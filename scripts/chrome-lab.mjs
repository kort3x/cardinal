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
if (scenario !== "elements") throw new Error(`Unknown Chrome lab scenario: ${scenario}`);

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
  const server = spawn(npm, ["--prefix", "examples/card-engine-lab", "start"], { stdio: "ignore" });
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
    ], { stdio: "ignore" });
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
    cards: [...document.querySelectorAll("#card-list label")].map((card) => card.textContent),
    elements: [...document.querySelectorAll("#element-list .element-row")].map((row) => ({
      name: row.querySelector(".element-name")?.textContent,
      visible: row.querySelector("input[type=checkbox]")?.checked,
      content: row.querySelector("input[type=text]")?.value,
      mode: row.querySelectorAll("select")[0]?.value,
      policy: row.querySelectorAll("select")[1]?.value,
    })),
    shells: document.querySelectorAll(".cardinal-webgl-card").length,
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
    results.push({ label, pass: Boolean(predicate(current)), status: current.status });
  };
  const step = async (label, action, predicate) => {
    await action();
    await sleep(850);
    record(label, predicate);
  };

  await sleep(700);
  record("baseline WebGL lab", (current) => current.renderer.includes("Three.js WebGL")
    && current.shells === 1 && current.elements.length === 3);
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
    click('button[data-move-x="760"][data-move-y="250"]');
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

  return { ok: results.every((result) => result.pass), results };
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
    await connection.command("Page.navigate", { url: labUrl });
    await delay(1200);
    const evaluation = await connection.command("Runtime.evaluate", {
      expression: elementScenario,
      awaitPromise: true,
      returnByValue: true,
    });
    if (evaluation.exceptionDetails) throw new Error(evaluation.exceptionDetails.text ?? "Chrome lab scenario threw");
    const report = evaluation.result?.value;
    for (const result of report?.results ?? []) console.log(`${result.pass ? "PASS" : "FAIL"} ${result.label}: ${result.status}`);
    if (!report || report.ok !== true) throw new Error("Chrome lab scenario failed");
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
