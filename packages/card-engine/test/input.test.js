import test from "node:test";
import assert from "node:assert/strict";
import { createInputAdapter } from "../src/input.js";
import { createSelection } from "../src/selection.js";

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
    ["drag", { cardIds: ["card-1"], primaryCardId: "card-1", point: { x: 20, y: 30 } }],
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
  let selected = [];
  const scene = {
    snapshot: () => ({
      selection: { cardIds: selected },
      desired: {
        cards: [{ id: "card-1" }, { id: "card-2" }],
        zones: [{ id: "zone-a", cardIds: ["card-1", "card-2"] }],
      },
    }),
    clientToScene(point) { return point; },
    select(ids) { selected = ids; calls.push(["select", ids]); },
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

// Exercise input against the real policy; the drag double only records the
// boundary owned by the interaction module and freezes its supplied cohort.
function selectionInput({ config, options } = {}) {
  const shells = new Map(["a", "b", "c", "d"].map((id) => [id, cardShell(id)]));
  const stage = stageWithCard(shells.get("a"));
  stage.contains = (node) => [...shells.values()].includes(node);
  stage.querySelector = (selector) => shells.get(selector.match(/data-card-id="([^"]+)"/)?.[1]);
  const regions = [];
  stage.append = (region) => regions.push(region);
  stage.ownerDocument = { createElement: () => ({ style: {}, setAttribute() {}, remove() {} }) };
  const desired = { cards: [...shells.keys()].map((id) => ({ id })), zones: [
    { id: "lake", cardIds: ["a", "b", "c"] }, { id: "river", cardIds: ["d"] },
  ] };
  const visual = new Map([...shells.keys()].map((id) => [id, { visible: true }]));
  const listeners = new Map();
  const calls = [];
  const emit = (type, detail) => { for (const callback of listeners.get(type) ?? []) callback(detail); };
  const selection = createSelection({ config, state: () => ({ desired, visual }), onChange: (next) => emit("selection-change", next) });
  let session;
  const scene = {
    snapshot: () => ({ selection: selection.snapshot(), desired }),
    select: selection.select,
    clientToScene: (point) => point,
    on(type, callback) {
      const callbacks = listeners.get(type) ?? new Set(); callbacks.add(callback); listeners.set(type, callbacks);
      return () => callbacks.delete(callback);
    },
    drag(request) {
      calls.push(["drag", structuredClone(request)]);
      const data = { id: "batch", phase: "dragging", cardIds: [...request.cardIds], primaryCardId: request.primaryCardId, candidate: null };
      session = {
        snapshot: () => structuredClone(data),
        update(change) {
          calls.push(["update", change]);
          if (change.toZoneId) data.candidate = { ...change, allowed: true };
          return this.snapshot();
        },
        release() { calls.push(["release"]); data.phase = "pending"; return this.snapshot(); },
        cancel(reason) { calls.push(["cancel", reason]); data.phase = "cancelled"; return this.snapshot(); },
      };
      return session;
    },
  };
  const adapter = createInputAdapter({ element: stage, scene, options, selectionContext: selection.context });
  const send = (type, id, properties = {}) => {
    const input = event(type, { target: shells.get(id) ?? stage, ...properties });
    stage.dispatchEvent(input);
    return input;
  };
  const tap = (id, properties = {}) => { send("pointerdown", id, properties); return send("pointerup", id, properties); };
  const pickup = (id, properties = {}) => {
    send("pointerdown", id, properties);
    send("pointermove", id, { ...properties, clientX: 40, clientY: 50 });
  };
  return { selection, stage, scene, calls, shells, regions, send, tap, pickup, adapter, session: () => session };
}

test("plain click collapses only on release; Ctrl/Cmd toggle and Shift selects logical ranges", (t) => {
  const f = selectionInput(); t.after(() => f.adapter.destroy());
  f.selection.select(["a", "b"]);
  f.send("pointerdown", "a");
  assert.deepEqual(f.selection.snapshot().cardIds, ["a", "b"]);
  f.send("pointerup", "a");
  assert.deepEqual(f.selection.snapshot(), { cardIds: ["a"], primaryCardId: "a", anchorCardId: "a" });
  f.tap("c", { shiftKey: true });
  assert.deepEqual(f.selection.snapshot().cardIds, ["a", "b", "c"]);
  f.tap("b", { ctrlKey: true });
  assert.deepEqual(f.selection.snapshot().cardIds, ["a", "c"]);
  f.tap("d", { metaKey: true });
  assert.deepEqual(f.selection.snapshot().cardIds, ["a", "c", "d"]);
});

test("pickup preserves full selection and anchor, sets picked primary, and freezes the drag request", (t) => {
  const f = selectionInput(); t.after(() => f.adapter.destroy());
  f.selection.select(["a", "c", "d"], { primaryCardId: "d", anchorCardId: "a" });
  f.pickup("c");
  assert.deepEqual(f.calls[0], ["drag", { cardIds: ["a", "c", "d"], primaryCardId: "c", point: { x: 20, y: 30 } }]);
  assert.deepEqual(f.selection.snapshot(), { cardIds: ["a", "c", "d"], primaryCardId: "c", anchorCardId: "a" });
  f.selection.select(["b"]);
  assert.deepEqual(f.session().snapshot().cardIds, ["a", "c", "d"]);
  f.send("pointerup", "c");
  assert.equal(f.calls.filter(([name]) => name === "release").length, 1);
  assert.deepEqual(f.selection.snapshot().cardIds, ["b"]);
});

test("unselected pickup replaces, while modifier pickup adds without toggling selected members out", (t) => {
  for (const [modifiers, expected] of [[{}, ["c"]], [{ ctrlKey: true }, ["a", "c"]], [{ metaKey: true }, ["a", "c"]], [{ shiftKey: true }, ["a", "b", "c"]]]) {
    const f = selectionInput(); t.after(() => f.adapter.destroy());
    f.selection.select(["a"]);
    f.pickup("c", modifiers);
    assert.deepEqual(f.session().snapshot().cardIds, expected);
  }
  const f = selectionInput(); t.after(() => f.adapter.destroy());
  f.selection.select(["a", "b"]);
  f.pickup("a", { ctrlKey: true });
  assert.deepEqual(f.session().snapshot().cardIds, ["a", "b"]);
});

test("denied selection prevents pickup and announces the reason without changing the set", (t) => {
  const f = selectionInput({ config: { max: 1 } }); t.after(() => f.adapter.destroy());
  f.selection.select(["a"]);
  f.pickup("b", { ctrlKey: true });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.selection.snapshot().cardIds, ["a"]);
  assert.match(f.regions[0].textContent, /Selection unavailable.*maximum/);
  assert.equal(f.stage.capturedPointers.size, 0);
});

test("idle keyboard navigation uses eligibility context and supports range, toggle, select-all and clear", (t) => {
  const f = selectionInput({ config: { canSelect: ({ cardId }) => ({ allowed: cardId !== "b" }) } });
  t.after(() => f.adapter.destroy());
  f.send("keydown", "a", { key: "ArrowRight" });
  assert.equal(f.shells.get("c").focusCalls.length, 1);
  assert.deepEqual(f.selection.snapshot().cardIds, []);
  f.send("keydown", "c", { key: "s" });
  assert.deepEqual(f.selection.snapshot().cardIds, ["c"]);
  f.send("keydown", "c", { key: "S" });
  assert.deepEqual(f.selection.snapshot().cardIds, []);
  assert.equal(f.calls.length, 0);
  f.send("keydown", "c", { key: "a", metaKey: true });
  assert.deepEqual(f.selection.snapshot().cardIds, ["a", "c", "d"]);
  f.send("keydown", "c", { key: "Escape" });
  assert.deepEqual(f.selection.snapshot().cardIds, []);
  const range = selectionInput(); t.after(() => range.adapter.destroy());
  range.send("keydown", "a", { key: "ArrowRight", shiftKey: true });
  assert.deepEqual(range.selection.snapshot(), { cardIds: ["a", "b"], primaryCardId: "b", anchorCardId: "a" });
  range.send("keydown", "b", { key: "ArrowRight", shiftKey: true });
  assert.deepEqual(range.selection.snapshot().cardIds, ["a", "b", "c"]);
  range.send("keydown", "c", { key: "ArrowLeft", shiftKey: true });
  assert.deepEqual(range.selection.snapshot().cardIds, ["a", "b"]);
});

test("keyboard select-all obeys scope and denies maximum overflow atomically", (t) => {
  const f = selectionInput({ config: { scope: "zone" } }); t.after(() => f.adapter.destroy());
  f.send("keydown", "d", { key: "a", ctrlKey: true });
  assert.deepEqual(f.selection.snapshot().cardIds, ["d"]);
  const capped = selectionInput({ config: { max: 2 } }); t.after(() => capped.adapter.destroy());
  capped.selection.select(["a"]);
  capped.send("keydown", "a", { key: "a", metaKey: true });
  assert.deepEqual(capped.selection.snapshot().cardIds, ["a"]);
  assert.match(capped.regions[0].textContent, /maximum/);
});

test("keyboard cohort pickup uses post-removal source index and slot bounds, retaining pending Escape", (t) => {
  const f = selectionInput(); t.after(() => f.adapter.destroy());
  f.selection.select(["a", "c"]);
  f.send("keydown", "c", { key: " " });
  assert.deepEqual(f.calls.slice(0, 2), [
    ["drag", { cardIds: ["a", "c"], primaryCardId: "c" }],
    ["update", { toZoneId: "lake", index: 1 }],
  ]);
  f.send("keydown", "c", { key: "ArrowRight" });
  assert.equal(f.calls.filter(([name]) => name === "update").length, 1);
  f.send("keydown", "c", { key: "Tab" });
  assert.deepEqual(f.calls.at(-1), ["update", { toZoneId: "river", index: 0 }]);
  f.send("keydown", "c", { key: "Enter" });
  assert.equal(f.send("keydown", "c", { key: "Tab" }).defaultPrevented, undefined);
  f.send("keydown", "c", { key: "Escape" });
  assert.deepEqual(f.calls.at(-1), ["cancel", "Escape"]);
  assert.deepEqual(f.selection.snapshot().cardIds, ["a", "c"]);
});

test("touch selection without touch dragging toggles taps and preserves native scrolling", (t) => {
  const f = selectionInput({ options: { touchSelection: true } }); t.after(() => f.adapter.destroy());
  f.tap("a", { pointerType: "touch" });
  f.tap("c", { pointerType: "touch" });
  assert.deepEqual(f.selection.snapshot().cardIds, ["a", "c"]);
  f.tap("a", { pointerType: "touch" });
  assert.deepEqual(f.selection.snapshot().cardIds, ["c"]);
  f.send("pointerdown", "b", { pointerType: "touch" });
  const move = f.send("pointermove", "b", { pointerType: "touch", clientY: 60 });
  f.send("pointerup", "b", { pointerType: "touch", clientY: 60 });
  assert.equal(move.defaultPrevented, undefined);
  assert.equal(f.stage.style.touchAction, undefined);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.selection.snapshot().cardIds, ["c"]);
});

test("combined touch mode carries the selection without applying a tap toggle first", (t) => {
  const f = selectionInput({ options: { touchDrag: true, touchSelection: true } }); t.after(() => f.adapter.destroy());
  f.tap("a", { pointerType: "touch" });
  f.tap("d", { pointerType: "touch" });
  f.pickup("a", { pointerType: "touch" });
  assert.equal(f.stage.style.touchAction, "none");
  assert.deepEqual(f.session().snapshot().cardIds, ["a", "d"]);
  f.send("pointerup", "a", { pointerType: "touch" });
  assert.deepEqual(f.selection.snapshot().cardIds, ["a", "d"]);
});

test("a second contact cancels a touch selection tap without preventing native input", (t) => {
  const f = selectionInput({ options: { touchSelection: true } }); t.after(() => f.adapter.destroy());
  f.send("pointerdown", "a", { pointerType: "touch" });
  const second = f.send("pointerdown", "c", { pointerType: "touch", pointerId: 2, isPrimary: false });
  f.send("pointerup", "a", { pointerType: "touch" });
  assert.equal(second.defaultPrevented, undefined);
  assert.deepEqual(f.selection.snapshot().cardIds, []);
});

test("handled pointer clicks are suppressed and embedded controls keep their keyboard behavior", (t) => {
  const f = selectionInput(); t.after(() => f.adapter.destroy());
  f.tap("a");
  let stopped = false;
  const click = f.send("click", "a", { detail: 1, stopImmediatePropagation() { stopped = true; } });
  assert.equal(click.defaultPrevented, true);
  assert.equal(stopped, true);
  assert.equal(f.send("click", "a", { detail: 0 }).defaultPrevented, undefined);
  const control = { closest: (selector) => selector === "[data-card-id]" ? f.shells.get("a") : control };
  for (const key of [" ", "a", "ArrowRight", "Escape"]) {
    const input = event("keydown", { target: control, key, ctrlKey: true });
    f.stage.dispatchEvent(input);
    assert.equal(input.defaultPrevented, undefined);
  }
  assert.deepEqual(f.selection.snapshot().cardIds, ["a"]);
  assert.equal(f.calls.length, 0);
});
