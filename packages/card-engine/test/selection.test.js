import test from "node:test";
import assert from "node:assert/strict";
import { createSelection } from "../src/selection.js";

function fixture(config) {
  const desired = { cards: ["a", "b", "c", "d", "e"].map((id) => ({ id })), zones: [
    { id: "lake", cardIds: ["a", "b", "c"] }, { id: "river", cardIds: ["d", "e"] },
  ] };
  const visual = new Map(desired.cards.map(({ id }) => [id, { visible: true }]));
  const events = [];
  const selection = createSelection({ config, state: () => ({ desired, visual }), onChange: (value) => events.push(value) });
  return { selection, desired, visual, events };
}

test("replace/add/toggle/remove preserve ordered sets, primary and an independent anchor", () => {
  const { selection: s } = fixture({ allowCrossZone: true });
  assert.deepEqual(s.select(["c", "a", "c"]), { cardIds: ["c", "a"], primaryCardId: "a", anchorCardId: "a", accepted: true });
  assert.deepEqual(s.select(["b", "a"], { mode: "add" }), { cardIds: ["c", "a", "b"], primaryCardId: "b", anchorCardId: "a", accepted: true });
  assert.deepEqual(s.select(["a", "d"], { mode: "toggle" }), { cardIds: ["c", "b", "d"], primaryCardId: "d", anchorCardId: "a", accepted: true });
  assert.deepEqual(s.select(["d"], { mode: "remove" }), { cardIds: ["c", "b"], primaryCardId: "c", anchorCardId: "a", accepted: true });
  assert.deepEqual(s.select([]), { cardIds: [], primaryCardId: null, anchorCardId: null, accepted: true });
});

test("forced zone selection expands the top card into an atomic top cohort", () => {
  const desired = { cards: ["a", "b", "c", "d", "e"].map((id) => ({ id })), zones: [
    { id: "ocean", cardIds: ["a", "b", "c", "d"], selectionPolicy: { mode: "forced", count: 3, from: "top" } },
    { id: "hand", cardIds: ["e"] },
  ] };
  const visual = new Map(desired.cards.map(({ id }) => [id, { visible: true }]));
  const selection = createSelection({ config: { multiple: true, max: 3, scope: "zone" }, state: () => ({ desired, visual }) });

  assert.deepEqual(selection.context("d").eligibleCardIds, ["b", "c", "d"]);
  assert.deepEqual(selection.select(["d"]), {
    cardIds: ["b", "c", "d"], primaryCardId: "d", anchorCardId: "d", accepted: true,
  });
  assert.equal(selection.select(["a"]).accepted, false);
  assert.equal(selection.select(["c"], { mode: "toggle" }).accepted, true);
  assert.deepEqual(selection.snapshot().cardIds, []);
});

test("forced zone selection waits for the complete cohort", () => {
  const { selection: s, desired } = fixture();
  desired.zones[0].selectionPolicy = { mode: "forced", count: 4, from: "top" };
  assert.equal(s.select(["c"]).accepted, false);
  assert.match(s.select(["c"]).reason, /requires selecting 4 cards/);
});

test("cross-zone selection is denied by default until explicitly enabled", () => {
  const { selection: s } = fixture();
  assert.equal(s.select(["a"]).accepted, true);
  const denied = s.select(["d"], { mode: "add" });
  assert.equal(denied.accepted, false);
  assert.match(denied.reason, /cannot span multiple zones/);
  assert.deepEqual(s.snapshot().cardIds, ["a"]);
});

test("snapshots and change events are detached and no-op calls emit nothing", () => {
  const { selection: s, events } = fixture();
  s.select(["a", "b"], { primaryCardId: "a" });
  s.select([], { mode: "add" });
  s.select(["b"], { mode: "add" });
  s.select(["unknown"], { mode: "remove" });
  assert.equal(events.length, 1);
  events[0].cardIds.push("c");
  const snapshot = s.snapshot();
  snapshot.cardIds.length = 0;
  assert.deepEqual(s.snapshot(), { cardIds: ["a", "b"], primaryCardId: "a", anchorCardId: "a" });
  s.clear(); s.clear();
  assert.equal(events.length, 2);
});

test("limits deny whole requests without changing selection or emitting events", () => {
  for (const config of [{ max: 1 }, { multiple: false }, { scope: "zone" }]) {
    const { selection: s, events } = fixture(config);
    s.select(["a"]);
    const denied = s.select(["d"], { mode: "add" });
    assert.equal(denied.accepted, false);
    assert.equal(typeof denied.reason, "string");
    assert.deepEqual(s.snapshot().cardIds, ["a"]);
    assert.equal(events.length, 1);
    assert.equal(s.select(["d"]).accepted, true);
  }
  const { selection } = fixture({ max: 0 });
  assert.equal(selection.select(["a"]).accepted, false);
  assert.equal(selection.select([]).accepted, true);
});

test("allowCrossZone denies cross-zone add, toggle, and range requests atomically", () => {
  const { selection: s, events } = fixture({ allowCrossZone: false, rangeOrder: ["a", "b", "c", "d", "e"] });
  assert.equal(s.select(["a"]).accepted, true);
  const before = s.snapshot();
  for (const request of [
    ["d", { mode: "add" }],
    ["d", { mode: "toggle" }],
    ["d", { mode: "range", anchorCardId: "a" }],
  ]) {
    const denied = s.select([request[0]], request[1]);
    assert.equal(denied.accepted, false);
    assert.match(denied.reason, /cannot span multiple zones/);
    assert.deepEqual(s.snapshot(), before);
  }
  assert.equal(events.length, 1);
});

test("eligibility checks live existence, visibility, and project policy without leaking model mutation", () => {
  let allowed = true;
  const { selection: s, visual, desired } = fixture({ canSelect: ({ cardId, zoneId, snapshot }) => {
    assert.equal(zoneId, "lake");
    snapshot.cards.length = 0;
    return { allowed: allowed && cardId !== "b", reason: "Locked" };
  } });
  assert.equal(s.select(["a"]).accepted, true);
  assert.equal(s.select(["a", "b"]).reason, "Locked");
  assert.equal(desired.cards.length, 5);
  const isSelectable = s.isSelectable;
  assert.equal(isSelectable("a"), true);
  visual.get("a").visible = false;
  assert.equal(isSelectable("a"), false);
  assert.equal(s.select(["a"]).accepted, false);
  assert.equal(s.select(["missing"]).accepted, false);
  allowed = false;
  assert.equal(s.select(["a"], { mode: "remove" }).accepted, true);
  assert.deepEqual(s.snapshot().cardIds, []);
});

test("throwing or asynchronous policy denies and removals remain possible", () => {
  let policy = () => ({ allowed: true });
  const { selection: s } = fixture({ canSelect: (request) => policy(request) });
  s.select(["a", "b"]);
  policy = () => { throw new Error("project failure"); };
  assert.equal(s.select(["c"], { mode: "add" }).accepted, false);
  assert.equal(s.select(["a"], { mode: "toggle" }).accepted, true);
  assert.deepEqual(s.snapshot().cardIds, ["b"]);
  policy = () => Promise.resolve({ allowed: true });
  assert.equal(s.isSelectable("c"), false);
  s.clear();
});

test("ranges use committed membership in either direction and retain a toggled-out anchor", () => {
  const { selection: s, desired, visual } = fixture();
  s.select(["b"]);
  s.select(["c"], { mode: "add" });
  s.select(["b"], { mode: "toggle" });
  assert.equal(s.snapshot().anchorCardId, "b");
  visual.get("a").x = 999;
  assert.deepEqual(s.select(["a"], { mode: "range" }), { cardIds: ["a", "b"], primaryCardId: "a", anchorCardId: "b", accepted: true });
  desired.zones[0].cardIds = ["c", "b", "a"];
  assert.deepEqual(s.select(["c"], { mode: "range" }).cardIds, ["c", "b"]);
});

test("cross-zone ranges need explicit card order, independently of zone order", () => {
  const base = fixture({ zoneOrder: ["river", "lake"] }).selection;
  base.select(["a"]);
  assert.equal(base.select(["d"], { mode: "range" }).accepted, false);
  const s = fixture({ allowCrossZone: true, rangeOrder: ["e", "d", "c", "b", "a"] }).selection;
  s.select(["b"]);
  assert.deepEqual(s.select(["d"], { mode: "range" }).cardIds, ["d", "c", "b"]);
  const constrained = fixture({ scope: "zone", rangeOrder: ["a", "b", "c", "d", "e"] }).selection;
  constrained.select(["a"]);
  assert.equal(constrained.select(["d"], { mode: "range" }).accepted, false);
});

test("range eligibility and maximum are evaluated for the complete interval", () => {
  const s = fixture({ canSelect: ({ cardId }) => ({ allowed: cardId !== "b" }) }).selection;
  s.select(["a"]);
  assert.equal(s.select(["c"], { mode: "range" }).accepted, false);
  assert.deepEqual(s.snapshot().cardIds, ["a"]);
  const limited = fixture({ max: 2 }).selection;
  limited.select(["a"]);
  assert.equal(limited.select(["c"], { mode: "range" }).accepted, false);
});

test("source order uses zone order plus membership while provided order is preserved", () => {
  const { selection: s } = fixture({ zoneOrder: ["river"] });
  assert.deepEqual(s.order(["c", "e", "a", "d"]), ["d", "e", "a", "c"]);
  assert.deepEqual(s.order(["c", "a"], "provided"), ["c", "a"]);
  for (const ids of [["a", "a"], ["unknown"]]) assert.throws(() => s.order(ids), /unique known/);
  assert.throws(() => s.order(["a"], "unknown"), /Unknown selection order/);
  assert.throws(() => fixture({ zoneOrder: ["missing"] }).selection.order(["a"]), /zoneOrder/);
  const invalid = fixture({ rangeOrder: ["a", "missing"] }).selection;
  assert.throws(() => invalid.select(["d"], { mode: "range", anchorCardId: "a" }), /rangeOrder/);
});

test("context gives eligible logical navigation and focused zone scope without drop-target filtering", () => {
  const { selection: s, desired, visual } = fixture({ scope: "zone", canSelect: ({ cardId }) => ({ allowed: cardId !== "b" }) });
  desired.zones[0].dropTarget = "transparent";
  assert.deepEqual(s.context("a"), { navigationCardIds: ["a", "c"], eligibleCardIds: ["a", "c"], scopeZoneId: "lake" });
  assert.deepEqual(s.context("e").eligibleCardIds, ["d", "e"]);
  visual.get("c").visible = false;
  assert.deepEqual(s.context("a").eligibleCardIds, ["a"]);
  const scene = fixture({ zoneOrder: ["river"] }).selection;
  assert.deepEqual(scene.context("a"), { navigationCardIds: ["d", "e", "a", "b", "c"], eligibleCardIds: ["d", "e", "a", "b", "c"], scopeZoneId: null });
});

test("reconciliation prunes all invalid members once and retains valid selection after transfer", () => {
  let allowed = true;
  const { selection: s, desired, visual, events } = fixture({ canSelect: ({ cardId }) => ({ allowed: allowed || cardId !== "b" }) });
  s.select(["a", "b", "c"]);
  desired.zones[0].cardIds = ["b", "c"];
  desired.zones[1].cardIds.push("a");
  s.reconcile();
  assert.equal(events.length, 1);
  desired.cards = desired.cards.filter(({ id }) => id !== "c");
  visual.delete("c");
  allowed = false;
  s.reconcile(); s.reconcile();
  assert.equal(events.length, 2);
  assert.deepEqual(s.snapshot(), { cardIds: ["a"], primaryCardId: "a", anchorCardId: "a" });
});

test("zone reconciliation retains the first survivor's zone and repairs an external anchor", () => {
  const { selection: s, desired } = fixture({ scope: "zone" });
  s.select(["a", "b", "c"], { anchorCardId: "b" });
  s.select(["b"], { mode: "toggle" });
  desired.zones[0].cardIds = ["a"];
  desired.zones[1].cardIds.push("b", "c");
  s.reconcile();
  assert.deepEqual(s.snapshot(), { cardIds: ["a"], primaryCardId: "a", anchorCardId: "a" });
});

test("configuration and explicit primary/anchor are validated", () => {
  for (const config of [{ max: -1 }, { max: 1.5 }, { multiple: "yes" }, { allowCrossZone: "yes" }, { scope: "unknown" }, { canSelect: true }, { rangeOrder: ["a", "a"] }]) {
    assert.throws(() => fixture(config));
  }
  const s = fixture().selection;
  assert.equal(s.select(["a"], { primaryCardId: "b" }).accepted, false);
  assert.equal(s.select(["a"], { anchorCardId: "unknown" }).accepted, false);
  assert.equal(s.select(["a"], { anchorCardId: "b" }).accepted, true);
  assert.throws(() => s.select("a"), /array/);
  assert.throws(() => s.select(["a", "b"], { mode: "range" }), /one endpoint/);
});
