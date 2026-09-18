import test from "node:test";
import assert from "node:assert/strict";
import { createCardScene } from "../src/index.js";
import { normalizeSnapshot } from "../src/model.js";
import { filterContentElements } from "../src/renderer.js";

function clock() {
  let time = 0;
  let nextId = 0;
  const frames = new Map();
  return {
    now: () => time,
    requestFrame(callback) {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      frames.delete(id);
    },
    tick(milliseconds) {
      time += milliseconds;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(time);
    },
  };
}

function rendererLog() {
  const updates = [];
  return {
    updates,
    factory: () => ({
      update(card, pose, options) {
        updates.push({ card, pose: { ...pose }, options: { ...options } });
      },
      remove() {},
      destroy() {},
    }),
  };
}

function face(title, extra = {}) {
  return {
    ...extra,
    elements: [
      { id: "title", type: "text", content: { text: title } },
      { id: "image", type: "image", content: { src: `/${title}.png`, alt: `${title} image` } },
    ],
  };
}

function zone(presentation = { elements: ["image"] }) {
  return {
    id: "table",
    cardIds: ["card"],
    presentation,
    geometry: { x: 0, y: 0, width: 500, height: 400, depth: 0 },
  };
}

function card({ faceUp = false, activeFaceId = "a", faceCycle, faces, ...rest } = {}) {
  return {
    id: "card",
    faceUp,
    activeFaceId,
    ...(faceCycle ? { faceCycle } : {}),
    faces: faces ?? { a: face("a"), b: face("b", { elements: [
      { id: "title", type: "text", content: { text: "b" } },
      { id: "description", type: "text", content: { text: "A longer detail face with enough text to change a content-sized card." } },
    ] }) },
    back: { elements: [{ id: "sleeve", type: "text", content: { text: "Concealed" } }] },
    ...rest,
  };
}

test("contentFace is permissioned, render-filtered, and independent of concealment", async () => {
  const motion = clock();
  const log = rendererLog();
  const scene = createCardScene({
    renderer: log.factory,
    motion: { clock: motion, duration: 100 },
    interaction: { rules: { canChangeFace: () => ({ allowed: true }), canReveal: () => ({ allowed: true }) } },
  });
  scene.apply({ cards: [card()], zones: [zone()] });
  const before = scene.snapshot().visual[0].pose;

  const transition = scene.transact([{ type: "contentFace", cardId: "card", faceId: "b" }], { origin: "user" });
  const selected = scene.snapshot();
  assert.equal(selected.desired.cards[0].activeFaceId, "b");
  assert.equal(selected.desired.cards[0].faceUp, false);
  assert.equal(selected.desired.cards[0].faces.a.elements.length, 2);
  assert.equal(selected.desired.cards[0].faces.b.elements.length, 2);
  assert.equal(selected.visual[0].pose.flipY, before.flipY);
  assert.deepEqual(log.updates.at(-1).options.presentation, { elements: ["image"] });
  assert.deepEqual(filterContentElements(selected.desired.cards[0].faces.b, { elements: ["image"] }).elements.map(({ id }) => id), ["image"]);

  scene.transact([{ type: "face", cardId: "card", face: "faceUp" }]);
  motion.tick(100);
  await transition.finished;
  const revealed = scene.snapshot();
  assert.equal(revealed.desired.cards[0].activeFaceId, "b", "reveal preserves an explicitly selected concealed face");
  assert.equal(revealed.desired.cards[0].faceUp, true);
  scene.destroy();
});

test("contentFace preserves an active spin on rejected batches and cancels it on acceptance", () => {
  const motion = clock();
  const log = rendererLog();
  const scene = createCardScene({ renderer: log.factory, motion: { clock: motion, duration: 100 } });
  scene.apply({ cards: [card({ faceUp: true, faceCycle: ["a", "b"] })], zones: [zone(null)] });
  scene.spin("card", { speed: 180 });
  motion.tick(200);
  const spinningFace = scene.snapshot().desired.cards[0].activeFaceId;
  assert.throws(() => scene.transact([
    { type: "contentFace", cardId: "card", faceId: "b" },
    { type: "contentFace", cardId: "card", faceId: "missing" },
  ]), /Unknown face missing/);
  assert.equal(scene.snapshot().desired.cards[0].activeFaceId, spinningFace);
  assert.equal(scene.snapshot().spinning, true);

  scene.transact([{ type: "contentFace", cardId: "card", faceId: "b" }]);
  assert.equal(scene.snapshot().spinning, false);
  motion.tick(1000);
  assert.equal(scene.snapshot().desired.cards[0].activeFaceId, "b");
  scene.destroy();
});

test("back-only unknown cards stay concealed and reject reveal or content selection atomically", () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply({ cards: [{ id: "card", faceUp: false, back: { elements: [] } }], zones: [zone(null)] });
  const before = scene.snapshot().desired;
  assert.deepEqual(before.cards[0].faces, {});
  assert.throws(() => scene.transact([{ type: "contentFace", cardId: "card", faceId: "front" }]), /Unknown face front/);
  assert.throws(() => scene.transact([{ type: "face", cardId: "card", face: "faceUp" }]), /requires at least one content face/);
  assert.deepEqual(scene.snapshot().desired, before);
  assert.throws(() => scene.apply({ ...before, zones: [{ ...zone(null), faceUp: true }] }), /requires at least one content face/);
  assert.deepEqual(scene.snapshot().desired, before);
  scene.destroy();
});

test("user contentFace requires canChangeFace and disabled feedback is validated", () => {
  const fixture = {
    cards: [card({ faceUp: true, feedback: { actionable: true, pending: true } })],
    zones: [zone(null)],
  };
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply(fixture);
  assert.throws(() => scene.transact([{ type: "contentFace", cardId: "card", faceId: "b" }], { origin: "user" }), /Change face is not permitted/);
  assert.deepEqual(scene.snapshot().desired.cards[0].feedback, { disabled: false, actionable: true, pending: true });
  scene.apply({ ...fixture, cards: [card({ faceUp: true, feedback: { disabled: true } })] });
  assert.throws(() => scene.transact([{ type: "contentFace", cardId: "card", faceId: "b" }], { origin: "user" }), /disabled/);
  assert.throws(() => normalizeSnapshot({ ...fixture, cards: [card({ feedback: { pending: "yes" } })] }), /feedback.pending must be boolean/);
  scene.destroy();
});


test("inspection and explicit content selection preserve concurrent motion and latest zone presentation", async () => {
  const motion = clock();
  const log = rendererLog();
  const scene = createCardScene({ renderer: log.factory, motion: { clock: motion, duration: 100 } });
  scene.apply({ cards: [card({ faceCycle: ["a", "b"] })], zones: [zone()] });
  const travel = scene.transact([
    { type: "move", cardId: "card", position: { x: 350, y: 300 } },
    { type: "face", cardId: "card", face: "faceUp" },
  ]);
  motion.tick(30);
  const view = scene.inspect("card", { mode: "inPlace" });
  assert.equal(log.updates.at(-1).options.presentation, null);
  scene.transact([{ type: "contentFace", cardId: "card", faceId: "a" }]);
  scene.transact([{ type: "zone", zoneId: "table", changes: { presentation: { elements: ["title"] } } }]);
  view.close();
  motion.tick(1000);
  await travel.finished;
  const state = scene.snapshot();
  assert.equal(state.desired.cards[0].activeFaceId, "a");
  assert.equal(state.desired.cards[0].faceUp, true);
  assert.equal(state.visual[0].pose.x, 350);
  assert.equal(state.visual[0].pose.y, 300);
  assert.equal(state.visual[0].pose.flipY, 0);
  assert.deepEqual(log.updates.at(-1).options.presentation, { elements: ["title"] });
  assert.equal(state.inspection.sessions.length, 0);
  scene.destroy();
});

test("change events carry reconciled inspection content after concealment", () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply({ cards: [card({ faceUp: true })], zones: [zone(null)] });
  scene.inspect("card");
  const events = [];
  scene.on("change", (state) => events.push(state));
  scene.transact([{ type: "face", cardId: "card", face: "faceDown" }]);
  assert.ok(events.length > 0);
  for (const state of events) {
    assert.equal(state.inspection.sessions[0].contentFaceId, "back");
    assert.equal(state.inspection.sessions[0].content.elements[0].content.text, "Concealed");
  }
  scene.destroy();
});
