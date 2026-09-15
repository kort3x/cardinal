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

test("multiple-card requests are explicitly rejected until cohort dragging exists", () => {
  const { scene } = sceneWith({ rules: permissiveRules() });
  assertDeniedStart(scene, { cardIds: ["a", "b"], primaryCardId: "a", point: { x: 40, y: 50 } });
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
