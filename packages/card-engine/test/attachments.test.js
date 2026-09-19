import test from "node:test";
import assert from "node:assert/strict";
import { attachmentContent } from "../src/attachments.js";
import { createCardScene } from "../src/index.js";
import { cardDimensions } from "../src/layout.js";
import { filterContentElements } from "../src/renderer.js";
import { normalizeSnapshot } from "../src/model.js";

const zone = { id: "table", cardIds: ["card"], geometry: { x: 0, y: 0, width: 500, height: 500, depth: 0 } };
const base = {
  id: "card", faceUp: true, activeFaceId: "front", sizing: { mode: "content", minHeight: 1 },
  faces: { front: { elements: [{ id: "title", type: "text", content: { text: "Title" } }] }, details: { elements: [] } },
};

function manualClock() {
  let time = 0;
  let nextId = 0;
  const frames = new Map();
  return {
    now: () => time,
    requestFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelFrame(id) { frames.delete(id); },
    tick(milliseconds) {
      time += milliseconds;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(time);
    },
  };
}

test("attachmentContent preserves face identity when there are no attachments", () => {
  const face = base.faces.front;
  assert.equal(attachmentContent(base, "front"), face);
});

test("attachments project by affinity and preserve card-level identity", () => {
  const [card] = normalizeSnapshot({ cards: [{ ...base, attachments: [
    { id: "counter", type: "counter", content: { value: 2 }, affinity: "front", layout: { mode: "flow" } },
    { id: "back-stamp", type: "stamp", affinity: "back" },
    { id: "detail-sticker", type: "sticker", faceId: "details" },
  ] }], zones: [zone] }).cards;
  assert.deepEqual(attachmentContent(card, "front").elements.map(({ id }) => id), ["title", "counter"]);
  assert.deepEqual(attachmentContent(card, "details").elements.map(({ id }) => id), ["counter", "detail-sticker"]);
  assert.deepEqual(attachmentContent(card, "back").elements.map(({ id }) => id), ["back-stamp"]);
});

test("attachment IDs cannot collide with ordinary elements and anchor cycles are rejected", () => {
  assert.throws(() => normalizeSnapshot({ cards: [{ ...base, attachments: [{ id: "title", type: "stamp" }] }], zones: [zone] }), /collides/);
  assert.throws(() => normalizeSnapshot({ cards: [{ ...base, attachments: [
    { id: "a", type: "stamp", layout: { anchor: "b" } },
    { id: "b", type: "stamp", layout: { anchor: "a" } },
  ] }], zones: [zone] }), /cycle/);
});

test("attachment transactions preserve identity while updating content and visibility", async () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply({ cards: [base], zones: [zone] });
  await scene.transact([{ type: "attachment", cardId: "card", attachmentId: "counter", action: "add", attachment: {
    type: "counter", content: { value: 1 }, layout: { mode: "flow" }, controls: [{ id: "inc", label: "Increase" }],
  } }]).finished;
  await scene.transact([{ type: "attachment", cardId: "card", attachmentId: "counter", action: "update", attachment: { content: { value: 2 } } }]).finished;
  await scene.transact([{ type: "attachment", cardId: "card", attachmentId: "counter", action: "hide" }]).finished;
  const card = scene.snapshot().desired.cards[0];
  assert.equal(card.attachments[0].id, "counter");
  assert.equal(card.attachments[0].content.value, 2);
  assert.equal(card.attachments[0].visible, false);
  scene.destroy();
});

test("flow attachments resize content cards and presentation uses original instance IDs", () => {
  const [card] = normalizeSnapshot({ cards: [{ ...base, attachments: [
    { id: "counter", type: "counter", content: { value: 2 }, layout: { mode: "flow" }, controls: [{ id: "inc", label: "Increase", disabled: true }] },
  ] }], zones: [zone] }).cards;
  const full = cardDimensions(card, {}, {}, undefined).height;
  const hidden = cardDimensions(card, {}, {}, { elements: ["title"] }).height;
  assert.ok(full > hidden);
  assert.equal(attachmentContent(card, "front", { elements: ["title"] }).elements.find(({ id }) => id === "counter").visible, false);
  assert.deepEqual(card.attachments[0].controls, [{ id: "inc", label: "Increase", disabled: true }]);
});

test("presentation cannot resurrect an attachment hidden by a missing anchor", () => {
  const [card] = normalizeSnapshot({ cards: [{ ...base, attachments: [
    { id: "stamp", type: "stamp", layout: { anchor: "missing", missingAnchor: "hide" } },
    { id: "fallback", type: "stamp", layout: { anchor: "missing", missingAnchor: "card" } },
  ] }], zones: [zone] }).cards;
  const projected = attachmentContent(card, "front", { visibility: { stamp: true, fallback: true } });
  assert.equal(projected.elements.find(({ id }) => id === "stamp").visible, false);
  assert.equal(projected.elements.find(({ id }) => id === "fallback").layout.anchor, "card");
  assert.equal(filterContentElements(projected, { visibility: { stamp: true } }).elements.find(({ id }) => id === "stamp").visible, false);
});

test("zone visibility cannot reserve flow space for an unavailable attachment anchor", () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply({ cards: [base], zones: [{ ...zone, presentation: { visibility: { counter: true } } }] });
  const height = scene.snapshot().visual[0].pose.height;
  scene.transact([{ type: "attachment", cardId: "card", attachmentId: "counter", action: "add", attachment: {
    type: "text", content: { text: "Unavailable counter" }, layout: { mode: "flow", anchor: "missing" },
  } }]);
  assert.equal(scene.snapshot().visual[0].pose.height, height);
  scene.destroy();
});

test("an ordinary overlay with an unavailable anchor cannot expose a dependent attachment", () => {
  const [card] = normalizeSnapshot({ cards: [{ ...base, faces: { front: { elements: [{
    id: "region", type: "image", layout: { mode: "overlay", anchor: "missing" },
  }] } }, attachments: [{ id: "stamp", type: "stamp", layout: { anchor: "region" } }] }], zones: [zone] }).cards;
  assert.equal(attachmentContent(card, "front").elements.find(({ id }) => id === "stamp").visible, false);
  card.faces.front.elements[0].layout.missingAnchor = "card";
  assert.equal(attachmentContent(card, "front").elements.find(({ id }) => id === "stamp").visible, true);
});

test("concealed cards do not expose front attachment sizing through their shell", () => {
  const concealedBase = { ...base, faceUp: false, back: { elements: [] } };
  const [withoutCounter] = normalizeSnapshot({ cards: [concealedBase], zones: [zone] }).cards;
  const [withCounter] = normalizeSnapshot({ cards: [{ ...concealedBase, attachments: [{
    id: "counter", type: "counter", content: { value: 1 }, layout: { mode: "flow" },
  }] }], zones: [zone] }).cards;
  const withoutCounterHeight = cardDimensions(withoutCounter, {}, {}).height;
  const withCounterHeight = cardDimensions(withCounter, {}, {}).height;
  assert.equal(withCounterHeight, withoutCounterHeight);
  assert.ok(cardDimensions({ ...withCounter, faceUp: true }, {}, {}).height > withCounterHeight);
});

test("concealing a content-sized card updates its visual shell to public geometry", async () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply({ cards: [{ ...base, back: { elements: [] }, attachments: [
    { id: "counter", type: "counter", content: { value: 1 }, layout: { mode: "flow" } },
  ] }], zones: [zone] });
  const frontHeight = scene.snapshot().visual[0].pose.height;
  const expectedBackHeight = cardDimensions({ ...scene.snapshot().desired.cards[0], faceUp: false }, {}, {}).height;
  await scene.transact([{ type: "face", cardId: "card", face: "faceDown", axis: "y", angle: 180 }]).finished;
  const concealedHeight = scene.snapshot().visual[0].pose.height;
  assert.ok(frontHeight > expectedBackHeight);
  assert.equal(concealedHeight, expectedBackHeight);
  scene.destroy();
});

test("attachment updates preserve independent live move, rotation, and spin channels", () => {
  const clock = manualClock();
  const scene = createCardScene({ motion: { clock, duration: 320 } });
  scene.apply({ cards: [{ ...base, faceUp: true }], zones: [zone] });
  scene.transact([
    { type: "move", cardId: "card", position: { x: 420, y: 220 } },
    { type: "rotate", cardId: "card", angle: 90 },
  ]);
  clock.tick(80);
  const spin = scene.spin("card", { axis: "y", speed: 180 });
  assert.equal(spin.active, true);
  const before = scene.snapshot().visual[0].pose;
  scene.transact([{ type: "attachment", cardId: "card", attachmentId: "counter", action: "add", attachment: {
    type: "counter", content: { value: 1 }, layout: { mode: "flow" },
  } }]);
  clock.tick(80);
  const after = scene.snapshot().visual[0].pose;
  assert.ok(after.x > before.x);
  assert.ok(after.angle > before.angle);
  assert.ok(after.flipY > before.flipY);
  assert.equal(scene.snapshot().desired.cards[0].attachments[0].id, "counter");
  scene.destroy();
});

test("remove and re-add during a flip cannot erase the replacement attachment", async () => {
  const clock = manualClock();
  const scene = createCardScene({ motion: { clock, duration: 320 } });
  scene.apply({ cards: [{ ...base, faceUp: true, attachments: [
    { id: "stamp", type: "stamp", content: { text: "old" }, layout: { mode: "flow" } },
  ] }], zones: [zone] });
  const removal = scene.transact([
    { type: "face", cardId: "card", face: "faceDown" },
    { type: "attachment", cardId: "card", attachmentId: "stamp", action: "remove" },
  ]);
  clock.tick(80);
  scene.transact([{ type: "attachment", cardId: "card", attachmentId: "stamp", action: "add", attachment: {
    type: "stamp", content: { text: "replacement" }, layout: { mode: "flow" },
  } }]);
  clock.tick(640);
  await removal.finished;
  const replacement = scene.snapshot().desired.cards[0].attachments;
  assert.deepEqual(replacement.map(({ id, content }) => [id, content.text]), [["stamp", "replacement"]]);
  assert.equal(scene.snapshot().visual[0].pose.flipY, 180);
  scene.destroy();
});
