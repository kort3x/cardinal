import test from "node:test";
import assert from "node:assert/strict";
import { createCardScene } from "../src/index.js";
import { createInteraction } from "../src/interaction.js";
import { resolveBatchMove } from "../src/batch.js";
import { solveAllPoses } from "../src/layout.js";
import { normalizeSnapshot } from "../src/model.js";

function clock() {
  let time = 0;
  let id = 0;
  const frames = new Map();
  return {
    now: () => time,
    requestFrame(fn) { frames.set(++id, fn); return id; },
    cancelFrame(frameId) { frames.delete(frameId); },
    tick(ms) {
      time += ms;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((fn) => fn(time));
    },
    pending: () => frames.size,
  };
}

const card = (id, pose = {}) => ({
  id,
  activeFaceId: "front",
  faceUp: true,
  dimensions: { width: 80, height: 100 },
  pose,
  faces: { front: { elements: [] } },
});

const zone = (id, cardIds, x = 0, changes = {}) => ({
  id,
  cardIds,
  geometry: { x, y: 0, width: 300, height: 500, depth: 0 },
  arrangement: { type: "grid", gap: 10 },
  ...changes,
});

function input({ source = ["a", "b", "c", "d"], destination = [], cards = ["a", "b", "c", "d"], zones = {} } = {}) {
  return {
    cards: cards.map((id) => card(id)),
    zones: [
      zone("source", source, 0, zones.source),
      zone("destination", destination, 400, zones.destination),
    ],
  };
}

function sceneWith({ rules, reducedMotion = true, timer = clock(), duration = 100, renderer } = {}) {
  const scene = createCardScene({
    motion: { clock: timer, reducedMotion, duration },
    interaction: rules === undefined ? undefined : { rules },
    renderer,
  });
  scene.apply(input());
  return { scene, timer };
}

function permissiveRules(overrides = {}) {
  return {
    canStart: () => ({ allowed: true }),
    canDrop: () => ({ allowed: true }),
    ...overrides,
  };
}

function start(scene, cardIds = ["a"], point = { x: 40, y: 50 }) {
  return scene.drag({ cardIds, primaryCardId: cardIds[0], point });
}

function interactionSessions(scene) {
  return scene.snapshot().interaction.sessions;
}

function pose(scene, cardId) {
  return scene.snapshot().visual.find(({ cardId: id }) => id === cardId).pose;
}

function visualLayout(scene) {
  return scene.snapshot().visual.map(({ cardId, pose: currentPose }) => ({ cardId, pose: currentPose }));
}

function assertSessionShape(session, expected) {
  const snapshot = session.snapshot();
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(snapshot[key], value);
  assert.equal(snapshot.candidate === null || typeof snapshot.candidate === "object", true);
  return snapshot;
}

function assertDeniedStart(scene, request = { cardIds: ["a"], primaryCardId: "a", point: { x: 40, y: 50 } }) {
  assert.throws(() => scene.drag(request), /permitted|locked|requires exactly one drag card|available|destroyed/i);
  assert.deepEqual(interactionSessions(scene), []);
}

test("missing interaction rules deny pickup and denied canStart leaves no live session", () => {
  const { scene } = sceneWith();
  assertDeniedStart(scene);

  scene.destroy();
  const denied = sceneWith({ rules: permissiveRules({ canStart: () => ({ allowed: false, reason: "locked" }) }) });
  assertDeniedStart(denied.scene);
  denied.scene.destroy();
});

test("multiple-card requests retain all requested members", () => {
  const { scene } = sceneWith({ rules: permissiveRules() });
  const session = start(scene, ['a', 'b']);
  assert.deepEqual(session.snapshot().cardIds, ['a', 'b']);
  session.cancel();
  scene.destroy();
});

test("drag lift temporarily enlarges the carried card and restores its scale", () => {
  const { scene } = sceneWith({ rules: permissiveRules() });
  const before = pose(scene, "a").scale;
  const session = start(scene);

  assert.equal(pose(scene, "a").scale, before * 1.12);
  assert.equal(scene.snapshot().desired.cards[0].pose.scale ?? 1, before);

  session.cancel("test cleanup");
  assert.equal(pose(scene, "a").scale, before);
  scene.destroy();
});

test("pickup during a move has no jump and preserves rotation and independent spin", () => {
  const timer = clock();
  const { scene } = sceneWith({ rules: permissiveRules(), reducedMotion: false, timer, duration: 100 });
  scene.apply(input({ source: ["b", "c", "d"], destination: ["a"], cards: ["a", "b", "c", "d"] }));
  scene.transact([{ type: "move", cardId: "a", to: "source", index: 0 }]);
  scene.transact([{ type: "rotate", cardId: "a", angle: 35 }]);
  scene.spin("a", { axis: "y", speed: 90 });
  timer.tick(40);

  const before = pose(scene, "a");
  const session = start(scene, ["a"], { x: before.x, y: before.y });
  const afterPickup = pose(scene, "a");
  assert.equal(afterPickup.x, before.x);
  assert.equal(afterPickup.y, before.y);
  assert.equal(afterPickup.angle, before.angle);
  assert.equal(afterPickup.flipY, before.flipY);
  assert.equal(scene.snapshot().spinning, true);
  assert.equal(session.snapshot().phase, "dragging");

  session.cancel("test cleanup");
  assert.equal(scene.snapshot().spinning, true);
  scene.destroy();
  assert.equal(timer.pending(), 0);
});

test("drag updates move the visual preview without changing committed membership", () => {
  const { scene } = sceneWith({ rules: permissiveRules() });
  const session = start(scene);
  const before = scene.snapshot().desired.zones.map(({ cardIds }) => cardIds);

  const updated = session.update({ toZoneId: "destination", index: 0 });
  assert.deepEqual(scene.snapshot().desired.zones.map(({ cardIds }) => cardIds), before);
  assert.equal(updated.candidate.toZoneId, "destination");
  assert.equal(updated.candidate.index, 0);
  assert.equal(updated.candidate.allowed, true);
  assert.deepEqual(interactionSessions(scene).map(({ cardIds }) => cardIds), [["a"]]);
  session.cancel("test cleanup");
  scene.destroy();
});

test("edge pickup hang stays disabled while the card remains pointer anchored", () => {
  const { scene } = sceneWith({ rules: permissiveRules() });
  const card = pose(scene, "a");
  const session = scene.drag({
    cardIds: ["a"],
    point: { x: card.x - card.width * 0.45, y: card.y },
  });
  assert.equal(pose(scene, "a").tiltY, 0);

  session.update({ point: { x: 1000, y: 600 } });
  assert.equal(pose(scene, "a").tiltY, 0);

  session.cancel("test cleanup");
  scene.destroy();
});

test("zero dangliness disables pickup and movement dangle", () => {
  const timer = clock();
  const scene = createCardScene({
    motion: { clock: timer, reducedMotion: false },
    interaction: { rules: permissiveRules(), dragHangFactor: 0 },
  });
  scene.apply(input());
  const card = pose(scene, "a");
  const session = scene.drag({
    cardIds: ["a"],
    point: { x: card.x - card.width * 0.45, y: card.y },
  });
  assert.equal(pose(scene, "a").tiltY, 0);

  session.update({ point: { x: 1000, y: 600 } });
  for (let frame = 0; frame < 12; frame += 1) timer.tick(16);
  assert.equal(pose(scene, "a").angle, 0);
  assert.equal(pose(scene, "a").tiltX, 0);
  assert.equal(pose(scene, "a").tiltY, 0);

  session.cancel("test cleanup");
  scene.destroy();
});

test("free pointer dragging eases a card upright until a zone target is found", () => {
  const { scene, timer } = sceneWith({ rules: permissiveRules() });
  scene.transact([{ type: "rotate", cardId: "a", angle: 35 }]);
  const session = start(scene);

  session.update({ point: { x: 1000, y: 600 } });
  assert.equal(pose(scene, "a").angle, 35);
  timer.tick(80);
  assert.ok(pose(scene, "a").angle > 0);
  assert.ok(pose(scene, "a").angle < 35);

  session.update({ toZoneId: "destination", index: 0 });
  assert.ok(Math.abs(pose(scene, "a").angle - 35) < 0.001);
  session.cancel("test cleanup");
  scene.destroy();
});

test("upright return can be disabled and responds more strongly to an edge grab", () => {
  const centerTimer = clock();
  const centerScene = createCardScene({
    motion: { clock: centerTimer, reducedMotion: true },
    interaction: { rules: permissiveRules(), dragUprightFactor: 1 },
  });
  centerScene.apply(input());
  centerScene.transact([{ type: "rotate", cardId: "a", angle: 35 }]);
  const centerPose = pose(centerScene, "a");
  const centerSession = centerScene.drag({ cardIds: ["a"], point: { x: centerPose.x, y: centerPose.y } });

  const edgeTimer = clock();
  const edgeScene = createCardScene({
    motion: { clock: edgeTimer, reducedMotion: true },
    interaction: { rules: permissiveRules(), dragUprightFactor: 1 },
  });
  edgeScene.apply(input());
  edgeScene.transact([{ type: "rotate", cardId: "a", angle: 35 }]);
  const edgePose = pose(edgeScene, "a");
  const edgeSession = edgeScene.drag({
    cardIds: ["a"],
    point: { x: edgePose.x + edgePose.width * 0.45, y: edgePose.y },
  });

  centerSession.update({ point: { x: 1000, y: 600 } });
  edgeSession.update({ point: { x: 1000, y: 600 } });
  centerTimer.tick(80);
  edgeTimer.tick(80);
  assert.ok(Math.abs(pose(edgeScene, "a").angle) < Math.abs(pose(centerScene, "a").angle));
  centerSession.cancel("test cleanup");
  edgeSession.cancel("test cleanup");
  centerScene.destroy();
  edgeScene.destroy();

  const disabledTimer = clock();
  const disabledScene = createCardScene({
    motion: { clock: disabledTimer, reducedMotion: true },
    interaction: { rules: permissiveRules(), dragUprightFactor: 0 },
  });
  disabledScene.apply(input());
  disabledScene.transact([{ type: "rotate", cardId: "a", angle: 35 }]);
  const disabledSession = start(disabledScene);
  disabledSession.update({ point: { x: 1000, y: 600 } });
  disabledTimer.tick(160);
  assert.equal(pose(disabledScene, "a").angle, 35);
  disabledSession.cancel("test cleanup");
  disabledScene.destroy();
});

test("leaving a zone after a long preview cannot turn the free-drag card repeatedly", () => {
  const { scene, timer } = sceneWith({ rules: permissiveRules() });
  scene.apply(input({
    zones: { source: { arrangement: { type: "hand", spread: 60, radius: 240, curve: "concave" } } },
  }));
  const initial = pose(scene, "c");
  const session = scene.drag({ cardIds: ["c"], point: { x: initial.x + 20, y: initial.y + 10 } });

  for (let frame = 0; frame < 30; frame += 1) {
    session.update({ point: { x: initial.x + 20 + frame, y: initial.y + 10 } });
    timer.tick(16);
  }
  session.update({ point: { x: 1000, y: 600 } });
  assert.ok(Math.abs(pose(scene, "c").angle) < 90);

  session.cancel("test cleanup");
  scene.destroy();
});

test("free dragging tilts with direction changes and clears tilt at a target", () => {
  const { scene, timer } = sceneWith({ rules: permissiveRules(), reducedMotion: false });
  const initial = pose(scene, "a");
  const session = scene.drag({ cardIds: ["a"], point: { x: initial.x, y: initial.y } });

  session.update({ point: { x: initial.x + 700, y: initial.y } });
  for (let frame = 0; frame < 8; frame += 1) timer.tick(16);
  assert.equal(pose(scene, "a").tiltX, 0);
  assert.ok(pose(scene, "a").tiltY > 0);

  session.update({ point: { x: initial.x - 500, y: initial.y } });
  for (let frame = 0; frame < 8; frame += 1) timer.tick(16);
  assert.ok(pose(scene, "a").tiltY < 0);

  session.update({ toZoneId: "destination", index: 0 });
  for (let frame = 0; frame < 20; frame += 1) timer.tick(16);
  assert.equal(pose(scene, "a").tiltX, 0);
  assert.equal(pose(scene, "a").tiltY, 0);
  session.cancel("test cleanup");
  scene.destroy();
});

test("pending drops wait for the configured snap delay before landing", () => {
  const timer = clock();
  const scene = createCardScene({
    motion: { clock: timer, reducedMotion: false, duration: 100 },
    interaction: { rules: permissiveRules(), dragSnapDelay: 80 },
  });
  scene.apply(input());
  const session = scene.drag({ cardIds: ["a"], primaryCardId: "a", point: { x: 40, y: 50 } });
  session.update({ toZoneId: "destination", index: 0 });
  const intent = session.release();
  const held = pose(scene, "a");
  timer.tick(79);
  assert.equal(pose(scene, "a").x, held.x);
  timer.tick(21);
  assert.notEqual(pose(scene, "a").x, held.x);
  scene.resolveDrop(intent.id, { accepted: false });
  scene.destroy();
});

test("drag preview leaves the normalized desired card model unchanged", () => {
  const { scene } = sceneWith({ rules: permissiveRules() });
  const before = structuredClone(scene.snapshot().desired);
  const session = start(scene);

  session.update({ toZoneId: "destination", index: 0 });

  assert.deepEqual(scene.snapshot().desired, before);
  session.cancel("test cleanup");
  scene.destroy();
});

test("release creates one pending drop and resolves to accepted or rejected exactly once", () => {
  const events = [];
  const first = sceneWith({ rules: permissiveRules() }).scene;
  first.on("drop", (detail) => events.push(detail));
  const accepted = start(first);
  accepted.update({ toZoneId: "destination", index: 0 });
  const intent = accepted.release();

  assert.equal(intent.id, accepted.snapshot().id);
  assert.equal(accepted.snapshot().phase, "pending");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].cardIds, ["a"]);
  assert.equal(events[0].primaryCardId, "a");
  assert.equal(events[0].toZoneId, "destination");
  assert.equal(events[0].index, 0);
  assert.equal(Array.isArray(events[0].sources), true);
  assert.equal(first.resolveDrop(intent.id, { accepted: true }).status, "accepted");
  assert.equal(accepted.snapshot().phase, "accepted");
  assert.deepEqual(interactionSessions(first), []);
  assert.equal(first.resolveDrop(intent.id, { accepted: true }).status, "stale");
  assert.deepEqual(first.snapshot().desired.zones.map(({ cardIds }) => cardIds), [["b", "c", "d"], ["a"]]);
  first.destroy();

  const second = sceneWith({ rules: permissiveRules() }).scene;
  const rejected = start(second);
  rejected.update({ toZoneId: "destination", index: 0 });
  const rejectedIntent = rejected.release();
  assert.equal(second.resolveDrop(rejectedIntent.id, { accepted: false }).status, "rejected");
  assert.equal(rejected.snapshot().phase, "rejected");
  assert.deepEqual(interactionSessions(second), []);
  assert.deepEqual(second.snapshot().desired.zones.map(({ cardIds }) => cardIds), [["a", "b", "c", "d"], []]);
  second.destroy();
});

test("pending fixed-index intents become stale when source or destination ordering changes", () => {
  const mutations = [
    ["source order", { source: ["d", "a"], destination: ["b", "c"] }],
    ["destination order", { source: ["a", "d"], destination: ["c", "b"] }],
  ];
  for (const [label, mutation] of mutations) {
    const scene = sceneWith({ rules: permissiveRules() }).scene;
    scene.apply(input({ source: ["a", "d"], destination: ["b", "c"] }));
    const session = start(scene);
    session.update({ toZoneId: "destination", index: 1 });
    const intent = session.release();
    assert.equal(session.snapshot().phase, "pending", label);

    scene.apply(input(mutation));
    assert.equal(session.snapshot().phase, "cancelled", label);
    assert.equal(scene.resolveDrop(intent.id, { accepted: true }).status, "stale", label);
    assert.deepEqual(scene.snapshot().desired.zones.map(({ cardIds }) => cardIds), [mutation.source, mutation.destination], label);
    scene.destroy();
  }
});

test("rejected drops restore the exact latest committed visual layout without a gap", () => {
  const scene = sceneWith({ rules: permissiveRules() }).scene;
  scene.apply(input({ source: ["a", "b"], destination: ["c", "d"] }));
  const before = scene.snapshot().visual;
  const session = start(scene);
  session.update({ toZoneId: "destination", index: 1 });
  const intent = session.release();

  assert.equal(scene.resolveDrop(intent.id, { accepted: false }).status, "rejected");
  assert.equal(session.snapshot().phase, "rejected");
  assert.deepEqual(scene.snapshot().visual, before);
  assert.deepEqual(scene.snapshot().desired.zones.map(({ cardIds }) => cardIds), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(interactionSessions(scene), []);
  scene.destroy();
});

test("same-zone insertion indices are interpreted after removing the dragged card", () => {
  const { scene } = sceneWith({ rules: permissiveRules() });
  scene.apply(input({ source: ["a", "b", "c", "d"], destination: [], cards: ["a", "b", "c", "d"] }));
  const session = start(scene);
  const candidate = session.update({ toZoneId: "source", index: 3 });
  assert.equal(candidate.candidate.index, 3);
  assert.deepEqual(scene.snapshot().desired.zones[0].cardIds, ["a", "b", "c", "d"]);

  const intent = session.release();
  assert.equal(scene.resolveDrop(intent.id, { accepted: true }).status, "accepted");
  assert.deepEqual(scene.snapshot().desired.zones[0].cardIds, ["b", "c", "d", "a"]);
  scene.destroy();
});

test("same-zone hand previews recompute depth order", () => {
  const { scene } = sceneWith({ rules: permissiveRules() });
  scene.apply(input({
    source: ["a", "b", "c", "d"],
    destination: [],
    cards: ["a", "b", "c", "d"],
    zones: { source: { arrangement: { type: "hand", spread: 60, radius: 240, curve: "concave" } } },
  }));
  const session = start(scene);
  session.update({ toZoneId: "source", index: 3 });
  const visual = new Map(scene.snapshot().visual.map(({ cardId, pose: currentPose }) => [cardId, currentPose]));
  assert.ok(visual.get("b").z < visual.get("c").z);
  assert.ok(visual.get("c").z < visual.get("d").z);
  assert.ok(visual.get("d").z < visual.get("a").z);
  assert.ok(visual.get("b").drawOrder < visual.get("c").drawOrder);
  assert.ok(visual.get("c").drawOrder < visual.get("d").drawOrder);
  assert.ok(visual.get("d").drawOrder < visual.get("a").drawOrder);
  assert.ok(visual.get("b").angle > visual.get("c").angle);
  assert.ok(visual.get("c").angle > visual.get("d").angle);
  assert.ok(visual.get("d").angle > visual.get("a").angle);
  session.cancel("test cleanup");
  scene.destroy();
});

test("an active drag renders above every arrangement and restores its depth on cancel", () => {
  const arrangements = ["grid", "row", "column", "splay", "pile", "stack", "hand"];
  for (const type of arrangements) {
    const rendered = new Map();
    const renderer = () => ({
      type: "test",
      update(cardValue, renderedPose) { rendered.set(cardValue.id, { ...renderedPose }); },
      remove() {},
      render() {},
      destroy() {},
      sceneToClient: (point) => ({ x: point.x, y: point.y }),
      clientToScene: (point) => ({ x: point.x, y: point.y }),
    });
    const { scene } = sceneWith({
      rules: permissiveRules(),
      renderer,
    });
    scene.apply(input({
      zones: { source: { arrangement: { type, gap: 10, spread: 60, radius: 240, curve: "concave" } } },
    }));
    const restingDepth = new Map(scene.snapshot().visual.map(({ cardId, pose: currentPose }) => [cardId, currentPose.z]));
    const session = start(scene, ["a"]);
    const draggedDepth = rendered.get("a").z;
    for (const id of ["b", "c", "d"]) assert.ok(draggedDepth > rendered.get(id).z, `${type}: dragged card should render above ${id}`);
    assert.equal(pose(scene, "a").z, restingDepth.get("a"), `${type}: logical depth should remain unchanged`);
    session.cancel("test cleanup");
    assert.equal(rendered.get("a").z, restingDepth.get("a"), `${type}: cancel should restore resting depth`);
    scene.destroy();
  }
});

test("an ineligible foreground zone blocks a zone behind it, while transparent targeting passes through", () => {
  const rules = permissiveRules({ canDrop: ({ toZoneId }) => ({ allowed: toZoneId === "behind" }) });
  const { scene } = sceneWith({ rules });
  scene.apply({
    cards: [card("a")],
    zones: [
      zone("behind", ["a"], 0, { geometry: { x: 0, y: 0, width: 300, height: 500, depth: 0 } }),
      zone("front", [], 0, { geometry: { x: 0, y: 0, width: 300, height: 500, depth: 100 } }),
    ],
  });
  const blocked = start(scene, ["a"], { x: 40, y: 50 });
  blocked.update({ point: { x: 150, y: 250 } });
  assert.equal(blocked.snapshot().candidate.toZoneId, "front");
  assert.equal(blocked.snapshot().candidate.allowed, false);
  assert.equal(blocked.release(), null);
  blocked.cancel("test cleanup");

  scene.apply({
    cards: [card("a")],
    zones: [
      zone("behind", ["a"], 0, { geometry: { x: 0, y: 0, width: 300, height: 500, depth: 0 } }),
      zone("front", [], 0, { geometry: { x: 0, y: 0, width: 300, height: 500, depth: 100 }, dropTarget: "transparent" }),
    ],
  });
  const passed = start(scene, ["a"], { x: 40, y: 50 });
  passed.update({ point: { x: 150, y: 250 } });
  assert.equal(passed.snapshot().candidate.toZoneId, "behind");
  assert.equal(passed.snapshot().candidate.allowed, true);
  passed.cancel("test cleanup");
  scene.destroy();
});

test("empty zones accept index zero and full zones deny without reserving a slot", () => {
  const emptyScene = sceneWith({ rules: permissiveRules() }).scene;
  const empty = start(emptyScene);
  const emptyCandidate = empty.update({ toZoneId: "destination", index: 0 }).candidate;
  assert.equal(emptyCandidate.toZoneId, "destination");
  assert.equal(emptyCandidate.index, 0);
  assert.equal(emptyCandidate.allowed, true);
  empty.cancel("test cleanup");
  emptyScene.destroy();

  const fullScene = sceneWith({ rules: permissiveRules() }).scene;
  fullScene.apply(input({ source: ["a", "c", "d"], destination: ["b"], zones: { destination: { capacity: 1 } } }));
  const full = start(fullScene);
  const candidate = full.update({ toZoneId: "destination", index: 0 }).candidate;
  assert.equal(candidate.allowed, false);
  assert.match(candidate.reason, /capacity/i);
  assert.deepEqual(fullScene.snapshot().desired.zones.map(({ cardIds }) => cardIds), [["a", "c", "d"], ["b"]]);
  assert.equal(full.release(), null);
  full.cancel("test cleanup");
  fullScene.destroy();
});

test("hidden or removed destinations cancel the active session", () => {
  const hidden = sceneWith({ rules: permissiveRules() }).scene;
  const hiddenSession = start(hidden);
  hiddenSession.update({ toZoneId: "destination", index: 0 });
  const hiddenIntent = hiddenSession.release();
  assert.equal(hiddenSession.snapshot().phase, "pending");
  hidden.transact([{ type: "zone", zoneId: "destination", changes: { visible: false } }]);
  assert.equal(hiddenSession.snapshot().phase, "cancelled");
  assert.deepEqual(interactionSessions(hidden), []);
  assert.equal(hidden.resolveDrop(hiddenIntent.id, { accepted: true }).status, "stale");
  hidden.destroy();

  const removedZone = sceneWith({ rules: permissiveRules() }).scene;
  const removedZoneSession = start(removedZone);
  removedZoneSession.update({ toZoneId: "destination", index: 0 });
  const removedZoneIntent = removedZoneSession.release();
  assert.equal(removedZoneSession.snapshot().phase, "pending");
  removedZone.apply({
    cards: [card("a"), card("b"), card("c"), card("d")],
    zones: [zone("source", ["a", "b", "c", "d"])],
  });
  assert.equal(removedZoneSession.snapshot().phase, "cancelled");
  assert.equal(removedZone.resolveDrop(removedZoneIntent.id, { accepted: true }).status, "stale");
  removedZone.destroy();

  const removedCard = sceneWith({ rules: permissiveRules() }).scene;
  const removedCardSession = start(removedCard);
  removedCard.apply({ cards: [card("b"), card("c"), card("d")], zones: [zone("source", ["b", "c", "d"]), zone("destination", [])] });
  assert.equal(removedCardSession.snapshot().phase, "cancelled");
  assert.deepEqual(interactionSessions(removedCard), []);
  removedCard.destroy();
});

test("an external membership change cancels a session and cannot be accepted later", () => {
  const { scene } = sceneWith({ rules: permissiveRules() });
  const session = start(scene);
  scene.apply(input({ source: ["b", "c", "d"], destination: ["a"] }));

  assert.equal(session.snapshot().phase, "cancelled");
  assert.deepEqual(scene.snapshot().desired.zones.map(({ cardIds }) => cardIds), [["b", "c", "d"], ["a"]]);
  assert.equal(session.release(), null);
  assert.deepEqual(interactionSessions(scene), []);
  scene.destroy();
});

test("pending approval becomes stale when the source membership changes", () => {
  const { scene } = sceneWith({ rules: permissiveRules() });
  const session = start(scene);
  session.update({ toZoneId: "destination", index: 0 });
  const intent = session.release();

  scene.apply(input({ source: ["b", "c", "d"], destination: ["a"] }));

  assert.equal(session.snapshot().phase, "cancelled");
  assert.equal(scene.resolveDrop(intent.id, { accepted: true }).status, "stale");
  assert.deepEqual(scene.snapshot().desired.zones.map(({ cardIds }) => cardIds), [["b", "c", "d"], ["a"]]);
  assert.deepEqual(interactionSessions(scene), []);
  scene.destroy();
});

test("pending approval is cancelled when a destination loses capacity", () => {
  const { scene } = sceneWith({ rules: permissiveRules() });
  scene.apply(input({
    source: ["a", "c", "d"],
    destination: ["b"],
    zones: { destination: { capacity: 2 } },
  }));
  const session = start(scene);
  session.update({ toZoneId: "destination", index: 1 });
  const intent = session.release();
  assert.equal(session.snapshot().phase, "pending");

  scene.transact([{ type: "zone", zoneId: "destination", changes: { capacity: 1 } }]);

  assert.equal(session.snapshot().phase, "cancelled");
  assert.equal(scene.resolveDrop(intent.id, { accepted: true }).status, "stale");
  assert.deepEqual(scene.snapshot().desired.zones.map(({ cardIds }) => cardIds), [["a", "c", "d"], ["b"]]);
  assert.deepEqual(interactionSessions(scene), []);

  const expected = createCardScene({ motion: { reducedMotion: true } });
  expected.apply(scene.snapshot().desired);
  assert.deepEqual(visualLayout(scene), visualLayout(expected));
  expected.destroy();
  scene.destroy();
});

test("pending rejection uses live card elements and dimensions without leaving a gap", () => {
  const timer = clock();
  const liveCard = {
    ...card("a"),
    sizing: { mode: "content", minHeight: 120 },
  };
  const scene = createCardScene({ motion: { clock: timer, reducedMotion: true }, interaction: { rules: permissiveRules() } });
  scene.apply({
    cards: [liveCard, card("b"), card("c")],
    zones: [zone("source", ["a", "b"]), zone("destination", ["c"], 400)],
  });
  const initialHeight = pose(scene, "a").height;
  const session = start(scene);
  session.update({ toZoneId: "destination", index: 1 });
  const intent = session.release();
  assert.equal(session.snapshot().phase, "pending");

  scene.transact([{
    type: "element",
    cardId: "a",
    elementId: "details",
    action: "add",
    element: {
      type: "text",
      content: { text: "one two three four five six seven eight nine ten eleven twelve" },
      layout: { mode: "flow" },
    },
  }]);

  const liveSnapshot = session.snapshot();
  assert.equal(liveSnapshot.phase, "pending");
  assert.equal(liveSnapshot.targetPose.height > initialHeight, true);
  assert.equal(pose(scene, "a").height, liveSnapshot.targetPose.height);
  assert.deepEqual(scene.snapshot().desired.cards[0].faces.front.elements.map(({ id }) => id), ["details"]);

  assert.equal(scene.resolveDrop(intent.id, { accepted: false }).status, "rejected");
  assert.deepEqual(scene.snapshot().desired.zones.map(({ cardIds }) => cardIds), [["a", "b"], ["c"]]);
  assert.deepEqual(interactionSessions(scene), []);

  const expected = createCardScene({ motion: { reducedMotion: true } });
  expected.apply(scene.snapshot().desired);
  assert.deepEqual(visualLayout(scene), visualLayout(expected));
  expected.destroy();
  scene.destroy();
  assert.equal(timer.pending(), 0);
});

test("rule invalidation cancels pending approval and makes late acceptance stale", () => {
  let allowed = true;
  const { scene } = sceneWith({
    rules: permissiveRules({ canDrop: () => ({ allowed, reason: allowed ? undefined : "rule-revoked" }) }),
  });
  const session = start(scene);
  session.update({ toZoneId: "destination", index: 0 });
  const intent = session.release();
  assert.equal(session.snapshot().phase, "pending");

  allowed = false;
  scene.invalidateRules();
  assert.equal(session.snapshot().phase, "cancelled");
  assert.equal(scene.resolveDrop(intent.id, { accepted: true }).status, "stale");
  assert.deepEqual(scene.snapshot().desired.zones.map(({ cardIds }) => cardIds), [["a", "b", "c", "d"], []]);
  scene.destroy();
});

test("destroy cancels sessions, removes them from diagnostics, and leaves terminal snapshots usable", () => {
  const { scene } = sceneWith({ rules: permissiveRules() });
  const session = start(scene);
  const id = session.snapshot().id;
  scene.destroy();

  assert.equal(session.snapshot().phase, "cancelled");
  assert.equal(session.snapshot().id, id);
  assert.deepEqual(scene.snapshot().interaction.sessions, []);
  assert.equal(session.cancel("after destroy").phase, "cancelled");
  assert.equal(scene.resolveDrop(id, { accepted: true }).status, "stale");
});

test("geometry changes during dragging are ignored by the pointer owner and cancel lands on newest layout", () => {
  const timer = clock();
  let sourceX = 0;
  const renderer = () => ({
    type: "test",
    update() {},
    remove() {},
    destroy() {},
    measureZone: ({ id }) => id === "source" ? {
      visible: true,
      geometry: { x: sourceX, y: 0, width: 300, height: 500, depth: 0 },
    } : null,
  });
  const scene = createCardScene({ motion: { clock: timer, reducedMotion: true }, interaction: { rules: permissiveRules() }, renderer });
  scene.apply({ cards: [card("a")], zones: [{ id: "source", anchor: "#source", cardIds: ["a"] }] });
  const session = start(scene, ["a"], { x: 40, y: 50 });
  session.update({ point: { x: 500, y: 300 } });
  const carried = pose(scene, "a");

  sourceX = 300;
  scene.refreshGeometry();
  assert.equal(pose(scene, "a").x, carried.x);
  assert.equal(pose(scene, "a").y, carried.y);
  assert.equal(session.cancel("geometry changed").phase, "cancelled");
  assert.equal(pose(scene, "a").x, 340);
  assert.equal(pose(scene, "a").y, 50);
  scene.destroy();
  assert.equal(timer.pending(), 0);
});

test("coordinate conversion delegates client and scene points to the renderer", () => {
  const calls = [];
  const renderer = () => ({
    type: "test",
    update() {},
    remove() {},
    destroy() {},
    clientToScene(point, depth) { calls.push(["clientToScene", point, depth]); return { x: point.x - 10, y: point.y - 20, z: depth }; },
    sceneToClient(point) { calls.push(["sceneToClient", point]); return { x: point.x + 10, y: point.y + 20 }; },
  });
  const scene = createCardScene({ renderer });
  assert.deepEqual(scene.clientToScene({ x: 110, y: 220 }, 4), { x: 100, y: 200, z: 4 });
  assert.deepEqual(scene.sceneToClient({ x: 100, y: 200, z: 4 }), { x: 110, y: 220 });
  assert.deepEqual(calls, [
    ["clientToScene", { x: 110, y: 220 }, 4],
    ["sceneToClient", { x: 100, y: 200, z: 4 }],
  ]);
  scene.destroy();
});

test("interaction changes publish session diagnostics", () => {
  const { scene } = sceneWith({ rules: permissiveRules() });
  const changes = [];
  scene.on("interaction-change", (detail) => changes.push(detail));
  const session = start(scene);
  session.update({ toZoneId: "destination", index: 0 });
  session.cancel("test cleanup");

  assert.equal(changes.length >= 3, true);
  assert.equal(changes.some(({ sessions }) => sessions.some(({ id }) => id === session.snapshot().id)), true);
  assert.deepEqual(changes.at(-1).sessions, []);
  scene.destroy();
});

test("a denied keyboard candidate keeps the carried pose without reserving a slot", () => {
  const { scene } = sceneWith({ rules: permissiveRules({
    canDrop: ({ toZoneId }) => ({ allowed: toZoneId !== "destination" }),
  }) });
  const drag = start(scene);
  drag.update({ toZoneId: "source", index: 2 });
  const carried = pose(scene, "a");
  drag.update({ toZoneId: "destination", index: 0 });
  assert.equal(drag.snapshot().candidate.allowed, false);
  assert.equal(drag.snapshot().targetPose, null);
  assert.deepEqual(pose(scene, "a"), carried);
  assert.deepEqual(scene.snapshot().desired.zones[1].cardIds, []);
  scene.destroy();
});

test("authoritative same-zone reorder cancels an active drag", () => {
  const { scene } = sceneWith({ rules: permissiveRules() });
  const drag = start(scene);
  const next = scene.snapshot().desired;
  next.zones[0].cardIds = ["b", "a", "c", "d"];
  scene.apply(next);
  assert.equal(drag.snapshot().phase, "cancelled");
  assert.equal(drag.release(), null);
  scene.destroy();
});

function threeZones() {
  return { cards: ['a', 'b', 'c', 'd', 'e'].map((id) => card(id)), zones: [
    zone('lake', ['a', 'b']), zone('river', ['c', 'd'], 400), zone('ocean', ['e'], 800),
  ] };
}

function assertResting(scene) {
  const expected = createCardScene({ motion: { reducedMotion: true } });
  expected.apply(scene.snapshot().desired);
  for (const { cardId, pose: rest } of expected.snapshot().visual) {
    const actual = pose(scene, cardId);
    for (const key of ['x', 'y', 'z']) assert.equal(actual[key], rest[key], `${cardId}.${key}`);
  }
  expected.destroy();
}

test('cohort and source order freeze at pickup despite subsequent selection and request edits', () => {
  const { scene } = sceneWith({ rules: permissiveRules() });
  scene.apply(threeZones());
  scene.select(['d', 'b']);
  const request = { cardIds: ['d', 'b'], primaryCardId: 'd', order: 'provided', point: { x: 530, y: 50 } };
  const session = scene.drag(request);
  request.cardIds.push('a');
  scene.select(['a']);
  const snapshot = session.snapshot();
  assert.deepEqual(snapshot.cardIds, ['d', 'b']);
  assert.deepEqual(snapshot.sources, [{ cardId: 'd', zoneId: 'river', index: 1 }, { cardId: 'b', zoneId: 'lake', index: 1 }]);
  snapshot.cardIds.reverse();
  snapshot.sources[0].index = 100;
  assert.deepEqual(session.snapshot().cardIds, ['d', 'b']);
  session.update({ toZoneId: 'ocean', index: 1 });
  const intent = session.release();
  assert.deepEqual(intent.cardIds, ['d', 'b']);
  assert.equal(intent.sources[0].index, 1);
  scene.resolveDrop(intent.id, { accepted: true });
  assert.deepEqual(scene.snapshot().desired.zones[2].cardIds, ['e', 'd', 'b']);
  assert.deepEqual(scene.snapshot().selection.cardIds, ['a']);
  scene.destroy();
});

test('all-member previews and a single immutable intent agree with atomic same-zone landing', async () => {
  const { scene } = sceneWith({ rules: permissiveRules() });
  scene.apply(input({ source: ['a', 'b', 'c', 'd', 'e'], cards: ['a', 'b', 'c', 'd', 'e'] }));
  scene.transact(['b', 'd'].map((cardId, index) => ({ type: 'move', cardId, position: { x: 10 + index * 80, y: 200 } })));
  scene.select(['b', 'd']);
  const before = scene.snapshot().desired;
  const events = [];
  scene.on('drop', (intent) => events.push(intent));
  const session = start(scene, ['b', 'd']);
  const preview = session.update({ toZoneId: 'source', index: 3 });
  assert.equal(preview.candidate.index, 3);
  assert.deepEqual(Object.keys(preview.targetPoses), ['b', 'd']);
  assert.deepEqual(preview.targetPose, preview.targetPoses.b);
  assert.deepEqual(scene.snapshot().desired, before);
  const expected = resolveBatchMove(before, { cardIds: ['b', 'd'], toZoneId: 'source', index: 3 });
  const solved = solveAllPoses(expected.nextSnapshot, { projection: 'orthographic' });
  assert.deepEqual(preview.targetPoses.b, solved.get('b'));
  assert.deepEqual(preview.targetPoses.d, solved.get('d'));
  const intent = session.release();
  assert.equal(events.length, 1);
  assert.equal(session.release(), null);
  assert.throws(() => events[0].cardIds.push('a'), TypeError);
  assert.throws(() => intent.sources[0].index = 50, TypeError);
  assert.deepEqual(scene.snapshot().desired, before);
  const result = scene.resolveDrop(intent.id, { accepted: true });
  assert.equal(result.status, 'accepted');
  await result.finished;
  assert.equal((await session.finished).phase, 'accepted');
  assert.deepEqual(scene.snapshot().desired.zones[0].cardIds, ['a', 'c', 'e', 'b', 'd']);
  assert.deepEqual(scene.snapshot().selection.cardIds, ['b', 'd']);
  for (const id of ['b', 'd']) assert.equal(scene.snapshot().desired.cards.find((card) => card.id === id).positionMode, undefined);
  assertResting(scene);
  assert.equal(scene.resolveDrop(intent.id, { accepted: true }).status, 'stale');
  scene.destroy();
});

test('full-batch permission and capacity reject without silently dropping a member', () => {
  const requests = [];
  const rules = permissiveRules({ canDrop(request) { requests.push(request); return { allowed: !request.cardIds.includes('d'), reason: 'd is locked' }; } });
  const { scene } = sceneWith({ rules });
  scene.apply(threeZones());
  const before = scene.snapshot().desired;
  const session = start(scene, ['b', 'd']);
  const denied = session.update({ toZoneId: 'ocean', index: 1 });
  assert.equal(denied.candidate.allowed, false);
  assert.equal(denied.targetPoses, null);
  assert.deepEqual(requests.at(-1).cardIds, ['b', 'd']);
  assert.deepEqual(requests.at(-1).sources.map(({ zoneId }) => zoneId), ['lake', 'river']);
  assert.equal(session.release(), null);
  assert.deepEqual(scene.snapshot().desired, before);
  assertResting(scene);
  scene.destroy();

  const permitted = sceneWith({ rules: permissiveRules() }).scene;
  const snapshot = threeZones();
  snapshot.zones[2].capacity = 2;
  permitted.apply(snapshot);
  const batch = start(permitted, ['b', 'd']);
  const full = batch.update({ toZoneId: 'ocean', index: 0 });
  assert.equal(full.candidate.allowed, false);
  assert.match(full.candidate.reason, /capacity/);
  assert.equal(full.targetPoses, null);
  assert.equal(batch.release(), null);
  assertResting(permitted);
  permitted.destroy();
});

test('batch rejection returns every source and displaced neighbor to live resized arrangements', () => {
  const { scene } = sceneWith({ rules: permissiveRules() });
  scene.apply(threeZones());
  const session = start(scene, ['b', 'd']);
  session.update({ toZoneId: 'ocean', index: 0 });
  const intent = session.release();
  scene.transact([
    { type: 'zone', zoneId: 'lake', changes: { geometry: { x: 100, y: 100, width: 350, height: 400, depth: 20 } } },
    { type: 'resize', cardId: 'd', dimensions: { width: 140, height: 160 } },
    { type: 'rotate', cardId: 'd', angle: 30 },
  ]);
  assert.equal(session.snapshot().phase, 'pending');
  assert.equal(session.snapshot().targetPoses.d.width, 140);
  scene.resolveDrop(intent.id, { accepted: false });
  assertResting(scene);
  assert.equal(pose(scene, 'd').angle, 30);
  assert.deepEqual(scene.snapshot().desired.zones.map(({ cardIds }) => cardIds), [['a', 'b'], ['c', 'd'], ['e']]);
  scene.destroy();
});

test('secondary removal, reorder, authored position, visibility and batch moves cancel the entire cohort', () => {
  const mutations = {
    removal(scene) {
      const next = scene.snapshot().desired;
      next.cards = next.cards.filter(({ id }) => id !== 'd');
      next.zones[1].cardIds = ['c'];
      scene.apply(next);
    },
    reorder(scene) {
      const next = scene.snapshot().desired;
      next.zones[1].cardIds = ['d', 'c'];
      scene.apply(next);
    },
    position(scene) { scene.transact([{ type: 'move', cardId: 'd', position: { x: 100, y: 100 } }]); },
    hidden(scene) { scene.transact([{ type: 'zone', zoneId: 'river', changes: { visible: false } }]); },
    batch(scene) { scene.transact([{ type: 'moveBatch', cardIds: ['d'], to: 'ocean', index: 0 }]); },
  };
  for (const pending of [false, true]) for (const [label, mutate] of Object.entries(mutations)) {
    const { scene } = sceneWith({ rules: permissiveRules() });
    scene.apply(threeZones());
    const session = start(scene, ['b', 'd']);
    session.update({ toZoneId: 'ocean', index: 0 });
    const id = pending ? session.release().id : session.snapshot().id;
    mutate(scene);
    assert.equal(session.snapshot().phase, 'cancelled', `${label}, pending=${pending}`);
    const latest = scene.snapshot().desired;
    assert.equal(scene.resolveDrop(id, { accepted: true }).status, 'stale');
    assert.deepEqual(scene.snapshot().desired, latest);
    assertResting(scene);
    scene.destroy();
  }
});

test('selection eligibility loss cancels the full cohort while unrelated selection changes do not', () => {
  let denied = false;
  const scene = createCardScene({ motion: { reducedMotion: true }, interaction: { rules: permissiveRules() },
    selection: { allowCrossZone: true, canSelect: ({ cardId }) => ({ allowed: !(denied && cardId === 'd') }) } });
  scene.apply(threeZones());
  const session = start(scene, ['b', 'd']);
  scene.select(['a']);
  assert.equal(session.snapshot().phase, 'dragging');
  denied = true;
  scene.invalidateRules();
  assert.equal(session.snapshot().phase, 'cancelled');
  assertResting(scene);
  assert.throws(() => start(scene, ['b', 'd']), /available|eligible/);
  scene.destroy();
});

test('preserve mode reprojects each frozen screen offset at its own depth through camera changes', () => {
  let zoom = 1;
  let pan = 0;
  const project = ({ x, y, z = 0 }) => ({ x: x * zoom / (1 + z / 1000) + pan, y: y * zoom / (1 + z / 1000) });
  const unproject = ({ x, y }, z = 0) => ({ x: (x - pan) * (1 + z / 1000) / zoom, y: y * (1 + z / 1000) / zoom });
  const scene = createCardScene({ motion: { reducedMotion: true }, interaction: { rules: permissiveRules() }, renderer: () => ({
    update() {}, remove() {}, destroy() {}, sceneToClient: project, clientToScene: unproject,
  }) });
  const snapshot = threeZones();
  snapshot.zones[1].geometry.depth = 200;
  scene.apply(snapshot);
  const before = new Map(['b', 'd'].map((id) => [id, pose(scene, id)]));
  const primary = project(before.get('d'));
  const secondary = project(before.get('b'));
  const pointer = { x: primary.x + 7, y: primary.y - 9 };
  const session = scene.drag({ cardIds: ['b', 'd'], primaryCardId: 'd', point: unproject(pointer) });
  for (const id of ['b', 'd']) for (const key of ['x', 'y', 'z']) assert.ok(Math.abs(pose(scene, id)[key] - before.get(id)[key]) < 1e-9);
  zoom = 1.7; pan = 60;
  const moved = { x: pointer.x + 100, y: pointer.y + 70 };
  session.update({ point: unproject(moved) });
  const p = project(pose(scene, 'd'));
  const s = project(pose(scene, 'b'));
  assert.ok(Math.abs(p.x - (moved.x - 7 * 1.12)) < 1e-9);
  assert.ok(Math.abs(p.y - (moved.y + 9 * 1.12)) < 1e-9);
  assert.ok(Math.abs((s.x - p.x) - (secondary.x - primary.x)) < 1e-9);
  assert.ok(Math.abs((s.y - p.y) - (secondary.y - primary.y)) < 1e-9);
  for (const id of ['b', 'd']) assert.equal(pose(scene, id).z, before.get(id).z);
  session.cancel();
  assertResting(scene);
  scene.destroy();
});

test('compact carry animates on the engine clock and pending uses actual destination slots', () => {
  const timer = clock();
  const scene = createCardScene({ motion: { clock: timer, duration: 100 }, interaction: { rules: permissiveRules(), dragPresentation: 'compact' } });
  scene.apply(threeZones());
  const original = pose(scene, 'd').x - pose(scene, 'b').x;
  const session = scene.drag({ cardIds: ['b', 'd'], primaryCardId: 'b', point: { x: 137, y: 41 } });
  assert.equal(pose(scene, 'd').x - pose(scene, 'b').x, original);
  timer.tick(90);
  const middle = pose(scene, 'd').x - pose(scene, 'b').x;
  assert.ok(middle > 18 && middle < original);
  timer.tick(90);
  assert.equal(pose(scene, 'd').x - pose(scene, 'b').x, 18);
  assert.equal(pose(scene, 'b').x, 129.16);
  assert.equal(pose(scene, 'b').y, 51.08);
  session.update({ point: { x: 870, y: 120 } });
  const intent = session.release();
  assert.equal(session.snapshot().phase, 'pending');
  timer.tick(100);
  const targets = session.snapshot().targetPoses;
  for (const id of ['b', 'd']) for (const key of ['x', 'y', 'z']) assert.equal(pose(scene, id)[key], targets[id][key]);
  assert.notEqual(targets.d.x - targets.b.x, 18);
  scene.resolveDrop(intent.id, { accepted: false });
  timer.tick(100);
  assertResting(scene);
  scene.destroy();
  assert.equal(timer.pending(), 0);
});

test('compact reduced motion settles immediately and preserve overrides a compact default', () => {
  const scene = createCardScene({ motion: { reducedMotion: true }, interaction: { rules: permissiveRules(), dragPresentation: 'compact' } });
  scene.apply(threeZones());
  const original = pose(scene, 'd').x - pose(scene, 'b').x;
  const preserve = scene.drag({ cardIds: ['b', 'd'], presentation: 'preserve' });
  assert.equal(pose(scene, 'd').x - pose(scene, 'b').x, original);
  preserve.cancel();
  const compact = scene.drag({ cardIds: ['b', 'd'] });
  assert.equal(pose(scene, 'd').x - pose(scene, 'b').x, 18);
  compact.cancel();
  assertResting(scene);
  scene.destroy();
});

// A small injected boundary exercises lifecycle hooks independently: a scene
// update normally invokes both beforeCommit and reconcile, so testing only that
// path would miss a guard that works in just one of the two hooks.
function interactionBoundary({ commitError = false } = {}) {
  let desired = normalizeSnapshot(threeZones());
  let visual = solveAllPoses(desired, { projection: 'orthographic' });
  let previous = new Map();
  const commits = [];
  const events = [];
  const calls = { solve: 0, canDrop: 0 };
  const interaction = createInteraction({
    state: () => ({ desired, visual, zones: desired.zones }),
    solve: (next) => { calls.solve += 1; return solveAllPoses(next, { projection: 'orthographic' }); },
    sample() {}, refresh() {}, takePosition() {},
    toClient: ({ x, y }) => ({ x, y }), fromClient: ({ x, y }) => ({ x, y }),
    present(positions, detail, resting) {
      for (const id of new Set([...previous.keys(), ...positions.keys()])) {
        if (!visual.has(id)) continue;
        visual.set(id, { ...visual.get(id), ...(positions.get(id)?.pose ?? resting.get(id)) });
      }
      previous = positions;
    },
    commit(operations) {
      commits.push(operations);
      if (commitError) throw new Error('commit failed');
      const operation = operations[0];
      desired = resolveBatchMove(desired, { cardIds: operation.cardIds, toZoneId: operation.to, index: operation.index }).nextSnapshot;
      return { finished: Promise.resolve() };
    },
    emit(name, detail) { events.push([name, detail]); },
    rules: permissiveRules({ canDrop() { calls.canDrop += 1; return { allowed: true }; } }),
  });
  return { interaction, commits, events, calls, model: () => desired, visual: () => visual,
    replace(next) { desired = normalizeSnapshot(next); visual = solveAllPoses(desired, { projection: 'orthographic' }); } };
}

test('beforeCommit and reconcile independently detect every secondary-member conflict', () => {
  const changes = {
    removed(next) { next.cards = next.cards.filter(({ id }) => id !== 'd'); next.zones[1].cardIds.pop(); },
    moved(next) { next.zones[1].cardIds.pop(); next.zones[2].cardIds.push('d'); },
    reordered(next) { next.zones[1].cardIds.reverse(); },
    authored(next) { next.cards.find(({ id }) => id === 'd').pose.x += 30; },
  };
  for (const hook of ['beforeCommit', 'reconcile']) for (const [name, change] of Object.entries(changes)) {
    const boundary = interactionBoundary();
    const session = boundary.interaction.drag({ cardIds: ['b', 'd'], primaryCardId: 'b' });
    session.update({ toZoneId: 'ocean', index: 0 });
    const intent = session.release();
    const next = structuredClone(boundary.model());
    change(next);
    if (hook === 'beforeCommit') boundary.interaction.beforeCommit(next);
    else { boundary.replace(next); boundary.interaction.reconcile(); }
    assert.equal(session.snapshot().phase, 'cancelled', `${hook}: ${name}`);
    assert.equal(boundary.interaction.resolveDrop(intent.id, { accepted: true }).status, 'stale');
    assert.equal(boundary.commits.length, 0);
    boundary.interaction.destroy();
  }
});

test('approval makes exactly one complete moveBatch call and failed commits settle cancellation', async () => {
  for (const commitError of [false, true]) {
    const boundary = interactionBoundary({ commitError });
    const before = structuredClone(boundary.model());
    const session = boundary.interaction.drag({ cardIds: ['d', 'b'], primaryCardId: 'b' });
    session.update({ toZoneId: 'ocean', index: 0 });
    const intent = session.release();
    if (commitError) {
      assert.throws(() => boundary.interaction.resolveDrop(intent.id, { accepted: true }), /commit failed/);
      assert.equal((await session.finished).phase, 'cancelled');
      assert.deepEqual(boundary.model(), before);
      assert.deepEqual(boundary.visual(), solveAllPoses(before, { projection: 'orthographic' }));
    } else {
      assert.equal(boundary.interaction.resolveDrop(intent.id, { accepted: true }).status, 'accepted');
      assert.equal((await session.finished).phase, 'accepted');
    }
    assert.deepEqual(boundary.commits, [[{ type: 'moveBatch', cardIds: ['d', 'b'], to: 'ocean', index: 0 }]]);
    assert.equal(boundary.events.filter(([name]) => name === 'drop').length, 1);
    assert.equal(boundary.interaction.resolveDrop(intent.id, { accepted: true }).status, 'stale');
    boundary.interaction.destroy();
  }
});

test('batch approval revalidates denied rules and a capacity loss without partial commit', () => {
  for (const kind of ['rules', 'capacity', 'destination-order']) {
    let allowed = true;
    const { scene } = sceneWith({ rules: permissiveRules({ canDrop: () => ({ allowed }) }) });
    const snapshot = threeZones();
    snapshot.zones[2].capacity = 3;
    scene.apply(snapshot);
    const session = start(scene, ['b', 'd']);
    session.update({ toZoneId: 'ocean', index: 0 });
    const intent = session.release();
    if (kind === 'rules') allowed = false;
    else if (kind === 'capacity') scene.transact([{ type: 'zone', zoneId: 'ocean', changes: { capacity: 2 } }]);
    else scene.transact([{ type: 'move', cardId: 'a', to: 'ocean', index: 0 }]);
    const latest = scene.snapshot().desired;
    assert.equal(scene.resolveDrop(intent.id, { accepted: true }).status, 'stale', kind);
    assert.equal(session.snapshot().phase, 'cancelled');
    assert.deepEqual(scene.snapshot().desired, latest);
    assertResting(scene);
    scene.destroy();
  }
});

test('every moving cohort member keeps independent rotation, scale and spin on pickup', async () => {
  const timer = clock();
  const { scene } = sceneWith({ rules: permissiveRules(), timer, reducedMotion: false });
  scene.apply(threeZones());
  const movement = scene.transact([{ type: 'moveBatch', cardIds: ['b', 'd'], to: 'ocean', index: 0 }]);
  scene.transact([{ type: 'rotate', cardId: 'b', angle: 45 }, { type: 'scale', cardId: 'd', factor: 1.5 }]);
  scene.spin('b', { axis: 'x', speed: 120 });
  scene.spin('d', { axis: 'y', speed: 180 });
  timer.tick(40);
  const before = new Map(['b', 'd'].map((id) => [id, pose(scene, id)]));
  const session = scene.drag({ cardIds: ['b', 'd'], primaryCardId: 'b', point: before.get('b') });
  for (const id of ['b', 'd']) for (const key of ['x', 'y', 'z', 'angle', 'scale', 'flipX', 'flipY']) {
    assert.equal(pose(scene, id)[key], before.get(id)[key]);
  }
  timer.tick(100);
  assert.equal(pose(scene, 'b').angle, 45);
  assert.equal(pose(scene, 'd').scale, 1.5 * 1.12);
  assert.notEqual(pose(scene, 'b').flipX, before.get('b').flipX);
  assert.notEqual(pose(scene, 'd').flipY, before.get('d').flipY);
  assert.equal((await movement.finished)[0].status, 'superseded');
  session.cancel();
  assert.equal(scene.snapshot().spinning, true);
  scene.destroy();
  assert.equal(timer.pending(), 0);
});

test('supersession and disposal settle the entire compact or pending cohort', async () => {
  const timer = clock();
  const scene = createCardScene({ motion: { clock: timer, duration: 100 }, interaction: { rules: permissiveRules(), dragPresentation: 'compact' } });
  scene.apply(threeZones());
  const first = scene.drag({ cardIds: ['b', 'd'], primaryCardId: 'b' });
  timer.tick(30);
  const second = scene.drag({ cardIds: ['a'], primaryCardId: 'a' });
  assert.equal((await first.finished).phase, 'cancelled');
  assert.deepEqual(scene.snapshot().interaction.sessions.map(({ cardIds }) => cardIds), [['a']]);
  second.update({ toZoneId: 'ocean', index: 0 });
  const intent = second.release();
  scene.destroy();
  assert.equal((await second.finished).phase, 'cancelled');
  assert.equal(scene.resolveDrop(intent.id, { accepted: true }).status, 'stale');
  assert.equal(timer.pending(), 0);
});

test('unchanged pointer candidates reuse batch layouts and project decisions', () => {
  const { interaction, calls } = interactionBoundary();
  const session = interaction.drag({ cardIds: ['b', 'd'], primaryCardId: 'b', point: { x: 130, y: 50 } });
  session.update({ point: { x: 860, y: 80 } });
  const before = { ...calls };
  session.update({ point: { x: 861, y: 81 } });
  session.update({ point: { x: 862, y: 82 } });
  assert.deepEqual(calls, before);
  interaction.invalidateRules();
  assert.equal(calls.solve, before.solve);
  assert.equal(calls.canDrop, before.canDrop + 1);
  interaction.destroy();
});

test('invalid cohort requests leave an already active gesture intact', () => {
  const { interaction } = interactionBoundary();
  const active = interaction.drag({ cardIds: ['b', 'd'], primaryCardId: 'b' });
  for (const request of [
    { cardIds: [] }, { cardIds: ['b', 'b'] }, { cardIds: ['b', 'missing'] },
    { cardIds: ['b', 'd'], primaryCardId: 'a' }, { cardIds: ['b'], presentation: 'unknown' },
    { cardIds: ['b'], point: { x: NaN, y: 0 } },
  ]) {
    assert.throws(() => interaction.drag(request));
    assert.equal(active.snapshot().phase, 'dragging');
  }
  interaction.destroy();
});

test('a single compact card still receives the drag lift', () => {
  const timer = clock();
  const scene = createCardScene({ motion: { clock: timer }, interaction: { rules: permissiveRules(), dragPresentation: 'compact' } });
  scene.apply({ cards: [card('a')], zones: [zone('source', ['a'])] });
  const session = start(scene);
  assert.equal(timer.pending() > 0, true);
  assert.equal(scene.snapshot().settling, true);
  session.cancel();
  scene.destroy();
});

test('batch acceptance preserves mounted shell identities and each card face and pivot', () => {
  const shells = new Map();
  const scene = createCardScene({ motion: { reducedMotion: true }, selection: { allowCrossZone: true }, interaction: { rules: permissiveRules() },
    renderer: () => ({
      update(card) { if (!shells.has(card.id)) shells.set(card.id, { id: card.id }); },
      remove(id) { shells.delete(id); }, destroy() {},
    }) });
  const next = threeZones();
  next.cards[1].faceUp = false;
  next.cards[1].pose = { pivotX: 0.2, pivotY: 0.3, angle: 35, scale: 1.2 };
  next.cards[3].pose = { pivotX: 0.8, pivotY: 0.9, angle: -25, scale: 0.8 };
  scene.apply(next);
  scene.select(['b', 'd']);
  const originalShells = new Map(shells);
  const originals = scene.snapshot().desired.cards;
  const session = start(scene, ['b', 'd']);
  session.update({ toZoneId: 'ocean', index: 0 });
  const intent = session.release();
  scene.resolveDrop(intent.id, { accepted: true });
  for (const card of scene.snapshot().desired.cards) {
    assert.equal(shells.get(card.id), originalShells.get(card.id));
    assert.deepEqual(card, originals.find(({ id }) => id === card.id));
  }
  assert.deepEqual(scene.snapshot().selection.cardIds, ['b', 'd']);
  scene.destroy();
});
