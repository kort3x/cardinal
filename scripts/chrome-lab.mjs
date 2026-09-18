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
if (!new Set(["elements", "acceptance", "layout", "resize", "movement", "random", "spin-state", "demo-toggles", "performance", "random-performance", "diagnostics", "zones", "main-zones", "arrangements", "drag-lift", ...Object.keys(inputScenarios)]).has(scenario)) throw new Error(`Unknown ${browserLabel} lab scenario: ${scenario}`);

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

// Element and authored-motion checks use an explicit one-card grid fixture,
// independent of the lab's showcase cards and default Hand arrangement.
const singleCardFixture = String.raw`{
  const { getScene } = await import("/examples/card-engine-lab/main.js");
  const fixtureScene = getScene();
  const desired = fixtureScene.snapshot().desired;
  const card = desired.cards[0];
  fixtureScene.apply({
    cards: [card],
    zones: desired.zones.map((zone) => ({ ...zone,
      cardIds: zone.id === "river" ? [card.id] : [],
      arrangement: { type: "grid", gap: 16 },
    })),
  });
  fixtureScene.select([card.id]);
}`;

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
  ${singleCardFixture}
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
    const rect = document.querySelector("#zone-river").getBoundingClientRect();
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
    click('[data-flip="1"]');
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
  ${singleCardFixture}
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
  const selectedPose = () => {
    const snapshot = scene();
    const cardId = snapshot?.selection?.primaryCardId ?? snapshot?.selection?.cardIds?.[0];
    return snapshot?.visual?.find(({ cardId: visualCardId }) => visualCardId === cardId)?.pose;
  };
  const pose = () => selectedPose();
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
    && (() => {
      const snapshot = scene();
      const cardId = snapshot?.selection?.primaryCardId ?? snapshot?.selection?.cardIds?.[0];
      return snapshot?.visual?.find(({ cardId: visualCardId }) => visualCardId === cardId)?.physicalSide === "back";
    })());
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
    && getComputedStyle(document.querySelector("#zone-lake"))?.zIndex === "1");
  record("expanded rails use the side space", () => stage.clientWidth >= 1600);
  record("side rails use matching widths", () => {
    const left = document.querySelector(".cards-sidebar")?.getBoundingClientRect();
    const right = document.querySelector(".elements-sidebar")?.getBoundingClientRect();
    return Boolean(left && right) && Math.abs(left.width - right.width) <= 1;
  });
  record("desktop side rails scroll independently when they exceed the viewport", () => {
    const rails = [...document.querySelectorAll(".lab-workspace > .side-controls")];
    const sceneColumn = document.querySelector(".lab-workspace > .scene-column");
    return innerWidth <= 980 || (rails.length === 2
      && rails.every((rail) => getComputedStyle(rail).position === "sticky"
        && getComputedStyle(rail).overflowY === "auto"
        && getComputedStyle(rail).maxHeight !== "none")
      && getComputedStyle(sceneColumn).position === "sticky");
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
  record("right rail controls use compact sizing", () => {
    const add = document.querySelector("#add-element");
    const type = document.querySelector("#element-type");
    const presets = [...document.querySelectorAll("[data-background-preset]")];
    return Boolean(add && type && presets.length)
      && Number.parseFloat(getComputedStyle(add).paddingTop) <= 6
      && type.clientHeight <= 32
      && presets.every((button) => button.clientHeight <= 32);
  });
  record("right rail text fields use compact typography", () => {
    const fields = [...document.querySelectorAll('.elements-sidebar input[type="text"]')];
    return fields.length > 0 && fields.every((field) => Number.parseFloat(getComputedStyle(field).fontSize) <= 13);
  });
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
  if (spawnZone) spawnZone.value = "lake";
  document.querySelector("#add-card")?.click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const spawnedInLake = Boolean(cardList?.querySelector('.card-zone[data-zone-id="lake"]')
    && spawnZone?.value === "lake");
  const addedTop = rect(cardActions)?.top;
  document.querySelector("#remove-cards")?.click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const removedTop = rect(cardActions)?.top;
  record("card collection actions stay above the changing list", () => Boolean(cardList && actionsTop !== undefined)
    && rect(cardActions).bottom <= rect(cardList).top
    && Math.abs(addedTop - actionsTop) <= 1
    && Math.abs(removedTop - actionsTop) <= 1
    && spawnedInLake);
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
  const { getScene } = await import("/examples/card-engine-lab/main.js");
  const tuningScene = getScene();
  const tuningBefore = tuningScene.snapshot();
  const tuningFields = [
    ["drag-lift-scale", "liftScale", 1.2], ["drag-lift-time", "liftTime", 50],
    ["drag-response-time", "responseTime", 120], ["drag-damping", "damping", 1],
    ["drag-dangliness", "dangle", 0], ["drag-max-tilt", "maxTilt", 0],
    ["drag-max-twist", "maxTwist", 5], ["drag-upright", "upright", 0.5],
    ["drag-landing-time", "landingTime", 150], ["drag-landing-bounce", "landingBounce", 0.2],
    ["drag-snap-delay", "landingDelay", 40], ["drag-weight-influence", "weightInfluence", 0.8],
  ];
  for (const [id, field, value] of tuningFields) {
    const control = document.getElementById(id);
    control.value = String(value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    record("live drag control: " + field, () => getScene() === tuningScene
      && Math.abs(tuningScene.snapshot().dragMotion[field] - value) < 0.001);
    control.value = String(tuningBefore.dragMotion[field]);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  }
  record("drag tuning preserves cards and selection", () =>
    JSON.stringify(tuningScene.snapshot().desired) === JSON.stringify(tuningBefore.desired)
    && JSON.stringify(tuningScene.snapshot().selection) === JSON.stringify(tuningBefore.selection));
  const presetControl = document.getElementById("drag-motion-preset");
  presetControl.value = "crisp";
  presetControl.dispatchEvent(new Event("change", { bubbles: true }));
  record("drag preset applies live", () => getScene() === tuningScene
    && tuningScene.snapshot().dragMotion.preset === "crisp"
    && tuningScene.snapshot().dragMotion.responseTime === 95);
  presetControl.value = "natural";
  presetControl.dispatchEvent(new Event("change", { bubbles: true }));
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
    const zone = document.querySelector("#zone-river").getBoundingClientRect();
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
  record("baseline river placement is hittable", (current) => current.pointer?.insideStage === true
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
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, "clipboard");
  const originalExecCommand = document.execCommand;
  let fallbackCopied = false;
  try {
    Object.defineProperty(Navigator.prototype, "clipboard", { configurable: true, get: () => ({
      writeText: async () => { throw new Error("blocked clipboard"); },
    }) });
    document.execCommand = (command) => {
      fallbackCopied = command === "copy";
      return fallbackCopied;
    };
    document.querySelector("#copy-diagnostics")?.click();
    await sleep(50);
  } finally {
    if (clipboardDescriptor) Object.defineProperty(Navigator.prototype, "clipboard", clipboardDescriptor);
    else delete Navigator.prototype.clipboard;
    document.execCommand = originalExecCommand;
  }
  record("diagnostics copy falls back when Clipboard API is blocked", () => fallbackCopied
    && diagnosticsStatus().includes("copied"));
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
  const anchor = document.querySelector('#ocean');
  const zone = () => scene.snapshot().zones.find((item) => item.id === 'ocean');
  const matchesGrid = () => zone().cardIds.every((id, index) => {
    const columns = Math.max(1, Math.floor((zone().geometry.width + 18) / 128));
    return Math.abs(pose(id).x - (zone().geometry.x + 55 + index % columns * 128)) < 0.01
      && Math.abs(pose(id).y - (zone().geometry.y + 75 + Math.floor(index / columns) * 168)) < 0.01;
  });
  await sleep(800);
  record('zones lab starts with six WebGL cards and three zones', scene.snapshot().renderer === 'webgl' && shells.length === 6 && scene.snapshot().zones.length === 3);
  const transfer = scene.transact([{ type: 'move', cardId: 'card-1', to: 'ocean', index: 0 }, { type: 'move', cardId: 'card-2', to: 'ocean', index: 1 }]);
  await sleep(150);
  stage.style.width = '85%';
  document.querySelector('#reflow').click();
  window.scrollTo(0, 180);
  await transfer.finished;
  await sleep(850);
  record('batch transfer lands in current grid after resize and scroll', matchesGrid() && zone().cardIds.join(',') === 'card-1,card-2,card-3,card-4');
  const before = { ...zone().geometry };
  await scene.transact([{ type: 'zone', zoneId: 'ocean', changes: { depth: -180 } }]).finished;
  record('orthographic anchor footprint survives a depth change', Math.abs(zone().geometry.x - before.x) < 0.01 && Math.abs(zone().geometry.width - before.width) < 0.01 && pose('card-1').z === -180 && matchesGrid());
  anchor.hidden = true;
  await sleep(100);
  record('hidden anchor keeps membership and valid geometry', zone().visible === false && zone().cardIds.length === 4 && zone().geometry.width === before.width);
  record('hidden cards cannot be hit or focused', scene.hitTest({x: pose('card-1').x, y: pose('card-1').y}) === null && shells[0].hidden && shells[0].inert);
  anchor.hidden = false;
  stage.style.width = '100%';
  await sleep(900);
  record('restored anchor solves from current bounds', zone().visible && matchesGrid() && !shells[0].hidden);
  for (const to of ['river', 'lake', 'ocean']) {
    await scene.transact([{ type: 'move', cardId: 'card-1', to, index: 0 }]).finished;
  }
  record('repeated transfers retain six shells and their stage parent', shells.every((shell) => shell.isConnected && shell.parentNode === parent) && stage.querySelectorAll('.cardinal-webgl-card').length === 6 && matchesGrid());
  const previous = scene.snapshot();
  let rejected = false;
  try { scene.transact([{ type: 'zone', zoneId: 'ocean', changes: { capacity: 0 } }]); }
  catch { rejected = true; }
  record('invalid capacity update leaves state intact', rejected && JSON.stringify(previous.desired) === JSON.stringify(scene.snapshot().desired));
  const moved = scene.transact([{ type: 'move', cardId: 'card-1', to: 'lake' }, { type: 'rotate', cardId: 'card-1', angle: 45 }, { type: 'face', cardId: 'card-1', face: 'faceDown' }]);
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
  const lab = await import('/examples/card-engine-lab/main.js');
  const scene = lab.getScene();
  const zoneCount = (id) => scene.snapshot().desired.zones.find(({ id: zoneId }) => zoneId === id)?.cardIds.length ?? -1;
  await sleep(800);
  record('main lab exposes three integrated zones', document.querySelectorAll('#zone-list .zone-row').length === 3
    && zoneCount('lake') === 1 && zoneCount('river') === 1 && zoneCount('ocean') === 1);
  for (let index = 0; index < 2; index += 1) document.querySelector('#add-card').click();
  await sleep(200);
  record('new cards spawn in the selected River zone', zoneCount('river') === 3
    && zoneCount('lake') === 1 && zoneCount('ocean') === 1);
  document.querySelector('#add-card').click();
  await sleep(200);
  record('cards continue spawning in the selected River zone', zoneCount('river') === 4
    && zoneCount('lake') === 1 && zoneCount('ocean') === 1 && document.querySelector('#spawn-zone').value === 'river');
  for (let index = 0; index < 2; index += 1) document.querySelector('#add-card').click();
  const totalCards = scene.snapshot().desired.cards.length;
  document.querySelector('#select-all').click();
  document.querySelector('[data-transfer-zone="lake"]').click();
  await sleep(900);
  record('integrated transfer moves all selected cards into the destination zone', zoneText('lake').includes(totalCards + ' cards')
    && zoneText('river').includes('0 cards') && document.querySelectorAll('#stage .cardinal-webgl-card').length === totalCards
    && document.querySelectorAll('#card-list .card-zone[data-zone-id="lake"]').length === totalCards);
  document.querySelector('#stage').style.width = '85%';
  window.dispatchEvent(new Event('resize'));
  await sleep(500);
  const anchor = document.querySelector('#zone-lake');
  document.querySelector('[data-zone-id="lake"] button').click();
  await sleep(250);
  record('hiding an integrated anchored zone preserves membership and hides its cards', anchor.hidden && zoneRow('lake')?.getAttribute('aria-hidden') === 'true' && zoneText('lake').includes(totalCards + ' cards'));
  document.querySelector('[data-zone-id="lake"] button').click();
  await sleep(800);
  record('restoring an integrated anchored zone makes its cards visible again', !anchor.hidden && zoneRow('lake')?.getAttribute('aria-hidden') === 'false');
  document.querySelector('#select-all').click();
  document.querySelector('[data-transfer-zone="ocean"]').click();
  await sleep(900);
  record('integrated cards can be transferred repeatedly without remounting shells', zoneText('ocean').includes(totalCards + ' cards') && document.querySelectorAll('#stage .cardinal-webgl-card').length === totalCards);
  document.querySelector('#stage').style.width = '';
  window.scrollTo(0, 0);
  await sleep(200);
  return { ok: results.every(({ pass }) => pass), results };
})()`;

const arrangementsScenario = String.raw`(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const results = [];
  const record = (label, pass) => results.push({ label, pass: Boolean(pass) });
  const lab = await import('/examples/card-engine-lab/main.js');
  const scene = lab.getScene();
  await sleep(700);
  record('new cards use the Ember front face by default', scene.snapshot().desired.cards[0]?.faces?.['face-a']?.backgroundImage?.src?.endsWith('/b1.png'));
  const initialCards = scene.snapshot().desired.cards;
  const initialZones = scene.snapshot().desired.zones;
  const initialOceanCard = initialZones.find(({ id }) => id === 'ocean')?.cardIds[0];
  const initialOceanVisual = scene.snapshot().visual.find(({ cardId }) => cardId === initialOceanCard);
  record('Lake defaults to columns and Ocean to a concealed stack', initialZones.find(({ id }) => id === 'lake')?.arrangement.type === 'column'
    && initialZones.find(({ id }) => id === 'ocean')?.arrangement.type === 'stack'
    && initialOceanVisual?.physicalSide === 'back');
  record('example card backs contain the Cardinal logo element', initialCards.every((card) => {
    const logo = card.back?.elements?.find(({ id }) => id === 'cardinal-logo');
    return logo?.type === 'image' && logo.content?.src?.endsWith('/assets/cards/paint.png');
  }));
  record('lab starts with the requested 50-card distribution', initialCards.length === 50
    && initialZones.find(({ id }) => id === 'lake')?.cardIds.length === 1
    && initialZones.find(({ id }) => id === 'river')?.cardIds.length === 1
    && initialZones.find(({ id }) => id === 'ocean')?.cardIds.length === 48
    && initialZones.find(({ id }) => id === 'lake')?.cardIds.includes('owl-demo')
    && initialZones.find(({ id }) => id === 'river')?.cardIds.includes('cardinal-demo'));
  record('lab includes the new ice and owl card art', initialCards.find((card) => card.id === 'ice-demo')
    && initialCards.find((card) => card.id === 'owl-demo')
    && initialCards.find((card) => card.id === 'ice-demo')?.faces?.['face-a']?.elements?.find(({ id }) => id === 'image')?.content?.src?.endsWith('/ice.png')
    && initialCards.find((card) => card.id === 'owl-demo')?.faces?.['face-a']?.elements?.find(({ id }) => id === 'image')?.content?.src?.endsWith('/owl.png'));
  record('primary selection is marked on the card shell', document.querySelector('.cardinal-webgl-card[data-card-id="cardinal-demo"]')?.dataset.selected === 'true'
    && document.querySelector('.cardinal-webgl-card[data-card-id="cardinal-demo"]')?.dataset.primary === 'true');
  record('lab controls expose explanatory tooltips', Boolean(document.querySelector('#add-card')?.title)
    && Boolean(document.querySelector('#move')?.title)
    && Boolean(document.querySelector('[data-zone-arrangement="river"]')?.title)
    && Boolean(document.querySelector('[data-zone-overflow="river"]')?.title));
  record('Ocean exposes the draw stack preset', document.querySelector('[data-zone-setting="ocean"][data-zone-policy-key="preset"]')?.value === 'drawStack'
    && document.querySelector('[data-zone-setting="ocean"][data-zone-policy-key="selectionMode"]')?.value === 'forced'
    && document.querySelector('[data-zone-setting="ocean"][data-zone-policy-key="selectionCount"]')?.value === '1'
    && document.querySelector('[data-zone-setting="ocean"][data-zone-policy-key="selectionCount"]')?.disabled
    && initialZones.find(({ id }) => id === 'ocean')?.preset === 'drawStack');
  const lakePreset = document.querySelector('[data-zone-setting="lake"][data-zone-policy-key="preset"]');
  if (lakePreset) {
    lakePreset.value = 'drawStack';
    lakePreset.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(250);
  }
  const lakeCardId = scene.snapshot().desired.zones.find(({ id }) => id === 'lake')?.cardIds[0];
  record('draw stack preset conceals Lake cards', scene.snapshot().desired.zones.find(({ id }) => id === 'lake')?.preset === 'drawStack'
    && scene.snapshot().desired.cards.find(({ id }) => id === lakeCardId)?.faceUp === false);
  if (lakePreset) {
    lakePreset.value = '';
    lakePreset.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(250);
  }
  const originalSpawnZone = document.querySelector('#spawn-zone')?.value;
  const oceanSpawn = document.querySelector('#spawn-zone');
  if (oceanSpawn) {
    oceanSpawn.value = 'ocean';
    oceanSpawn.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#add-card')?.click();
    document.querySelector('#add-card')?.click();
    await sleep(250);
  }
  await sleep(250);
  const oceanSelectionCount = document.querySelector('[data-zone-setting="ocean"][data-zone-policy-key="selectionCount"]');
  const oceanState = scene.snapshot();
  const oceanZone = oceanState.desired.zones.find(({ id }) => id === 'ocean');
  const oceanTopIds = oceanZone?.cardIds.slice(-1) ?? [];
  const forcedSelection = oceanTopIds.length === 1 ? scene.select(oceanTopIds) : { accepted: false };
  record('draw stack preset selects only Ocean top card', Boolean(oceanSelectionCount)
    && oceanZone?.selectionPolicy?.mode === 'forced'
    && oceanZone.selectionPolicy.count === 1
    && forcedSelection.accepted === true
    && JSON.stringify(forcedSelection.cardIds) === JSON.stringify(oceanTopIds));
  const oceanRows = [...document.querySelectorAll('#card-list label')]
    .filter((row) => row.querySelector('.card-zone[data-zone-id="ocean"]'));
  const topOceanRow = oceanRows.find((row) => row.dataset.cardId === oceanZone?.cardIds.at(-1));
  record('card list marks draw stack cards that are not pickable', oceanRows.length === oceanZone?.cardIds.length
    && topOceanRow?.dataset.pickable === 'true'
    && oceanRows.some((row) => row.dataset.pickable === 'false'
      && row.querySelector('.card-pickability')?.textContent === 'Not pickable'));
  if (oceanSpawn && originalSpawnZone) {
    oceanSpawn.value = originalSpawnZone;
    oceanSpawn.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await sleep(250);
  record('lab exposes grab-point and card-center drag anchors', document.querySelector('#drag-anchor')?.value === 'grab'
    && scene.snapshot().dragAnchor === 'grab');
  const zoneRailFits = () => [...document.querySelectorAll('#zone-list .zone-row')].every((row) => {
    const list = document.querySelector('#zone-list');
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    return row.scrollWidth <= row.clientWidth + 1 && rowRect.right <= listRect.right + 1;
  });
  record('zone controls stay inside the sidebar', zoneRailFits());
  for (let index = 0; index < 5; index += 1) document.querySelector('#add-card').click();
  const cardArtSources = new Set(['/examples/card-engine-lab/majestic.png', '/examples/card-engine-lab/assets/cards/ice.png', '/examples/card-engine-lab/assets/cards/owl.png']);
  const imageSource = (card) => card.faces?.['face-a']?.elements?.find(({ id }) => id === 'image')?.content?.src;
  record('new cards randomize across the three card artworks', scene.snapshot().desired.cards.slice(3).every((card) => cardArtSources.has(imageSource(card))));
  document.querySelector('#deselect-all').click();
  for (const { id } of scene.snapshot().desired.cards) scene.select([id], { mode: 'add' });
  const selectedCardCount = scene.snapshot().selection.cardIds.length;
  document.querySelector('[data-transfer-zone="river"]').click();
  await sleep(900);
  const zone = () => scene.snapshot().desired.zones.find(({ id }) => id === 'river');
  const riverAngles = scene.snapshot().visual.filter(({ cardId }) => zone().cardIds.includes(cardId)).map(({ pose }) => pose.angle);
  record('moving cards into the hand arrangement updates orientation', new Set(riverAngles).size > 1 && riverAngles.some((angle) => angle !== 0));
  const types = [];
  for (let index = 0; index < 7; index += 1) {
    document.querySelector('[data-zone-cycle="river"]').click();
    await sleep(120);
    types.push(zone().arrangement.type);
  }
  record('cycle control visits every arrangement type', JSON.stringify(types) === JSON.stringify(['grid', 'row', 'column', 'splay', 'pile', 'stack', 'hand']));
  record('splay, pile, stack, and hand leave selected cards in the populated zone', ['splay', 'pile', 'stack', 'hand'].every((type) => types.includes(type)) && zone().cardIds.length === selectedCardCount);
  const beforeOrder = [...zone().cardIds];
  document.querySelector('[data-zone-reorder="river"]').click();
  await sleep(400);
  record('reverse control changes explicit stack order', JSON.stringify(zone().cardIds) === JSON.stringify(beforeOrder.reverse()));
  let rejectedOverflow = false;
  try { scene.transact([{ type: 'zone', zoneId: 'river', changes: { arrangement: { type: 'row', gap: 10, overflow: 'reject' } } }]); }
  catch { rejectedOverflow = true; }
  record('reject overflow reports an explicit failure', rejectedOverflow);
  const arrangementSelect = document.querySelector('[data-zone-arrangement="river"]');
  arrangementSelect.value = 'hand';
  arrangementSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(250);
  const settingsDisclosure = document.querySelector('[data-zone-id="river"] .zone-arrangement-settings');
  settingsDisclosure.open = true;
  const radiusControl = document.querySelector('[data-zone-setting="river"][data-arrangement-key="radius"]');
  if (radiusControl) {
    radiusControl.value = '220';
    radiusControl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await sleep(250);
  record('hand arrangement exposes radius settings', Boolean(radiusControl) && scene.snapshot().desired.zones.find(({ id }) => id === 'river')?.arrangement.radius === 220);
  record('arrangement settings stay open after an update', document.querySelector('[data-zone-id="river"] .zone-arrangement-settings')?.open === true);
  const curveControl = document.querySelector('[data-zone-setting="river"][data-arrangement-key="curve"]');
  if (curveControl) {
    curveControl.value = 'concave';
    curveControl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await sleep(250);
  record('hand arrangement exposes concave or convex curve control', Boolean(curveControl) && scene.snapshot().desired.zones.find(({ id }) => id === 'river')?.arrangement.curve === 'concave');
  const zonesGroup = document.querySelector('#zones-group');
  const sentToLabel = zonesGroup?.querySelector('.zone-actions-label');
  const transferActions = zonesGroup?.querySelector('.zone-actions');
  const slotControl = zonesGroup?.querySelector('#zone-slot');
  const zoneControls = zonesGroup?.querySelector('#zone-list');
  const controlOrder = [zoneControls, sentToLabel, transferActions, slotControl?.closest('.control-row')]
    .map((element) => element ? [...(zonesGroup?.children ?? [])].indexOf(element) : -1);
  record('zone transfer controls are ordered below the zone controls', controlOrder.every((index, position) => index >= 0 && (position === 0 || index > controlOrder[position - 1])));
  const positionSpeedControl = document.querySelector('[data-zone-setting="river"][data-zone-policy-key="positionSpeed"]');
  const scaleControl = document.querySelector('[data-zone-setting="river"][data-zone-policy-key="scale"]');
  const faceControl = document.querySelector('[data-zone-setting="river"][data-zone-policy-key="faceUp"]');
  if (positionSpeedControl) {
    positionSpeedControl.value = '2';
    positionSpeedControl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (scaleControl) {
    scaleControl.value = '0.75';
    scaleControl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (faceControl) {
    faceControl.value = 'false';
    faceControl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await sleep(250);
  const riverPolicy = scene.snapshot().desired.zones.find(({ id }) => id === 'river');
  record('zone controls expose alignment speed, scale, and face policy', Boolean(positionSpeedControl && scaleControl && faceControl)
    && riverPolicy?.motion?.positionSpeed === 2 && riverPolicy.scale === 0.75 && riverPolicy.faceUp === false);
  const orderControl = document.querySelector('[data-zone-setting="river"][data-zone-policy-key="orderMode"]');
  const slotModeControl = document.querySelector('[data-zone-setting="river"][data-zone-policy-key="slotMode"]');
  const concealedReorderControl = document.querySelector('[data-zone-setting="river"][data-zone-policy-key="concealedReorder"]');
  if (orderControl) {
    orderControl.value = 'locked';
    orderControl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (slotModeControl) {
    slotModeControl.value = 'fixed';
    slotModeControl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (concealedReorderControl) {
    concealedReorderControl.value = 'allow';
    concealedReorderControl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await sleep(250);
  const enforcedRiver = scene.snapshot().desired.zones.find(({ id }) => id === 'river');
  record('zone controls expose optional order and slot enforcement', Boolean(orderControl && slotModeControl)
    && enforcedRiver?.orderPolicy?.mode === 'locked'
    && enforcedRiver?.slotPolicy?.mode === 'fixed'
    && Object.keys(enforcedRiver.slotPolicy.slots).length === enforcedRiver.cardIds.length);
  record('zone controls expose concealed reorder policy', Boolean(concealedReorderControl)
    && enforcedRiver?.reorderPolicy?.concealed === 'allow');
  const handVisual = scene.snapshot().visual
    .filter(({ cardId }) => zone().cardIds.includes(cardId))
    .sort((first, second) => first.pose.x - second.pose.x);
  record('hand layering follows left-to-right visual order', handVisual.every((entry, index) => index === 0
    || (entry.pose.z >= handVisual[index - 1].pose.z && entry.pose.drawOrder > handVisual[index - 1].pose.drawOrder)));
  window.scrollTo(0, 0);
  return { ok: results.every(({ pass }) => pass), results };
})()`;

const dragLiftScenario = String.raw`(async () => {
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const results = [];
  const record = (label, pass) => results.push({ label, pass: Boolean(pass) });
  const lab = await import('/examples/card-engine-lab/main.js');
  const scene = () => lab.getScene();
  const setDepth = (value) => {
    const control = document.querySelector('#drag-lift-depth');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(control, String(value));
    control.dispatchEvent(new Event('input', { bubbles: true }));
  };
  await sleep(700);
  const initial = scene();
  record('3D lift starts disabled without changing the Lab camera', initial.snapshot().projection === 'orthographic'
    && initial.snapshot().dragMotion.liftDepth === 0);
  setDepth(80);
  await sleep(350);
  const lifted = scene();
  const basePoint = lifted.sceneToClient({ x: 600, y: 300, z: 0 });
  const liftedPoint = lifted.sceneToClient({ x: 600, y: 300, z: 80 });
  record('3D lift enables visible perspective depth in the Lab', lifted.snapshot().projection === 'perspective'
    && lifted.snapshot().dragMotion.liftDepth === 80
    && Math.hypot(liftedPoint.x - basePoint.x, liftedPoint.y - basePoint.y) > 1);
  setDepth(0);
  await sleep(350);
  record('disabling 3D lift restores the orthographic Lab camera', scene().snapshot().projection === 'orthographic'
    && scene().snapshot().dragMotion.liftDepth === 0);
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
                  : scenario === "arrangements" ? arrangementsScenario
                  : scenario === "drag-lift" ? dragLiftScenario
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
