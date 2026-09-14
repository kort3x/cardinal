import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createCardScene } from "../src/index.js";
import { clearCardDepth, createCardFaceMaterial, createCardGeometry, createCardShape, createSafeWebGLContext } from "../src/renderers/webgl.js";

const card = {
  id: "card-1",
  activeFaceId: "front",
  faceUp: true,
  faces: {
    front: { title: "The Cardinal", image: "cardinal.svg", flavour: "A bright beginning." },
  },
  template: "illustrated",
};

const zone = {
  id: "table",
  cardIds: ["card-1"],
  geometry: { x: 0, y: 0, width: 640, height: 420, depth: 0 },
  arrangement: { type: "grid", gap: 16 },
};

function testClock() {
  let time = 0;
  let nextId = 0;
  const frames = new Map();
  return {
    now: () => time,
    requestFrame(callback) {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      frames.delete(id);
    },
    tick(milliseconds) {
      time += milliseconds;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(time);
    },
  };
}

function fakeDomElement() {
  return {
    children: [],
    style: { setProperty(name, value) { this[name] = value; } },
    dataset: {},
    classList: { add() {}, remove() {} },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    removeAttribute() {},
    setAttribute() {},
    remove() {},
  };
}

test("a WebGL context with a null precision result is made safe for Three.js", () => {
  const context = {
    getShaderPrecisionFormat() { return null; },
  };

  const safeContext = createSafeWebGLContext({
    getContext() { return context; },
  });

  assert.equal(safeContext, context);
  assert.deepEqual(safeContext.getShaderPrecisionFormat(), { rangeMin: 0, rangeMax: 0, precision: 0 });
});

test("the WebGL shape seam creates a shield profile", () => {
  const shield = createCardShape({ type: "shield" }, { width: 180, height: 250 });
  const points = shield.getPoints(32);

  assert.equal(points.some((point) => point.x === 0 && point.y === -125), true);
});

test("the WebGL shape seam rejects unknown profiles", () => {
  assert.throws(
    () => createCardShape({ type: "hexagon" }, { width: 180, height: 250 }),
    /Unknown card shape: hexagon/,
  );
});

test("WebGL face materials render content above the solid cuboid caps", () => {
  const material = createCardFaceMaterial();

  assert.equal(material.side, THREE.FrontSide);
  assert.equal(material.depthWrite, false);
  assert.equal(material.polygonOffset, true);
  assert.equal(material.polygonOffsetFactor, -1);
  assert.equal(material.polygonOffsetUnits, -1);

  material.dispose();
});

test("card render layers clear prior card depth once per cuboid", () => {
  let clears = 0;
  const renderer = { clearDepth() { clears += 1; } };
  clearCardDepth(renderer, null, null, null, null, { materialIndex: 0 });
  clearCardDepth(renderer, null, null, null, null, { materialIndex: 1 });
  assert.equal(clears, 1);
});

test("a rounded cuboid geometry includes a real bevel", () => {
  const geometry = createCardGeometry(
    createCardShape("rounded-rectangle", { width: 180, height: 250 }),
  );

  assert.equal(geometry.parameters.options.bevelEnabled, true);
  assert.equal(geometry.parameters.options.bevelSegments, 4);
  assert.equal(geometry.parameters.options.bevelSize, 1.2);
  const position = geometry.getAttribute("position");
  const zValues = Array.from({ length: position.count }, (_, index) => position.getZ(index));
  assert.equal(Math.min(...zValues) >= -3.001, true);
  assert.equal(Math.max(...zValues) <= 3.001, true);
  geometry.dispose();
});

test("a scene can use an injected renderer adapter", () => {
  const calls = [];
  const renderer = () => ({
    update(card) { calls.push(`update:${card.id}`); },
    remove(cardId) { calls.push(`remove:${cardId}`); },
    destroy() { calls.push("destroy"); },
  });
  const scene = createCardScene({ renderer });

  scene.apply({ cards: [card], zones: [zone] });
  assert.equal(scene.snapshot().renderer, "custom");
  assert.equal(scene.snapshot().rendererReason, null);
  scene.destroy();

  assert.deepEqual(calls, ["update:card-1", "destroy"]);
});

test("a CSS scene identifies its active renderer", () => {
  const scene = createCardScene({ renderMode: "css" });

  scene.apply({ cards: [card], zones: [zone] });

  assert.equal(scene.snapshot().renderer, "css");
  assert.equal(scene.snapshot().rendererReason, "css");
  scene.destroy();
});

test("the default renderer does not hide missing WebGL behind CSS", () => {
  assert.throws(
    () => createCardScene({ element: fakeDomElement() }),
    /Cardinal WebGL renderer requires a browser document/,
  );
});

test("a scene applies one card and exposes its committed state", () => {
  const scene = createCardScene();

  scene.apply({ cards: [card], zones: [zone] });

  const committed = scene.snapshot().desired;
  assert.equal(committed.cards[0].id, card.id);
  assert.equal(committed.cards[0].activeFaceId, card.activeFaceId);
  assert.equal(committed.cards[0].faceUp, true);
  assert.deepEqual(scene.snapshot().desired.zones, [zone]);
});

test("cards in one zone receive deterministic depth and draw order", () => {
  const secondCard = { ...card, id: "card-2" };
  const scene = createCardScene();
  scene.apply({
    cards: [card, secondCard],
    zones: [{ ...zone, cardIds: [card.id, secondCard.id] }],
  });

  const [first, second] = scene.snapshot().visual;
  assert.equal(first.pose.z, 0);
  assert.equal(second.pose.z, 8);
  assert.equal(first.pose.drawOrder, 0);
  assert.equal(second.pose.drawOrder, 1);
  scene.destroy();
});

test("the default headless scene is not reported as CSS", () => {
  const scene = createCardScene();

  assert.equal(scene.snapshot().renderer, "headless");
  assert.equal(scene.snapshot().rendererReason, "no-element");
  scene.destroy();
});

test("apply retargets from the currently displayed pose", () => {
  const clock = testClock();
  const scene = createCardScene({ motion: { clock, duration: 320 } });
  scene.apply({ cards: [card], zones: [zone] });
  scene.transact([{ type: "move", cardId: "card-1", position: { x: 400, y: 220 } }]);
  clock.tick(160);
  const inFlightX = scene.snapshot().visual[0].pose.x;

  scene.apply({
    cards: [{ ...card, positionMode: "absolute", pose: { x: 500, y: 220 } }],
    zones: [zone],
  });

  assert.equal(scene.snapshot().visual[0].pose.x, inFlightX);
  assert.equal(scene.snapshot().settling, true);
  clock.tick(320);
  assert.equal(scene.snapshot().visual[0].pose.x, 500);
  assert.equal(scene.snapshot().settling, false);
  scene.destroy();
});

test("one transaction composes move, rotation, scale, and flip", async () => {
  const clock = testClock();
  const scene = createCardScene({ motion: { clock, duration: 320 } });
  scene.apply({ cards: [card], zones: [zone] });

  const transition = scene.transact([
    { type: "move", cardId: "card-1", position: { x: 400, y: 220 } },
    { type: "rotate", cardId: "card-1", angle: 90 },
    { type: "scale", cardId: "card-1", factor: 1.25 },
    { type: "face", cardId: "card-1", face: "faceDown", axis: "y" },
  ]);

  assert.equal(scene.snapshot().settling, true);
  clock.tick(160);
  const halfway = scene.snapshot().visual[0].pose;
  assert.equal(halfway.x, 245);
  assert.equal(halfway.y, 172.5);
  assert.equal(halfway.angle, 45);
  assert.equal(halfway.scale, 1.125);
  assert.equal(halfway.flipAngle, 90);

  clock.tick(160);
  assert.deepEqual(await transition.finished, [
    { type: "move", cardId: "card-1", status: "settled" },
    { type: "rotate", cardId: "card-1", status: "settled" },
    { type: "scale", cardId: "card-1", status: "settled" },
    { type: "face", cardId: "card-1", status: "settled" },
  ]);
  assert.equal(scene.snapshot().settling, false);
  assert.equal(scene.snapshot().visual[0].pose.x, 400);
  assert.equal(scene.snapshot().visual[0].pose.angle, 90);
  assert.equal(scene.snapshot().visual[0].pose.scale, 1.25);
  assert.equal(scene.snapshot().visual[0].pose.flipAngle, 180);
});

test("a logical face cycle advances independently of physical orientation", () => {
  const cycleCard = {
    ...card,
    activeFaceId: "a",
    faceCycle: ["a", "b", "c"],
    faces: {
      a: { title: "Face A" },
      b: { title: "Face B" },
      c: { title: "Face C" },
    },
  };
  const scene = createCardScene({ renderer: () => ({ update() {}, remove() {}, destroy() {} }) });
  scene.apply({ cards: [cycleCard], zones: [zone] });

  scene.transact([{ type: "face", cardId: "card-1", face: "faceDown", axis: "y", angle: 180 }], { immediate: true });
  assert.equal(scene.snapshot().desired.cards[0].activeFaceId, "a");
  assert.equal(scene.snapshot().desired.cards[0].faceUp, false);
  assert.equal(scene.snapshot().visual[0].physicalSide, "back");

  scene.transact([{ type: "face", cardId: "card-1", face: "faceUp", axis: "y", angle: 0 }], { immediate: true });
  assert.equal(scene.snapshot().desired.cards[0].activeFaceId, "b");
  assert.equal(scene.snapshot().desired.cards[0].faceUp, true);
  assert.equal(scene.snapshot().visual[0].physicalSide, "front");

  scene.transact([{ type: "face", cardId: "card-1", face: "faceDown", axis: "y", angle: 180 }], { immediate: true });
  assert.equal(scene.snapshot().desired.cards[0].activeFaceId, "b");

  scene.transact([{ type: "face", cardId: "card-1", face: "faceUp", axis: "y", angle: 0 }], { immediate: true });
  assert.equal(scene.snapshot().desired.cards[0].activeFaceId, "c");
});

test("a logical face cycle commits only after the flip settles", async () => {
  const clock = testClock();
  const cycleCard = {
    ...card,
    activeFaceId: "a",
    faceCycle: ["a", "b", "c"],
    faces: {
      a: { title: "Face A" },
      b: { title: "Face B" },
      c: { title: "Face C" },
    },
  };
  const scene = createCardScene({ clock, motion: { clock, duration: 320 }, renderer: () => ({ update() {}, remove() {}, destroy() {} }) });
  scene.apply({ cards: [cycleCard], zones: [zone] });

  const transition = scene.transact([{ type: "face", cardId: "card-1", face: "faceDown", axis: "y", angle: 180 }]);
  assert.equal(scene.snapshot().desired.cards[0].activeFaceId, "a");
  clock.tick(320);
  await transition.finished;
  assert.equal(scene.snapshot().desired.cards[0].activeFaceId, "a");

  const returnTransition = scene.transact([{ type: "face", cardId: "card-1", face: "faceUp", axis: "y", angle: 0 }]);
  assert.equal(scene.snapshot().desired.cards[0].activeFaceId, "a");
  clock.tick(320);
  await returnTransition.finished;
  assert.equal(scene.snapshot().desired.cards[0].activeFaceId, "b");
});

test("an interrupted logical face transition does not consume a face", async () => {
  const clock = testClock();
  const cycleCard = {
    ...card,
    activeFaceId: "a",
    faceCycle: ["a", "b", "c"],
    faces: {
      a: { title: "Face A" },
      b: { title: "Face B" },
      c: { title: "Face C" },
    },
  };
  const scene = createCardScene({ motion: { clock, duration: 320 }, renderer: () => ({ update() {}, remove() {}, destroy() {} }) });
  scene.apply({ cards: [cycleCard], zones: [zone] });

  scene.transact([{ type: "face", cardId: "card-1", face: "faceDown", axis: "y", angle: 180 }]);
  clock.tick(100);
  const secondTransition = scene.transact([{ type: "face", cardId: "card-1", face: "faceUp", axis: "y", angle: 0 }]);
  clock.tick(320);
  await secondTransition.finished;

  assert.equal(scene.snapshot().desired.cards[0].activeFaceId, "b");
  assert.equal(scene.snapshot().desired.cards[0].faceUp, true);
});

test("logical face cycles advance during continuous spinning", () => {
  const clock = testClock();
  const cycleCard = {
    ...card,
    activeFaceId: "a",
    faceCycle: ["a", "b", "c"],
    faces: {
      a: { title: "Face A" },
      b: { title: "Face B" },
      c: { title: "Face C" },
    },
  };
  const scene = createCardScene({ motion: { clock }, renderer: () => ({ update() {}, remove() {}, destroy() {} }) });
  scene.apply({ cards: [cycleCard], zones: [zone] });
  scene.spin("card-1", { axis: "y", speed: 180 });

  clock.tick(1000);
  assert.equal(scene.snapshot().desired.cards[0].activeFaceId, "a");
  clock.tick(1000);
  assert.equal(scene.snapshot().desired.cards[0].activeFaceId, "b");
  clock.tick(1000);
  assert.equal(scene.snapshot().desired.cards[0].activeFaceId, "b");
  clock.tick(1000);
  assert.equal(scene.snapshot().desired.cards[0].activeFaceId, "c");
  assert.equal(scene.snapshot().desired.cards[0].faceUp, true);
});

test("a face transition can target an intermediate flip angle", async () => {
  const clock = testClock();
  const scene = createCardScene({ motion: { clock, duration: 320 } });
  scene.apply({ cards: [card], zones: [zone] });

  const transition = scene.transact([
    { type: "face", cardId: "card-1", face: "faceDown", axis: "y", angle: 120 },
  ]);

  clock.tick(160);
  assert.equal(scene.snapshot().visual[0].pose.flipAngle, 60);
  clock.tick(160);
  assert.equal(scene.snapshot().visual[0].pose.flipAngle, 120);
  assert.equal(scene.snapshot().desired.cards[0].faceUp, false);
  await transition.finished;
});

test("a face transition can animate x and y axes together", async () => {
  const clock = testClock();
  const scene = createCardScene({ motion: { clock, duration: 320 } });
  scene.apply({ cards: [card], zones: [zone] });

  const transition = scene.transact([
    {
      type: "face",
      cardId: "card-1",
      face: "faceDown",
      axis: ["x", "y"],
      angle: { x: 60, y: 120 },
    },
  ]);

  clock.tick(160);
  assert.equal(scene.snapshot().visual[0].pose.flipX, 30);
  assert.equal(scene.snapshot().visual[0].pose.flipY, 60);
  clock.tick(160);
  assert.equal(scene.snapshot().visual[0].pose.flipX, 60);
  assert.equal(scene.snapshot().visual[0].pose.flipY, 120);
  await transition.finished;
});

test("a card can spin continuously and stop at its current flip angle", () => {
  const clock = testClock();
  const scene = createCardScene({ motion: { clock, duration: 320 } });
  scene.apply({ cards: [card], zones: [zone] });

  const spin = scene.spin("card-1", { axis: "y", direction: 1, speed: 180 });
  clock.tick(500);
  assert.equal(scene.snapshot().visual[0].pose.flipAngle, 90);
  clock.tick(750);
  assert.equal(scene.snapshot().visual[0].pose.flipAngle, 225);

  assert.equal(spin.stop(), true);
  assert.equal(scene.snapshot().settling, false);
  clock.tick(500);
  assert.equal(scene.snapshot().visual[0].pose.flipAngle, 225);
  assert.equal(scene.stopSpin("card-1"), false);
});

test("continuous spinning supports the x flip axis", () => {
  const clock = testClock();
  const scene = createCardScene({ motion: { clock, duration: 320 } });
  scene.apply({ cards: [card], zones: [zone] });

  scene.spin("card-1", { axis: "x", direction: -1, speed: 180 });
  clock.tick(500);

  assert.equal(scene.snapshot().visual[0].pose.flipAxis, "x");
  assert.equal(scene.snapshot().visual[0].pose.flipAngle, -90);
  scene.stopSpin("card-1");
});

test("face retargeting takes the shortest path after continuous spinning", async () => {
  const clock = testClock();
  const scene = createCardScene({ motion: { clock, duration: 320 } });
  scene.apply({ cards: [{ ...card, faceUp: false }], zones: [zone] });
  scene.spin("card-1", { axis: "y", direction: 1, speed: 180 });
  clock.tick(1500);
  scene.stopSpin("card-1");

  const transition = scene.transact([{ type: "face", cardId: "card-1", face: "faceUp", axis: "y" }]);
  clock.tick(160);
  assert.equal(scene.snapshot().visual[0].pose.flipAngle, 405);
  clock.tick(160);
  assert.equal(scene.snapshot().visual[0].pose.flipAngle, 360);
  await transition.finished;
});

test("interrupting one channel preserves the other channel", async () => {
  const clock = testClock();
  const scene = createCardScene({ motion: { clock, duration: 320 } });
  scene.apply({ cards: [card], zones: [zone] });

  const first = scene.transact([
    { type: "move", cardId: "card-1", position: { x: 400, y: 220 } },
    { type: "rotate", cardId: "card-1", angle: 90 },
  ]);
  clock.tick(160);
  const second = scene.transact([{ type: "rotate", cardId: "card-1", angle: 180 }]);

  clock.tick(320);
  assert.deepEqual(await first.finished, [
    { type: "move", cardId: "card-1", status: "settled" },
    { type: "rotate", cardId: "card-1", status: "superseded" },
  ]);
  assert.deepEqual(await second.finished, [
    { type: "rotate", cardId: "card-1", status: "settled" },
  ]);
  assert.equal(scene.snapshot().visual[0].pose.x, 400);
  assert.equal(scene.snapshot().visual[0].pose.angle, 180);
});

test("reduced motion settles immediately at the same final pose", async () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply({ cards: [card], zones: [zone] });

  const transition = scene.transact([
    { type: "move", cardId: "card-1", position: { x: 400, y: 220 } },
    { type: "rotate", cardId: "card-1", angle: 90 },
    { type: "scale", cardId: "card-1", factor: 1.25 },
    { type: "face", cardId: "card-1", face: "faceDown", axis: "y" },
  ]);

  assert.equal(scene.snapshot().settling, false);
  assert.equal(scene.snapshot().visual[0].pose.x, 400);
  assert.equal(scene.snapshot().visual[0].pose.angle, 90);
  assert.equal(scene.snapshot().visual[0].pose.scale, 1.25);
  assert.equal(scene.snapshot().visual[0].pose.flipAngle, 180);
  await transition.finished;
});

test("destroy settles active work and releases the scene", async () => {
  const clock = testClock();
  const scene = createCardScene({ motion: { clock, duration: 320 } });
  scene.apply({ cards: [card], zones: [zone] });
  const transition = scene.transact([{ type: "move", cardId: "card-1", position: { x: 400, y: 220 } }]);

  scene.destroy();

  assert.deepEqual(await transition.finished, [
    { type: "move", cardId: "card-1", status: "destroyed" },
  ]);
  assert.equal(scene.snapshot().settling, false);
});

test("a scene emits a final change when animation settles", () => {
  const clock = testClock();
  const scene = createCardScene({ motion: { clock, duration: 320 } });
  scene.apply({ cards: [card], zones: [zone] });
  const changes = [];
  scene.on("change", (detail) => changes.push(detail));

  scene.transact([{ type: "move", cardId: "card-1", position: { x: 400, y: 220 } }]);

  assert.equal(changes.length, 1);
  assert.equal(changes[0].settling, true);
  clock.tick(320);
  assert.equal(changes.length, 2);
  assert.equal(changes[1].settling, false);
  assert.equal(changes[1].visual[0].pose.x, 400);
});

test("a face-down card presents its back surface to the camera", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: fakeDomElement };
  const stage = fakeDomElement();
  const scene = createCardScene({ renderMode: "css", element: stage, motion: { reducedMotion: true } });
  scene.apply({ cards: [card], zones: [zone] });

  scene.transact([{ type: "face", cardId: "card-1", face: "faceDown", axis: "y" }]);

  const shell = stage.children[0];
  const body = shell.children[0].children[0];
  const faces = body.children[0];
  const back = faces.children[1];
  assert.equal(back.hidden, false);
  assert.equal(faces.style.transform, "rotateX(0deg) rotateY(180deg)");
  assert.equal(back.style.transform, "rotateY(180deg) translateZ(calc(var(--card-depth) / 2))");
  if (previousDocument) globalThis.document = previousDocument;
  else delete globalThis.document;
});

test("a face transition renders around the x axis", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: fakeDomElement };
  const stage = fakeDomElement();
  const scene = createCardScene({ renderMode: "css", element: stage, motion: { reducedMotion: true } });
  scene.apply({ cards: [card], zones: [zone] });

  scene.transact([{ type: "face", cardId: "card-1", face: "faceDown", axis: "x" }]);

  const shell = stage.children[0];
  const body = shell.children[0].children[0];
  const faces = body.children[0];
  const back = faces.children[1];
  assert.equal(faces.style.transform, "rotateX(180deg) rotateY(0deg)");
  assert.equal(back.style.transform, "rotateY(180deg) translateZ(calc(var(--card-depth) / 2))");
  if (previousDocument) globalThis.document = previousDocument;
  else delete globalThis.document;
});

test("a simultaneous flip composes x and y rotations on one shell", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: fakeDomElement };
  const stage = fakeDomElement();
  const scene = createCardScene({ renderMode: "css", element: stage, motion: { reducedMotion: true } });
  scene.apply({ cards: [card], zones: [zone] });

  scene.transact([{
    type: "face",
    cardId: "card-1",
    face: "faceDown",
    axis: ["x", "y"],
    angle: { x: 60, y: 120 },
  }]);

  const faces = stage.children[0].children[0].children[0].children[0];
  assert.equal(faces.style.transform, "rotateX(60deg) rotateY(120deg)");
  if (previousDocument) globalThis.document = previousDocument;
  else delete globalThis.document;
});

test("a rounded cuboid uses smooth rounded extrusion layers", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: fakeDomElement };
  const stage = fakeDomElement();
  const scene = createCardScene({ renderMode: "css", element: stage, motion: { reducedMotion: true } });
  scene.apply({ cards: [card], zones: [zone] });

  const edge = stage.children[0].children[0].children[0].children[0].children[2];
  const extrusionLayers = edge.children.filter((child) => child.className.includes("edge-layer"));
  const cornerFacets = edge.children.filter((child) => child.className.includes("edge-corner"));
  assert.equal(extrusionLayers.length, 9);
  assert.equal(cornerFacets.length, 0);
  if (previousDocument) globalThis.document = previousDocument;
  else delete globalThis.document;
});

test("an intermediate flip keeps a physical card edge visible", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: fakeDomElement };
  const stage = fakeDomElement();
  const scene = createCardScene({ renderMode: "css", element: stage, motion: { reducedMotion: true } });
  scene.apply({ cards: [card], zones: [zone] });

  scene.transact([{ type: "face", cardId: "card-1", face: "faceDown", axis: "y", angle: 114 }]);

  const shell = stage.children[0];
  const body = shell.children[0].children[0];
  const faces = body.children[0];
  const front = faces.children[0];
  const back = faces.children[1];
  const edge = faces.children[2];
  assert.equal(edge.className, "cardinal-card__edge");
  assert.equal(front.style.transform, "translateZ(calc(var(--card-depth) / 2))");
  assert.equal(back.style.transform, "rotateY(180deg) translateZ(calc(var(--card-depth) / 2))");
  if (previousDocument) globalThis.document = previousDocument;
  else delete globalThis.document;
});

test("scaling preserves the rendered text node identity", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: fakeDomElement };
  const stage = fakeDomElement();
  const scene = createCardScene({ renderMode: "css", element: stage, motion: { reducedMotion: true } });
  scene.apply({ cards: [card], zones: [zone] });

  const title = stage.children[0].children[0].children[0].children[0].children[0].children[0];
  scene.transact([{ type: "scale", cardId: "card-1", factor: 1.25 }]);

  const currentTitle = stage.children[0].children[0].children[0].children[0].children[0].children[0];
  assert.strictEqual(currentTitle, title);
  if (previousDocument) globalThis.document = previousDocument;
  else delete globalThis.document;
});

test("scaling changes rendered geometry without scaling the content transform", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: fakeDomElement };
  const stage = fakeDomElement();
  const scene = createCardScene({ renderMode: "css", element: stage, motion: { reducedMotion: true } });
  scene.apply({ cards: [card], zones: [zone] });

  scene.transact([{ type: "scale", cardId: "card-1", factor: 1.25 }]);

  const shell = stage.children[0];
  const body = shell.children[0].children[0];
  assert.equal(shell.style.width, "225px");
  assert.equal(shell.style.height, "312.5px");
  assert.equal(shell.style["--card-scale"], "1.25");
  assert.equal(body.style.transform.includes("scale("), false);
  if (previousDocument) globalThis.document = previousDocument;
  else delete globalThis.document;
});

test("an immediate scale transaction does not leave an animation backlog", async () => {
  const clock = testClock();
  const scene = createCardScene({ motion: { clock, duration: 700 } });
  scene.apply({ cards: [card], zones: [zone] });

  const transition = scene.transact(
    [{ type: "scale", cardId: "card-1", factor: 1.7 }],
    { immediate: true },
  );

  assert.equal(scene.snapshot().settling, false);
  assert.equal(scene.snapshot().visual[0].pose.scale, 1.7);
  assert.deepEqual(await transition.finished, [
    { type: "scale", cardId: "card-1", status: "settled" },
  ]);
});

test("scaling preserves canonical text line breaks", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(tagName) {
      const element = fakeDomElement();
      if (tagName === "canvas") {
        element.getContext = () => ({ measureText: (text) => ({ width: text.length * 10 }) });
      }
      return element;
    },
  };
  const stage = fakeDomElement();
  const longCard = {
    ...card,
    faces: {
      front: {
        ...card.faces.front,
        flavour: "alpha beta gamma delta epsilon",
      },
    },
  };
  const scene = createCardScene({ renderMode: "css", element: stage, motion: { reducedMotion: true } });
  scene.apply({ cards: [longCard], zones: [zone] });

  const flavour = stage.children[0].children[0].children[0].children[0].children[0].children[2];
  const canonicalLines = flavour.textContent;
  scene.transact([{ type: "scale", cardId: "card-1", factor: 1.75 }]);

  assert.equal(canonicalLines.includes("\n"), true);
  assert.equal(flavour.textContent, canonicalLines);
  assert.equal(flavour.style.whiteSpace, "pre");
  if (previousDocument) globalThis.document = previousDocument;
  else delete globalThis.document;
});
