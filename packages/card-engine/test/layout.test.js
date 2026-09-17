import test from "node:test";
import assert from "node:assert/strict";
import { solveAllPoses } from "../src/layout.js";
import { normalizeArrangement } from "../src/model.js";

const face = { elements: [] };
const card = (id, dimensions = { width: 80, height: 100 }) => ({
  id,
  dimensions,
  activeFaceId: "front",
  faces: { front: face },
  pose: { x: 0, y: 0, angle: 0, scale: 1 },
});
const zone = (arrangement, cardIds, geometry = { x: 0, y: 0, width: 400, height: 300, depth: 0 }) => ({
  id: "zone",
  cardIds,
  geometry,
  arrangement,
});
const solve = (cards, arrangement, geometry) => solveAllPoses({
  cards,
  zones: [zone(arrangement, cards.map(({ id }) => id), geometry)],
}, { projection: "orthographic" }, {});
const pose = (poses, id) => poses.get(id);

test("row and column arrangements use actual dimensions and alignment", () => {
  const cards = [card("a", { width: 80, height: 100 }), card("b", { width: 140, height: 60 }), card("c", { width: 60, height: 120 })];
  const row = solve(cards, { type: "row", gap: 10, alignment: "center" });
  assert.deepEqual([pose(row, "a").x, pose(row, "b").x, pose(row, "c").x], [40, 160, 270]);
  assert.deepEqual([pose(row, "a").y, pose(row, "b").y, pose(row, "c").y], [150, 150, 150]);

  const column = solve(cards, { type: "column", gap: 10, alignment: "end" });
  assert.deepEqual([pose(column, "a").y, pose(column, "b").y, pose(column, "c").y], [50, 140, 240]);
  assert.deepEqual([pose(column, "a").x, pose(column, "b").x, pose(column, "c").x], [360, 330, 370]);
});

test("splay arrangement spreads angles and preserves ordered depth", () => {
  const cards = [card("a"), card("b"), card("c")];
  const poses = solve(cards, { type: "splay", spread: 40, gap: 20 });
  assert.ok(pose(poses, "a").angle < pose(poses, "b").angle);
  assert.ok(pose(poses, "b").angle < pose(poses, "c").angle);
  assert.equal(pose(poses, "b").angle, 0);
  assert.ok(pose(poses, "a").x < pose(poses, "b").x);
  assert.ok(pose(poses, "b").x < pose(poses, "c").x);
  assert.ok(pose(poses, "a").z < pose(poses, "b").z);
  assert.ok(pose(poses, "b").z < pose(poses, "c").z);
});

test("hand arrangement places cards around a held-hand arc", () => {
  const cards = [card("a"), card("b"), card("c"), card("d"), card("e")];
  const poses = solve(cards, { type: "hand", spread: 60, radius: 180, curve: "convex" });
  assert.equal(pose(poses, "c").angle, 0);
  assert.equal(pose(poses, "a").angle, -24);
  assert.equal(pose(poses, "e").angle, 24);
  assert.ok(pose(poses, "a").x < pose(poses, "c").x);
  assert.ok(pose(poses, "c").x < pose(poses, "e").x);
  assert.ok(pose(poses, "a").angle < pose(poses, "b").angle);
  assert.ok(pose(poses, "b").angle < pose(poses, "c").angle);
  assert.ok(pose(poses, "a").y < pose(poses, "c").y);
  assert.ok(pose(poses, "a").z < pose(poses, "b").z);
  assert.ok(pose(poses, "d").z < pose(poses, "e").z);

  const concave = solve(cards, { type: "hand", spread: 60, radius: 180, curve: "concave" });
  assert.ok(pose(concave, "a").y > pose(concave, "c").y);
  assert.ok(pose(concave, "c").y < pose(concave, "e").y);

  const pair = [card("a"), card("b")];
  const convexPair = solve(pair, { type: "hand", spread: 60, radius: 180, curve: "convex" });
  const concavePair = solve(pair, { type: "hand", spread: 60, radius: 180, curve: "concave" });
  assert.equal(Math.abs(pose(convexPair, "a").angle), 6);
  assert.equal(Math.abs(pose(convexPair, "b").angle), 6);
  assert.equal(pose(convexPair, "a").y, pose(concavePair, "a").y);
  assert.equal(pose(convexPair, "b").y, pose(concavePair, "b").y);
  assert.equal(pose(convexPair, "a").angle, -pose(concavePair, "a").angle);
  assert.equal(pose(convexPair, "b").angle, -pose(concavePair, "b").angle);
});

test("hand draw order follows the visual left-to-right order", () => {
  const cards = [card("a"), card("b"), card("c")];
  const poses = solve(cards, { type: "hand", spread: 60, radius: 180, curve: "concave", order: "reverse" });
  assert.ok(pose(poses, "c").x < pose(poses, "b").x);
  assert.ok(pose(poses, "b").x < pose(poses, "a").x);
  assert.ok(pose(poses, "c").z < pose(poses, "b").z);
  assert.ok(pose(poses, "b").z < pose(poses, "a").z);
  assert.ok(pose(poses, "c").drawOrder < pose(poses, "b").drawOrder);
  assert.ok(pose(poses, "b").drawOrder < pose(poses, "a").drawOrder);
});

test("pile scatter is deterministic per card identity while stack order remains explicit", () => {
  const cards = [card("a"), card("b"), card("c")];
  const first = solve(cards, { type: "pile", spread: 24, angle: 12 });
  const reordered = solve([cards[2], cards[0], cards[1]], { type: "pile", spread: 24, angle: 12 });
  for (const id of ["a", "b", "c"]) {
    assert.deepEqual(
      [pose(first, id).x, pose(first, id).y, pose(first, id).angle],
      [pose(reordered, id).x, pose(reordered, id).y, pose(reordered, id).angle],
    );
  }

  const stack = solve(cards, { type: "stack", gap: 0 });
  assert.deepEqual([pose(stack, "a").x, pose(stack, "b").x, pose(stack, "c").x], [200, 200, 200]);
  assert.deepEqual([pose(stack, "a").y, pose(stack, "b").y, pose(stack, "c").y], [150, 150, 150]);
  assert.ok(pose(stack, "a").z < pose(stack, "b").z);
  assert.ok(pose(stack, "b").z < pose(stack, "c").z);
});

test("row overflow can reject or explicitly fit to a minimum readable scale", () => {
  const cards = [card("a"), card("b"), card("c")];
  assert.throws(
    () => solve(cards, { type: "row", gap: 10, overflow: "reject" }, { x: 0, y: 0, width: 200, height: 300, depth: 0 }),
    /row arrangement exceeds zone width/,
  );
  const poses = solve(cards, { type: "row", gap: 10, overflow: "fit", minScale: 0.5 }, { x: 0, y: 0, width: 200, height: 300, depth: 0 });
  assert.ok(pose(poses, "a").layoutScale < 1);
  assert.ok(pose(poses, "a").layoutScale >= 0.5);
  assert.ok(pose(poses, "c").x + pose(poses, "c").width * pose(poses, "c").layoutScale / 2 <= 200);
});

test("overlap is an explicit linear policy and arrangement options are validated", () => {
  const cards = [card("a"), card("b")];
  const poses = solve(cards, { type: "row", gap: 10, overflow: "overlap", overlap: 20 });
  assert.equal(pose(poses, "b").x - pose(poses, "a").x, 60);
  assert.throws(() => normalizeArrangement({ type: "unknown" }), /Unknown arrangement/);
  assert.throws(() => normalizeArrangement({ type: "row", overflow: "mystery" }), /Unknown arrangement overflow/);
  assert.throws(() => normalizeArrangement({ type: "row", minScale: 0 }), /minScale/);
  assert.equal(normalizeArrangement({ type: "hand", radius: 140 }).radius, 140);
  assert.throws(() => normalizeArrangement({ type: "hand", radius: -1 }), /radius/);
  assert.equal(normalizeArrangement({ type: "hand", curve: "concave" }).curve, "concave");
  assert.equal(normalizeArrangement({ type: "hand" }).curve, "concave");
  assert.throws(() => normalizeArrangement({ type: "hand", curve: "flat" }), /curve/);
});
