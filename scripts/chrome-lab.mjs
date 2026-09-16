#!/usr/bin/env node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const inputScenarios = {
  batch: async (options) => (await import("./chrome-batch-scenario.mjs")).runBatchScenario(options),
  "mobile-scale": async (options) => (await import("./chrome-mobile-scale.mjs")).runMobileScaleScenario(options),
  drag: async (options) => (await import("./chrome-drag-scenario.mjs")).runDragScenario(options),
  "drag-geometry": async (options) => (await import("./chrome-drag-geometry.mjs")).runDragGeometryScenario(options),
  "drag-performance": async (options) => (await import("./chrome-drag-performance.mjs")).runDragPerformanceScenario(options),
};

const args = new Set(process.argv.slice(2));
const scenarioIndex = process.argv.indexOf("--scenario");
const scenario = scenarioIndex === -1 ? "elements" : process.argv[scenarioIndex + 1];
const browserIndex = process.argv.indexOf("--browser");
const browser = browserIndex === -1 ? "chrome" : process.argv[browserIndex + 1];
const browserLabel = browser === "edge" ? "Edge" : "Chrome";
const port = Number(process.env.CARDINAL_CHROME_PORT ?? 9222);
const labUrl = process.env.CARDINAL_LAB_URL ?? "http://localhost:4173/";
const headless = args.has("--headless");
const minimumFps = Number(process.env.CARDINAL_MIN_FPS ?? 0);
const deviceScaleFactor = Number(process.env.CARDINAL_DEVICE_SCALE_FACTOR ?? (headless ? 1 : 0));
const keepOpen = args.has("--show");

if (!new Set(["chrome", "edge"]).has(browser)) throw new Error(`Unknown Chromium browser: ${browser}`);
if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid ${browserLabel} port: ${port}`);
if (typeof WebSocket !== "function") {
  throw new Error(`${browserLabel} automation requires Node 22+ with the built-in WebSocket API`);
}
if (!new Set(["elements", "acceptance", "layout", "resize", "movement", "random", "spin-state", "demo-toggles", "performance", "random-performance", "diagnostics", "zones", "main-zones", ...Object.keys(inputScenarios)]).has(scenario)) throw new Error(`Unknown ${browserLabel} lab scenario: ${scenario}`);

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`);
  return response.json();
}

async function chromiumTargets() {
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

async function waitForBrowser(timeout = 10000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const targets = await chromiumTargets();
      if (targets.some((target) => target.type === "page")) return targets;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError ?? new Error(`${browserLabel} did not expose a page target`);
}

function browserExecutable() {
  const explicit = browser === "edge" ? process.env.EDGE_BIN : process.env.CHROME_BIN;
  if (explicit) return explicit;
  if (process.platform === "darwin") {
    return browser === "edge"
      ? "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
      : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  if (process.platform === "win32") {
    return browser === "edge"
      ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
      : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }
  return browser === "edge" ? "microsoft-edge" : "google-chrome";
}

async function ensureBrowser() {
  try {
    return { targets: await chromiumTargets(), process: undefined };
  } catch {
    const profile = await mkdtemp(join(tmpdir(), `cardinal-${browser}-`));
    const chromium = spawn(browserExecutable(), [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      ...(headless ? ["--headless=new"] : []),
      "about:blank",
    ], { detached: keepOpen, stdio: "ignore" });
    if (keepOpen) chromium.unref();
    return { targets: await waitForBrowser(), process: chromium };
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
  const showDemo = new URLSearchParams(location.search).has("show-demo");
  const stepPause = showDemo ? 1800 : 850;
  const results = [];
  const state = () => ({
    renderer: document.querySelector("#renderer-status")?.textContent ?? "",
    status: document.querySelector("#status")?.getAttribute("aria-label") ?? document.querySelector("#status")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    fps: document.querySelector("#fps-status")?.textContent ?? "",
    diagnostics: document.querySelector("#diagnostics-report")?.textContent ?? "",
    selection: document.querySelector("#selection-status")?.textContent ?? "",
    pointer: document.querySelector("#pointer-status")?.dataset.pointerState
      ? JSON.parse(document.querySelector("#pointer-status").dataset.pointerState)
      : null,
    cards: [...document.querySelectorAll("#card-list label")].map((card) => card.textContent),
    elements: [...document.querySelectorAll("#element-list .element-row")].map((row) => ({
      name: row.querySelector(".element-name")?.textContent,
      visible: row.querySelector("input[type=checkbox]")?.checked,
      content: row.querySelector("input[type=text], input[type=number]")?.value,
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
    setValueToElement(element, value, eventName);
  };
  const setValueToElement = (element, value, eventName = "change") => {
    if (!element) throw new Error("Missing element");
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
    await sleep(stepPause);
    record(label, predicate);
  };

  await sleep(showDemo ? 2500 : 700);
  record("baseline WebGL lab", (current) => current.renderer.includes("Three.js WebGL")
    && current.shells === 1 && current.elements.length >= 5
    && ["title", "image", "flavour"].every((id) => current.elements.some((element) => element.name?.startsWith(id)))
    && (current.elements.find((element) => element.name?.startsWith("flavour"))?.content?.length ?? 0) > 0
    && (current.elements.find((element) => element.name?.startsWith("flavour"))?.content?.length ?? Infinity) <= 40
    && (() => {
      const size = current.status.match(/size (\d+)×(\d+)/);
      const ratio = size ? Number(size[1]) / Number(size[2]) : NaN;
      return ratio >= 0.70 && ratio <= 0.73;
    })()
    && current.fps.includes("FPS:")
    && current.diagnostics.includes("devicePixelRatio") && current.diagnostics.includes("webgl"));
  await step("deselect all cards", () => click("#deselect-all"), (current) => current.selection === "0 of 1 selected");
  await step("select all cards", () => click("#select-all"), (current) => current.selection === "1 of 1 selected");
  await step("track pointer coordinates", () => {
    const stage = document.querySelector("#stage");
    const dimensions = document.querySelector("#status").getAttribute("aria-label").match(/size ([0-9.]+)×([0-9.]+).*scale ([0-9.]+)/);
    const scale = Number(dimensions?.[3] ?? 1);
    stage.scrollIntoView({ block: "center", inline: "center" });
    const rect = document.querySelector("#zone-reserve").getBoundingClientRect();
    stage.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: rect.left + Number(dimensions?.[1] ?? 180) * scale / 2,
      clientY: rect.top + Number(dimensions?.[2] ?? 250) * scale / 2,
    }));
  }, () => {
    const pointer = JSON.parse(document.querySelector("#pointer-status").dataset.pointerState);
    return pointer.status === "observed" && pointer.insideStage === true
      && pointer.target?.kind === "card-element" && pointer.target.elementId === "image";
  });
  await step("hide image", () => click('#element-list input[aria-label="Show image"]'), (current) => {
    const image = current.elements.find((element) => element.name?.startsWith("image"));
    return image?.visible === false && !current.text[0]?.includes("majestic red cardinal");
  });
  await step("restore image", () => click('#element-list input[aria-label="Show image"]'), (current) => {
    const image = current.elements.find((element) => element.name?.startsWith("image"));
    return image?.visible === true && current.text[0]?.includes("majestic red cardinal");
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
  let customTextIndex;
  await step("reorder custom text", () => {
    customTextIndex = state().elements.findIndex((element) => element.name?.startsWith("text-"));
    row("text-")?.querySelector("button:first-child")?.click();
  }, (current) => {
    const nextIndex = current.elements.findIndex((element) => element.name?.startsWith("text-"));
    return nextIndex >= 0 && nextIndex < customTextIndex;
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
  await step("add adjustable white space", () => {
    setValue("#element-type", "spacer");
    click("#add-element");
  }, (current) => current.elements.some((element) => element.name?.startsWith("spacer-") && element.content === "24"));
  await step("resize adjustable white space", () => {
    const editor = row("spacer-")?.querySelector("input[type=number]");
    setValueToElement(editor, 48);
  }, (current) => current.elements.some((element) => element.name?.startsWith("spacer-") && element.content === "48"));
  await step("remove adjustable white space", () => row("spacer-")?.querySelector("button:last-child")?.click(), (current) => {
    return !current.elements.some((element) => element.name?.startsWith("spacer-"));
  });
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
    click('[data-background-preset="b4"]');
  }, (current) => current.backgroundSide === "back"
    && current.backgroundImage.endsWith("b4.png"));

  return { ok: results.every((result) => result.pass), results };
})()`;

const acceptanceScenario = String.raw`(async () => {
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const results = [];
  const state = () => ({
    renderer: document.querySelector("#renderer-status")?.textContent ?? "",
    status: document.querySelector("#status")?.getAttribute("aria-label") ?? document.querySelector("#status")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
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

  click('button[data-rotate="45"]');
  record("rotate settles", (await waitForStable()).status.includes("angle 45°"));
  setValue("#scale-slider", 1.25);
  record("scale settles", (await waitForStable()).status.includes("scale 1.25"));
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
  click('button[data-flip="1"]');
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

const demoTogglesScenario = String.raw`(async () => {
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const results = [];
  const module = await import([...document.querySelectorAll('script[type="module"]')].at(-1).src);
  const scene = () => module.getScene()?.snapshot();
  const pose = () => scene()?.visual?.[0]?.pose;
  const record = (label, predicate) => results.push({ label, pass: Boolean(predicate()) });
  const click = (selector) => document.querySelector(selector)?.click();
  await sleep(700);

  const beforeMove = pose();
  click("#move");
  await sleep(350);
  const afterMove = pose();
  record("move toggle starts continuous bounded motion", () => document.querySelector("#move")?.getAttribute("aria-pressed") === "true"
    && (Math.abs(afterMove.x - beforeMove.x) > 1 || Math.abs(afterMove.y - beforeMove.y) > 1));
  click("#move");
  record("move toggle stops", () => document.querySelector("#move")?.getAttribute("aria-pressed") === "false");

  const beforeRotate = pose()?.angle;
  click("#rotate");
  await sleep(250);
  const afterRotate = pose()?.angle;
  record("rotate toggle continuously changes angle", () => document.querySelector("#rotate")?.getAttribute("aria-pressed") === "true"
    && Math.abs(afterRotate - beforeRotate) > 1);
  click("#rotate");

  const beforeScale = pose()?.scale;
  click("#scale");
  await sleep(350);
  const afterScale = pose()?.scale;
  record("scale toggle continuously changes size", () => document.querySelector("#scale")?.getAttribute("aria-pressed") === "true"
    && Math.abs(afterScale - beforeScale) > 0.01);
  click("#scale");

  click("#flip");
  await sleep(500);
  record("flip toggle repeatedly changes the physical face", () => document.querySelector("#flip")?.getAttribute("aria-pressed") === "true"
    && scene()?.visual?.[0]?.physicalSide === "back");
  click("#flip");

  click("#move");
  click("#rotate");
  click("#scale");
  click("#flip");
  await sleep(150);
  record("demo toggles compose independently", () => ["move", "rotate", "scale", "flip"]
    .every((id) => document.querySelector("#" + id)?.getAttribute("aria-pressed") === "true"));
  click("#move");
  click("#rotate");
  click("#scale");
  click("#flip");
  return { ok: results.every((result) => result.pass), results };
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
  const elementsDefaultCollapsed = elementsPanel?.open === false;
  elementsPanel.open = true;
  const stage = document.querySelector("#stage");
  const rows = [...document.querySelectorAll("#element-list .element-row")];
  record("WebGL lab is visible", () => document.querySelector("#renderer-status")?.textContent.includes("Three.js WebGL"));
  record("renderer and FPS share a status row", () => document.querySelector("#renderer-status")?.parentElement === document.querySelector("#fps-status")?.parentElement);
  record("status uses a plain inline sentence with literal dividers", () => {
    const status = document.querySelector("#status");
    return Boolean(status?.textContent.includes(" · ")
      && getComputedStyle(status).whiteSpace === "nowrap"
      && status.querySelectorAll(".status-unit, .status-separator").length === 0);
  });
  record("cards render above zone guides", () => getComputedStyle(document.querySelector("#stage > .cardinal-webgl-canvas"))?.zIndex === "2"
    && getComputedStyle(document.querySelector("#zone-archive"))?.zIndex === "1");
  record("expanded rails use the side space", () => stage.clientWidth >= 1600);
  record("side rails use matching widths", () => {
    const left = document.querySelector(".cards-sidebar")?.getBoundingClientRect();
    const right = document.querySelector(".elements-sidebar")?.getBoundingClientRect();
    return Boolean(left && right) && Math.abs(left.width - right.width) <= 1;
  });
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
    return buttons.length === 6
      && [...(side?.options ?? [])].some((option) => option.value === "back")
      && buttons.map((button) => button.textContent.trim()).join(",") === "B1 · Ember,B2 · Azure,B3 · Grove,B4 · Circuit,B5 · Parchment,None";
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
  const speedLayout = (() => {
    const toolbar = document.querySelector(".motion-actions");
    const speed = document.querySelector("#motion-speed-control");
    const firstButton = toolbar?.querySelector("button");
    const speedRect = rect(speed);
    const buttonRect = rect(firstButton);
    return {
      inToolbar: speed?.parentElement === toolbar,
      isFirst: toolbar?.firstElementChild === speed,
      speedHeight: speedRect?.height,
      buttonHeight: buttonRect?.height,
      heightMatch: speedRect && buttonRect && Math.abs(speedRect.height - buttonRect.height) <= 2,
    };
  })();
  record("target speed is the first button-sized stage control", () => speedLayout.inToolbar
    && speedLayout.isFirst && speedLayout.heightMatch);
  const cardActions = document.querySelector(".cards-sidebar .presets");
  const cardList = document.querySelector("#card-list");
  const spawnZone = document.querySelector("#spawn-zone");
  const actionsTop = rect(cardActions)?.top;
  record("card actions fit the card rail", () => {
    const buttons = [...(cardActions?.querySelectorAll("button") ?? [])];
    return buttons.length === 4 && buttons.every((button) => within(button, cardActions));
  });
  if (spawnZone) spawnZone.value = "archive";
  document.querySelector("#add-card")?.click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const spawnedInArchive = Boolean(cardList?.querySelector('.card-zone[data-zone-id="archive"]')
    && spawnZone?.value === "archive");
  const addedTop = rect(cardActions)?.top;
  document.querySelector("#remove-cards")?.click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const removedTop = rect(cardActions)?.top;
  record("card collection actions stay above the changing list", () => Boolean(cardList && actionsTop !== undefined)
    && rect(cardActions).bottom <= rect(cardList).top
    && Math.abs(addedTop - actionsTop) <= 1
    && Math.abs(removedTop - actionsTop) <= 1
    && spawnedInArchive);
  record("lab logo sits above the Cards toolbox corner", () => {
    const cardsGroup = document.querySelector(".cards-sidebar > .control-group");
    const logo = document.querySelector(".lab-header .lab-logo");
    const logoRect = logo?.getBoundingClientRect();
    const cardsRect = cardsGroup?.getBoundingClientRect();
    return Boolean(logo) && logo.getAttribute("alt")?.includes("lab logo")
      && getComputedStyle(logo).pointerEvents === "none"
      && logoRect && cardsRect && logoRect.bottom >= cardsRect.top - 1
      && logoRect.left <= cardsRect.left + 2;
  });
  const transferButtons = [...document.querySelectorAll(".zone-actions [data-transfer-zone]")];
  record("send-to-zone buttons follow stage order and colors", () =>
    transferButtons.map((button) => button.textContent.trim()).join(",") === "Lake,River,Ocean"
    && transferButtons.every((button) => {
      const zone = document.querySelector("#zone-" + button.dataset.transferZone + " span");
      return zone && getComputedStyle(button).color === getComputedStyle(zone).color;
    }));
  const toolboxes = [...document.querySelectorAll(".lab-workspace details.control-group")];
  const cardsBox = toolboxes.find((box) => box.querySelector(":scope > summary")?.textContent.trim() === "Cards");
  record("control boxes are keyboard-accessible collapsible panels", () => {
    const initiallyOpen = toolboxes.filter((box) => box.open).map((box) => box.querySelector(":scope > summary")?.textContent.trim());
    const summaryRect = cardsBox?.querySelector(":scope > summary")?.getBoundingClientRect();
    const cardsRect = cardsBox?.getBoundingClientRect();
    cardsBox?.querySelector(":scope > summary")?.click();
    const collapsed = cardsBox?.open === false;
    cardsBox?.querySelector(":scope > summary")?.click();
    return toolboxes.length === 11 && initiallyOpen.join(",") === "Cards,Zones,Elements"
      && elementsDefaultCollapsed && collapsed && cardsBox?.open === true
      && summaryRect && cardsRect && summaryRect.width >= cardsRect.width - 2;
  });
  const railTitles = (rail) => [...rail.querySelectorAll(":scope > details.control-group > summary")].map((summary) => summary.textContent.trim());
  record("toolboxes follow the scene-and-card workflow order", () =>
    railTitles(document.querySelector(".cards-sidebar")).join(",") === "Cards,Zones,Drag"
    && railTitles(document.querySelector(".elements-sidebar")).join(",") === "Scale,Shape,Dimensions,Move,Rotate,Flip,Logical faces,Elements");
  record("collapsing panels reserves stable scrollbar space", () => getComputedStyle(document.documentElement).scrollbarGutter.includes("stable"));
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
  document.querySelector("#animation-test")?.click();
  await new Promise((resolve) => setTimeout(resolve, 10200));
  record("ten-second animation test settles", () => document.querySelector("#animation-test")?.disabled === false
    && document.querySelector("#animation-test")?.textContent === "Test"
    && document.querySelector("#status")?.getAttribute("aria-label")?.includes("x 450 · y 250")
    && document.querySelector("#status")?.getAttribute("aria-label")?.includes("angle 0°")
    && document.querySelector("#status")?.getAttribute("aria-label")?.includes("scale 1.00")
    && document.querySelector("#status")?.getAttribute("aria-label")?.includes("stable"));
  return { ok: results.every((result) => result.pass), results };
})()`;

const resizeScenario = String.raw`(async () => {
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const results = [];
  const stage = document.querySelector("#stage");
  const state = () => ({
    renderer: document.querySelector("#renderer-status")?.textContent ?? "",
    status: document.querySelector("#status")?.getAttribute("aria-label") ?? document.querySelector("#status")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
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
  const centerPointer = () => {
    const zone = document.querySelector("#zone-reserve").getBoundingClientRect();
    const dimensions = document.querySelector("#status").getAttribute("aria-label").match(/size ([0-9.]+)×([0-9.]+).*scale ([0-9.]+)/);
    const scale = Number(dimensions?.[3] ?? 1);
    stage.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: zone.left + Number(dimensions?.[1] ?? 180) * scale / 2,
      clientY: zone.top + Number(dimensions?.[2] ?? 250) * scale / 2,
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
  record("baseline reserve placement is hittable", (current) => current.pointer?.insideStage === true
    && current.pointer.target?.kind === "card-element" && current.pointer.target.elementId === "image");

  for (const [label, width, height] of [["narrow", 1000, 650], ["wide", 1700, 850], ["tall", 1200, 1000]]) {
    await resizeStage(width, height);
    await sleep(850);
    centerPointer();
    await sleep(80);
    record(label + " resize follows stage", (current) => current.stage.width === width
      && current.stage.height === height
      && current.canvas.width === width
      && current.canvas.height === height
      && current.pointer.target?.elementId === "image");
  }

  for (const [width, height] of [[1400, 760], [1500, 820], [1300, 720], [1376, 994]]) {
    stage.style.width = width + "px";
    stage.style.height = height + "px";
  }
  await sleep(120);
  await sleep(850);
  centerPointer();
  await sleep(80);
  record("rapid resize settles on the final stage", (current) => current.stage.width === 1376
    && current.stage.height === 994
    && current.canvas.width === 1376
    && current.canvas.height === 994
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
  const motionSpeed = document.querySelector("#motion-speed");
  const labModule = await import([...document.querySelectorAll('script[type="module"]')].at(-1).src);
  const liveScene = () => labModule.getScene()?.snapshot();
  let fastSnapshot;
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
    status: document.querySelector("#status")?.getAttribute("aria-label") ?? document.querySelector("#status")?.textContent?.replace(/\s+/g, " ").trim(),
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
  record("target speed control is available", () => motionSpeed?.min === "0.25"
    && motionSpeed?.max === "2" && document.querySelector("#motion-speed-value")?.textContent === "1×");
  setRange(motionSpeed, 2);
  document.querySelector('button[data-move-preset="right"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 450));
  fastSnapshot = liveScene();
  record("fast target movement reaches its target", () => document.querySelector("#status")?.getAttribute("aria-label")?.includes("stable")
    && Math.abs((fastSnapshot?.visual?.[0]?.pose?.x ?? NaN) - Number(moveX?.value)) < 1);
  setRange(motionSpeed, 0.25);
  document.querySelector('button[data-move-preset="left"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 450));
  const slowSnapshot = liveScene();
  record("slow target movement remains animated longer", () => document.querySelector("#status")?.getAttribute("aria-label")?.includes("animating")
    && Math.abs((slowSnapshot?.desired?.cards?.[0]?.pose?.x ?? NaN) - Number(moveX?.value)) < 1
    && Math.abs((slowSnapshot?.visual?.[0]?.pose?.x ?? NaN) - Number(moveX?.value)) > 1);
  return { ok: results.every((result) => result.pass), results };
})()`;

const randomScenario = String.raw`(async () => {
  const results = [];
  const randomButton = document.querySelector("#random");
  const status = () => document.querySelector("#status")?.getAttribute("aria-label") ?? document.querySelector("#status")?.textContent.replace(/\s+/g, " ").trim() ?? "";
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
  const status = () => document.querySelector("#status")?.getAttribute("aria-label") ?? document.querySelector("#status")?.textContent.replace(/\s+/g, " ").trim() ?? "";
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
    status: document.querySelector("#status")?.getAttribute("aria-label") ?? document.querySelector("#status")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
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

const randomPerformanceScenario = String.raw`(async () => {
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const results = [];
  const addCard = document.querySelector("#add-card");
  const selectAll = document.querySelector("#select-all");
  const randomButton = document.querySelector("#random");
  if (!addCard || !selectAll || !randomButton) throw new Error("Random performance controls are unavailable");

  await sleep(700);
  for (let index = 1; index < 10; index += 1) addCard.click();
  await sleep(1800);
  selectAll.click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  randomButton.click();
  await sleep(250);

  const frameTimes = [];
  const sampleStart = performance.now();
  await new Promise((resolve) => {
    const sample = (now) => {
      frameTimes.push(now);
      if (now - sampleStart < 3000) requestAnimationFrame(sample);
      else resolve();
    };
    requestAnimationFrame(sample);
  });
  randomButton.click();
  await sleep(1200);

  const intervals = frameTimes.slice(1).map((time, index) => time - frameTimes[index]);
  const sorted = [...intervals].sort((a, b) => a - b);
  const percentile = (values, fraction) => values.length
    ? values[Math.min(values.length - 1, Math.floor(values.length * fraction))]
    : 0;
  const elapsedMs = frameTimes.length > 1 ? frameTimes.at(-1) - frameTimes[0] : 0;
  const fps = elapsedMs > 0 ? (frameTimes.length - 1) * 1000 / elapsedMs : 0;
  const details = {
    cards: document.querySelectorAll("#card-list label").length,
    shells: document.querySelectorAll(".cardinal-webgl-card").length,
    frames: frameTimes.length,
    fps: Number(fps.toFixed(1)),
    medianFrameMs: Number(percentile(sorted, 0.5).toFixed(1)),
    p95FrameMs: Number(percentile(sorted, 0.95).toFixed(1)),
    missedFramesOver20Ms: intervals.filter((interval) => interval > 20).length,
    status: document.querySelector("#status")?.getAttribute("aria-label") ?? document.querySelector("#status")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    renderer: document.querySelector("#renderer-status")?.textContent ?? "",
  };
  results.push({
    label: "10-card random-motion cohort mounts and animates",
    pass: details.cards === 10 && details.shells === 10 && details.frames > 0 && details.renderer.includes("Three.js WebGL") && details.status.includes("stable"),
    details,
  });
  if (${JSON.stringify(minimumFps)} > 0) {
    results.push({
      label: "10-card random-motion FPS threshold",
      pass: details.fps >= ${JSON.stringify(minimumFps)},
      details: { measuredFps: details.fps, minimumFps: ${JSON.stringify(minimumFps)} },
    });
  }

  document.querySelector("#remove-cards")?.click();
  await sleep(700);
  addCard.click();
  await sleep(700);
  return { ok: results.every((result) => result.pass), results, measurements: details };
})()`;

const diagnosticsScenario = String.raw`(async () => {
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const results = [];
  const report = () => document.querySelector("#diagnostics-report")?.textContent ?? "";
  const diagnosticsStatus = () => document.querySelector("#diagnostics-status")?.textContent ?? "";
  const record = (label, predicate) => results.push({ label, pass: Boolean(predicate()) });
  await sleep(800);
  document.querySelector("#collect-diagnostics")?.click();
  await sleep(300);
  record("diagnostics report collects environment and WebGL data", () => report().includes("devicePixelRatio") && report().includes("webgl"));
  document.querySelector("#run-diagnostics-benchmark")?.click();
  const deadline = performance.now() + 20000;
  while (performance.now() < deadline && !diagnosticsStatus().includes("Benchmark complete")) await sleep(100);
  record("diagnostics benchmark measures 1, 5, and 10 cards", () => {
    const text = report();
    return diagnosticsStatus().includes("Benchmark complete")
      && text.includes('"cards": 1')
      && text.includes('"cards": 5')
      && text.includes('"cards": 10');
  });
  record("diagnostics benchmark restores the lab", () => document.querySelectorAll("#card-list label").length === 1
    && document.querySelector("#selection-status")?.textContent === "1 of 1 selected");
  return { ok: results.every((result) => result.pass), results };
})()`;

const zonesScenario = String.raw`(async () => {
  const lab = await import('/examples/card-engine-lab/zones.js');
  const scene = lab.scene;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const results = [];
  const record = (label, pass) => results.push({ label, pass: Boolean(pass) });
  const stage = document.querySelector('#stage');
  const shells = [...stage.querySelectorAll('.cardinal-webgl-card')];
  const parent = shells[0].parentNode;
  const pose = (id) => scene.snapshot().visual.find((item) => item.cardId === id).pose;
  const anchor = document.querySelector('#workbench');
  const zone = () => scene.snapshot().zones.find((item) => item.id === 'workbench');
  const matchesGrid = () => zone().cardIds.every((id, index) => {
    const columns = Math.max(1, Math.floor((zone().geometry.width + 18) / 128));
    return Math.abs(pose(id).x - (zone().geometry.x + 55 + index % columns * 128)) < 0.01
      && Math.abs(pose(id).y - (zone().geometry.y + 75 + Math.floor(index / columns) * 168)) < 0.01;
  });
  await sleep(800);
  record('zones lab starts with six WebGL cards and three zones', scene.snapshot().renderer === 'webgl' && shells.length === 6 && scene.snapshot().zones.length === 3);
  const transfer = scene.transact([{ type: 'move', cardId: 'card-1', to: 'workbench', index: 0 }, { type: 'move', cardId: 'card-2', to: 'workbench', index: 1 }]);
  await sleep(150);
  stage.style.width = '85%';
  document.querySelector('#reflow').click();
  window.scrollTo(0, 180);
  await transfer.finished;
  await sleep(850);
  record('batch transfer lands in current grid after resize and scroll', matchesGrid() && zone().cardIds.join(',') === 'card-1,card-2,card-3,card-4');
  const before = { ...zone().geometry };
  await scene.transact([{ type: 'zone', zoneId: 'workbench', changes: { depth: -180 } }]).finished;
  record('orthographic anchor footprint survives a depth change', Math.abs(zone().geometry.x - before.x) < 0.01 && Math.abs(zone().geometry.width - before.width) < 0.01 && pose('card-1').z === -180 && matchesGrid());
  anchor.hidden = true;
  await sleep(100);
  record('hidden anchor keeps membership and valid geometry', zone().visible === false && zone().cardIds.length === 4 && zone().geometry.width === before.width);
  record('hidden cards cannot be hit or focused', scene.hitTest({x: pose('card-1').x, y: pose('card-1').y}) === null && shells[0].hidden && shells[0].inert);
  anchor.hidden = false;
  stage.style.width = '100%';
  await sleep(900);
  record('restored anchor solves from current bounds', zone().visible && matchesGrid() && !shells[0].hidden);
  for (const to of ['reserve', 'archive', 'workbench']) {
    await scene.transact([{ type: 'move', cardId: 'card-1', to, index: 0 }]).finished;
  }
  record('repeated transfers retain six shells and their stage parent', shells.every((shell) => shell.isConnected && shell.parentNode === parent) && stage.querySelectorAll('.cardinal-webgl-card').length === 6 && matchesGrid());
  const previous = scene.snapshot();
  let rejected = false;
  try { scene.transact([{ type: 'zone', zoneId: 'workbench', changes: { capacity: 0 } }]); }
  catch { rejected = true; }
  record('invalid capacity update leaves state intact', rejected && JSON.stringify(previous.desired) === JSON.stringify(scene.snapshot().desired));
  const moved = scene.transact([{ type: 'move', cardId: 'card-1', to: 'archive' }, { type: 'rotate', cardId: 'card-1', angle: 45 }, { type: 'face', cardId: 'card-1', face: 'faceDown' }]);
  await sleep(120);
  document.querySelector('#reflow').click();
  await moved.finished;
  record('layout retarget preserves independent rotation and flip', pose('card-1').angle === 45 && pose('card-1').flipY === 180 && !scene.snapshot().settling);
  const { createCardScene } = await import('/packages/card-engine/src/index.js');
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px';
  const probeAnchor = document.createElement('div');
  probeAnchor.id = 'projection-probe';
  probeAnchor.style.cssText = 'position:absolute;left:100px;top:100px;width:400px;height:300px';
  probe.append(probeAnchor);
  document.body.append(probe);
  const projected = createCardScene({ element: probe, camera: { projection: 'perspective', distance: 1000, fov: 60 }, motion: { reducedMotion: true } });
  try {
    const example = scene.snapshot().desired.cards[0];
    projected.apply({ cards: [{ ...example, pose: { angle: 0, flipX: 0, flipY: 0 }, faceUp: true }], zones: [{ id: 'probe', anchor: '#projection-probe', cardIds: [example.id] }] });
    const near = projected.snapshot().zones[0].geometry;
    await projected.transact([{ type: 'zone', zoneId: 'probe', changes: { depth: -200 } }]).finished;
    const far = projected.snapshot().zones[0].geometry;
    const farPose = projected.snapshot().visual[0].pose;
    record('perspective anchor resolves the same screen footprint at a different depth', Math.abs(far.width / near.width - 1.2) < 0.0001 && Math.abs(far.height / near.height - 1.2) < 0.0001);
    const projectionScale = 1000 / (1000 - farPose.z);
    record('perspective hit test agrees with camera projection without double scaling', farPose.depthScale === 1 && projected.hitTest({ x: farPose.x * projectionScale, y: farPose.y * projectionScale })?.cardId === example.id);
    const spatial = projected.snapshot().desired;
    spatial.zones = [{ id: 'spatial', geometry: near, cardIds: [example.id] }];
    projected.apply(spatial);
    await projected.transact([{ type: 'zone', zoneId: 'spatial', changes: { geometry: { ...near, depth: -200 } } }]).finished;
    record('spatial zones retain their world dimensions under depth changes', projected.snapshot().zones[0].geometry.width === near.width && projected.snapshot().visual[0].pose.z === -200);
  } finally { projected.destroy(); probe.remove(); }
  window.scrollTo(0, 0);
  return { ok: results.every(({ pass }) => pass), results };
})()`;

const mainZonesScenario = String.raw`(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const results = [];
  const record = (label, pass) => results.push({ label, pass: Boolean(pass) });
  const zoneRow = (id) => document.querySelector('#zone-list [data-zone-id="' + id + '"]');
  const zoneText = (id) => zoneRow(id)?.textContent ?? '';
  await sleep(800);
  record('main lab exposes three integrated zones', document.querySelectorAll('#zone-list .zone-row').length === 3 && zoneText('reserve').includes('1 card'));
  for (let index = 0; index < 2; index += 1) document.querySelector('#add-card').click();
  await sleep(200);
  record('the first three cards spawn in River by default', zoneText('reserve').includes('3 cards') && zoneText('workbench').includes('0 cards'));
  document.querySelector('#add-card').click();
  await sleep(200);
  record('cards after the first three spawn in Lake by default', zoneText('reserve').includes('3 cards') && zoneText('archive').includes('1 card') && document.querySelector('#spawn-zone').value === 'archive');
  for (let index = 0; index < 2; index += 1) document.querySelector('#add-card').click();
  document.querySelector('#select-all').click();
  document.querySelector('[data-transfer-zone="archive"]').click();
  await sleep(900);
  record('integrated transfer moves all selected cards into the destination zone', zoneText('archive').includes('6 cards') && zoneText('reserve').includes('0 cards') && document.querySelectorAll('#stage .cardinal-webgl-card').length === 6
    && document.querySelectorAll('#card-list .card-zone[data-zone-id="archive"]').length === 6);
  document.querySelector('#stage').style.width = '85%';
  window.dispatchEvent(new Event('resize'));
  await sleep(500);
  const anchor = document.querySelector('#zone-archive');
  document.querySelector('[data-zone-id="archive"] button').click();
  await sleep(250);
  record('hiding an integrated anchored zone preserves membership and hides its cards', anchor.hidden && zoneRow('archive')?.getAttribute('aria-hidden') === 'true' && zoneText('archive').includes('6 cards'));
  document.querySelector('[data-zone-id="archive"] button').click();
  await sleep(800);
  record('restoring an integrated anchored zone makes its cards visible again', !anchor.hidden && zoneRow('archive')?.getAttribute('aria-hidden') === 'false');
  document.querySelector('[data-transfer-zone="workbench"]').click();
  await sleep(900);
  record('integrated cards can be transferred repeatedly without remounting shells', zoneText('workbench').includes('6 cards') && document.querySelectorAll('#stage .cardinal-webgl-card').length === 6);
  document.querySelector('#stage').style.width = '';
  window.scrollTo(0, 0);
  await sleep(200);
  return { ok: results.every(({ pass }) => pass), results };
})()`;

async function run() {
  const server = await ensureLabServer();
  let chromium;
  let connection;
  try {
    chromium = await ensureBrowser();
    const target = chromium.targets.find((candidate) => candidate.type === "page");
    if (!target) throw new Error(`${browserLabel} did not expose a page target`);
    connection = connect(target);
    if (headless && chromium.process) {
      await connection.command("Emulation.setDeviceMetricsOverride", {
        width: 2515,
        height: 1322,
        deviceScaleFactor,
        mobile: false,
      });
    } else {
      await connection.command("Emulation.clearDeviceMetricsOverride");
    }
    const navigationUrl = new URL(scenario === "zones" ? "/examples/card-engine-lab/zones.html" : labUrl, labUrl);
    if (keepOpen && scenario === "elements") navigationUrl.searchParams.set("show-demo", "1");
    await connection.command("Page.navigate", { url: navigationUrl.href });
    await delay(1200);
    const report = inputScenarios[scenario]
      ? await inputScenarios[scenario]({ command: connection.command })
      : await (async () => {
        const evaluation = await connection.command("Runtime.evaluate", {
          expression: scenario === "elements" ? elementScenario
            : scenario === "layout" ? layoutScenario
              : scenario === "demo-toggles" ? demoTogglesScenario
              : scenario === "resize" ? resizeScenario
                  : scenario === "movement" ? movementScenario
                  : scenario === "random" ? randomScenario
                  : scenario === "spin-state" ? spinStateScenario
                  : scenario === "performance" ? performanceScenario
                  : scenario === "random-performance" ? randomPerformanceScenario
                  : scenario === "diagnostics" ? diagnosticsScenario
                  : scenario === "zones" ? zonesScenario
                  : scenario === "main-zones" ? mainZonesScenario
                  : acceptanceScenario,
          awaitPromise: true,
          returnByValue: true,
        });
        if (evaluation.exceptionDetails) throw new Error(evaluation.exceptionDetails.text ?? `${browserLabel} lab scenario threw`);
        return evaluation.result?.value;
      })();
    for (const result of report?.results ?? []) {
      const marker = result.skipped ? "SKIP" : result.pass ? "PASS" : "FAIL";
      console.log(`${marker} ${result.label}: ${result.status ?? result.error ?? ""}`);
      if (!result.pass && result.pointer) console.log(`  pointer: ${JSON.stringify(result.pointer)}`);
      if (!result.pass && result.details) console.log(`  details: ${JSON.stringify(result.details)}`);
      if (result.skipped && result.details?.reason) console.log(`  reason: ${result.details.reason}`);
    }
    if (inputScenarios[scenario] && report?.environment) {
      console.log(`${browserLabel} ${scenario} environment: ${JSON.stringify(report.environment)}`);
    }
    if (inputScenarios[scenario] && report?.measurementNotes) {
      console.log(`${browserLabel} ${scenario} measurement notes: ${JSON.stringify(report.measurementNotes)}`);
    }
    if (inputScenarios[scenario] && report?.measurements) {
      console.log(`${browserLabel} ${scenario} measurements: ${JSON.stringify(report.measurements)}`);
    }
    if (!report || report.ok !== true) throw new Error(`${browserLabel} lab scenario failed`);
    if (report.measurements?.inputLatencyMs !== undefined) console.log(`${browserLabel} measurements: input latency ${report.measurements.inputLatencyMs.toFixed(2)} ms · landing delta ${report.measurements.landingDeltaPx.toFixed(0)} px`);
    if (scenario === "performance" && report.measurements) {
      const measurements = report.measurements;
      console.log(`${browserLabel} performance: ${measurements.cards} cards · setup ${measurements.setupMs.toFixed(1)} ms · handler ${measurements.actionHandlerMs.toFixed(1)} ms · ${measurements.frames} frames · first frame ${measurements.firstFrameDelayMs.toFixed(1)} ms · median ${measurements.medianFrameMs.toFixed(1)} ms · p95 ${measurements.p95FrameMs.toFixed(1)} ms · missed >20 ms ${measurements.missedFramesOver20Ms}`);
    }
    if (scenario === "random-performance" && report.measurements) {
      const measurements = report.measurements;
      console.log(`${browserLabel} random performance: ${measurements.cards} cards · ${measurements.fps.toFixed(1)} FPS · median ${measurements.medianFrameMs.toFixed(1)} ms · p95 ${measurements.p95FrameMs.toFixed(1)} ms · missed >20 ms ${measurements.missedFramesOver20Ms}`);
    }
    console.log(`${browserLabel} lab scenario '${scenario}' passed (${report.results.length} checks)`);
  } finally {
    connection?.socket.close();
    if (chromium?.process && !keepOpen) chromium.process.kill("SIGTERM");
    if (server && !keepOpen) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`${browserLabel} lab scenario failed: ${error.message}`);
  process.exitCode = 1;
});
