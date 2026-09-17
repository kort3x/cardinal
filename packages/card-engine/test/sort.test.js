import test from "node:test";
import assert from "node:assert/strict";
import { createCardScene, sortCardIds } from "../src/index.js";

function card(id, { background, title = "", specimen = "" } = {}) {
  return {
    id,
    activeFaceId: "front",
    faceUp: true,
    faces: {
      front: {
        background,
        elements: [
          { id: "title", type: "text", content: { text: title } },
          { id: "specimen", type: "text", content: { text: specimen } },
        ],
      },
    },
  };
}

function snapshot(cards, cardIds, options = {}) {
  return {
    cards,
    zones: [{
      id: "river",
      cardIds,
      geometry: { x: 0, y: 0, width: 600, height: 400, depth: 0 },
      arrangement: { type: "grid" },
      ...options,
    }],
  };
}

test("sortCardIds reads face fields and element paths with stable missing values", () => {
  const cards = [
    card("a", { background: "blue", title: "Beta" }),
    card("b", { background: "amber", title: "Alpha" }),
    card("c", { title: "Alpha" }),
  ];
  const model = snapshot(cards, ["a", "b", "c"]);

  assert.deepEqual(sortCardIds(model, {
    zoneId: "river",
    by: { source: "face", face: "active", path: "background" },
  }), ["b", "a", "c"]);
  assert.deepEqual(sortCardIds(model, {
    zoneId: "river",
    by: { source: "element", face: "active", elementId: "title", path: "content.text" },
    direction: "desc",
  }), ["a", "b", "c"]);
  assert.deepEqual(sortCardIds(model, {
    zoneId: "river",
    getValue: ({ card: current }) => current.faces.front.background ?? "zzz",
    direction: "asc",
  }), ["b", "a", "c"]);
});

test("scene.sortBy atomically reorders a zone using an element path", async () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply(snapshot([
    card("a", { title: "Beta" }),
    card("b", { title: "Alpha" }),
  ], ["a", "b"]));

  const transition = scene.sortBy({
    zoneId: "river",
    by: { source: "element", elementId: "title", path: "content.text" },
  });

  assert.deepEqual(scene.snapshot().desired.zones[0].cardIds, ["b", "a"]);
  assert.equal((await transition.finished)[0].status, "settled");
  scene.destroy();
});

test("autoSort applies on snapshots and relevant element updates", () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply(snapshot([
    card("a", { title: "Beta" }),
    card("b", { title: "Alpha" }),
  ], ["a", "b"], {
    autoSort: {
      by: { source: "element", elementId: "title", path: "content.text" },
    },
  }));
  assert.deepEqual(scene.snapshot().desired.zones[0].cardIds, ["b", "a"]);

  scene.transact([{
    type: "element",
    cardId: "a",
    elementId: "title",
    action: "update",
    element: { content: { text: "Aardvark" } },
  }]);
  assert.deepEqual(scene.snapshot().desired.zones[0].cardIds, ["a", "b"]);
  scene.destroy();
});

test("autoSort preserves the policy when a zone is moved or updated", () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply(snapshot([
    card("a", { background: "blue" }),
    card("b", { background: "amber" }),
  ], ["a", "b"], {
    autoSort: {
      by: { source: "face", path: "background" },
      direction: "desc",
    },
  }));
  scene.transact([{ type: "move", cardId: "b", to: "river", index: 0 }]);
  assert.deepEqual(scene.snapshot().desired.zones[0].cardIds, ["a", "b"]);
  scene.destroy();
});
