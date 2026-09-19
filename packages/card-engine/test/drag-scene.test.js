import test from "node:test";
import assert from "node:assert/strict";
import { createCardScene } from "../src/index.js";
import { createHeadlessRenderer } from "../src/renderer.js";

function clock() {
  let time = 0;
  let id = 0;
  const frames = new Map();
  return {
    now: () => time,
    requestFrame(fn) { frames.set(++id, fn); return id; },
    cancelFrame(key) { frames.delete(key); },
    tick(ms) {
      time += ms;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((fn) => fn(time));
    },
    pending: () => frames.size,
  };
}

const rules = { canStart: () => ({ allowed: true }), canDrop: () => ({ allowed: true }) };
const fixture = () => ({
  cards: [{ id: "a", activeFaceId: "front", faces: { front: { elements: [] } }, dimensions: { width: 80, height: 100 } }],
  zones: [
    { id: "source", cardIds: ["a"], geometry: { x: 0, y: 0, width: 300, height: 300, depth: 0 }, arrangement: { type: "row" } },
    { id: "destination", cardIds: [], geometry: { x: 500, y: 0, width: 300, height: 300, depth: 0 }, arrangement: { type: "row" } },
  ],
});
const pose = (scene) => scene.snapshot().visual[0].pose;

test("live drag settings preserve scene, selection and active session and validate atomically", () => {
  const timer = clock();
  const scene = createCardScene({ motion: { clock: timer }, interaction: { rules, dragHangFactor: 2, motion: { dangle: 0.5 } } });
  scene.apply(fixture());
  scene.select(["a"]);
  const session = scene.drag({ cardIds: ["a"], point: { x: pose(scene).x, y: pose(scene).y } });
  const desired = scene.snapshot().desired;
  assert.equal(scene.snapshot().dragMotion.dangle, 0.5);
  scene.setDragMotion({ preset: "crisp", liftScale: 1.3 });
  assert.deepEqual(scene.snapshot().desired, desired);
  assert.equal(session.snapshot().phase, "dragging");
  assert.equal(scene.snapshot().dragMotion.liftScale, 1.3);
  const before = scene.snapshot().dragMotion;
  assert.throws(() => scene.setDragMotion({ damping: -1 }), /damping/);
  assert.deepEqual(scene.snapshot().dragMotion, before);
  timer.tick(100);
  assert.equal(pose(scene).scale, 1.3);
  scene.destroy();
  assert.equal(timer.pending(), 0);
});

test("drag rendering coalesces pointer updates and animation channels once per frame", () => {
  const timer = clock();
  const updates = [];
  let renders = 0;
  const scene = createCardScene({
    motion: { clock: timer }, interaction: { rules },
    renderer: () => ({ ...createHeadlessRenderer(), update: (card, current) => updates.push({ id: card.id, pose: { ...current } }), render: () => { renders += 1; } }),
  });
  scene.apply(fixture());
  const session = scene.drag({ cardIds: ["a"], point: { x: pose(scene).x, y: pose(scene).y } });
  updates.length = 0;
  renders = 0;
  for (let i = 0; i < 10; i += 1) session.update({ point: { x: 850 + i, y: 600 } });
  assert.equal(updates.length, 0);
  assert.equal(renders, 0);
  timer.tick(16);
  assert.equal(updates.length, 1);
  assert.equal(renders, 1);
  assert.equal(updates[0].pose.x, 859);
  scene.destroy();
});

test("immediately accepted drops retain their landing delay and finite settlement", async () => {
  const timer = clock();
  const scene = createCardScene({ motion: { clock: timer }, interaction: { rules, motion: { landingDelay: 80, landingTime: 180 } } });
  scene.apply(fixture());
  const session = scene.drag({ cardIds: ["a"], point: { x: pose(scene).x, y: pose(scene).y } });
  session.update({ toZoneId: "destination", index: 0 });
  const intent = session.release();
  const before = pose(scene).x;
  scene.resolveDrop(intent.id, { accepted: true });
  timer.tick(79);
  assert.equal(pose(scene).x, before);
  timer.tick(31);
  assert.notEqual(pose(scene).x, before);
  timer.tick(1000);
  assert.equal(scene.snapshot().settling, false);
  assert.deepEqual(scene.snapshot().desired.zones[1].cardIds, ["a"]);
  assert.equal(timer.pending(), 0);
  scene.destroy();
});

test("invalid nested drag options fail before a renderer is created", () => {
  let created = false;
  assert.throws(() => createCardScene({ interaction: { motion: null }, renderer: () => { created = true; return createHeadlessRenderer(); } }), /object/);
  assert.equal(created, false);
});

test("physical grab correction carries the entire cohort without changing screen offsets", () => {
  const timer = clock();
  const scene = createCardScene({
    motion: { clock: timer }, interaction: { rules, dragPresentation: 'preserve', motion: { dangle: 0, upright: 0 } },
    renderer: () => ({
      ...createHeadlessRenderer(),
      captureGrab: () => ({ localX: 20 }),
      resolveGrabPose: (current, grab, pointer) => ({ x: pointer.x - grab.localX * current.scale, y: pointer.y }),
    }),
  });
  const data = fixture();
  data.cards.push({ ...structuredClone(data.cards[0]), id: "b" });
  data.zones[1].cardIds = ["b"];
  scene.apply(data);
  const primary = pose(scene);
  const initialOffset = scene.snapshot().visual[1].pose.x - primary.x;
  scene.drag({ cardIds: ["a", "b"], primaryCardId: "a", point: { x: primary.x + 20, y: primary.y } });
  timer.tick(45);
  const carried = scene.snapshot().visual.map(({ pose }) => pose);
  assert.ok(Math.abs(carried[1].x - carried[0].x - initialOffset) < 1e-9);
  assert.ok(Math.abs(carried[0].x + 20 * carried[0].scale - primary.x - 20) < 1e-9);
  scene.destroy();
});
