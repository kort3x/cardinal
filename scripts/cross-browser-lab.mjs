#!/usr/bin/env node

import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

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
  renderer: document.querySelector("#renderer-status")?.textContent ?? "",
  status: document.querySelector("#status")?.textContent ?? "",
  shells: document.querySelectorAll(".cardinal-webgl-card").length,
  text: [...document.querySelectorAll(".cardinal-webgl-card")].map((card) => card.textContent),
  elements: [...document.querySelectorAll("#element-list .element-row")].map((row) => ({
    name: row.querySelector(".element-name")?.textContent ?? "",
    visible: row.querySelector("input[type=checkbox]")?.checked,
    content: row.querySelector("input[type=text]")?.value ?? "",
  })),
})`;

const setExpression = (selector, value, event = "input") => `(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!element) throw new Error("Missing " + ${JSON.stringify(selector)});
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, String(${JSON.stringify(value)}));
  element.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
  return true;
})()`;

const clickExpression = (selector) => `document.querySelector(${JSON.stringify(selector)})?.click(); true`;

async function acceptance(name, evaluate, navigate) {
  await navigate(labUrl);
  await delay(1000);
  const checks = [];
  const record = (label, value, predicate) => checks.push({ label, pass: Boolean(predicate(value)), status: value.status });
  let state = await evaluate(stateExpression);
  record("baseline WebGL", state, (value) => value.renderer.includes("Three.js WebGL") && value.shells === 1);

  const moveTarget = await evaluate("Number(document.querySelector('#move-x')?.max || 760)");
  await evaluate(setExpression("#move-x", moveTarget));
  await delay(850);
  state = await evaluate(stateExpression);
  record("move settles at visible target", state, (value) => value.status.includes(`x ${moveTarget}`) && value.status.includes("stable"));

  await evaluate(clickExpression("#rotate"));
  await delay(850);
  state = await evaluate(stateExpression);
  record("rotate settles", state, (value) => value.status.includes("angle 45°") && value.status.includes("stable"));

  await evaluate(clickExpression("#scale"));
  await delay(850);
  state = await evaluate(stateExpression);
  record("scale settles", state, (value) => value.status.includes("scale 1.00") && value.status.includes("stable"));

  await evaluate(setExpression("#scale-slider", 2));
  await delay(850);
  state = await evaluate(stateExpression);
  record("200% scale keeps content", state, (value) => value.status.includes("scale 2.00") && value.text[0]?.includes("The Cardinal"));

  await evaluate(clickExpression("#flip"));
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

  return { browser: name, ok: checks.every((check) => check.pass), checks };
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
    await command("browsingContext.setViewport", { context, viewport: { width: 1280, height: 815 }, devicePixelRatio: 1 });
    const evaluate = async (expression) => {
      const response = await command("script.evaluate", { expression, target: { context }, awaitPromise: true, resultOwnership: "none" });
      const value = response.result.result.value;
      return typeof value === "string" && value.startsWith("{") ? JSON.parse(value) : value;
    };
    const navigate = (url) => command("browsingContext.navigate", { context, url, wait: "complete" });
    const report = await acceptance("Firefox 155.0.1", evaluate, navigate);
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
    await command("/window/rect", { method: "POST", body: JSON.stringify({ width: 1600, height: 1000 }) });
    const evaluate = async (expression) => {
      const value = await command("/execute/sync", { method: "POST", body: JSON.stringify({ script: `return ${expression}`, args: [] }) });
      return typeof value === "string" && value.startsWith("{") ? JSON.parse(value) : value;
    };
    const navigate = (url) => command("/url", { method: "POST", body: JSON.stringify({ url }) });
    return await acceptance("Safari 26.6.2", evaluate, navigate);
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
      for (const check of report.checks) console.log(`${check.pass ? "PASS" : "FAIL"} ${report.browser}: ${check.label}`);
      if (!report.ok) throw new Error(`${report.browser} acceptance failed`);
      console.log(`${report.browser} acceptance passed (${report.checks.length} checks)`);
    }
  } finally {
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Cross-browser lab failed: ${error.message}`);
  process.exitCode = 1;
});
