#!/usr/bin/env node

import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { runBatchAcceptance } from "./batch-scenario.mjs";

const labUrl = process.env.CARDINAL_LAB_URL ?? "http://127.0.0.1:4173/";
const browsers = process.argv.slice(2).filter((name) => name === "firefox" || name === "safari");
const requestedBrowsers = browsers.length > 0 ? browsers : ["firefox", "safari"];

async function waitForHttp(url, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 400) return;
    } catch {
      // The process may still be starting.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function ensureLabServer() {
  try {
    const response = await fetch(labUrl);
    if (response.ok) return undefined;
  } catch {
    // Start the lab below.
  }
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const server = spawn(npm, ["--prefix", "examples/card-engine-lab", "start"], { stdio: "ignore" });
  await waitForHttp(labUrl);
  return server;
}

const stateExpression = `JSON.stringify({
  environment: { innerWidth, innerHeight, outerWidth, outerHeight, screenX, screenY,
    devicePixelRatio, userAgent: navigator.userAgent },
  renderer: document.querySelector("#renderer-status")?.textContent ?? "",
  status: document.querySelector("#status")?.textContent ?? "",
  shells: document.querySelectorAll(".cardinal-webgl-card").length,
  text: [...document.querySelectorAll(".cardinal-webgl-card")].map((card) => card.textContent),
  elements: [...document.querySelectorAll("#element-list .element-row")].map((row) => ({
    name: row.querySelector(".element-name")?.textContent ?? "",
    visible: row.querySelector("input[type=checkbox]")?.checked,
    content: row.querySelector("input[type=text]")?.value ?? "",
  })),
  interaction: globalThis.__cardinalGetScene?.()?.snapshot?.().interaction ?? { sessions: [] },
  zones: globalThis.__cardinalGetScene?.()?.snapshot?.().desired?.zones ?? [],
})`;

const getSceneSetupExpression = `(async () => {
  const module = await import("/examples/card-engine-lab/main.js");
  globalThis.__cardinalGetScene = module.getScene;
  return true;
})()`;

const scenePointExpression = (kind, zoneId) => `JSON.stringify((() => {
  const scene = globalThis.__cardinalGetScene?.();
  const snapshot = scene?.snapshot?.();
  if (!scene || !snapshot) throw new Error("Cardinal scene is unavailable");
  const point = ${kind === "card"
    ? `snapshot.visual.find(({ cardId }) => cardId === snapshot.desired.cards[0]?.id)?.pose`
    : `snapshot.zones.find(({ id }) => id === ${JSON.stringify(zoneId)})?.geometry`};
  if (!point) throw new Error("Missing ${kind} drag point");
  const scenePoint = ${kind === "card"
    ? `{ x: point.x, y: point.y, z: point.z ?? 0 }`
    : `{ x: point.x + point.width / 2, y: point.y + point.height / 2, z: point.depth ?? 0 }`};
  return scene.sceneToClient(scenePoint);
})())`;

const focusCardExpression = (cardId) => `(() => {
  const shell = document.querySelector(".cardinal-webgl-card[data-card-id=" + ${JSON.stringify(JSON.stringify(cardId))} + "]");
  if (!shell) throw new Error("Missing keyboard card shell");
  shell.focus();
  return document.activeElement === shell;
})()`;

const setExpression = (selector, value, event = "input") => `(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!element) throw new Error("Missing " + ${JSON.stringify(selector)});
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, String(${JSON.stringify(value)}));
  element.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
  return true;
})()`;

const setCheckboxExpression = (selector, checked) => `(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!(element instanceof HTMLInputElement) || element.type !== "checkbox") {
    throw new Error("Missing checkbox " + ${JSON.stringify(selector)});
  }
  element.checked = Boolean(${JSON.stringify(checked)});
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()`;

const clickExpression = (selector) => `document.querySelector(${JSON.stringify(selector)})?.click(); true`;

function zoneContainsCard(state, zoneId, cardId) {
  return state.zones?.find(({ id }) => id === zoneId)?.cardIds?.includes(cardId) === true;
}

function interactionSession(state) {
  return state.interaction?.sessions?.at(-1) ?? null;
}

async function acceptance(name, evaluate, navigate, actions, prepareScene, touchActions = actions, evaluateBatch = evaluate) {
  await navigate(labUrl);
  await delay(1000);
  await prepareScene();
  const waitForStable = async (timeout = 2000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const current = await evaluate(stateExpression);
      if (current.status.includes("stable")) return current;
      await delay(50);
    }
    throw new Error(`${name} scene did not settle before interaction`);
  };
  const checks = [];
  const record = (label, value, predicate) => {
    const pass = Boolean(predicate(value));
    checks.push({
      label,
      pass,
      status: value.status,
      ...(pass ? {} : { detail: { interaction: value.interaction, zones: value.zones } }),
    });
  };
  let state = await evaluate(stateExpression);
  console.log(`${name} measured environment: ${JSON.stringify(state.environment)}`);
  record("baseline WebGL", state, (value) => value.renderer.includes("Three.js WebGL") && value.shells === 1);

  const moveTarget = await evaluate("Number(document.querySelector('#move-x')?.max || 760)");
  await evaluate(setExpression("#move-x", moveTarget));
  await delay(850);
  state = await evaluate(stateExpression);
  record("move settles at visible target", state, (value) => value.status.includes(`x ${moveTarget}`) && value.status.includes("stable"));

  await evaluate(clickExpression('button[data-rotate="45"]'));
  await delay(850);
  state = await evaluate(stateExpression);
  record("rotate settles", state, (value) => value.status.includes("angle 45°") && value.status.includes("stable"));

  await evaluate(setExpression("#scale-slider", 1.25));
  await delay(850);
  state = await evaluate(stateExpression);
  record("scale settles", state, (value) => value.status.includes("scale 1.25") && value.status.includes("stable"));

  await evaluate(setExpression("#scale-slider", 2));
  await delay(850);
  state = await evaluate(stateExpression);
  record("200% scale keeps content", state, (value) => value.status.includes("scale 2.00") && value.text[0]?.includes("The Cardinal"));

  await evaluate(clickExpression('button[data-flip="1"]'));
  await delay(850);
  state = await evaluate(stateExpression);
  record("face-down settles", state, (value) => value.status.includes("physical back") && value.shells === 1);

  await evaluate(setExpression("#flip-x-slider", 60));
  await evaluate(setExpression("#flip-y-slider", 45));
  await delay(850);
  state = await evaluate(stateExpression);
  record("simultaneous X/Y flip settles", state, (value) => value.status.includes("physical front") && value.status.includes("stable"));

  await evaluate(setExpression("#flip-y-slider", 90));
  await delay(850);
  state = await evaluate(stateExpression);
  record("edge-on pose keeps shell", state, (value) => value.status.includes("physical edge") && value.shells === 1);

  await evaluate(clickExpression("#combined"));
  await delay(1400);
  state = await evaluate(stateExpression);
  record("combined motion settles", state, (value) => value.shells === 1 && value.status.includes("stable"));

  await evaluate(clickExpression("#reduced"));
  await delay(250);
  state = await evaluate(stateExpression);
  record("reduced motion settles", state, (value) => value.status.includes("stable") && !value.status.includes("animating"));

  await evaluate(`(() => {
    const canvas = document.querySelector("canvas");
    const gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl");
    window.__cardinalLossExtension = gl?.getExtension("WEBGL_lose_context");
    window.__cardinalLossExtension?.loseContext();
    return Boolean(window.__cardinalLossExtension);
  })()`);
  await delay(180);
  state = await evaluate(stateExpression);
  record("context loss reports", state, (value) => value.renderer.includes("webgl-context-lost"));

  await evaluate("window.__cardinalLossExtension?.restoreContext(); true");
  await delay(1500);
  state = await evaluate(stateExpression);
  record("context recovery reports", state, (value) => value.renderer.includes("webgl-context-restored") && value.shells === 1);

  await evaluate(setExpression("#shape", "shield", "change"));
  await delay(850);
  state = await evaluate(stateExpression);
  record("scene disposal/recreation keeps WebGL card", state, (value) => value.renderer.includes("Three.js WebGL") && value.shells === 1 && value.status.includes("stable"));

  await evaluate(clickExpression('#element-list input[aria-label="Show image"]'));
  await delay(850);
  state = await evaluate(stateExpression);
  record("hide image", state, (value) => value.elements.some((element) => element.name.startsWith("image") && element.visible === false));

  await evaluate(clickExpression('#element-list input[aria-label="Show image"]'));
  await delay(850);
  state = await evaluate(stateExpression);
  record("restore image", state, (value) => value.elements.some((element) => element.name.startsWith("image") && element.visible === true));

  const flavourRow = "[...document.querySelectorAll('#element-list .element-row')].find((row) => (row.querySelector('.element-name')?.textContent || '').startsWith('flavour'))";
  await evaluate(`${flavourRow}?.querySelector("button:last-child")?.click(); true`);
  await delay(850);
  state = await evaluate(stateExpression);
  record("remove flavour", state, (value) => !value.elements.some((element) => element.name.startsWith("flavour")));

  await evaluate(setExpression("#element-type", "text", "change"));
  await evaluate(clickExpression("#add-element"));
  await delay(850);
  state = await evaluate(stateExpression);
  record("add custom text", state, (value) => value.elements.some((element) => element.name.startsWith("text-")));

  const customEditor = `document.querySelector('[aria-label^="Content for text-"]')`;
  await evaluate(`${customEditor} && (Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(${customEditor}, "Cross-browser text"), ${customEditor}.dispatchEvent(new Event("change", { bubbles: true }))); true`);
  await delay(850);
  state = await evaluate(stateExpression);
  record("edit custom text", state, (value) => value.elements.some((element) => element.content === "Cross-browser text"));

  // Start the interaction journey from a fresh, stable scene so the original
  // 18 presentation checks above remain independent of input state.
  await navigate(labUrl);
  await delay(1000);
  await prepareScene();
  await waitForStable();
  state = await evaluate(stateExpression);
  const cardId = state.zones.flatMap(({ cardIds }) => cardIds ?? [])[0] ?? "cardinal-demo";
  const cardPoint = () => evaluate(scenePointExpression("card"));
  const archivePoint = () => evaluate(scenePointExpression("zone", "archive"));
  const workbenchPoint = () => evaluate(scenePointExpression("zone", "workbench"));

  await evaluate(setExpression("#drag-denied-zone", "", "change"));
  const firstCardPoint = await cardPoint();
  const firstArchivePoint = await archivePoint();
  await actions.dragStart(firstCardPoint, firstArchivePoint, 240);
  await actions.up();
  await actions.release();
  await delay(850);
  state = await evaluate(stateExpression);
  record("pointer drag allowed transfer", state, (value) => zoneContainsCard(value, "archive", cardId)
    && value.interaction.sessions.length === 0);

  await evaluate(setExpression("#drag-denied-zone", "workbench", "change"));
  await actions.dragStart(await cardPoint(), await workbenchPoint(), 240);
  await delay(120);
  state = await evaluate(stateExpression);
  const deniedSession = interactionSession(state);
  record("pointer drag exposes denied candidate", state, () => deniedSession?.candidate?.toZoneId === "workbench"
    && deniedSession.candidate.allowed === false && Boolean(deniedSession.candidate.reason));
  await actions.up();
  await actions.release();
  await delay(450);
  state = await evaluate(stateExpression);
  record("denied pointer transfer preserves membership", state, (value) => zoneContainsCard(value, "archive", cardId)
    && value.interaction.sessions.length === 0);

  await navigate(labUrl);
  await delay(1000);
  await prepareScene();
  await waitForStable();
  await evaluate(setCheckboxExpression("#drag-touch", true));
  await waitForStable();
  await evaluate(setExpression("#drag-denied-zone", "", "change"));
  const touchCardPoint = await cardPoint();
  const touchArchivePoint = await archivePoint();
  if (touchActions.supported === false) {
    checks.push({ label: "touch drag allowed transfer", pass: false, skipped: true, status: touchActions.unsupportedReason });
  } else {
    await touchActions.dragStart(touchCardPoint, touchArchivePoint, 240);
    await touchActions.up();
    await touchActions.release();
    await delay(850);
    state = await evaluate(stateExpression);
    record("touch drag allowed transfer", state, (value) => zoneContainsCard(value, "archive", cardId)
      && value.interaction.sessions.length === 0);
  }

  await navigate(labUrl);
  await delay(1000);
  await prepareScene();
  await waitForStable();
  await evaluate(setExpression("#drag-denied-zone", "", "change"));
  if (!await evaluate(focusCardExpression(cardId))) throw new Error("Keyboard card shell did not receive focus");
  await actions.keyPress(" ");
  await delay(120);
  state = await evaluate(stateExpression);
  record("keyboard Space picks up a card", state, (value) => interactionSession(value)?.phase === "dragging");
  await actions.keyPress("\uE00C");
  await delay(220);
  state = await evaluate(stateExpression);
  record("keyboard Escape cancels without transfer", state, (value) => zoneContainsCard(value, "reserve", cardId)
    && value.interaction.sessions.length === 0);

  if (!await evaluate(focusCardExpression(cardId))) throw new Error("Keyboard card shell did not receive focus");
  await actions.keyPress(" ");
  await actions.keyPress("\uE004");
  await actions.keyPress("\uE007");
  await actions.release();
  await delay(850);
  state = await evaluate(stateExpression);
  record("keyboard transfer uses the allowed destination", state, (value) => zoneContainsCard(value, "archive", cardId)
    && value.interaction.sessions.length === 0);

  const batch = await runBatchAcceptance({
    evaluate: evaluateBatch,
    navigate,
    pointer: actions,
    keyboard: actions,
    touch: touchActions,
    label: `${name} batch acceptance`,
    labUrl,
  });
  checks.push(...batch.results.map((result) => ({
    label: result.label,
    pass: result.pass,
    skipped: result.skipped,
    status: result.pass ? "batch case passed" : result.error,
    ...(result.pass ? {} : { detail: result.diagnostic }),
  })));
  return { browser: name, ok: checks.every((check) => check.pass || check.skipped), checks, batch, environment: batch.environment };
}

function createWebDriverActions(perform, release, pointerType = "mouse") {
  const pointerId = `cardinal-pointer-${pointerType}`;
  const keyboardId = "cardinal-keyboard";
  let pickupPoint;
  const modifier = process.platform === "darwin" ? "\uE03D" : "\uE009";
  const shiftKeyValue = "\uE008";
  const pointer = (action) => perform([{
    type: "pointer",
    id: pointerId,
    parameters: { pointerType },
    actions: [action],
  }]);
  const pointerSequence = (actions) => perform([{
    type: "pointer",
    id: pointerId,
    parameters: { pointerType },
    actions,
  }]);
  const keyboard = (actions) => perform([{
    type: "key",
    id: keyboardId,
    actions,
  }]);
  const modifierKey = ({ toggle = false, shift = false, shiftKey = false } = {}) => [
    ...(toggle ? [modifier] : []),
    ...(shift || shiftKey ? [shiftKeyValue] : []),
  ];
  const withModifiers = (value, options = {}) => {
    const keys = modifierKey(options);
    return [
      ...keys.map((key) => ({ type: "keyDown", value: key })),
      { type: "keyDown", value },
      { type: "keyUp", value },
      ...keys.reverse().map((key) => ({ type: "keyUp", value: key })),
    ];
  };
  const releasePointer = async () => {
    try { await pointer({ type: "pointerUp", button: 0 }); }
    finally { await release(); }
  };
  return {
    dragStart(from, to, duration = 0) {
      return pointerSequence([
        { type: "pointerMove", x: Math.round(from.x), y: Math.round(from.y), duration: 0, origin: "viewport" },
        { type: "pointerDown", button: 0 },
        { type: "pointerMove", x: Math.round(to.x), y: Math.round(to.y), duration, origin: "viewport" },
      ]);
    },
    drag(from, to, { steps = 1 } = {}) {
      // Cross the pickup threshold in one known event. Timed WebDriver moves
      // interpolate extra events, so their endpoint is not the pickup point.
      pickupPoint = { x: Math.round(from.x + 8), y: Math.round(from.y) };
      const actions = [
        { type: "pointerMove", x: Math.round(from.x), y: Math.round(from.y), duration: 0, origin: "viewport" },
        { type: "pointerDown", button: 0 },
        { type: "pointerMove", ...pickupPoint, duration: 0, origin: "viewport" },
      ];
      for (let index = 1; index <= steps; index += 1) {
        actions.push({
          type: "pointerMove",
          x: Math.round(from.x + (to.x - from.x) * index / steps),
          y: Math.round(from.y + (to.y - from.y) * index / steps),
          duration: Math.max(1, Math.round(240 / steps)),
          origin: "viewport",
        });
      }
      return pointerSequence(actions);
    },
    get pickupPoint() {
      return pickupPoint;
    },
    click(point, options = {}) {
      const keys = modifierKey(options);
      if (!keys.length) {
        return pointerSequence([
          { type: "pointerMove", x: Math.round(point.x), y: Math.round(point.y), duration: 0, origin: "viewport" },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 },
        ]);
      }
      return perform([
        { type: "key", id: keyboardId, actions: [
          ...keys.map((key) => ({ type: "keyDown", value: key })),
          { type: "pause", duration: 0 },
          { type: "pause", duration: 0 },
          ...keys.reverse().map((key) => ({ type: "keyUp", value: key })),
        ] },
        { type: "pointer", id: pointerId, parameters: { pointerType }, actions: [
          { type: "pointerMove", x: Math.round(point.x), y: Math.round(point.y), duration: 0, origin: "viewport" },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 },
          { type: "pause", duration: 0 },
        ] },
      ]);
    },
    move(point, duration = 0) {
      return pointer({
        type: "pointerMove",
        x: Math.round(point.x),
        y: Math.round(point.y),
        duration,
        origin: "viewport",
      });
    },
    down() {
      return pointer({ type: "pointerDown", button: 0 });
    },
    up() {
      return pointer({ type: "pointerUp", button: 0 });
    },
    keyPress(value) {
      return keyboard([{ type: "keyDown", value }, { type: "keyUp", value }]);
    },
    press(value, options = {}) {
      const key = { Tab: "\uE004", Enter: "\uE007", Escape: "\uE00C", ArrowLeft: "\uE012",
        ArrowUp: "\uE013", ArrowRight: "\uE014", ArrowDown: "\uE015" }[value] ?? value;
      return keyboard(withModifiers(key, options));
    },
    tap(point) {
      return pointerSequence([
        { type: "pointerMove", x: Math.round(point.x), y: Math.round(point.y), duration: 0, origin: "viewport" },
        { type: "pointerDown", button: 0 },
        { type: "pointerUp", button: 0 },
      ]);
    },
    releasePoint(point) {
      return pointer({
        type: "pointerMove", x: Math.round(point.x), y: Math.round(point.y), duration: 0, origin: "viewport",
      }).then(() => this.up());
    },
    cleanup: releasePointer,
    release: releasePointer,
  };
}

async function runFirefox() {
  const port = 9231;
  const profile = await mkdtemp(join(tmpdir(), "cardinal-firefox-") );
  const process = spawn("/Applications/Firefox.app/Contents/MacOS/firefox", [
    "--headless", "--no-remote", "--remote-debugging-port", String(port), "--profile", profile, "about:blank",
  ], { stdio: "ignore" });
  try {
    await waitForHttp(`http://127.0.0.1:${port}/`);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/session`);
    let nextId = 1;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const resolve = pending.get(message.id);
      if (!resolve) return;
      pending.delete(message.id);
      resolve(message);
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (message) => message.error ? reject(new Error(JSON.stringify(message))) : resolve(message));
      socket.send(JSON.stringify({ id, method, params }));
    });
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    await command("session.new", { capabilities: { alwaysMatch: {} } });
    const context = (await command("browsingContext.getTree")).result.contexts[0].context;
    await command("browsingContext.setViewport", { context, viewport: { width: 2500, height: 1300 }, devicePixelRatio: 1 });
    const evaluate = async (expression) => {
      const response = await command("script.evaluate", { expression, target: { context }, awaitPromise: true, resultOwnership: "none" });
      const value = response.result.result.value;
      return typeof value === "string" && value.startsWith("{") ? JSON.parse(value) : value;
    };
    const actions = createWebDriverActions(
      (sources) => command("input.performActions", { context, actions: sources }),
      () => command("input.releaseActions", { context }),
    );
    const touchActions = createWebDriverActions(
      (sources) => command("input.performActions", { context, actions: sources }),
      () => command("input.releaseActions", { context }),
      "touch",
    );
    const navigate = (url) => command("browsingContext.navigate", { context, url, wait: "complete" });
    const evaluateBatch = async (expression) => {
      // BiDi remote objects are typed entries, not ordinary JS objects. Use the
      // existing JSON decoder and await the shared scenario's async expressions.
      const result = await evaluate(`(async () => JSON.stringify({ value: await (${expression}) }))()`);
      return result.value;
    };
    const report = await acceptance("Firefox 155.0.1", evaluate, navigate, actions, () => evaluate(getSceneSetupExpression), touchActions, evaluateBatch);
    await command("session.end").catch(() => {});
    socket.close();
    return report;
  } finally {
    process.kill("SIGTERM");
  }
}

async function runSafari() {
  const port = 9523;
  const driver = spawn("/System/Cryptexes/App/usr/bin/safaridriver", ["--port", String(port)], { stdio: "ignore" });
  let session;
  let request;
  try {
    await waitForHttp(`http://127.0.0.1:${port}/status`);
    request = async (path, options = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { "content-type": "application/json" }, ...options });
      const body = await response.text();
      if (!response.ok) throw new Error(`${response.status} ${body}`);
      return body ? JSON.parse(body) : null;
    };
    session = (await request("/session", { method: "POST", body: '{"capabilities":{"alwaysMatch":{"browserName":"safari"}}}' })).value.sessionId;
    const command = async (path, options = {}) => (await request(`/session/${session}${path}`, options)).value;
    await command("/window/rect", { method: "POST", body: JSON.stringify({ x: 100, y: 0, width: 2500, height: 1300 }) });
    const evaluate = async (expression) => {
      const value = await command("/execute/sync", { method: "POST", body: JSON.stringify({ script: `return ${expression}`, args: [] }) });
      return typeof value === "string" && value.startsWith("{") ? JSON.parse(value) : value;
    };
    const evaluateAsync = async (expression) => {
      const value = await command("/execute/async", {
        method: "POST",
        body: JSON.stringify({
          script: `const done = arguments[arguments.length - 1]; Promise.resolve(${expression}).then(done, (error) => done({ __cardinalError: error?.message || String(error) }));`,
          args: [],
        }),
      });
      if (value?.__cardinalError) throw new Error(value.__cardinalError);
      return typeof value === "string" && value.startsWith("{") ? JSON.parse(value) : value;
    };
    const actions = createWebDriverActions(
      (sources) => command("/actions", { method: "POST", body: JSON.stringify({ actions: sources }) }),
      () => request(`/session/${session}/actions`, { method: "DELETE" }),
    );
    const touchActions = createWebDriverActions(
      (sources) => command("/actions", { method: "POST", body: JSON.stringify({ actions: sources }) }),
      () => request(`/session/${session}/actions`, { method: "DELETE" }),
      "touch",
    );
    const navigate = (url) => command("/url", { method: "POST", body: JSON.stringify({ url }) });
    touchActions.supported = false;
    touchActions.unsupportedReason = "Desktop SafariDriver emits mouse events for the touch source; physical Safari touch requires device verification.";
    return await acceptance("Safari 26.6.2", evaluate, navigate, actions, () => evaluateAsync(getSceneSetupExpression), touchActions, evaluateAsync);
  } finally {
    if (session) {
      await request(`/session/${session}`, { method: "DELETE" }).catch(() => {});
    }
    driver.kill("SIGTERM");
  }
}

async function run() {
  const server = await ensureLabServer();
  try {
    for (const browser of requestedBrowsers) {
      const report = browser === "firefox" ? await runFirefox() : await runSafari();
      for (const check of report.checks) {
        const detail = check.pass ? "" : ` — ${JSON.stringify({ status: check.status, detail: check.detail })}`;
        console.log(`${check.skipped ? "SKIP" : check.pass ? "PASS" : "FAIL"} ${report.browser}: ${check.label}${detail}`);
      }
      if (report.batch) console.log(`${report.browser} batch measurements: ${JSON.stringify(report.batch.measurements)}`);
      if (!report.ok) throw new Error(`${report.browser} acceptance failed`);
      console.log(`${report.browser} acceptance passed (${report.checks.filter((check) => check.pass).length} passed, ${report.checks.filter((check) => check.skipped).length} skipped)`);
    }
  } finally {
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Cross-browser lab failed: ${error.message}`);
  process.exitCode = 1;
});
