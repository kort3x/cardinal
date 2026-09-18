import test from "node:test";
import assert from "node:assert/strict";
import { cardDimensions } from "../src/layout.js";
import { createCardScene } from "../src/index.js";
import { filterContentElements } from "../src/renderer.js";

const face = () => ({
  elements: [
    { id: "title", type: "text", content: { text: "A title" } },
    { id: "flavour", type: "text", content: { text: "A long flavour passage that contributes height." } },
  ],
});

const card = (id = "card") => ({
  id,
  faceUp: true,
  activeFaceId: "front",
  sizing: { mode: "content", minHeight: 1, maxHeight: 480 },
  faces: { front: face() },
});

const zone = (id, cardIds, presentation) => ({
  id,
  cardIds,
  presentation,
  geometry: { x: 0, y: 0, width: 500, height: 500, depth: 0 },
});

test("zone visibility overrides card visibility without mutating the retained baseline", () => {
  const baseline = card();
  baseline.faces.front.elements[1].visible = false;
  const shown = filterContentElements(baseline.faces.front, { visibility: { flavour: true } });
  assert.equal(shown.elements.find(({ id }) => id === "flavour").visible, true);

  const hidden = filterContentElements(baseline.faces.front, { visibility: { flavour: false } });
  assert.equal(hidden.elements.find(({ id }) => id === "flavour").visible, false);
  assert.equal(baseline.faces.front.elements[1].visible, false);
});

test("zone visibility changes content-driven height and leaving restores the card baseline", () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply({ cards: [card()], zones: [zone("shown", ["card"], { visibility: { flavour: true } }), zone("hidden", [], { visibility: { flavour: false } })] });
  const shownHeight = scene.snapshot().visual[0].pose.height;
  scene.transact([{ type: "move", cardId: "card", to: "hidden" }]);
  const hiddenHeight = scene.snapshot().visual[0].pose.height;
  assert.ok(hiddenHeight < shownHeight);

  scene.transact([{ type: "move", cardId: "card", to: "shown" }]);
  assert.equal(scene.snapshot().visual[0].pose.height, shownHeight);
  assert.equal(scene.snapshot().desired.cards[0].faces.front.elements[1].visible, true);
  scene.destroy();
});

test("zone element filtering changes content-driven height as well as rendered content", () => {
  const source = card();
  const shown = cardDimensions(source, {}, {}, { elements: ["title", "flavour"] });
  const titleOnly = cardDimensions(source, {}, {}, { elements: ["title"] });
  assert.ok(titleOnly.height < shown.height);
  assert.deepEqual(filterContentElements(source.faces.front, { elements: ["title"] }).elements.map(({ id }) => id), ["title"]);
});

test("preserve-space zone hiding keeps content height while reflow hiding collapses it", () => {
  const source = card();
  const dimensions = cardDimensions(source, {}, {}, { visibility: { flavour: false } });
  const preserveCard = card();
  preserveCard.faces.front.elements[1].visibilityMode = "preserve-space";
  const preserved = cardDimensions(preserveCard, {}, {}, { visibility: { flavour: false } });
  assert.ok(dimensions.height < preserved.height);
});

test("invalid zone visibility is rejected atomically", () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  const snapshot = { cards: [card()], zones: [zone("table", ["card"])] };
  scene.apply(snapshot);
  assert.throws(() => scene.transact([{ type: "zone", zoneId: "table", changes: { presentation: { visibility: { flavour: "yes" } } } }]), /visibility values/);
  assert.equal(scene.snapshot().desired.zones[0].presentation, undefined);
  scene.destroy();
});
