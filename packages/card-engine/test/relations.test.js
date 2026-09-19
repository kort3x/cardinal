import test from "node:test";
import assert from "node:assert/strict";
import { createCardScene } from "../src/index.js";
import { normalizeSnapshot } from "../src/model.js";

const zone = (id, cardIds, x = 0) => ({ id, cardIds, geometry: { x, y: 0, width: 500, height: 500, depth: 0 } });
const card = (id) => ({ id, activeFaceId: "front", faces: { front: { elements: [] } }, pose: { x: 0, y: 0 } });

test("card relations normalize one parent per child and reject cycles", () => {
  const snapshot = normalizeSnapshot({
    cards: [card("parent"), card("child"), card("grandchild")],
    zones: [zone("table", ["parent", "child", "grandchild"])],
    relationships: [
      { id: "child-link", parentId: "parent", childId: "child", anchorX: 0.8, offsetX: 12, angle: 5 },
      { id: "grandchild-link", parentId: "child", childId: "grandchild", offsetY: 10, scale: 0.5 },
    ],
  });
  assert.equal(snapshot.relationships[0].anchorX, 0.8);
  assert.throws(() => normalizeSnapshot({
    cards: [card("a"), card("b")], zones: [zone("table", ["a", "b"])],
    relationships: [{ parentId: "a", childId: "b" }, { parentId: "b", childId: "a" }],
  }), /cycle/);
  assert.throws(() => normalizeSnapshot({
    cards: [card("a"), card("b"), card("c")], zones: [zone("table", ["a", "b", "c"])],
    relationships: [{ parentId: "a", childId: "c" }, { parentId: "b", childId: "c" }],
  }), /multiple spatial parents/);
});

test("attached cards do not consume arrangement slots and inherit parent transforms", () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply({
    cards: [card("parent"), card("child")],
    zones: [zone("table", ["parent", "child"])],
    relationships: [{ parentId: "parent", childId: "child", offsetX: 20, offsetY: 10, angle: 15, scale: 0.5 }],
  });
  const visual = new Map(scene.snapshot().visual.map(({ cardId, pose }) => [cardId, pose]));
  assert.equal(visual.get("child").x - visual.get("parent").x, 20);
  assert.equal(visual.get("child").y - visual.get("parent").y, 10);
  assert.equal(visual.get("child").angle, 15);
  assert.equal(visual.get("child").scale, 0.5);
  scene.destroy();
});

test("attach, detach, and parent moves preserve child identity and zone membership", async () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply({ cards: [card("parent"), card("child")], zones: [zone("one", ["parent", "child"]), zone("two", [])] });
  await scene.transact([{ type: "attach", parentId: "parent", childId: "child", relation: { offsetX: 15 } }]).finished;
  assert.equal(scene.snapshot().desired.relationships[0].childId, "child");
  await scene.transact([{ type: "move", cardId: "parent", to: "two" }]).finished;
  assert.deepEqual(scene.snapshot().desired.zones.map(({ cardIds }) => cardIds), [[], ["parent", "child"]]);
  await scene.transact([{ type: "detach", childId: "child", position: { x: 100, y: 120 } }]).finished;
  const state = scene.snapshot();
  assert.equal(state.desired.relationships.length, 0);
  assert.equal(state.desired.cards.find(({ id }) => id === "child").positionMode, "absolute");
  scene.destroy();
});

test("moving an attached child requires explicit detach", () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply({ cards: [card("parent"), card("child")], zones: [zone("one", ["parent", "child"])] , relationships: [{ parentId: "parent", childId: "child" }] });
  assert.throws(() => scene.transact([{ type: "move", cardId: "child", position: { x: 20, y: 20 } }]), /detach/);
  scene.destroy();
});

test("parent rotation, scale, and face changes propagate to descendants", async () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply({
    cards: [card("parent"), card("child")],
    zones: [zone("table", ["parent", "child"])],
    relationships: [{ parentId: "parent", childId: "child", angle: 10, scale: 0.5 }],
  });
  await scene.transact([{ type: "rotate", cardId: "parent", angle: 30 }, { type: "scale", cardId: "parent", factor: 2 }]).finished;
  let visual = new Map(scene.snapshot().visual.map(({ cardId, pose }) => [cardId, pose]));
  assert.equal(visual.get("child").angle, 40);
  assert.equal(visual.get("child").scale, 1);
  await scene.transact([{ type: "face", cardId: "parent", face: "faceDown" }]).finished;
  visual = new Map(scene.snapshot().visual.map(({ cardId, pose }) => [cardId, pose]));
  assert.equal(visual.get("parent").flipY, 180);
  assert.equal(visual.get("child").flipY, 180);
  scene.destroy();
});

test("cross-zone attach adopts the child subtree and respects surface affinity", async () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply({
    cards: [card("parent"), card("child")],
    zones: [zone("parent-zone", ["parent"]), zone("child-zone", ["child"])],
    relationships: [],
  });
  await scene.transact([{ type: "attach", parentId: "parent", childId: "child", relation: { affinity: "front" } }]).finished;
  let state = scene.snapshot();
  assert.deepEqual(state.desired.zones.map(({ cardIds }) => cardIds), [["parent", "child"], []]);
  await scene.transact([{ type: "face", cardId: "parent", face: "faceDown" }]).finished;
  state = scene.snapshot();
  assert.equal(state.visual.find(({ cardId }) => cardId === "child").pose.visible, false);
  scene.destroy();
});

test("parent drag preview and commit carry descendants once", () => {
  const scene = createCardScene({ motion: { reducedMotion: true }, interaction: { rules: {
    canTake: () => ({ allowed: true }), canPut: () => ({ allowed: true }),
  } } });
  scene.apply({
    cards: [card("parent"), card("child")],
    zones: [zone("one", ["parent", "child"]), zone("two", [], 600)],
    relationships: [{ parentId: "parent", childId: "child" }],
  });
  const drag = scene.drag({ cardIds: ["parent"] });
  drag.update({ toZoneId: "two", index: 0 });
  const intent = drag.release();
  assert.equal(intent.cardIds.includes("child"), true);
  scene.resolveDrop(intent.id, { accepted: true });
  assert.deepEqual(scene.snapshot().desired.zones.map(({ cardIds }) => cardIds), [[], ["parent", "child"]]);
  scene.destroy();
});

test("parent-plus-child drag selection is deduplicated instead of double-moving", () => {
  const scene = createCardScene({ motion: { reducedMotion: true }, interaction: { rules: {
    canTake: () => ({ allowed: true }), canPut: () => ({ allowed: true }),
  } } });
  scene.apply({
    cards: [card("parent"), card("child")],
    zones: [zone("one", ["parent", "child"]), zone("two", [], 600)],
    relationships: [{ parentId: "parent", childId: "child" }],
  });
  const drag = scene.drag({ cardIds: ["parent", "child"] });
  assert.deepEqual(drag.snapshot().cardIds, ["parent", "child"]);
  drag.cancel();
  scene.destroy();
});

test("named flow anchors use measured geometry and hide missing anchors", () => {
  const parent = { ...card("parent"), faces: { front: { elements: [
    { id: "title", type: "text", content: { text: "Parent title" }, layout: { mode: "flow" } },
  ] } } };
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply({
    cards: [parent, card("child"), card("missing")],
    zones: [zone("table", ["parent", "child", "missing"])],
    relationships: [
      { parentId: "parent", childId: "child", anchor: "title" },
      { parentId: "parent", childId: "missing", anchor: "unknown" },
    ],
  });
  const state = scene.snapshot();
  assert.equal(state.visual.find(({ cardId }) => cardId === "child").pose.visible, true);
  assert.equal(state.visual.find(({ cardId }) => cardId === "missing").pose.visible, false);
  scene.destroy();
});
