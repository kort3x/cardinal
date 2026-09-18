import test from "node:test";
import assert from "node:assert/strict";
import { createInspection } from "../src/inspection.js";
import { attachInspectionInput } from "../src/inspection-input.js";

class FakeTarget {
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

class FakeElement extends FakeTarget {
  constructor(tagName, ownerDocument) {
    super();
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.attributes = {};
    this.className = "";
    this.classList = {
      add: (...names) => { this.className = [...new Set(`${this.className} ${names.join(" ")}`.trim().split(/\s+/))].join(" "); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(" "); },
      toggle: (name, force) => {
        const has = this.className.split(/\s+/).includes(name);
        if (force === true || (!has && force !== false)) this.classList.add(name);
        else if (has && force !== true) this.classList.remove(name);
      },
    };
    this.hidden = false;
    this.tabIndex = 0;
    this.isConnected = false;
    this._text = "";
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this._text = String(value ?? "");
    this.children = [];
  }

  append(...nodes) {
    for (const node of nodes) {
      if (!node) continue;
      node.parentElement = this;
      node.isConnected = this.isConnected;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  remove() {
    this.parentElement?.children.splice(this.parentElement.children.indexOf(this), 1);
    this.isConnected = false;
  }

  contains(node) {
    return node === this || this.children.some((child) => child.contains(node));
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 420, bottom: 320, width: 420, height: 320 };
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.children) {
        if ((selector === ".cardinal-inspection" && child.className.split(/\s+/).includes("cardinal-inspection"))
          || (selector === "[data-card-id]" && child.dataset.cardId)
          || (selector === "button" && child.tagName === "BUTTON")) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

class FakeDocument extends FakeTarget {
  constructor() {
    super();
    this.defaultView = new FakeTarget();
    this.defaultView.innerWidth = 500;
    this.defaultView.innerHeight = 300;
    this.body = new FakeElement("body", this);
    this.body.isConnected = true;
    this.activeElement = this.body;
  }

  createElement(tagName) { return new FakeElement(tagName, this); }

  contains(node) { return this.body.contains(node); }
}

function card(id, { faceUp = true, text = id, backText = "Sleeve" } = {}) {
  return {
    id,
    activeFaceId: "summary",
    faceUp,
    dimensions: { width: 100, height: 140 },
    faces: {
      summary: { elements: [{ id: "title", type: "text", content: { text } }] },
    },
    back: { elements: [{ id: "back", type: "text", content: { text: backText } }] },
  };
}

function sceneState(cards, visual = new Map(cards.map((entry) => [entry.id, { x: 100, y: 100, z: 0, visible: true }]))) {
  return {
    desired: { cards, zones: [{ id: "table", cardIds: cards.map((entry) => entry.id), visible: true }] },
    visual,
  };
}

function event(type, properties = {}) {
  return {
    type,
    pointerType: "mouse",
    pointerId: 1,
    clientX: 100,
    clientY: 100,
    key: "",
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
    ...properties,
  };
}

test("snapshot contains sanitized session content and never desired state", () => {
  let current = sceneState([card("visible", { text: "Readable" })]);
  const manager = createInspection({ state: () => current });
  const handle = manager.open("visible");
  const snapshot = manager.snapshot();

  assert.equal(snapshot.sessions.length, 1);
  assert.equal(snapshot.sessions[0].content.elements[0].content.text, "Readable");
  assert.equal("desired" in snapshot, false);
  assert.equal("zones" in snapshot.sessions[0], false);
  assert.equal(handle.snapshot().cardId, "visible");
  handle.close();
  assert.deepEqual(manager.snapshot(), { sessions: [] });
});

test("concealed inspection uses the back until canInspectConcealed explicitly allows content", () => {
  let current = sceneState([card("secret", { faceUp: false, text: "SECRET FRONT" })]);
  let allowConcealed = false;
  const manager = createInspection({
    state: () => current,
    rules: { canInspectConcealed: () => ({ allowed: allowConcealed }) },
  });
  const handle = manager.open("secret");
  assert.equal(handle.snapshot().content.elements[0].content.text, "Sleeve");
  assert.equal("activeFaceId" in handle.snapshot(), false);
  allowConcealed = true;
  manager.reconcile();
  assert.equal(handle.snapshot().content.elements[0].content.text, "SECRET FRONT");

  current = sceneState([card("secret", { faceUp: false, text: "SECRET FRONT" })]);
  current.desired.zones[0].visible = false;
  assert.throws(() => manager.open("secret"), /hidden/);
  handle.close();
});

test("related navigation reevaluates visibility and permission on every request", () => {
  let current = sceneState([card("one"), card("two")]);
  let allowTwo = true;
  const manager = createInspection({
    state: () => current,
    rules: { canInspect: ({ cardId }) => cardId !== "two" || allowTwo },
  });
  const handle = manager.open("one", { relatedCardIds: ["two"] });
  allowTwo = false;
  manager.reconcile();
  assert.deepEqual(handle.snapshot().relatedCardIds, []);
  assert.throws(() => handle.navigate("two"), /not permitted/);
  allowTwo = true;
  current.desired.zones[0].visible = false;
  assert.throws(() => handle.navigate("two"), /hidden/);
  assert.equal(handle.snapshot().cardId, "one");
  handle.close();
});

test("reconcile updates content and in-place decoration is transient, raised, readable, and clamped", () => {
  let current = sceneState([card("one", { text: "Before" })], new Map([["one", { x: 490, y: 290, z: 0, width: 100, height: 140, visible: true }]]));
  const doc = new FakeDocument();
  const host = doc.createElement("div");
  doc.body.append(host);
  const manager = createInspection({
    element: host,
    state: () => current,
    toClient: (point) => ({ x: point.x, y: point.y }),
    options: { lift: 20, scale: 1.5 },
  });
  const handle = manager.open("one", { mode: "preview" });
  current.desired.cards[0].faces.summary.elements[0].content.text = "After";
  manager.reconcile();
  assert.equal(handle.snapshot().content.elements[0].content.text, "After");

  const inPlace = manager.open("one", { mode: "inPlace" });
  const originalCard = current.desired.cards[0];
  const originalPose = current.visual.get("one");
  const decorated = manager.decorate(originalCard, originalPose);
  assert.notEqual(decorated.card, originalCard);
  assert.equal(decorated.card.faces.summary.elements[0].content.text, "After");
  assert.equal(decorated.pose.scale, 1.5);
  assert.equal(decorated.pose.z, 20);
  assert.ok(decorated.pose.x < originalPose.x);
  assert.ok(decorated.pose.y < originalPose.y);
  assert.equal(originalCard.faceUp, true);
  inPlace.close();
  handle.close();
});

test("modal preview exposes stable auxiliary identity and restores valid focus", () => {
  const doc = new FakeDocument();
  const host = doc.createElement("div");
  doc.body.append(host);
  const returnFocus = doc.createElement("button");
  doc.body.append(returnFocus);
  returnFocus.focus();
  const manager = createInspection({ element: host, state: () => sceneState([card("one"), card("two")]) });
  const handle = manager.open("one", { modal: true, relatedCardIds: ["two"] });
  const root = doc.body.querySelector(".cardinal-inspection");
  assert.equal(root.dataset.viewId, handle.id);
  assert.equal(root.dataset.sourceCardId, "one");
  assert.equal(root.querySelector("[data-card-id]"), null);
  assert.equal(doc.activeElement, root.children[0]);
  doc.dispatchEvent(event("keydown", { key: "Escape" }));
  assert.equal(manager.snapshot().sessions.length, 0);
  assert.equal(doc.activeElement, returnFocus);
});

test("input supports dwell, focus, keyboard, touch hold, and timer cancellation", async () => {
  const doc = new FakeDocument();
  const stage = doc.createElement("div");
  doc.body.append(stage);
  const calls = [];
  const handles = [];
  const scene = {
    clientToScene(point) { return point; },
    hitTest() { return { cardId: "one" }; },
    inspect(cardId) {
      calls.push(cardId);
      const handle = { close() { calls.push(`close:${cardId}`); } };
      handles.push(handle);
      return handle;
    },
    on() { return () => {}; },
    snapshot() { return { interaction: { sessions: [] } }; },
  };
  const adapter = attachInspectionInput({ element: stage, scene, options: { hover: true, dwell: 5, dismissDelay: 5, touchHold: 5 } });

  stage.dispatchEvent(event("pointermove", { pointerType: "mouse" }));
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.deepEqual(calls, ["one"]);
  stage.dispatchEvent(event("pointerleave", { relatedTarget: null }));
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.equal(calls.includes("close:one"), true);

  const shell = doc.createElement("article");
  shell.dataset.cardId = "one";
  stage.append(shell);
  stage.dispatchEvent(event("keydown", { target: shell, key: "i" }));
  assert.equal(calls.at(-1), "one");
  handles.at(-1).close();

  stage.dispatchEvent(event("pointerdown", { target: shell, pointerType: "touch", pointerId: 7 }));
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.equal(calls.at(-1), "one");
  stage.dispatchEvent(event("pointerup", { target: shell, pointerType: "touch", pointerId: 7 }));
  adapter.destroy();
  const callCount = calls.length;
  stage.dispatchEvent(event("pointerdown", { target: shell, pointerType: "touch", pointerId: 8 }));
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.equal(calls.length, callCount);
});

for (const [eventName, payload, expectedReads] of [
  ["change", "snapshot", 0],
  ["change", "absent", 1],
  ["interaction-change", "interaction", 1],
  ["inspection-change", "inspection", 1],
]) {
  test(`input reconciles ${eventName} (${payload}) with ${expectedReads} snapshot reads`, async () => {
    const doc = new FakeDocument();
    const stage = doc.createElement("div");
    doc.body.append(stage);
    const shell = doc.createElement("article");
    shell.dataset.cardId = "one";
    stage.append(shell);
    const listeners = new Map();
    const handles = [];
    let reads = 0;
    const state = { desired: { cards: [] }, interaction: { sessions: [] }, inspection: { sessions: [] } };
    const scene = {
      hitTest() { return { cardId: "one" }; },
      inspect() {
        const handle = { id: `view-${handles.length}`, closed: false, close() { this.closed = true; } };
        handles.push(handle);
        state.inspection.sessions.push({ id: handle.id });
        return handle;
      },
      snapshot() { reads += 1; return state; },
      on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name); },
    };
    const adapter = attachInspectionInput({ element: stage, scene, options: { hover: true, dwell: 5 } });
    const notify = () => {
      reads = 0;
      listeners.get(eventName)(payload === "snapshot" ? state : payload === "absent" ? undefined : state[payload]);
      assert.equal(reads, expectedReads);
    };
    const hover = async () => {
      stage.dispatchEvent(event("pointermove", { pointerType: "mouse" }));
      await new Promise((resolve) => setTimeout(resolve, 12));
    };
    try {
      await hover();
      assert.equal(handles.length, 1);
      notify();
      assert.equal(handles[0].closed, false, "a live hover session stays open");

      state.inspection.sessions = [];
      notify();
      assert.equal(handles[0].closed, true, "a removed session clears the hover handle");
      await hover();
      assert.equal(handles.length, 2, "the same card can be inspected again after removal");

      state.interaction.sessions = [{ phase: "dragging" }];
      notify();
      assert.equal(handles[1].closed, true, "dragging closes the hover preview");
      await hover();
      assert.equal(handles.length, 2, "dragging suppresses hover dwell");

      state.interaction.sessions = [];
      notify();
      stage.dispatchEvent(event("keydown", { target: shell, key: "i" }));
      assert.equal(handles.length, 3);
      notify();
      assert.equal(handles[2].closed, false, "a live keyboard session stays open");
      state.inspection.sessions = [];
      notify();
      assert.equal(handles[2].closed, true, "a removed session clears the focus handle");
    } finally {
      adapter.destroy();
    }
  });
}

test("hover inspection is opt-in and remains disabled by default", async () => {
  const doc = new FakeDocument();
  const stage = doc.createElement("div");
  doc.body.append(stage);
  const calls = [];
  const scene = {
    clientToScene(point) { return point; },
    hitTest() { return { cardId: "one" }; },
    inspect(cardId) { calls.push(cardId); return { close() {} }; },
    on() { return () => {}; },
    snapshot() { return { interaction: { sessions: [] } }; },
  };
  const adapter = attachInspectionInput({ element: stage, scene, options: { dwell: 5 } });

  stage.dispatchEvent(event("pointermove", { pointerType: "mouse" }));
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.deepEqual(calls, []);
  adapter.destroy();
});

test("in-place clamping measures scaled scene units in viewport pixels", () => {
  const doc = new FakeDocument();
  const host = doc.createElement("div");
  doc.body.append(host);
  const pose = { x: 240, y: 145, z: 0, scale: 0.8, layoutScale: 0.6, angle: 30, width: 100, height: 140, visible: true };
  const source = card("edge");
  const current = sceneState([source], new Map([[source.id, pose]]));
  const manager = createInspection({ element: host, state: () => current, toClient: ({ x, y }) => ({ x: x * 2, y: y * 2 }) });
  manager.open(source.id, { mode: "inPlace", scale: 3 });
  const { pose: shown } = manager.decorate(source, pose);
  const width = (Math.cos(Math.PI / 6) * 100 + 70) * shown.scale * 0.6 * 2;
  const height = (50 + Math.cos(Math.PI / 6) * 140) * shown.scale * 0.6 * 2;
  assert.ok(shown.x * 2 - width / 2 >= 12 - 1e-6);
  assert.ok(shown.x * 2 + width / 2 <= 500 - 12 + 1e-6);
  assert.ok(shown.y * 2 - height / 2 >= 12 - 1e-6);
  assert.ok(shown.y * 2 + height / 2 <= 300 - 12 + 1e-6);
  assert.equal(pose.x, 240);
  manager.destroy();
});
