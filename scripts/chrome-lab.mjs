#!/usr/bin/env node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const args = new Set(process.argv.slice(2));
const scenarioIndex = process.argv.indexOf("--scenario");
const scenario = scenarioIndex === -1 ? "elements" : process.argv[scenarioIndex + 1];
const port = Number(process.env.CARDINAL_CHROME_PORT ?? 9222);
const labUrl = process.env.CARDINAL_LAB_URL ?? "http://localhost:4173/";
const headless = args.has("--headless");
const keepOpen = args.has("--show");

if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid Chrome port: ${port}`);
if (typeof WebSocket !== "function") {
  throw new Error("Chrome automation requires Node 22+ with the built-in WebSocket API");
}
if (scenario !== "elements" && scenario !== "acceptance" && scenario !== "layout" && scenario !== "resize" && scenario !== "movement" && scenario !== "random" && scenario !== "spin-state" && scenario !== "performance") throw new Error(`Unknown Chrome lab scenario: ${scenario}`);

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`);
  return response.json();
}

async function chromeTargets() {
  return fetchJson(`http://127.0.0.1:${port}/json/list`);
}

async function labIsReady() {
  try {
    const response = await fetch(labUrl);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureLabServer() {
  if (await labIsReady()) return undefined;
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const server = spawn(npm, ["--prefix", "examples/card-engine-lab", "start"], {
    detached: keepOpen,
    stdio: "ignore",
  });
  const started = Date.now();
  while (Date.now() - started < 10000) {
    if (await labIsReady()) {
      if (keepOpen) server.unref();
      return server;
    }
    await delay(100);
  }
  server.kill("SIGTERM");
  throw new Error(`Cardinal lab server did not become ready at ${labUrl}`);
}

async function waitForChrome(timeout = 10000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const targets = await chromeTargets();
      if (targets.some((target) => target.type === "page")) return targets;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError ?? new Error("Chrome did not expose a page target");
}

function chromeExecutable() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  if (process.platform === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (process.platform === "win32") return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  return "google-chrome";
}

async function ensureChrome() {
  try {
    return { targets: await chromeTargets(), process: undefined };
  } catch {
    const profile = await mkdtemp(join(tmpdir(), "cardinal-chrome-"));
    const chrome = spawn(chromeExecutable(), [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      ...(headless ? ["--headless=new"] : []),
      "about:blank",
    ], { detached: keepOpen, stdio: "ignore" });
    if (keepOpen) chrome.unref();
    return { targets: await waitForChrome(), process: chrome };
  }
}

function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const resolve = pending.get(message.id);
    if (!resolve) return;
    pending.delete(message.id);
    if (message.error) resolve(Promise.reject(new Error(JSON.stringify(message.error))));
    else resolve(message.result);
  });
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const command = async (method, params = {}) => {
    await opened;
    const id = nextId++;
    const result = new Promise((resolve) => pending.set(id, resolve));
    socket.send(JSON.stringify({ id, method, params }));
    return result;
  };
  return { socket, command };
}

const elementScenario = String.raw`(async () => {
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const results = [];
  const state = () => ({
    renderer: document.querySelector("#renderer-status")?.textContent ?? "",
    status: document.querySelector("#status")?.textContent ?? "",
    selection: document.querySelector("#selection-status")?.textContent ?? "",
    pointer: document.querySelector("#pointer-status")?.dataset.pointerState
      ? JSON.parse(document.querySelector("#pointer-status").dataset.pointerState)
      : null,
    cards: [...document.querySelectorAll("#card-list label")].map((card) => card.textContent),
    elements: [...document.querySelectorAll("#element-list .element-row")].map((row) => ({
      name: row.querySelector(".element-name")?.textContent,
      visible: row.querySelector("input[type=checkbox]")?.checked,
      content: row.querySelector("input[type=text]")?.value,
      mode: row.querySelectorAll("select")[0]?.value,
      policy: row.querySelectorAll("select")[1]?.value,
    })),
    shells: document.querySelectorAll(".cardinal-webgl-card").length,
    backgroundSide: document.querySelector("#background-side")?.value,
    backgroundImage: document.querySelector("#background-image")?.value,
    text: [...document.querySelectorAll(".cardinal-webgl-card")].map((card) => card.textContent),
  });
  const click = (selector) => document.querySelector(selector)?.click();
  const setValue = (selector, value, eventName = "change") => {
    const element = document.querySelector(selector);
    if (!element) throw new Error("Missing " + selector);
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, String(value));
    element.dispatchEvent(new Event(eventName, { bubbles: true }));
  };
  const row = (prefix) => [...document.querySelectorAll("#element-list .element-row")]
    .find((candidate) => candidate.querySelector(".element-name")?.textContent.startsWith(prefix));
  const record = (label, predicate) => {
    const current = state();
    results.push({ label, pass: typeof predicate === "function" ? Boolean(predicate(current)) : Boolean(predicate), status: current.status, pointer: current.pointer });
  };
  const step = async (label, action, predicate) => {
    await action();
    await sleep(850);
    record(label, predicate);
  };

  await sleep(700);
  record("baseline WebGL lab", (current) => current.renderer.includes("Three.js WebGL")
    && current.shells === 1 && current.elements.length === 3);
  await step("track pointer coordinates", () => {
    const stage = document.querySelector("#stage");
    stage.scrollIntoView({ block: "center", inline: "center" });
    const rect = stage.getBoundingClientRect();
    stage.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }));
  }, () => {
    const pointer = JSON.parse(document.querySelector("#pointer-status").dataset.pointerState);
    return pointer.status === "observed" && pointer.insideStage === true
      && pointer.sceneX === 450 && pointer.sceneY === 250
      && pointer.target?.kind === "card-element" && pointer.target.elementId === "image";
  });
  await step("hide image", () => click('#element-list input[aria-label="Show image"]'), (current) => {
    const image = current.elements.find((element) => element.name?.startsWith("image"));
    return image?.visible === false && !current.text[0]?.includes("stylized red cardinal");
  });
  await step("restore image", () => click('#element-list input[aria-label="Show image"]'), (current) => {
    const image = current.elements.find((element) => element.name?.startsWith("image"));
    return image?.visible === true && current.text[0]?.includes("stylized red cardinal");
  });
  await step("remove flavour", () => row("flavour")?.querySelector("button:last-child")?.click(), (current) => {
    return !current.elements.some((element) => element.name?.startsWith("flavour"));
  });
  await step("add custom text", () => { setValue("#element-type", "text"); click("#add-element"); }, (current) => {
    return current.elements.some((element) => element.name?.startsWith("text-"));
  });
  await step("edit custom text", () => {
    const editor = row("text-")?.querySelector("input[type=text]");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(editor, "Custom field");
    editor.dispatchEvent(new Event("change", { bubbles: true }));
  }, (current) => current.elements.some((element) => element.content === "Custom field"));
  await step("reorder custom text", () => row("text-")?.querySelector("button:first-child")?.click(), (current) => {
    return current.elements[1]?.name?.startsWith("text-");
  });
  await step("overlay and preserve-space", () => {
    const selects = row("text-")?.querySelectorAll("select");
    selects[0].value = "overlay";
    selects[0].dispatchEvent(new Event("change", { bubbles: true }));
    selects[1].value = "preserve-space";
    selects[1].dispatchEvent(new Event("change", { bubbles: true }));
  }, (current) => {
    const element = current.elements.find((candidate) => candidate.name?.startsWith("text-"));
    return element?.mode === "overlay" && element?.policy === "preserve-space";
  });
  await step("hide and remove custom text", () => {
    row("text-")?.querySelector("input[type=checkbox]")?.click();
    row("text-")?.querySelector("button:last-child")?.click();
  }, (current) => !current.elements.some((element) => element.name?.startsWith("text-")));
  await step("add repeated image instances", () => {
    setValue("#element-type", "image");
    click("#add-element");
    click("#add-element");
  }, (current) => current.elements.filter((element) => element.name?.startsWith("image-")).length === 2);
  await step("add second card and select all", () => {
    click("#add-card");
    click("#select-all");
  }, (current) => current.shells === 2 && current.selection === "2 of 2 selected");
  await step("add element to multi-selection", () => {
    setValue("#element-type", "text");
    click("#add-element");
  }, (current) => current.text.filter((text) => text.includes("New text element")).length === 2);
  await step("remove element during movement", async () => {
    click('button[data-move-preset="right"]');
    await sleep(120);
    row("image")?.querySelector("button:last-child")?.click();
  }, (current) => !current.elements.some((element) => element.name === "image · image")
    && !current.status.includes("animating"));
  await step("add element during flip", async () => {
    click("#flip");
    await sleep(120);
    click("#add-element");
  }, (current) => current.shells === 2
    && current.elements.some((element) => element.name?.startsWith("text-"))
    && current.status.includes("physical back")
    && !current.status.includes("animating"));
  await step("set physical back background", () => {
    setValue("#background-side", "back");
    click('[data-background-preset="science-fiction"]');
  }, (current) => current.backgroundSide === "back"
    && current.backgroundImage.endsWith("science-fiction-space.jpg"));

  return { ok: results.every((result) => result.pass), results };
})()`;

const acceptanceScenario = String.raw`(async () => {
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const results = [];
  const state = () => ({
    renderer: document.querySelector("#renderer-status")?.textContent ?? "",
    status: document.querySelector("#status")?.textContent ?? "",
    shells: document.querySelectorAll(".cardinal-webgl-card").length,
    text: [...document.querySelectorAll(".cardinal-webgl-card")].map((card) => card.textContent),
  });
  const record = (label, predicate) => {
    const current = state();
    results.push({ label, pass: typeof predicate === "function" ? Boolean(predicate(current)) : Boolean(predicate), status: current.status });
  };
  const click = (selector) => document.querySelector(selector)?.click();
  const setValue = (selector, value) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error("Missing " + selector);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, String(value));
    element.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const waitForStable = async (milliseconds = 850) => {
    await sleep(milliseconds);
    return state();
  };
  const readX = (status) => Number(status.match(/ · x (-?\d+)/)?.[1]);

  await sleep(700);
  record("baseline WebGL card", (current) => current.renderer.includes("Three.js WebGL")
    && current.status.includes("physical front") && current.shells === 1);

  const inputStarted = performance.now();
  setValue("#move-x", 760);
  const inputLatencyMs = await new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now() - inputStarted)));
  const moved = await waitForStable();
  const landingDeltaPx = Math.abs(readX(moved.status) - 760);
  record("move lands at target", (current) => readX(current.status) === 760 && current.status.includes("stable"));

  click("#rotate");
  record("rotate settles", (await waitForStable()).status.includes("angle 45°"));
  click("#scale");
  record("scale settles", (await waitForStable()).status.includes("scale 1.00"));
  click('button[data-scale="2"]');
  await sleep(80);
  record("scale transition during motion keeps content", (current) => current.status.includes("animating")
    && current.text[0]?.includes("The Cardinal"));
  await waitForStable();
  for (const [label, value] of [["100%", 1], ["150%", 1.5], ["200%", 2]]) {
    setValue("#scale-slider", value);
    record(label + " scale settles with content", (await waitForStable()).status.includes("scale " + value.toFixed(2))
      && state().text[0]?.includes("The Cardinal"));
  }
  click("#flip");
  record("flip settles on back", (await waitForStable()).status.includes("physical back"));

  setValue("#flip-x-slider", 60);
  setValue("#flip-y-slider", 45);
  record("simultaneous X/Y flip settles", (await waitForStable()).status.includes("physical front"));
  setValue("#flip-y-slider", 90);
  record("edge-on pose keeps one shell", (await waitForStable()).status.includes("physical edge") && state().shells === 1);

  click("#combined");
  const combined = await waitForStable(1300);
  record("combined move rotate scale flip settles", combined.status.includes("stable") && state().shells === 1);

  click("#reduced");
  const reduced = await waitForStable();
  record("reduced motion settles immediately", reduced.status.includes("stable") && !reduced.status.includes("animating"));

  return {
    ok: results.every((result) => result.pass),
    results,
    measurements: { inputLatencyMs, landingDeltaPx },
  };
})()`;

const layoutScenario = String.raw`(async () => {
  const results = [];
  const record = (label, predicate) => results.push({ label, pass: Boolean(predicate()) });
  const rect = (element) => element?.getBoundingClientRect();
  const visible = (element) => {
    const bounds = rect(element);
    return Boolean(bounds && bounds.width > 0 && bounds.height > 0);
  };
  const within = (element, parent, tolerance = 1) => {
    const child = rect(element);
    const container = rect(parent);
    return Boolean(child && container
      && child.left >= container.left - tolerance
      && child.right <= container.right + tolerance);
  };
  const elementsPanel = document.querySelector(".elements-group");
  const stage = document.querySelector("#stage");
  const rows = [...document.querySelectorAll("#element-list .element-row")];
  record("WebGL lab is visible", () => document.querySelector("#renderer-status")?.textContent.includes("Three.js WebGL"));
  record("expanded rails use the side space", () => stage.clientWidth >= 1600);
  record("element rail is visible", () => visible(elementsPanel));
  record("element rows fit the rail", () => rows.length > 0 && rows.every((row) => within(row, elementsPanel)));
  record("element editors have usable width", () => rows.every((row) => {
    const editor = row.querySelector('input[type="text"]');
    const selects = [...row.querySelectorAll("select")];
    return Boolean(editor && editor.clientWidth >= 120 && selects.every((select) => select.clientWidth >= 90)
      && getComputedStyle(editor).backgroundColor !== "rgb(255, 255, 255)"
      && within(editor, row) && selects.every((select) => within(select, row)));
  }));
  record("element actions stay in one compact row", () => rows.every((row) => {
    const actions = row.querySelector(".element-actions");
    return Boolean(actions && actions.clientWidth >= 120 && actions.clientHeight <= 40 && within(actions, row));
  }));
  record("add-element controls fit the rail", () => within(document.querySelector("#add-element"), elementsPanel));
  record("model dropdowns align inside their boxes", () => ["#shape", "#face-count"].every((selector) => {
    const select = document.querySelector(selector);
    const row = select?.closest(".control-row");
    const label = row?.querySelector("span");
    const group = select?.closest(".control-group");
    const selectBounds = rect(select);
    const labelBounds = rect(label);
    const groupBounds = rect(group);
    return Boolean(selectBounds && labelBounds && groupBounds)
      && selectBounds.left >= labelBounds.right
      && selectBounds.right <= groupBounds.right - 12;
  }));
  record("background presets are available", () => {
    const buttons = [...document.querySelectorAll("[data-background-preset]")];
    const side = document.querySelector("#background-side");
    return buttons.length === 5
      && [...(side?.options ?? [])].some((option) => option.value === "back")
      && buttons.map((button) => button.textContent.trim()).join(",") === "Modern,Fantasy,Science fiction,Simple,None";
  });
  record("background URL editor matches element editors", () => {
    const editor = document.querySelector("#background-image");
    const elementEditor = document.querySelector('#element-list input[type="text"]');
    return Boolean(editor && elementEditor)
      && getComputedStyle(editor).backgroundColor === getComputedStyle(elementEditor).backgroundColor
      && getComputedStyle(editor).color === getComputedStyle(elementEditor).color
      && editor.clientWidth >= 120;
  });
  record("scale presets stay compact", () => document.querySelectorAll('[data-scale]').length === 5
    && [...document.querySelectorAll('[data-scale]')].map((button) => button.textContent.trim()).join(",") === "25%,50%,100%,150%,200%");
  const cardActions = document.querySelector(".cards-sidebar .presets");
  const cardList = document.querySelector("#card-list");
  const actionsTop = rect(cardActions)?.top;
  document.querySelector("#add-card")?.click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const addedTop = rect(cardActions)?.top;
  document.querySelector("#remove-cards")?.click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const removedTop = rect(cardActions)?.top;
  record("card collection actions stay above the changing list", () => Boolean(cardList && actionsTop !== undefined)
    && rect(cardActions).bottom <= rect(cardList).top
    && Math.abs(addedTop - actionsTop) <= 1
    && Math.abs(removedTop - actionsTop) <= 1);
  const fullWindowControl = document.querySelector("#full-window-control");
  fullWindowControl?.click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  record("full-window mode fills the viewport", () => {
    const bounds = rect(document.querySelector("#stage"));
    return Boolean(bounds
      && Math.abs(bounds.left) <= 1
      && Math.abs(bounds.top) <= 1
      && bounds.width >= innerWidth - 1
      && bounds.height >= innerHeight - 1
      && getComputedStyle(document.querySelector("h1")).display === "none"
      && getComputedStyle(document.querySelector(".cards-sidebar")).display === "none"
      && getComputedStyle(document.querySelector(".elements-sidebar")).display === "none"
      && fullWindowControl?.getAttribute("aria-pressed") === "true"
      && fullWindowControl?.textContent === "Exit full window");
  });
  fullWindowControl?.click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  record("full-window mode exits cleanly", () => document.body.classList.contains("stage-full-window") === false
    && fullWindowControl?.getAttribute("aria-pressed") === "false"
    && fullWindowControl?.textContent === "Full window");
  return { ok: results.every((result) => result.pass), results };
})()`;

const resizeScenario = String.raw`(async () => {
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const results = [];
  const stage = document.querySelector("#stage");
  const state = () => ({
    renderer: document.querySelector("#renderer-status")?.textContent ?? "",
    status: document.querySelector("#status")?.textContent ?? "",
    pointer: document.querySelector("#pointer-status")?.dataset.pointerState
      ? JSON.parse(document.querySelector("#pointer-status").dataset.pointerState)
      : null,
    stage: { width: stage.clientWidth, height: stage.clientHeight },
    canvas: { width: stage.querySelector("canvas")?.width, height: stage.querySelector("canvas")?.height },
    shells: document.querySelectorAll(".cardinal-webgl-card").length,
  });
  const record = (label, predicate) => {
    const current = state();
    results.push({ label, pass: Boolean(predicate(current)), status: current.status, pointer: current.pointer });
  };
  const centerPointer = (x = 450, y = 250) => {
    const bounds = stage.getBoundingClientRect();
    stage.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: bounds.left + bounds.width / 2 + (x - 450),
      clientY: bounds.top + bounds.height / 2 + (y - 250),
    }));
  };
  const resizeStage = async (width, height) => {
    stage.style.width = width + "px";
    stage.style.height = height + "px";
    await sleep(120);
  };

  await sleep(700);
  record("baseline WebGL scene", (current) => current.renderer.includes("Three.js WebGL") && current.shells === 1);
  centerPointer();
  await sleep(80);
  record("baseline logical center is hittable", (current) => current.pointer?.insideStage === true
    && current.pointer.sceneX === 450 && current.pointer.sceneY === 250
    && current.pointer.target?.kind === "card-element" && current.pointer.target.elementId === "image");

  for (const [label, width, height] of [["narrow", 1000, 650], ["wide", 1700, 850], ["tall", 1200, 1000]]) {
    await resizeStage(width, height);
    centerPointer();
    await sleep(80);
    record(label + " resize follows stage", (current) => current.stage.width === width
      && current.stage.height === height
      && current.canvas.width === width
      && current.canvas.height === height
      && current.pointer?.sceneX === 450
      && current.pointer?.sceneY === 250
      && current.pointer.target?.elementId === "image");
  }

  for (const [width, height] of [[1400, 760], [1500, 820], [1300, 720], [1376, 994]]) {
    stage.style.width = width + "px";
    stage.style.height = height + "px";
  }
  await sleep(120);
  centerPointer();
  await sleep(80);
  record("rapid resize settles on the final stage", (current) => current.stage.width === 1376
    && current.stage.height === 994
    && current.canvas.width === 1376
    && current.canvas.height === 994
    && current.pointer?.sceneX === 450
    && current.pointer?.sceneY === 250
    && current.pointer.target?.elementId === "image");

  await resizeStage(1376, 994);
  document.querySelector("#move").click();
  await sleep(120);
  await resizeStage(1100, 700);
  await sleep(850);
  record("resize during movement keeps the endpoint", (current) => current.status.includes("x 1138")
    && current.status.includes("stable")
    && current.canvas.width === 1100 && current.canvas.height === 700);

  return { ok: results.every((result) => result.pass), results };
})()`;

const movementScenario = String.raw`(async () => {
  const results = [];
  const stage = document.querySelector("#stage");
  const moveX = document.querySelector("#move-x");
  const moveY = document.querySelector("#move-y");
  const cameraCenter = { x: 450, y: 250 };
  const visibleWorld = () => ({
    left: cameraCenter.x - stage.clientWidth / 2,
    right: cameraCenter.x + stage.clientWidth / 2,
    top: cameraCenter.y - stage.clientHeight / 2,
    bottom: cameraCenter.y + stage.clientHeight / 2,
  });
  const record = (label, predicate) => results.push({ label, pass: Boolean(predicate()), details: {
    x: { min: moveX?.min, max: moveX?.max },
    y: { min: moveY?.min, max: moveY?.max },
    visible: visibleWorld(),
  }});
  const setRange = (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  await new Promise((resolve) => setTimeout(resolve, 700));
  record("move controls cover the visible world", () => {
    const world = visibleWorld();
    return Number(moveX?.min) <= Math.floor(world.left)
      && Number(moveX?.max) >= Math.ceil(world.right)
      && Number(moveY?.min) <= Math.floor(world.top)
      && Number(moveY?.max) >= Math.ceil(world.bottom);
  });
  setRange(moveX, moveX.max);
  await new Promise((resolve) => setTimeout(resolve, 850));
  record("card reaches the visible right edge", () => document.querySelector("#status")?.textContent.includes("x " + moveX.max));
  return { ok: results.every((result) => result.pass), results };
})()`;

const randomScenario = String.raw`(async () => {
  const results = [];
  const randomButton = document.querySelector("#random");
  const status = () => document.querySelector("#status")?.textContent ?? "";
  const record = (label, predicate) => results.push({ label, pass: Boolean(predicate()) });
  await new Promise((resolve) => setTimeout(resolve, 700));
  Math.random = () => 0.75;
  randomButton?.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  record("random motion starts smoothly", () => randomButton?.getAttribute("aria-pressed") === "true"
    && status().includes("animating") && status().includes("random motion"));
  randomButton?.click();
  await new Promise((resolve) => setTimeout(resolve, 850));
  record("random motion stops after the current cycle", () => randomButton?.getAttribute("aria-pressed") === "false"
    && status().includes("stable") && !status().includes("random motion") && !status().includes("x 450 · y 250 ·"));
  return { ok: results.every((result) => result.pass), results };
})()`;

const spinStateScenario = String.raw`(async () => {
  const results = [];
  const spinButton = document.querySelector("#spin");
  const randomButton = document.querySelector("#random");
  const status = () => document.querySelector("#status")?.textContent ?? "";
  const record = (label, predicate) => results.push({ label, pass: Boolean(predicate()) });
  await new Promise((resolve) => setTimeout(resolve, 700));
  Math.random = () => 0.75;
  spinButton?.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  record("spin toggle reflects an active spin", () => spinButton?.getAttribute("aria-pressed") === "true" && status().includes("animating"));
  randomButton?.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  randomButton?.click();
  await new Promise((resolve) => setTimeout(resolve, 850));
  record("spin toggle clears when its engine channel is cancelled", () => spinButton?.getAttribute("aria-pressed") === "false" && !status().includes("animating"));
  return { ok: results.every((result) => result.pass), results };
})()`;

const performanceScenario = String.raw`(async () => {
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const results = [];
  const record = (label, predicate, details) => results.push({ label, pass: Boolean(predicate()), details });
  const addCard = document.querySelector("#add-card");
  const selectAll = document.querySelector("#select-all");
  const move = document.querySelector("#move");
  if (!addCard || !selectAll || !move) throw new Error("Performance controls are unavailable");

  await sleep(700);
  const setupStart = performance.now();
  for (let index = 1; index < 200; index += 1) addCard.click();
  const setupMs = performance.now() - setupStart;
  await sleep(2500);
  selectAll.click();
  await nextFrame();

  const actionStart = performance.now();
  move.click();
  const actionReturned = performance.now();
  const frameTimes = [];
  await new Promise((resolve) => {
    const sampleStart = performance.now();
    const sample = (now) => {
      frameTimes.push(now);
      if (now - sampleStart < 1000) requestAnimationFrame(sample);
      else resolve();
    };
    requestAnimationFrame(sample);
  });
  await sleep(1200);

  const intervals = frameTimes.slice(1).map((time, index) => time - frameTimes[index]);
  const sorted = [...intervals].sort((a, b) => a - b);
  const percentile = (values, fraction) => values.length
    ? values[Math.min(values.length - 1, Math.floor(values.length * fraction))]
    : 0;
  const details = {
    cards: document.querySelectorAll("#card-list label").length,
    shells: document.querySelectorAll(".cardinal-webgl-card").length,
    setupMs: Number(setupMs.toFixed(1)),
    actionHandlerMs: Number((actionReturned - actionStart).toFixed(1)),
    frames: frameTimes.length,
    firstFrameDelayMs: Number((frameTimes[0] - actionStart).toFixed(1)),
    medianFrameMs: Number(percentile(sorted, 0.5).toFixed(1)),
    p95FrameMs: Number(percentile(sorted, 0.95).toFixed(1)),
    missedFramesOver20Ms: intervals.filter((interval) => interval > 20).length,
    status: document.querySelector("#status")?.textContent ?? "",
    renderer: document.querySelector("#renderer-status")?.textContent ?? "",
  };
  record("200-card cohort mounts", () => details.cards === 200 && details.shells === 200, details);
  record("200-card cohort settles", () => details.frames > 0 && details.status.includes("200 cards") && details.status.includes("stable"), details);

  document.querySelector("#remove-cards")?.click();
  await sleep(700);
  addCard.click();
  await sleep(700);
  return { ok: results.every((result) => result.pass), results, measurements: details };
})()`;

async function run() {
  const server = await ensureLabServer();
  let chrome;
  let connection;
  try {
    chrome = await ensureChrome();
    const target = chrome.targets.find((candidate) => candidate.type === "page");
    if (!target) throw new Error("Chrome did not expose a page target");
    connection = connect(target);
    if (headless) {
      await connection.command("Emulation.setDeviceMetricsOverride", {
        width: 2515,
        height: 1322,
        deviceScaleFactor: 1,
        mobile: false,
      });
    } else {
      await connection.command("Emulation.clearDeviceMetricsOverride");
    }
    await connection.command("Page.navigate", { url: labUrl });
    await delay(1200);
    const evaluation = await connection.command("Runtime.evaluate", {
      expression: scenario === "elements" ? elementScenario
        : scenario === "layout" ? layoutScenario
          : scenario === "resize" ? resizeScenario
              : scenario === "movement" ? movementScenario
              : scenario === "random" ? randomScenario
              : scenario === "spin-state" ? spinStateScenario
              : scenario === "performance" ? performanceScenario
              : acceptanceScenario,
      awaitPromise: true,
      returnByValue: true,
    });
    if (evaluation.exceptionDetails) throw new Error(evaluation.exceptionDetails.text ?? "Chrome lab scenario threw");
    const report = evaluation.result?.value;
    for (const result of report?.results ?? []) {
      console.log(`${result.pass ? "PASS" : "FAIL"} ${result.label}: ${result.status}`);
      if (!result.pass && result.pointer) console.log(`  pointer: ${JSON.stringify(result.pointer)}`);
      if (!result.pass && result.details) console.log(`  details: ${JSON.stringify(result.details)}`);
    }
    if (!report || report.ok !== true) throw new Error("Chrome lab scenario failed");
    if (report.measurements?.inputLatencyMs !== undefined) console.log(`Chrome measurements: input latency ${report.measurements.inputLatencyMs.toFixed(2)} ms · landing delta ${report.measurements.landingDeltaPx.toFixed(0)} px`);
    if (scenario === "performance" && report.measurements) {
      const measurements = report.measurements;
      console.log(`Chrome performance: ${measurements.cards} cards · setup ${measurements.setupMs.toFixed(1)} ms · handler ${measurements.actionHandlerMs.toFixed(1)} ms · ${measurements.frames} frames · first frame ${measurements.firstFrameDelayMs.toFixed(1)} ms · median ${measurements.medianFrameMs.toFixed(1)} ms · p95 ${measurements.p95FrameMs.toFixed(1)} ms · missed >20 ms ${measurements.missedFramesOver20Ms}`);
    }
    console.log(`Chrome lab scenario '${scenario}' passed (${report.results.length} checks)`);
  } finally {
    connection?.socket.close();
    if (chrome?.process && !keepOpen) chrome.process.kill("SIGTERM");
    if (server && !keepOpen) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Chrome lab scenario failed: ${error.message}`);
  process.exitCode = 1;
});
