import test from "node:test";
import assert from "node:assert/strict";
import { createInputAdapter } from "../src/input.js";

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    event.target ??= this;
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return true;
  }
}

function event(type, properties = {}) {
  return {
    type,
    isPrimary: true,
    button: 0,
    pointerId: 1,
    pointerType: "mouse",
    clientX: 20,
    clientY: 30,
    preventDefault() { this.defaultPrevented = true; },
    ...properties,
  };
}

function cardShell(cardId) {
  const attributes = {};
  const focusCalls = [];
  return {
    dataset: { cardId },
    parentElement: null,
    style: {},
    isConnected: true,
    focusCalls,
    attributes,
    setAttribute(name, value) { attributes[name] = value; },
    removeAttribute(name) { delete attributes[name]; },
    focus(options) { focusCalls.push(options); },
    getBoundingClientRect() { return { left: 10, top: 20, right: 110, bottom: 170, width: 100, height: 150 }; },
    closest(selector) {
      return selector === "[data-card-id]" ? this : null;
    },
    setPointerCapture() {},
    releasePointerCapture() {},
  };
}

function stageWithCard(shell) {
  const stage = new FakeEventTarget();
  stage.style = {};
  stage.ownerDocument = undefined;
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 });
  stage.append = () => {};
  stage.contains = (node) => node === shell;
  stage.capturedPointers = new Set();
  stage.releasedPointers = [];
  stage.setPointerCapture = (id) => stage.capturedPointers.add(id);
  stage.releasePointerCapture = (id) => { stage.capturedPointers.delete(id); stage.releasedPointers.push(id); };
  return stage;
}

function sceneDouble() {
  const calls = [];
  let selection = [];
  let phase = "dragging";
  const session = {
    snapshot: () => ({ id: "drag-1", phase, cardIds: ["card-1"], primaryCardId: "card-1", candidate: null }),
    update(change) { calls.push(["update", change]); return this.snapshot(); },
    release() { calls.push(["release"]); phase = "accepted"; return this.snapshot(); },
    cancel(reason) { calls.push(["cancel", reason]); phase = "cancelled"; return this.snapshot(); },
  };
  return {
    calls,
    scene: {
      snapshot: () => ({ selection: { cardIds: selection, primaryCardId: selection.at(-1) ?? null }, desired: { cards: [{ id: "card-1" }], zones: [] } }),
      select(cardIds, options) { selection = cardIds; calls.push(["select", cardIds, options]); },
      clientToScene(point) { return point; },
      drag(request) { calls.push(["drag", request]); return session; },
      on() { return () => {}; },
    },
  };
}

test("keyboard navigation skips resolved hidden and transparent zones", () => {
  const shell = cardShell("card-1");
  const stage = stageWithCard(shell);
  const { scene, calls } = sceneDouble();
  const originalSnapshot = scene.snapshot;
  scene.snapshot = () => ({ ...originalSnapshot(), zones: [
    { id: "source", cardIds: ["card-1"], visible: true },
    { id: "missing-anchor", cardIds: [], visible: false },
    { id: "decoration", cardIds: [], dropTarget: "transparent" },
    { id: "destination", cardIds: [], visible: true },
  ] });
  const adapter = createInputAdapter({ element: stage, scene });
  stage.dispatchEvent(event("keydown", { target: shell, key: " " }));
  stage.dispatchEvent(event("keydown", { target: shell, key: "Tab" }));
  assert.deepEqual(calls.filter(([name]) => name === "update").at(-1),
    ["update", { toZoneId: "destination", index: 0 }]);
  adapter.destroy();
});

test("pointer pickup waits for movement and releases a one-card scene drag", () => {
  const shell = cardShell("card-1");
  const stage = stageWithCard(shell);
  const { scene, calls } = sceneDouble();
  const adapter = createInputAdapter({ element: stage, scene });

  stage.dispatchEvent(event("pointerdown", { target: shell, clientX: 20, clientY: 30 }));
  stage.dispatchEvent(event("pointermove", { target: shell, clientX: 23, clientY: 32 }));
  assert.deepEqual(calls, []);
  stage.dispatchEvent(event("pointerup", { target: shell, clientX: 23, clientY: 32 }));
  assert.deepEqual(calls, [["select", ["card-1"], { mode: "replace", primaryCardId: "card-1" }]]);

  calls.length = 0;
  stage.dispatchEvent(event("pointerdown", { target: shell, clientX: 20, clientY: 30 }));
  stage.dispatchEvent(event("pointermove", { target: shell, clientX: 30, clientY: 40 }));
  assert.deepEqual(calls, [
    ["drag", { cardIds: ["card-1"], primaryCardId: "card-1", point: { x: 30, y: 40 } }],
  ]);

  stage.dispatchEvent(event("pointerup", { target: shell, clientX: 32, clientY: 42 }));
  assert.deepEqual(calls.at(-2), ["update", { point: { x: 32, y: 42 } }]);
  assert.deepEqual(calls.at(-1), ["release"]);
  adapter.destroy();
});

test("Escape cancels a pending pointer drop and releases pointer capture", () => {
  const shell = cardShell("card-1");
  const stage = stageWithCard(shell);
  const calls = [];
  let phase = "dragging";
  const session = {
    snapshot: () => ({ id: "drag-2", phase, cardIds: ["card-1"], primaryCardId: "card-1", candidate: { toZoneId: "zone-b", index: 0, allowed: true } }),
    update(change) { calls.push(["update", change]); return this.snapshot(); },
    release() { calls.push(["release"]); phase = "pending"; return { id: "drag-2", toZoneId: "zone-b", index: 0 }; },
    cancel(reason) { calls.push(["cancel", reason]); phase = "cancelled"; return this.snapshot(); },
  };
  const scene = {
    snapshot: () => ({ selection: { cardIds: ["card-1"] }, desired: { cards: [{ id: "card-1" }], zones: [] } }),
    clientToScene(point) { return point; },
    drag() { calls.push(["drag"]); return session; },
    on() { return () => {}; },
  };
  const adapter = createInputAdapter({ element: stage, scene });

  stage.dispatchEvent(event("pointerdown", { target: shell, pointerId: 3 }));
  stage.dispatchEvent(event("pointermove", { target: shell, pointerId: 3, clientX: 40, clientY: 50 }));
  assert.equal(stage.capturedPointers.has(3), true);
  stage.dispatchEvent(event("pointerup", { target: shell, pointerId: 3, clientX: 42, clientY: 52 }));
  assert.equal(stage.capturedPointers.size, 0);
  stage.dispatchEvent(event("keydown", { target: shell, key: "Escape" }));

  assert.equal(calls.some(([name, reason]) => name === "cancel" && reason === "Escape"), true);
  assert.equal(shell.attributes["aria-grabbed"], undefined);

  const dragCount = calls.filter(([name]) => name === "drag").length;
  stage.dispatchEvent(event("pointerdown", { target: shell, pointerId: 5 }));
  stage.dispatchEvent(event("pointermove", { target: shell, pointerId: 5, clientX: 50, clientY: 60 }));
  assert.equal(calls.filter(([name]) => name === "drag").length, dragCount + 1);
  adapter.destroy();
});

test("lost pointer capture cancels a carrying pointer session", () => {
  const shell = cardShell("card-1");
  const stage = stageWithCard(shell);
  const { scene, calls } = sceneDouble();
  const adapter = createInputAdapter({ element: stage, scene });

  stage.dispatchEvent(event("pointerdown", { target: shell, pointerId: 7 }));
  stage.dispatchEvent(event("pointermove", { target: shell, pointerId: 7, clientX: 40, clientY: 50 }));
  stage.dispatchEvent(event("lostpointercapture", { target: shell, pointerId: 7 }));
  assert.equal(calls.some(([name]) => name === "cancel"), false);
  stage.dispatchEvent(event("lostpointercapture", { target: stage, pointerId: 7 }));

  assert.equal(calls.some(([name, reason]) => name === "cancel" && reason === "Pointer capture lost"), true);
  adapter.destroy();
});

test("pointercancel releases capture, restores focus, and does not leave a global input lock", () => {
  const shell = cardShell("card-1");
  const stage = stageWithCard(shell);
  const { scene, calls } = sceneDouble();
  const adapter = createInputAdapter({ element: stage, scene });

  stage.dispatchEvent(event("pointerdown", { target: shell, pointerId: 8 }));
  stage.dispatchEvent(event("pointermove", { target: shell, pointerId: 8, clientX: 40, clientY: 50 }));
  assert.equal(stage.capturedPointers.has(8), true);
  assert.equal(shell.attributes["aria-grabbed"], "true");
  stage.dispatchEvent(event("pointercancel", { target: stage, pointerId: 8 }));

  assert.equal(calls.some(([name, reason]) => name === "cancel" && reason === "Pointer cancelled"), true);
  assert.deepEqual(stage.releasedPointers, [8]);
  assert.equal(stage.capturedPointers.size, 0);
  assert.equal(shell.attributes["aria-grabbed"], undefined);
  assert.equal(shell.focusCalls.length >= 2, true);

  const dragCount = calls.filter(([name]) => name === "drag").length;
  stage.dispatchEvent(event("pointerdown", { target: shell, pointerId: 9 }));
  stage.dispatchEvent(event("pointermove", { target: shell, pointerId: 9, clientX: 40, clientY: 50 }));
  assert.equal(calls.filter(([name]) => name === "drag").length, dragCount + 1);
  adapter.destroy();
});

test("a pending pointer drop does not lock an unrelated card out of a new gesture", () => {
  const firstShell = cardShell("card-1");
  const secondShell = cardShell("card-2");
  const stage = stageWithCard(firstShell);
  const calls = [];
  const sessions = new Map();
  const scene = {
    snapshot: () => ({
      selection: { cardIds: [] },
      desired: {
        cards: [{ id: "card-1" }, { id: "card-2" }],
        zones: [{ id: "zone-a", cardIds: ["card-1", "card-2"] }],
      },
    }),
    clientToScene(point) { return point; },
    select(ids) { calls.push(["select", ids]); },
    drag(request) {
      calls.push(["drag", request]);
      const state = { phase: "dragging" };
      const session = {
        snapshot: () => ({ id: `drag-${request.cardIds[0]}`, phase: state.phase, cardIds: request.cardIds, primaryCardId: request.primaryCardId, candidate: null }),
        update() { return this.snapshot(); },
        release() { state.phase = "pending"; calls.push(["release", request.cardIds[0]]); return this.snapshot(); },
        cancel(reason) { state.phase = "cancelled"; calls.push(["cancel", request.cardIds[0], reason]); return this.snapshot(); },
      };
      sessions.set(request.cardIds[0], session);
      return session;
    },
    on() { return () => {}; },
  };
  const adapter = createInputAdapter({ element: stage, scene });

  stage.dispatchEvent(event("pointerdown", { target: firstShell, pointerId: 10 }));
  stage.dispatchEvent(event("pointermove", { target: firstShell, pointerId: 10, clientX: 40, clientY: 50 }));
  stage.dispatchEvent(event("pointerup", { target: firstShell, pointerId: 10, clientX: 42, clientY: 52 }));
  assert.equal(sessions.get("card-1").snapshot().phase, "pending");

  stage.dispatchEvent(event("pointerdown", { target: secondShell, pointerId: 11 }));
  stage.dispatchEvent(event("pointermove", { target: secondShell, pointerId: 11, clientX: 50, clientY: 60 }));

  assert.equal(calls.some(([name, cardId, reason]) => name === "cancel" && cardId === "card-1" && reason === "Superseded by another pointer"), true);
  assert.equal(calls.some(([name, request]) => name === "drag" && request.cardIds[0] === "card-2"), true);
  adapter.destroy();
});

test("keyboard dragging updates insertion slots and cycles visible zones", () => {
  const shell = cardShell("card-1");
  const stage = stageWithCard(shell);
  const calls = [];
  let phase = "dragging";
  let candidate = null;
  const session = {
    snapshot: () => ({ id: "drag-3", phase, cardIds: ["card-1"], primaryCardId: "card-1", candidate }),
    update(change) {
      calls.push(["update", change]);
      candidate = { toZoneId: change.toZoneId, index: change.index, allowed: true };
      return this.snapshot();
    },
    release() { calls.push(["release"]); phase = "accepted"; return this.snapshot(); },
    cancel(reason) { calls.push(["cancel", reason]); phase = "cancelled"; return this.snapshot(); },
  };
  let selection = [];
  const scene = {
    snapshot: () => ({
      selection: { cardIds: selection },
      desired: { cards: [{ id: "card-1" }], zones: [
        { id: "zone-a", cardIds: ["card-1", "card-2"], visible: true, geometry: { width: 100, height: 100 } },
        { id: "zone-b", cardIds: [], visible: true, geometry: { width: 100, height: 100 } },
      ] },
    }),
    select(ids) { selection = ids; calls.push(["select", ids]); },
    clientToScene(point) { return point; },
    drag(request) { calls.push(["drag", request]); return session; },
    on() { return () => {}; },
  };
  const adapter = createInputAdapter({ element: stage, scene });

  stage.dispatchEvent(event("keydown", { target: shell, key: " " }));
  stage.dispatchEvent(event("keydown", { target: shell, key: "ArrowRight" }));
  stage.dispatchEvent(event("keydown", { target: shell, key: "Tab" }));
  stage.dispatchEvent(event("keydown", { target: shell, key: "Enter" }));

  assert.deepEqual(calls.map(([name, value]) => [name, value]), [
    ["select", ["card-1"]],
    ["drag", { cardIds: ["card-1"], primaryCardId: "card-1" }],
    ["update", { toZoneId: "zone-a", index: 0 }],
    ["update", { toZoneId: "zone-a", index: 1 }],
    ["update", { toZoneId: "zone-b", index: 0 }],
    ["release", undefined],
  ]);
  adapter.destroy();
});

test("touch dragging is opt-in and a second contact cancels the active gesture", () => {
  const normalStage = stageWithCard(cardShell("card-1"));
  normalStage.style.touchAction = "auto";
  const normalAdapter = createInputAdapter({ element: normalStage, scene: sceneDouble().scene });
  assert.equal(normalStage.style.touchAction, "auto");
  normalAdapter.destroy();
  assert.equal(normalStage.style.touchAction, "auto");

  const shell = cardShell("card-1");
  const stage = stageWithCard(shell);
  const { scene, calls } = sceneDouble();
  const adapter = createInputAdapter({ element: stage, scene, options: { touchDrag: true } });
  assert.equal(stage.style.touchAction, "none");

  stage.dispatchEvent(event("pointerdown", { target: shell, pointerType: "touch", pointerId: 1 }));
  stage.dispatchEvent(event("pointermove", { target: shell, pointerType: "touch", pointerId: 1, clientX: 40, clientY: 50 }));
  stage.dispatchEvent(event("pointerdown", { target: shell, pointerType: "touch", pointerId: 2, isPrimary: false }));

  assert.equal(calls.some(([name, reason]) => name === "cancel" && reason === "Second touch contact"), true);
  adapter.destroy();
  assert.equal(stage.style.touchAction, undefined);
});

test("a second touch contact outside the stage cancels the active gesture", () => {
  const shell = cardShell("card-1");
  const stage = stageWithCard(shell);
  const view = new FakeEventTarget();
  const doc = { defaultView: view };
  view.document = doc;
  stage.ownerDocument = doc;
  const { scene, calls } = sceneDouble();
  const adapter = createInputAdapter({ element: stage, scene, options: { touchDrag: true } });

  try {
    stage.dispatchEvent(event("pointerdown", { target: shell, pointerType: "touch", pointerId: 20 }));
    stage.dispatchEvent(event("pointermove", { target: shell, pointerType: "touch", pointerId: 20, clientX: 40, clientY: 50 }));
    const outsideContact = event("pointerdown", { target: view, pointerType: "touch", pointerId: 21, isPrimary: false });
    view.dispatchEvent(outsideContact);

    assert.equal(calls.some(([name, reason]) => name === "cancel" && reason === "Second touch contact"), true);
    assert.equal(stage.capturedPointers.size, 0);
    assert.equal(outsideContact.defaultPrevented, undefined);
  } finally {
    adapter.destroy();
  }
  assert.equal(view.listeners.get("pointerdown").size, 0);
});

test("keyboard Escape cancels without leaving the adapter listening", () => {
  const shell = cardShell("card-1");
  const stage = stageWithCard(shell);
  const { scene, calls } = sceneDouble();
  const adapter = createInputAdapter({ element: stage, scene });

  stage.dispatchEvent(event("keydown", { target: shell, key: "Space" }));
  stage.dispatchEvent(event("keydown", { target: shell, key: "Escape" }));
  const callCount = calls.length;
  adapter.destroy();
  stage.dispatchEvent(event("keydown", { target: shell, key: "Space" }));

  assert.equal(calls.some(([name, reason]) => name === "cancel" && reason === "Escape"), true);
  assert.equal(calls.length, callCount);
});

test("pending keyboard drops release Tab navigation while retaining Escape cancellation", () => {
  const shell = cardShell("card-1");
  const stage = stageWithCard(shell);
  const calls = [];
  let phase = "dragging";
  let candidate = null;
  const session = {
    snapshot: () => ({ id: "drag-5", phase, cardIds: ["card-1"], primaryCardId: "card-1", candidate }),
    update(change) { candidate = { toZoneId: change.toZoneId, index: change.index, allowed: true }; calls.push(["update", change]); return this.snapshot(); },
    release() { phase = "pending"; calls.push(["release"]); return { id: "drag-5", toZoneId: "zone-a", index: 0 }; },
    cancel(reason) { phase = "cancelled"; calls.push(["cancel", reason]); return this.snapshot(); },
  };
  const scene = {
    snapshot: () => ({
      selection: { cardIds: ["card-1"] },
      desired: { cards: [{ id: "card-1" }], zones: [{ id: "zone-a", cardIds: ["card-1"], geometry: { width: 100, height: 100 } }] },
    }),
    clientToScene(point) { return point; },
    drag() { calls.push(["drag"]); return session; },
    on() { return () => {}; },
  };
  const adapter = createInputAdapter({ element: stage, scene });

  stage.dispatchEvent(event("keydown", { target: shell, key: "Space" }));
  stage.dispatchEvent(event("keydown", { target: shell, key: "Enter" }));
  const tab = event("keydown", { target: shell, key: "Tab" });
  stage.dispatchEvent(tab);
  assert.equal(tab.defaultPrevented, undefined);
  stage.dispatchEvent(event("keydown", { target: shell, key: "Escape" }));
  assert.equal(calls.some(([name, reason]) => name === "cancel" && reason === "Escape"), true);
  adapter.destroy();
});

test("auto-scroll uses elapsed frame time and reprojects the last client point", () => {
  const callbacks = [];
  const view = {
    innerWidth: 100,
    innerHeight: 100,
    requestAnimationFrame(callback) { callbacks.push(callback); return callbacks.length; },
    cancelAnimationFrame() {},
    getComputedStyle(node) { return node.style; },
  };
  const page = { scrollHeight: 1000, clientHeight: 100, scrollTop: 0 };
  const doc = { defaultView: view, scrollingElement: page, documentElement: page };
  view.document = doc;
  view.scrollTo = (_x, y) => { view.scrollY = y; page.scrollTop = y; };
  const scrollBox = {
    style: { overflowY: "auto" },
    scrollHeight: 1000,
    clientHeight: 100,
    scrollTop: 0,
    parentElement: null,
    getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }; },
  };
  const shell = cardShell("card-1");
  shell.parentElement = null;
  const stage = stageWithCard(shell);
  stage.ownerDocument = doc;
  stage.parentElement = scrollBox;
  const calls = [];
  let phase = "dragging";
  const session = {
    snapshot: () => ({ id: "drag-4", phase, cardIds: ["card-1"], primaryCardId: "card-1", candidate: null }),
    update(change) { calls.push(change); return this.snapshot(); },
    release() { phase = "accepted"; return this.snapshot(); },
    cancel() { phase = "cancelled"; return this.snapshot(); },
  };
  const scene = {
    snapshot: () => ({ selection: { cardIds: ["card-1"] }, desired: { cards: [{ id: "card-1" }], zones: [] } }),
    clientToScene(point) { return { x: point.x, y: point.y + scrollBox.scrollTop }; },
    drag() { return session; },
    on() { return () => {}; },
  };
  const adapter = createInputAdapter({ element: stage, scene, options: { autoScrollSpeed: 1000 } });

  stage.dispatchEvent(event("pointerdown", { target: shell, pointerId: 4, clientX: 50, clientY: 50 }));
  stage.dispatchEvent(event("pointermove", { target: shell, pointerId: 4, clientX: 50, clientY: 98 }));
  callbacks.shift()(0);
  callbacks.shift()(100);

  assert.equal(scrollBox.scrollTop, 95.83333333333334);
  assert.deepEqual(calls.at(-1), { point: { x: 50, y: 193.83333333333334 } });

  scrollBox.scrollTop = 900;
  callbacks.shift()(200);
  assert.equal(page.scrollTop, 95.83333333333334);
  adapter.destroy();
});

test("stationary camera-center dragging reprojects when pixel density changes", () => {
  const callbacks = [];
  const view = {
    innerWidth: 100,
    innerHeight: 100,
    requestAnimationFrame(callback) { callbacks.push(callback); return callbacks.length; },
    cancelAnimationFrame() {},
    getComputedStyle(node) { return node.style; },
  };
  const shell = cardShell("card-1");
  const stage = stageWithCard(shell);
  stage.ownerDocument = { defaultView: view };
  const { scene, calls } = sceneDouble();
  let unitsPerPixel = 1;
  scene.clientToScene = (point) => ({
    x: (point.x - 50) * unitsPerPixel,
    y: (point.y - 50) * unitsPerPixel,
  });
  const adapter = createInputAdapter({ element: stage, scene });
  try {
    stage.dispatchEvent(event("pointerdown", { target: shell, clientX: 40, clientY: 50 }));
    stage.dispatchEvent(event("pointermove", { target: shell, clientX: 50, clientY: 50 }));
    callbacks.shift()(0);
    const before = calls.filter(([name]) => name === "update").length;
    unitsPerPixel = 2;
    callbacks.shift()(16);
    assert.equal(calls.filter(([name]) => name === "update").length, before + 1);
    assert.deepEqual(calls.at(-1), ["update", { point: { x: 0, y: 0 } }]);
    callbacks.shift()(32);
    assert.equal(calls.filter(([name]) => name === "update").length, before + 1);
  } finally {
    adapter.destroy();
  }
});
