import test from "node:test";
import assert from "node:assert/strict";
import { createCardScene } from "../src/index.js";

function clock() {
  let time = 0;
  let id = 0;
  const frames = new Map();
  return {
    now: () => time,
    requestFrame(fn) { frames.set(++id, fn); return id; },
    cancelFrame(id) { frames.delete(id); },
    tick(ms) { time += ms; const work = [...frames.values()]; frames.clear(); work.forEach((fn) => fn(time)); },
    pending: () => frames.size,
  };
}

const card = (id) => ({ id, activeFaceId: "a", faceUp: true, dimensions: { width: 80, height: 100 }, faces: { a: { elements: [] } } });
const zone = (id, cardIds, x = 0) => ({ id, cardIds, geometry: { x, y: 0, width: 300, height: 500, depth: 0 }, arrangement: { type: "grid", gap: 10 } });
const initial = () => ({ cards: [card("a"), card("b"), card("c")], zones: [zone("source", ["a", "b"]), zone("destination", ["c"], 400)] });
const pose = (scene, id) => scene.snapshot().visual.find(({ cardId }) => cardId === id).pose;

test("transfers commit membership once and animate both grids' displaced neighbors", async () => {
  const timer = clock();
  const scene = createCardScene({ motion: { clock: timer, duration: 100 } });
  scene.apply(initial());
  const transition = scene.transact([{ type: "move", cardId: "a", to: "destination", index: 0 }]);
  assert.deepEqual(scene.snapshot().desired.zones.map(({ cardIds }) => cardIds), [["b"], ["a", "c"]]);
  timer.tick(50);
  assert.equal(pose(scene, "b").x, 85);
  assert.equal(pose(scene, "c").x, 485);
  timer.tick(50);
  await transition.finished;
  assert.equal(pose(scene, "a").x, 440);
  assert.equal(pose(scene, "b").x, 40);
  assert.equal(pose(scene, "c").x, 530);
  for (let i = 0; i < 6; i++) {
    const result = scene.transact([{ type: "move", cardId: "a", to: i % 2 ? "destination" : "source", index: 0 }]);
    timer.tick(100);
    await result.finished;
    assert.equal(pose(scene, "a").x, i % 2 ? 440 : 40);
  }
  scene.destroy();
});

test("invalid batches reject membership, capacity and geometry atomically", () => {
  const scene = createCardScene({ motion: { clock: clock() } });
  const input = initial();
  input.zones[1].capacity = 1;
  scene.apply(input);
  const before = scene.snapshot();
  assert.throws(() => scene.transact([{ type: "rotate", cardId: "a", angle: 70 }, { type: "move", cardId: "a", to: "destination" }]), /capacity/);
  assert.deepEqual(scene.snapshot(), before);
  assert.throws(() => scene.transact([{ type: "zone", zoneId: "source", changes: { geometry: { x: 0 } } }]), /finite/);
  assert.deepEqual(scene.snapshot(), before);
  assert.throws(() => scene.apply({ ...input, zones: input.zones.slice(1) }), /membership/);
  assert.deepEqual(scene.snapshot(), before);
  scene.destroy();
});

test("an atomic exchange into full zones and reduced motion reach identical states", async () => {
  const input = initial();
  input.zones[0].capacity = 2;
  input.zones[1].capacity = 1;
  const timer = clock();
  const normal = createCardScene({ motion: { clock: timer, duration: 100 } });
  const reduced = createCardScene({ motion: { reducedMotion: true } });
  const moves = [{ type: "move", cardId: "a", to: "destination" }, { type: "move", cardId: "c", to: "source", index: 0 }];
  normal.apply(input); reduced.apply(input);
  const result = normal.transact(moves);
  await reduced.transact(moves).finished;
  timer.tick(100); await result.finished;
  assert.deepEqual(normal.snapshot(), reduced.snapshot());
  normal.destroy(); reduced.destroy();
});

test("responsive anchor changes retarget movement tickets and preserve spinning", async () => {
  const timer = clock();
  let x = 400;
  const scene = createCardScene({
    motion: { clock: timer, duration: 100 },
    renderer: () => ({ update() {}, remove() {}, destroy() {}, measureZone: () => ({ visible: true, geometry: { x, y: 0, width: 300, height: 500, depth: 0 } }) }),
  });
  const input = initial();
  input.zones[1] = { id: "destination", anchor: "#destination", cardIds: ["c"] };
  scene.apply(input);
  const spin = scene.spin("a", { axis: "y", speed: 90 });
  const result = scene.transact([{ type: "move", cardId: "a", to: "destination", index: 0 }]);
  timer.tick(50);
  const before = pose(scene, "a").x;
  x = 600;
  scene.refreshGeometry();
  assert.equal(pose(scene, "a").x, before);
  let finished = false;
  result.finished.then(() => { finished = true; });
  timer.tick(50); await Promise.resolve();
  assert.equal(finished, false);
  timer.tick(50); await result.finished;
  assert.equal(pose(scene, "a").x, 640);
  assert.equal(spin.active, true);
  scene.destroy();
  assert.equal(timer.pending(), 0);
});

test("hidden anchors retain geometry and membership and exclude card input", () => {
  const timer = clock();
  let visible = true;
  let x = 0;
  const scene = createCardScene({ motion: { clock: timer, reducedMotion: true }, renderer: () => ({
    update() {}, remove() {}, destroy() {}, hitTest: () => ({ cardId: "a" }),
    measureZone: () => visible ? { visible, geometry: { x, y: 0, width: 300, height: 500, depth: 0 } } : { visible: false },
  }) });
  scene.apply({ cards: [card("a")], zones: [{ id: "anchored", anchor: "#anchor", cardIds: ["a"] }] });
  visible = false; scene.refreshGeometry();
  assert.equal(pose(scene, "a").visible, false);
  assert.equal(scene.hitTest({ x: 40, y: 50 }), null);
  assert.deepEqual(scene.select(["a"]).cardIds, []);
  assert.equal(scene.snapshot().zones[0].geometry.width, 300);
  assert.deepEqual(scene.snapshot().desired.zones[0].cardIds, ["a"]);
  visible = true; x = 500; scene.refreshGeometry();
  assert.equal(pose(scene, "a").visible, true);
  assert.equal(pose(scene, "a").x, 540);
  scene.destroy();
});

test("mixed-size grids allocate non-overlapping tracks and reflow on growth", async () => {
  const timer = clock();
  const scene = createCardScene({ motion: { clock: timer, duration: 100 } });
  const input = initial();
  input.cards[0].dimensions.width = 120;
  input.zones = [zone("grid", ["a", "b", "c"])];
  scene.apply(input);
  assert.equal(pose(scene, "b").x, 170);
  assert.equal(pose(scene, "c").y, 160);
  const result = scene.transact([{ type: "resize", cardId: "a", dimensions: { width: 250 } }]);
  timer.tick(100); await result.finished;
  assert.equal(pose(scene, "a").x, 125);
  assert.equal(pose(scene, "b").x, 40);
  assert.equal(pose(scene, "b").y, 160);
  scene.destroy();
});

test("scaled and rotated grid cards stay contained by their zone", () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  const input = { cards: [{ ...card("a"), pose: { x: 0, y: 0, angle: 35, scale: 1.5 } }], zones: [{
    id: "small", cardIds: ["a"], geometry: { x: 0, y: 0, width: 300, height: 500, depth: 0 }, arrangement: { type: "grid", gap: 10 },
  }] };
  scene.apply(input);
  const result = pose(scene, "a");
  const radians = Math.abs(result.angle * Math.PI / 180);
  const width = result.width * result.scale;
  const height = result.height * result.scale;
  const footprint = {
    width: Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians)),
    height: Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians)),
  };
  assert.ok(result.x - footprint.width / 2 >= 0);
  assert.ok(result.x + footprint.width / 2 <= 300);
  assert.ok(result.y - footprint.height / 2 >= 0);
  assert.ok(result.y + footprint.height / 2 <= 500);
  scene.destroy();
});

test("snapshot reconciliation of zone geometry retains independent motion channels", () => {
  const timer = clock();
  const scene = createCardScene({ motion: { clock: timer, duration: 100 } });
  scene.apply(initial());
  const spin = scene.spin("a", { speed: 90 });
  scene.transact([{ type: "rotate", cardId: "b", angle: 60 }]);
  timer.tick(50);
  const next = scene.snapshot().desired;
  next.zones[0].geometry.x += 100;
  scene.apply(next);
  assert.equal(spin.active, true);
  assert.equal(pose(scene, "b").angle, 30);
  timer.tick(50);
  assert.equal(pose(scene, "b").angle, 60);
  timer.tick(50);
  assert.equal(pose(scene, "a").x, 140);
  assert.equal(spin.active, true);
  scene.destroy();
});

test("zone depth updates animate in place and finish only after neighbors settle", async () => {
  const timer = clock();
  const scene = createCardScene({ motion: { clock: timer, duration: 100 } });
  scene.apply(initial());
  const result = scene.transact([{ type: "zone", zoneId: "source", changes: { geometry: { ...initial().zones[0].geometry, depth: 100 } } }]);
  assert.equal(pose(scene, "a").z, 0);
  timer.tick(50);
  assert.equal(pose(scene, "a").z, 50);
  timer.tick(50); await result.finished;
  assert.equal(pose(scene, "a").z, 100);
  scene.destroy();
});
