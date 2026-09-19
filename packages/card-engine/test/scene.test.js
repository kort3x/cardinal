import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createCardScene } from "../src/index.js";
import { normalizeSnapshot } from "../src/model.js";
import { cameraViewportForStage, cardGeometryKey, clearCardDepth, createCardCamera, createCardFaceGeometry, createCardFaceMaterial, createCardGeometry, createCardGeometryBundle, createGeometryCache, createCardShape, createSafeWebGLContext, drawCardTextureContent, flowTransitionPolicy, textureDimensionsForPose } from "../src/renderers/webgl.js";

function face({ title, image, imageAlt, flavour, ...rest } = {}) {
  return {
    ...rest,
    elements: [
      title === undefined ? null : { id: "title", type: "text", content: { text: title }, layout: { mode: "flow", order: 0 }, style: { variant: "title" } },
      image === undefined ? null : { id: "image", type: "image", content: { src: image, alt: imageAlt }, layout: { mode: "flow", order: 1 } },
      flavour === undefined ? null : { id: "flavour", type: "text", content: { text: flavour }, layout: { mode: "flow", order: 2 }, style: { variant: "flavour" } },
    ].filter(Boolean),
  };
}

const card = {
  id: "card-1",
  activeFaceId: "front",
  faceUp: true,
  faces: {
    front: face({ title: "The Cardinal", image: "cardinal.svg", flavour: "A bright beginning." }),
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

test("the WebGL camera defaults to an orthographic stage projection", () => {
  const camera = createCardCamera({ width: 900, height: 500 });

  assert.equal(camera.isOrthographicCamera, true);
  assert.equal(camera.left, -450);
  assert.equal(camera.right, 450);
  assert.equal(camera.top, 250);
  assert.equal(camera.bottom, -250);
});

test("perspective projection is opt-in", () => {
  const camera = createCardCamera({ projection: "perspective", width: 900, height: 500 });

  assert.equal(camera.isPerspectiveCamera, true);
});

test("an orthographic camera fits the logical scene inside a wide stage", () => {
  const viewport = cameraViewportForStage({ stageWidth: 1376, stageHeight: 992, sceneWidth: 900, sceneHeight: 500 });

  assert.equal(viewport.width, 900);
  assert.equal(viewport.height, 992 / 1376 * 900);
});

test("a stage-scaled camera has no fixed logical scene bounds", () => {
  assert.deepEqual(cameraViewportForStage({ stageWidth: 1376, stageHeight: 992, scaleMode: "stage" }), {
    width: 1376,
    height: 992,
  });
  assert.deepEqual(cameraViewportForStage({ stageWidth: 2515, stageHeight: 1322, scaleMode: "stage" }), {
    width: 2515,
    height: 1322,
  });
});

test("a stage-scaled camera can use an explicit world-unit density", () => {
  assert.deepEqual(cameraViewportForStage({ stageWidth: 1200, stageHeight: 800, scaleMode: "stage", unitsPerPixel: 2 }), {
    width: 600,
    height: 400,
  });
});

test("fit camera mode requires an explicit logical viewport", () => {
  assert.throws(
    () => cameraViewportForStage({ stageWidth: 1200, stageHeight: 800, scaleMode: "fit" }),
    /Fit camera mode requires positive and finite scene dimensions/,
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
  assert.equal(geometry.parameters.options.bevelSegments, 2);
  assert.equal(geometry.parameters.options.curveSegments, 24);
  assert.equal(geometry.parameters.options.bevelSize, 1.2);
  const position = geometry.getAttribute("position");
  const zValues = Array.from({ length: position.count }, (_, index) => position.getZ(index));
  assert.equal(Math.min(...zValues) >= -3.001, true);
  assert.equal(Math.max(...zValues) <= 3.001, true);
  geometry.dispose();
});

test("card geometry keeps higher tessellation configurable for consumers", () => {
  const shape = createCardShape("rounded-rectangle", { width: 180, height: 250 });
  const defaultGeometry = createCardGeometry(shape);
  const highQualityGeometry = createCardGeometry(shape, { bevelSegments: 4, curveSegments: 24 });
  const defaultBundle = createCardGeometryBundle("rounded-rectangle", { width: 180, height: 250 }, 6);
  const highQualityBundle = createCardGeometryBundle("rounded-rectangle", { width: 180, height: 250 }, 6, { faceCurveSegments: 12 });

  assert.equal(defaultGeometry.parameters.options.bevelSegments, 2);
  assert.equal(defaultGeometry.parameters.options.curveSegments, 24);
  assert.equal(highQualityGeometry.parameters.options.bevelSegments, 4);
  assert.equal(highQualityGeometry.parameters.options.curveSegments, 24);
  assert.equal(
    defaultGeometry.getAttribute("position").count < highQualityGeometry.getAttribute("position").count,
    true,
  );
  assert.equal(
    defaultBundle.faceGeometry.index.count < highQualityBundle.faceGeometry.index.count,
    true,
  );
  assert.equal(
    defaultBundle.selectionHaloGeometry.index.count < highQualityBundle.selectionHaloGeometry.index.count,
    true,
  );

  defaultGeometry.dispose();
  highQualityGeometry.dispose();
  for (const geometry of Object.values(defaultBundle)) geometry.dispose();
  for (const geometry of Object.values(highQualityBundle)) geometry.dispose();
});

test("a thin cuboid keeps the front content surface outside its bevel", () => {
  const thickness = 2;
  const geometry = createCardGeometry(
    createCardShape("rounded-rectangle", { width: 180, height: 250 }),
    { depth: thickness },
  );
  const position = geometry.getAttribute("position");
  const maximumZ = Math.max(...Array.from({ length: position.count }, (_, index) => position.getZ(index)));

  assert.equal(maximumZ < thickness / 2 + 0.06, true);
  geometry.dispose();
});

test("geometry cache shares a card bundle and disposes it after the final release", () => {
  const cache = createGeometryCache();
  const dimensions = { width: 180, height: 250 };
  const key = cardGeometryKey("rounded-rectangle", dimensions, 6);
  const first = cache.acquire(key, () => createCardGeometryBundle("rounded-rectangle", dimensions, 6));
  const second = cache.acquire(key, () => assert.fail("a matching geometry bundle must be reused"));
  let disposals = 0;
  for (const geometry of Object.values(first.value)) geometry.addEventListener("dispose", () => { disposals += 1; });

  assert.equal(cache.size, 1);
  assert.equal(first.value, second.value);
  assert.notEqual(first.value.faceGeometry, first.value.selectionFrameGeometry);
  assert.equal(first.value.faceGeometry, second.value.faceGeometry);

  first.release();
  assert.equal(disposals, 0);
  assert.equal(cache.size, 1);
  second.release();
  assert.equal(disposals, Object.keys(first.value).length);
  assert.equal(cache.size, 0);
});

test("geometry keys include the shape, dimensions, thickness, bevel, and selection inputs", () => {
  const base = cardGeometryKey("rounded-rectangle", { width: 180, height: 250 }, 6);
  assert.notEqual(base, cardGeometryKey("shield", { width: 180, height: 250 }, 6));
  assert.notEqual(base, cardGeometryKey("rounded-rectangle", { width: 181, height: 250 }, 6));
  assert.notEqual(base, cardGeometryKey("rounded-rectangle", { width: 180, height: 250 }, 7));
  assert.notEqual(base, cardGeometryKey("rounded-rectangle", { width: 180, height: 250 }, 6, { bevelSize: 1 }));
  assert.notEqual(base, cardGeometryKey("rounded-rectangle", { width: 180, height: 250 }, 6, { selectionPadding: 9 }));
});

test("destroying a geometry cache disposes outstanding bundles exactly once", () => {
  const cache = createGeometryCache();
  const lease = cache.acquire("card", () => createCardGeometryBundle("rounded-rectangle", { width: 180, height: 250 }, 6));
  let disposals = 0;
  for (const geometry of Object.values(lease.value)) geometry.addEventListener("dispose", () => { disposals += 1; });

  cache.destroy();
  lease.release();
  cache.destroy();

  assert.equal(disposals, Object.keys(lease.value).length);
  assert.equal(cache.size, 0);
});

test("card face geometries use normalized texture coordinates", () => {
  const dimensions = { width: 176, height: 246 };
  const geometry = createCardFaceGeometry(
    createCardShape("rounded-rectangle", dimensions),
    dimensions,
  );
  const uv = geometry.getAttribute("uv");
  const values = Array.from(uv.array);

  assert.equal(Math.min(...values) >= 0, true);
  assert.equal(Math.max(...values) <= 1, true);
  geometry.dispose();
});

test("card texture redraws reuse a loaded image synchronously", () => {
  const calls = [];
  const context = {
    fillText(...args) { calls.push(["fillText", ...args]); },
    drawImage(...args) { calls.push(["drawImage", ...args]); },
    fillRect(...args) { calls.push(["fillRect", ...args]); },
    measureText(text) { return { width: text.length * 8 }; },
  };
  const image = { id: "cached-card-image" };

  drawCardTextureContent(
    context,
    face({ title: "The Cardinal", image: "/cardinal.svg", flavour: "A bright beginning." }),
    { width: 180, height: 250 },
    image,
  );

  assert.equal(calls.some(([name, value]) => name === "drawImage" && value === image), true);
});

test("card images preserve their intrinsic aspect ratio during resize", () => {
  const calls = [];
  const context = {
    drawImage(...args) { calls.push(args); },
    fillRect() {},
    measureText(text) { return { width: text.length * 8 }; },
  };
  const image = { naturalWidth: 400, naturalHeight: 240 };
  drawCardTextureContent(context, {
    elements: [{ id: "art", type: "image", content: { src: "/art.svg" }, layout: { mode: "flow" } }],
  }, { width: 280, height: 320 }, image);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 5);
  assert.equal(calls[0][3] / calls[0][4], 400 / 240);
});

test("face background images render behind elements without entering flow", () => {
  const calls = [];
  const context = {
    drawImage(...args) { calls.push(["drawImage", ...args]); },
    fillRect(...args) { calls.push(["fillRect", ...args]); },
    fillText(...args) { calls.push(["fillText", ...args]); },
    measureText(text) { return { width: text.length * 8 }; },
  };
  const background = { naturalWidth: 400, naturalHeight: 200 };
  drawCardTextureContent(context, {
    background: "#17212b",
    backgroundImage: { src: "/background.png", fit: "cover" },
    elements: [{ id: "title", type: "text", content: { text: "Title" }, layout: { mode: "flow" } }],
  }, { width: 180, height: 250 }, new Map([["/background.png", background]]));

  assert.deepEqual(calls[0], ["fillRect", 0, 0, 180, 250]);
  assert.deepEqual(calls[1], ["drawImage", background, -160, 0, 500, 250]);
  assert.equal(calls.some(([name, value]) => name === "fillText" && value === "Title"), true);
});

test("face background images default to cover and reject unknown fitting", () => {
  const snapshot = normalizeSnapshot({
    cards: [{
      ...card,
      faces: { front: { ...card.faces.front, backgroundImage: "/background.png" } },
      back: { elements: [], backgroundImage: "/back-background.png" },
    }],
    zones: [zone],
  });
  assert.deepEqual(snapshot.cards[0].faces.front.backgroundImage, { src: "/background.png", fit: "cover" });
  assert.deepEqual(snapshot.cards[0].back.backgroundImage, { src: "/back-background.png", fit: "cover" });
  assert.throws(
    () => normalizeSnapshot({
      cards: [{ ...card, faces: { front: { ...card.faces.front, backgroundImage: { src: "/background.png", fit: "tile" } } } }],
      zones: [zone],
    }),
    /Unknown face backgroundImage fit: tile/,
  );
});

test("card weight is optional, positive, and finite", () => {
  const weighted = normalizeSnapshot({ cards: [{ ...card, weight: 2.5 }], zones: [zone] });
  assert.equal(weighted.cards[0].weight, 2.5);
  assert.throws(
    () => normalizeSnapshot({ cards: [{ ...card, weight: 0 }], zones: [zone] }),
    /Card weight must be positive and finite/,
  );
  assert.throws(
    () => normalizeSnapshot({ cards: [{ ...card, weight: Number.NaN }], zones: [zone] }),
    /Card weight must be positive and finite/,
  );
});

test("auto-height textures use the current animated height", () => {
  const autoCard = {
    ...card,
    sizing: { mode: "content" },
  };
  const textureDimensions = textureDimensionsForPose(autoCard, { height: 180 });

  assert.equal(textureDimensions.height, 180);
  assert.equal(textureDimensionsForPose(card, { height: 180 }).height, 250);
});

test("auto-height reflow keeps the bottom element anchored while the gap closes", () => {
  const positions = (content, options) => {
    const calls = [];
    const context = {
      fillText(...args) { calls.push(args); },
      fillRect() {},
      measureText(text) { return { width: text.length * 8 }; },
    };
    drawCardTextureContent(context, content, { width: 180, height: 116 }, null, options);
    return calls.map(([, , y]) => y);
  };
  const before = {
    elements: [
      { id: "top", type: "text", content: { text: "Top" }, layout: { mode: "flow", order: 0 } },
      { id: "middle", type: "text", content: { text: "Middle" }, layout: { mode: "flow", order: 1 } },
      { id: "bottom", type: "text", content: { text: "Bottom" }, layout: { mode: "flow", order: 2 } },
    ],
  };
  const after = { elements: [before.elements[0], before.elements[2]] };

  const removalPolicy = flowTransitionPolicy(before, after);
  const additionPolicy = flowTransitionPolicy(after, before);
  assert.equal(removalPolicy.preserveBottom, true);
  assert.equal(removalPolicy.gapIndex, 1);
  assert.equal(flowTransitionPolicy(before, { elements: before.elements.slice(0, 2) }).preserveBottom, false);
  assert.equal(additionPolicy.preserveBottom, true);
  assert.equal(additionPolicy.gapIndex, 1);
  assert.deepEqual(additionPolicy.deferFlowIds, ["middle"]);
  assert.equal(positions(after, removalPolicy)[1], positions(before)[2]);
  assert.equal(positions(after)[1] < positions(after, removalPolicy)[1], true);
});

test("auto-height additions do not place incoming flow before the shell grows", () => {
  const calls = [];
  const context = {
    fillText(...args) { calls.push(["text", ...args]); },
    fillRect() {},
    measureText(text) { return { width: text.length * 8 }; },
  };
  const previous = {
    elements: [
      { id: "top", type: "text", content: { text: "Top" }, layout: { mode: "flow", order: 0 } },
      { id: "upper", type: "text", content: { text: "Upper" }, layout: { mode: "flow", order: 1 } },
      { id: "bottom", type: "text", content: { text: "Bottom" }, layout: { mode: "flow", order: 2 } },
    ],
  };
  const next = {
    elements: [
      { id: "top", type: "text", content: { text: "Top" }, layout: { mode: "flow", order: 0 } },
      { id: "upper", type: "text", content: { text: "Upper" }, layout: { mode: "flow", order: 1 } },
      { id: "incoming", type: "text", content: { text: "Incoming" }, layout: { mode: "flow", order: 2 } },
      { id: "bottom", type: "text", content: { text: "Bottom" }, layout: { mode: "flow", order: 3 } },
    ],
  };
  const policy = flowTransitionPolicy(previous, next);
  drawCardTextureContent(context, next, { width: 180, height: 130 }, null, policy);

  assert.deepEqual(calls.map(([, text]) => text), ["Top", "Upper", "Bottom"]);
  assert.equal(calls[1][3], 48);
  assert.equal(calls[2][3], 92);
});

test("hidden preserved elements reserve flow space without rendering", () => {
  const calls = [];
  const context = {
    fillText(...args) { calls.push(["fillText", ...args]); },
    fillRect(...args) { calls.push(["fillRect", ...args]); },
    measureText(text) { return { width: text.length * 8 }; },
  };
  drawCardTextureContent(context, {
    elements: [
      { id: "hidden", type: "text", content: { text: "Hidden" }, visible: false, visibilityMode: "preserve-space", layout: { mode: "flow", order: 0 } },
      { id: "visible", type: "text", content: { text: "Visible" }, layout: { mode: "flow", order: 1 } },
    ],
  }, { width: 180, height: 250 });

  assert.deepEqual(calls.filter(([name]) => name === "fillText").map(([, text]) => text), ["Visible"]);
  assert.equal(calls.find(([name]) => name === "fillText")[3], 48);
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

test("a scene batches renderer draws for one animation sample", () => {
  const clock = testClock();
  let renders = 0;
  const renderer = () => ({
    update() {},
    render() { renders += 1; },
    destroy() {},
  });
  const cards = [card, { ...card, id: "card-2" }];
  const scene = createCardScene({ renderer, motion: { clock, duration: 100 } });

  scene.apply({ cards, zones: [{ ...zone, cardIds: cards.map(({ id }) => id) }] });
  renders = 0;
  scene.transact(cards.map((candidate, index) => ({
    type: "move",
    cardId: candidate.id,
    position: { x: 180 + index * 220, y: 180 },
  })));
  renders = 0;

  clock.tick(50);

  assert.equal(renders, 1);
  scene.destroy();
});

test("a scene exposes renderer context status changes", () => {
  let reportStatus;
  const renderer = ({ onStatus }) => {
    reportStatus = onStatus;
    return { type: "webgl", update() {}, destroy() {} };
  };
  const scene = createCardScene({ renderer });
  const events = [];
  scene.on("renderer-status", (detail) => events.push(detail));
  scene.apply({ cards: [card], zones: [zone] });

  reportStatus({ reason: "webgl-context-lost" });

  assert.equal(scene.snapshot().rendererReason, "webgl-context-lost");
  assert.deepEqual(events, [{ reason: "webgl-context-lost" }]);
  scene.destroy();
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

test("a scene applies a forced top-card selection cohort from zone policy", () => {
  const scene = createCardScene({ motion: { reducedMotion: true }, selection: { multiple: true, max: 3, scope: "zone" } });
  const cards = ["a", "b", "c", "d"].map((id) => ({ ...card, id }));
  scene.apply({
    cards,
    zones: [{ ...zone, cardIds: ["a", "b", "c", "d"], selectionPolicy: { mode: "forced", count: 3, from: "top" } }],
  });

  assert.deepEqual(scene.snapshot().desired.zones[0].selectionPolicy, { mode: "forced", count: 3, from: "top" });
  assert.deepEqual(scene.select(["d"]), {
    cardIds: ["b", "c", "d"], primaryCardId: "d", anchorCardId: "d", accepted: true,
  });
  assert.equal(scene.select(["a"]).accepted, false);
  scene.destroy();
});

test("user-originated card access is governed by take, put, reveal, conceal, and spin rules", async () => {
  let allowReveal = false;
  const calls = [];
  const scene = createCardScene({
    motion: { reducedMotion: true },
    interaction: { rules: {
      canTake(request) {
        calls.push("take");
        return { allowed: request.sources.every(({ zoneId }) => zoneId === "hand"), reason: "Card cannot be taken from that zone" };
      },
      canPut(request) {
        calls.push("put");
        return { allowed: request.toZoneId === "table", reason: "Card cannot be put there" };
      },
      canReveal(request) {
        calls.push("reveal");
        return { allowed: allowReveal && request.zoneId === "table", reason: "Reveal is not permitted" };
      },
      canConceal() {
        calls.push("conceal");
        return { allowed: false, reason: "Conceal is not permitted" };
      },
      canSpin() {
        calls.push("spin");
        return { allowed: false, reason: "Spin is not permitted" };
      },
    } },
  });
  const handCard = { ...card, id: "hand-card", faceUp: false };
  const tableCard = { ...card, id: "table-card", faceUp: true };
  scene.apply({
    cards: [handCard, tableCard],
    zones: [
      { ...zone, id: "hand", cardIds: [handCard.id], faceUp: false },
      { ...zone, id: "table", cardIds: [tableCard.id], faceUp: true, geometry: { ...zone.geometry, x: 700 } },
    ],
  });

  assert.throws(
    () => scene.transact([{ type: "move", cardId: tableCard.id, to: "hand" }], { origin: "user" }),
    /Card cannot be taken from that zone/,
  );
  assert.throws(
    () => scene.transact([{ type: "move", cardId: handCard.id, to: "table" }], { origin: "user" }),
    /Reveal is not permitted/,
  );
  assert.throws(
    () => scene.transact([{ type: "face", cardId: handCard.id, face: "faceUp" }], { origin: "user" }),
    /Reveal is not permitted/,
  );
  assert.throws(
    () => scene.transact([{ type: "face", cardId: handCard.id, face: "faceDown" }], { origin: "user" }),
    /Conceal is not permitted/,
  );
  assert.throws(
    () => scene.spin(handCard.id, { origin: "user" }),
    /Spin is not permitted/,
  );
  assert.deepEqual(scene.snapshot().desired.zones.map(({ id, cardIds }) => ({ id, cardIds })), [
    { id: "hand", cardIds: [handCard.id] },
    { id: "table", cardIds: [tableCard.id] },
  ]);

  allowReveal = true;
  await scene.transact([{ type: "move", cardId: handCard.id, to: "table", index: 0 }], { origin: "user" }).finished;
  assert.deepEqual(scene.snapshot().desired.zones.map(({ id, cardIds }) => ({ id, cardIds })), [
    { id: "hand", cardIds: [] },
    { id: "table", cardIds: [handCard.id, tableCard.id] },
  ]);
  assert.equal(scene.snapshot().desired.cards.find(({ id }) => id === handCard.id).faceUp, true);
  assert.deepEqual(calls, ["take", "take", "put", "reveal", "reveal", "conceal", "spin", "take", "put", "reveal"]);
  scene.destroy();
});

test("card faces require canonical element arrays", () => {
  const legacyCard = { ...card, faces: { front: { title: "Legacy" } } };
  assert.throws(
    () => normalizeSnapshot({ cards: [legacyCard], zones: [zone] }),
    /Face elements must be an array/,
  );
});

test("selection is an ordered engine-owned set and reconciles removed cards", () => {
  const secondCard = { ...card, id: "card-2" };
  const twoCardZone = { ...zone, cardIds: [card.id, secondCard.id] };
  const scene = createCardScene({ renderer: () => ({ update() {}, remove() {}, destroy() {} }) });
  scene.apply({ cards: [card, secondCard], zones: [twoCardZone] });

  assert.deepEqual(scene.select(["card-2", "card-1"]), {
    accepted: true,
    cardIds: ["card-2", "card-1"],
    primaryCardId: "card-1",
    anchorCardId: "card-1",
  });
  assert.deepEqual(scene.select(["card-2"], { mode: "toggle" }).cardIds, ["card-1"]);
  scene.apply({ cards: [card], zones: [zone] });
  assert.deepEqual(scene.snapshot().selection, {
    cardIds: ["card-1"],
    primaryCardId: "card-1",
    anchorCardId: "card-1",
  });
  scene.destroy();
});

function batchFixture() {
  return {
    cards: ["A", "B", "C", "D", "E"].map((id) => ({ ...structuredClone(card), id })),
    zones: [
      { ...structuredClone(zone), id: "source", cardIds: ["A", "B", "C", "D", "E"] },
      { ...structuredClone(zone), id: "destination", cardIds: [], geometry: { ...zone.geometry, x: 800 } },
    ],
  };
}

test("selection reconciliation never publishes an ineligible active cohort", () => {
  for (const change of ["rules", "apply", "transact", "hidden-zone", "geometry"]) {
    const fixture = batchFixture();
    let blocked = false;
    let sourceVisible = true;
    const geometry = new Map(fixture.zones.map((entry) => [entry.id, entry.geometry]));
    if (change === "geometry") fixture.zones = fixture.zones.map(({ geometry: ignored, ...entry }) => ({ ...entry, anchor: `#${entry.id}` }));
    const scene = createCardScene({
      motion: { reducedMotion: true },
      selection: { canSelect: ({ cardId, snapshot }) => ({ allowed: cardId !== "D"
        || !blocked && snapshot.cards.find(({ id }) => id === cardId).pose.angle !== 90 }) },
      interaction: { rules: { canStart: () => ({ allowed: true }), canDrop: () => ({ allowed: true }) } },
      renderer: () => ({ update() {}, destroy() {}, measureZone: (entry) => ({
        geometry: geometry.get(entry.id), visible: entry.id !== "source" || sourceVisible,
      }) }),
    });
    scene.apply(fixture);
    scene.select(["B", "D"]);
    scene.drag({ cardIds: ["B", "D"], primaryCardId: "B", point: { x: 10, y: 10 } });
    const observed = [];
    scene.on("selection-change", () => observed.push(scene.snapshot()));
    if (change === "rules") { blocked = true; scene.invalidateRules(); }
    if (change === "apply") {
      const next = scene.snapshot().desired;
      next.cards.find(({ id }) => id === "D").pose.angle = 90;
      scene.apply(next);
    }
    if (change === "transact") scene.transact([{ type: "rotate", cardId: "D", angle: 90 }]);
    if (change === "hidden-zone") scene.transact([{ type: "zone", zoneId: "source", changes: { visible: false } }]);
    if (change === "geometry") { sourceVisible = false; scene.refreshGeometry(); }
    assert.equal(observed.length, 1, change);
    assert.deepEqual(observed[0].interaction.sessions, [], change);
    assert.equal(observed[0].selection.cardIds.includes("D"), false, change);
    scene.destroy();
  }
});

test("failed batch commits restore displaced preview neighbors as well as the cohort", () => {
  const fixture = batchFixture();
  let rejectMeasurement = false;
  const geometry = new Map(fixture.zones.map((entry) => [entry.id, entry.geometry]));
  fixture.zones = fixture.zones.map(({ geometry: ignored, ...entry }) => ({ ...entry, anchor: `#${entry.id}` }));
  const scene = createCardScene({
    motion: { reducedMotion: true },
    interaction: { rules: { canStart: () => ({ allowed: true }), canDrop: () => ({ allowed: true }) } },
    renderer: () => ({
      update() {}, destroy() {},
      measureZone(entry) {
        if (rejectMeasurement && entry.id === "destination" && entry.cardIds.includes("B")) {
          throw new Error("Destination measurement failed");
        }
        return { geometry: geometry.get(entry.id), visible: true };
      },
    }),
  });
  scene.apply(fixture);
  const before = scene.snapshot();
  const session = scene.drag({ cardIds: ["B", "D"], primaryCardId: "B", point: { x: 10, y: 10 } });
  session.update({ toZoneId: "destination", index: 0 });
  const intent = session.release();
  assert.notDeepEqual(scene.snapshot().visual, before.visual);
  rejectMeasurement = true;
  assert.throws(() => scene.resolveDrop(intent.id, { accepted: true }), /Destination measurement failed/);
  assert.deepEqual(scene.snapshot().desired, before.desired);
  assert.deepEqual(scene.snapshot().visual, before.visual);
  assert.equal(scene.snapshot().interaction.sessions.length, 0);
  scene.destroy();
});

test("moving into an angled arrangement updates card orientation", async () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply({
    cards: [card, { ...card, id: "card-2" }],
    zones: [
      { ...zone, id: "source", cardIds: [card.id], geometry: { ...zone.geometry, x: 0 }, arrangement: { type: "grid", gap: 16 } },
      { ...zone, id: "destination", cardIds: ["card-2"], geometry: { ...zone.geometry, x: 700 }, arrangement: { type: "splay", spread: 60, gap: 16 } },
    ],
  });

  await scene.transact([{ type: "move", cardId: card.id, to: "destination", index: 0 }]).finished;
  assert.equal(scene.snapshot().visual.find(({ cardId }) => cardId === card.id)?.pose.angle, -30);
  scene.destroy();
});

test("moving a batch into an angled arrangement updates every card orientation", async () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  const second = { ...card, id: "card-2" };
  const third = { ...card, id: "card-3" };
  scene.apply({
    cards: [card, second, third],
    zones: [
      { ...zone, id: "source", cardIds: [card.id, second.id], geometry: { ...zone.geometry, x: 0 }, arrangement: { type: "grid", gap: 16 } },
      { ...zone, id: "destination", cardIds: [third.id], geometry: { ...zone.geometry, x: 700 }, arrangement: { type: "splay", spread: 60, gap: 16 } },
    ],
  });

  await scene.transact([{ type: "moveBatch", cardIds: [card.id, second.id], to: "destination", index: 0 }]).finished;
  const angles = new Map(scene.snapshot().visual.map(({ cardId, pose }) => [cardId, pose.angle]));
  assert.equal(angles.get(card.id), -30);
  assert.equal(angles.get(second.id), 0);
  assert.equal(angles.get(third.id), 30);
  scene.destroy();
});

test("zone policies govern scale, face side, and alignment channel speeds", async () => {
  const timer = testClock();
  const scene = createCardScene({ motion: { clock: timer, duration: 100 } });
  scene.apply({
    cards: [card, { ...card, id: "card-2" }],
    zones: [
      { ...zone, id: "source", cardIds: [card.id], geometry: { ...zone.geometry, x: 0 }, arrangement: { type: "grid", gap: 16 } },
      {
        ...zone,
        id: "destination",
        cardIds: ["card-2"],
        geometry: { ...zone.geometry, x: 700 },
        scale: 0.5,
        faceUp: false,
        motion: { positionSpeed: 2, orientationSpeed: 0.5, scaleSpeed: 4, faceSpeed: 2 },
        arrangement: { type: "hand", spread: 56, radius: 240, curve: "concave" },
      },
    ],
  });

  const initial = scene.snapshot().visual.find(({ cardId }) => cardId === card.id)?.pose;
  const transition = scene.transact([{ type: "move", cardId: card.id, to: "destination", index: 0 }]);
  timer.tick(50);
  const halfway = scene.snapshot().visual.find(({ cardId }) => cardId === card.id)?.pose;
  const target = scene.snapshot().desired.zones.find(({ id }) => id === "destination");
  assert.equal(halfway.scale, 0.5);
  assert.equal(halfway.flipY, 180);
  assert.notEqual(halfway.x, initial.x);
  assert.ok(halfway.angle > 0);
  assert.ok(halfway.angle < 5.6);
  assert.equal(target.scale, 0.5);
  assert.equal(target.faceUp, false);

  timer.tick(150);
  await transition.finished;
  const settled = scene.snapshot().visual.find(({ cardId }) => cardId === card.id)?.pose;
  assert.equal(settled.scale, 0.5);
  assert.equal(settled.flipY, 180);
  assert.notEqual(settled.x, initial.x);
  scene.destroy();
});

test("entering a face-down zone conceals before movement animation begins", async () => {
  const timer = testClock();
  const scene = createCardScene({ motion: { clock: timer, duration: 100 } });
  scene.apply({
    cards: [card],
    zones: [
      { ...zone, id: "source", cardIds: [card.id], geometry: { ...zone.geometry, x: 0 } },
      { ...zone, id: "ocean", cardIds: [], faceUp: false, geometry: { ...zone.geometry, x: 700 } },
    ],
  });

  const transition = scene.transact([{ type: "move", cardId: card.id, to: "ocean", index: 0 }]);
  let state = scene.snapshot();
  let visual = state.visual.find(({ cardId }) => cardId === card.id);
  assert.equal(state.desired.cards[0].faceUp, false);
  assert.equal(visual.physicalSide, "back");
  assert.equal(visual.pose.flipX, 0);
  assert.equal(visual.pose.flipY, 180);

  timer.tick(50);
  state = scene.snapshot();
  visual = state.visual.find(({ cardId }) => cardId === card.id);
  assert.equal(visual.physicalSide, "back");
  assert.equal(visual.pose.flipY, 180);
  timer.tick(100);
  await transition.finished;
  scene.destroy();
});

test("zone face policies cannot be bypassed by direct flips or spins", async () => {
  const timer = testClock();
  const scene = createCardScene({ motion: { clock: timer, duration: 100 } });
  scene.apply({
    cards: [card],
    zones: [{ ...zone, id: "ocean", cardIds: [card.id], faceUp: false }],
  });

  scene.transact([{ type: "face", cardId: card.id, face: "faceUp", axis: "y" }], { immediate: true });
  let state = scene.snapshot();
  assert.equal(state.desired.cards[0].faceUp, false);
  assert.equal(state.visual[0].physicalSide, "back");
  assert.equal(state.visual[0].pose.flipY, 180);

  const spin = scene.spin(card.id, { axis: "y", speed: 360 });
  assert.equal(spin.active, false);
  assert.equal(scene.snapshot().spinning, false);

  const transition = scene.transact([{ type: "face", cardId: card.id, face: "faceDown", axis: "x", angle: 0 }]);
  timer.tick(100);
  await transition.finished;
  state = scene.snapshot();
  assert.equal(state.desired.cards[0].faceUp, false);
  assert.equal(state.visual[0].physicalSide, "back");
  assert.equal(state.visual[0].pose.flipX, 0);
  assert.equal(state.visual[0].pose.flipY, 180);
  scene.destroy();

  const reconfigured = createCardScene({ motion: { reducedMotion: false } });
  reconfigured.apply({ cards: [card], zones: [{ ...zone, id: "ocean", cardIds: [card.id] }] });
  assert.equal(reconfigured.spin(card.id, { axis: "y", speed: 360 }).active, true);
  reconfigured.apply({ cards: [card], zones: [{ ...zone, id: "ocean", cardIds: [card.id], faceUp: false }] });
  assert.equal(reconfigured.snapshot().spinning, false);
  reconfigured.destroy();

  const override = createCardScene({ motion: { reducedMotion: false } });
  override.apply({ cards: [card], zones: [{ ...zone, id: "ocean", cardIds: [card.id], faceUp: false }] });
  override.transact([{ type: "face", cardId: card.id, face: "faceUp", axis: "y" }], {
    immediate: true,
    zoneFacePolicy: "override",
  });
  assert.equal(override.snapshot().desired.cards[0].faceUp, true);
  assert.equal(override.snapshot().visual[0].physicalSide, "front");
  const overrideSpin = override.spin(card.id, { axis: "y", speed: 360, zoneFacePolicy: "override" });
  assert.equal(overrideSpin.active, true);
  overrideSpin.stop();
  override.destroy();
});

test("moving a card out of a hand refans the remaining cards", async () => {
  const cards = [card, { ...card, id: "card-2" }, { ...card, id: "card-3" }, { ...card, id: "card-4" }];
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply({
    cards,
    zones: [
      { ...zone, id: "hand", cardIds: cards.map(({ id }) => id), geometry: { ...zone.geometry, x: 0 }, arrangement: { type: "hand", spread: 60, radius: 240, curve: "concave" } },
      { ...zone, id: "destination", cardIds: [], geometry: { ...zone.geometry, x: 700 }, arrangement: { type: "grid", gap: 16 } },
    ],
  });
  const before = new Map(scene.snapshot().visual.map(({ cardId, pose }) => [cardId, pose.angle]));

  await scene.transact([{ type: "move", cardId: card.id, to: "destination", index: 0 }]).finished;
  const after = new Map(scene.snapshot().visual.map(({ cardId, pose }) => [cardId, pose.angle]));
  const assertAngle = (angles, cardId, expected) => assert.ok(Math.abs(angles.get(cardId) - expected) < 1e-9, `${cardId} angle should be ${expected}`);
  assertAngle(before, "card-2", 6);
  assertAngle(before, "card-3", -6);
  assertAngle(before, "card-4", -18);
  assertAngle(after, "card-2", 12);
  assertAngle(after, "card-3", 0);
  assertAngle(after, "card-4", -12);
  scene.destroy();
});

test("moving cards within a hand recomputes depth order", async () => {
  const cards = [card, { ...card, id: "card-2" }, { ...card, id: "card-3" }, { ...card, id: "card-4" }];
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply({
    cards,
    zones: [{ ...zone, id: "hand", cardIds: cards.map(({ id }) => id), arrangement: { type: "hand", spread: 60, radius: 240, curve: "concave" } }],
  });
  const before = new Map(scene.snapshot().visual.map(({ cardId, pose }) => [cardId, pose.z]));

  await scene.transact([{ type: "moveBatch", cardIds: [card.id], to: "hand", index: 3 }]).finished;
  const after = new Map(scene.snapshot().visual.map(({ cardId, pose }) => [cardId, pose.z]));
  assert.ok(before.get("card-1") < before.get("card-2"));
  assert.ok(before.get("card-2") < before.get("card-3"));
  assert.ok(before.get("card-3") < before.get("card-4"));
  assert.ok(after.get("card-2") < after.get("card-3"));
  assert.ok(after.get("card-3") < after.get("card-4"));
  assert.ok(after.get("card-4") < after.get("card-1"));
  scene.destroy();
});

test("moved cards pop above a hand while traveling then restore their order", async () => {
  const timer = testClock();
  const cards = [card, { ...card, id: "card-2" }, { ...card, id: "card-3" }];
  const scene = createCardScene({ motion: { clock: timer, duration: 100 } });
  scene.apply({
    cards,
    zones: [{ ...zone, id: "hand", cardIds: cards.map(({ id }) => id), arrangement: { type: "hand", spread: 60, radius: 240, curve: "concave" } }],
  });

  const transition = scene.transact([{ type: "moveBatch", cardIds: [card.id], to: "hand", index: 2 }]);
  const moving = scene.snapshot().visual.find(({ cardId }) => cardId === card.id)?.pose;
  const otherOrders = scene.snapshot().visual.filter(({ cardId }) => cardId !== card.id).map(({ pose }) => pose.drawOrder);
  assert.ok(moving.drawOrder > Math.max(...otherOrders));

  timer.tick(100);
  await transition.finished;
  const settled = new Map(scene.snapshot().visual.map(({ cardId, pose }) => [cardId, pose]));
  assert.ok(settled.get("card-2").drawOrder < settled.get("card-3").drawOrder);
  assert.ok(settled.get("card-3").drawOrder < settled.get("card-1").drawOrder);
  scene.destroy();
});

test("moveBatch interprets insertion after removing every selected member", async () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply(batchFixture());
  scene.select(["B", "D"]);
  const result = await scene.transact([{ type: "moveBatch", cardIds: ["B", "D"], to: "source", index: 3 }]).finished;
  assert.deepEqual(scene.snapshot().desired.zones[0].cardIds, ["A", "C", "E", "B", "D"]);
  assert.deepEqual(scene.snapshot().selection.cardIds, ["B", "D"]);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "moveBatch");
  assert.deepEqual(result[0].cardIds, ["B", "D"]);
  assert.equal(result[0].status, "settled");
  scene.destroy();
});

test("moveBatch validates the final transaction so full zones can exchange batches", async () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  const fixture = batchFixture();
  fixture.zones[0].cardIds = ["A", "B", "C"];
  fixture.zones[0].capacity = 3;
  fixture.zones[1].cardIds = ["D", "E"];
  fixture.zones[1].capacity = 2;
  scene.apply(fixture);
  await scene.transact([
    { type: "moveBatch", cardIds: ["A", "B"], to: "destination", index: 0 },
    { type: "moveBatch", cardIds: ["D", "E"], to: "source", index: 0 },
  ]).finished;
  assert.deepEqual(scene.snapshot().desired.zones.map(({ cardIds }) => cardIds), [["D", "E", "C"], ["A", "B"]]);
  scene.destroy();
});

test("an invalid final batch operation leaves desired, selection and visual state unchanged", () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply(batchFixture());
  scene.select(["B", "D"]);
  const before = scene.snapshot();
  assert.throws(() => scene.transact([
    { type: "moveBatch", cardIds: ["B", "D"], to: "destination" },
    { type: "scale", cardId: "D", factor: -1 },
  ]), /positive/);
  assert.deepEqual(scene.snapshot(), before);
  assert.throws(() => scene.transact([
    { type: "moveBatch", cardIds: ["B", "missing"], to: "destination" },
  ]));
  assert.deepEqual(scene.snapshot(), before);
  scene.destroy();
});

test("moveBatch clears absolute positioning for every member and matches a fresh layout", async () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply(batchFixture());
  await scene.transact(["B", "D"].map((cardId) => ({ type: "move", cardId, position: { x: 15, y: 20 } }))).finished;
  await scene.transact([{ type: "moveBatch", cardIds: ["B", "D"], to: "destination" }]).finished;
  const actual = scene.snapshot();
  for (const id of ["B", "D"]) assert.equal(actual.desired.cards.find((entry) => entry.id === id).positionMode, undefined);
  const expected = createCardScene({ motion: { reducedMotion: true } });
  expected.apply(actual.desired);
  assert.deepEqual(Object.fromEntries(actual.visual.map(({ cardId, pose }) => [cardId, pose])),
    Object.fromEntries(expected.snapshot().visual.map(({ cardId, pose }) => [cardId, pose])));
  expected.destroy();
  scene.destroy();
});

test("moveBatch completion waits for secondary members after primary movement is superseded", async () => {
  const clock = testClock();
  const scene = createCardScene({ motion: { clock, duration: 300 } });
  scene.apply(batchFixture());
  let completed = false;
  const batch = scene.transact([{ type: "moveBatch", cardIds: ["B", "D"], to: "destination" }]);
  batch.finished.then(() => { completed = true; });
  clock.tick(100);
  scene.transact([{ type: "move", cardId: "B", position: { x: 100, y: 100 } }], { immediate: true });
  await Promise.resolve();
  assert.equal(completed, false);
  clock.tick(200);
  const result = await batch.finished;
  assert.equal(result[0].status, "superseded");
  assert.equal(scene.snapshot().visual.find(({ cardId }) => cardId === "D").pose.x >= 800, true);
  scene.destroy();
});

test("batch transforms and element edits use individual cards without moving membership", async () => {
  const scene = createCardScene({ motion: { reducedMotion: true } });
  scene.apply(batchFixture());
  const before = scene.snapshot();
  await scene.transact(["B", "D"].flatMap((cardId, index) => [
    { type: "rotate", cardId, angle: index ? 45 : 90 },
    { type: "scale", cardId, factor: index ? 1.5 : 0.75 },
    { type: "face", cardId, face: "faceDown" },
    { type: "element", cardId, elementId: "title", action: "update", element: { content: { text: cardId } } },
  ])).finished;
  const after = scene.snapshot();
  assert.deepEqual(after.desired.zones, before.desired.zones);
  assert.equal(after.desired.cards.find(({ id }) => id === "B").pose.angle, 90);
  assert.equal(after.desired.cards.find(({ id }) => id === "D").pose.angle, 45);
  assert.equal(after.desired.cards.find(({ id }) => id === "D").faces.front.elements[0].content.text, "D");
  assert.equal(after.desired.cards.find(({ id }) => id === "B").faceUp, false);
  scene.destroy();
});

test("hit testing delegates scene coordinates to the renderer adapter", () => {
  let received;
  const scene = createCardScene({ renderer: () => ({
    update() {},
    hitTest(point) { received = point; return { cardId: "card-1", side: "front" }; },
    destroy() {},
  }) });
  scene.apply({ cards: [card], zones: [zone] });

  assert.deepEqual(scene.hitTest({ x: 450, y: 250 }), { cardId: "card-1", side: "front" });
  assert.deepEqual(received, { x: 450, y: 250 });
  scene.destroy();
});

test("target sessions collect eligible card intent without changing selection or membership", () => {
  const secondCard = { ...card, id: "card-2" };
  const twoCardZone = { ...zone, cardIds: [card.id, secondCard.id] };
  const scene = createCardScene({ renderer: () => ({
    update() {},
    hitTest() { return { cardId: "card-2", side: "front" }; },
    destroy() {},
  }) });
  scene.apply({ cards: [card, secondCard], zones: [twoCardZone] });
  scene.select([card.id]);

  const events = [];
  scene.on("target-start", (intent) => events.push(["start", intent.status]));
  scene.on("target", (intent) => events.push(["finish", intent.status]));
  const session = scene.target({ eligibleCardIds: [secondCard.id] });

  assert.deepEqual(session.update({ point: { x: 450, y: 250 } }).cardIds, [secondCard.id]);
  assert.deepEqual(session.finish(), {
    id: "target-1",
    status: "committed",
    cardIds: [secondCard.id],
    point: { x: 450, y: 250 },
  });
  assert.deepEqual(scene.snapshot().selection.cardIds, [card.id]);
  assert.deepEqual(scene.snapshot().desired.zones[0].cardIds, [card.id, secondCard.id]);
  assert.deepEqual(events, [["start", "active"], ["finish", "committed"]]);
  scene.destroy();
});

test("project-defined element renderers measure and draw custom elements", () => {
  const calls = [];
  const context = {
    fillText(...args) { calls.push(["fillText", ...args]); },
    fillRect() {},
    measureText(text) { return { width: text.length * 8 }; },
  };
  drawCardTextureContent(context, {
    elements: [{ id: "badge", type: "badge", content: { text: "New" }, layout: { mode: "flow" } }],
  }, { width: 180, height: 80 }, null, {
    elementRenderers: {
      badge: {
        measure: () => 24,
        draw({ context: target, element, x, y }) {
          target.fillText(element.content.text, x, y);
        },
      },
    },
  });
  assert.deepEqual(calls, [["fillText", "New", 18, 18]]);
});

test("spacer elements add adjustable flow space without rendering content", () => {
  const calls = [];
  const context = {
    fillText(...args) { calls.push(["fillText", ...args]); },
    fillRect() {},
    measureText(text) { return { width: text.length * 8 }; },
  };
  drawCardTextureContent(context, {
    elements: [
      { id: "top", type: "text", content: { text: "Top" }, layout: { mode: "flow" } },
      { id: "space", type: "spacer", content: { height: 32 }, layout: { mode: "flow" } },
      { id: "bottom", type: "text", content: { text: "Bottom" }, layout: { mode: "flow" } },
    ],
  }, { width: 180, height: 160 });

  assert.deepEqual(calls, [
    ["fillText", "Top", 18, 18],
    ["fillText", "Bottom", 18, 90],
  ]);
});

test("spacer elements default to a small flow gap", () => {
  const snapshot = normalizeSnapshot({
    cards: [{
      ...card,
      sizing: { mode: "content", minHeight: 1 },
      faces: { front: { elements: [{ id: "space", type: "spacer" }] } },
    }],
    zones: [zone],
  });
  assert.equal(snapshot.cards[0].faces.front.elements[0].content.height, 20);
});

test("card elements support repeated types and targeted lifecycle operations", async () => {
  const elementCard = {
    ...card,
    faces: {
      front: {
        background: "#ffffff",
        elements: [
          { id: "title", type: "text", content: { text: "Title" }, layout: { mode: "flow", order: 0 } },
          { id: "subtitle", type: "text", content: { text: "Subtitle" }, layout: { mode: "flow", order: 1 } },
          { id: "art", type: "image", content: { src: "art.svg", alt: "Art" }, layout: { mode: "flow", order: 2 } },
        ],
      },
    },
  };
  const scene = createCardScene({ renderer: () => ({ update() {}, destroy() {} }) });
  scene.apply({ cards: [elementCard], zones: [zone] });

  const transition = scene.transact([
    { type: "element", cardId: "card-1", action: "hide", elementId: "title" },
    { type: "element", cardId: "card-1", action: "update", elementId: "subtitle", element: { content: { text: "Updated" }, visible: true } },
    { type: "element", cardId: "card-1", action: "reorder", elementId: "art", index: 0 },
    { type: "element", cardId: "card-1", action: "add", elementId: "badge", element: { type: "text", content: { text: "Badge" }, layout: { mode: "overlay", x: 0.1, y: 0.1, width: 0.3, height: 0.1 } } },
  ], { immediate: true });
  await transition.finished;

  const elements = scene.snapshot().desired.cards[0].faces.front.elements;
  assert.deepEqual(elements.map(({ id }) => id), ["art", "title", "subtitle", "badge"]);
  assert.equal(elements.find(({ id }) => id === "title").visible, false);
  assert.equal(elements.find(({ id }) => id === "subtitle").content.text, "Updated");
  assert.equal(elements.find(({ id }) => id === "badge").layout.mode, "overlay");
  scene.destroy();
});

test("card elements can be added to the physical back", async () => {
  const scene = createCardScene({ renderer: () => ({ update() {}, destroy() {} }) });
  scene.apply({ cards: [card], zones: [zone] });
  const transition = scene.transact([{
    type: "element",
    cardId: "card-1",
    faceId: "back",
    action: "add",
    elementId: "back-label",
    element: { type: "text", content: { text: "Back" } },
  }], { immediate: true });
  await transition.finished;
  assert.equal(scene.snapshot().desired.cards[0].back.elements[0].content.text, "Back");
  scene.destroy();
});

test("content-sized cards animate height changes when flow elements are removed", async () => {
  const clock = testClock();
  const contentCard = {
    ...card,
    sizing: { mode: "content", minHeight: 120, maxHeight: 480 },
    faces: {
      front: {
        elements: [
          { id: "title", type: "text", content: { text: "Title" }, layout: { mode: "flow" } },
          { id: "image", type: "image", content: { src: "art.svg" }, layout: { mode: "flow" } },
          { id: "flavour", type: "text", content: { text: "A longer description." }, layout: { mode: "flow" } },
        ],
      },
    },
  };
  const scene = createCardScene({ clock, renderer: () => ({ update() {}, destroy() {} }), motion: { clock, duration: 700 } });
  scene.apply({ cards: [contentCard], zones: [zone] });
  const initialHeight = scene.snapshot().visual[0].pose.height;

  const transition = scene.transact([{ type: "element", cardId: "card-1", action: "remove", elementId: "flavour" }]);
  assert.equal(scene.snapshot().desired.cards[0].dimensions, undefined);
  assert.equal(scene.snapshot().visual[0].pose.height, initialHeight);
  clock.tick(350);
  assert.equal(scene.snapshot().visual[0].pose.height < initialHeight, true);
  clock.tick(350);
  await transition.finished;
  assert.equal(scene.snapshot().visual[0].pose.height < initialHeight, true);
  scene.destroy();
});

test("all-hidden content cards collapse to their minimum and settle every element edit", async () => {
  const clock = testClock();
  const contentCard = {
    ...card,
    sizing: { mode: "content", minHeight: 120, maxHeight: 480 },
    faces: {
      front: {
        elements: [
          { id: "title", type: "text", content: { text: "Title" }, layout: { mode: "flow" } },
          { id: "image", type: "image", content: { src: "art.svg" }, layout: { mode: "flow" } },
          { id: "flavour", type: "text", content: { text: "A longer description." }, layout: { mode: "flow" } },
        ],
      },
    },
  };
  const scene = createCardScene({ clock, renderer: () => ({ update() {}, destroy() {} }), motion: { clock, duration: 700 } });
  scene.apply({ cards: [contentCard], zones: [zone] });

  const transition = scene.transact([
    { type: "element", cardId: "card-1", action: "hide", elementId: "title" },
    { type: "element", cardId: "card-1", action: "hide", elementId: "image" },
    { type: "element", cardId: "card-1", action: "hide", elementId: "flavour" },
  ]);
  clock.tick(700);

  assert.deepEqual(await transition.finished, [
    { type: "element", cardId: "card-1", status: "settled" },
    { type: "element", cardId: "card-1", status: "settled" },
    { type: "element", cardId: "card-1", status: "settled" },
  ]);
  assert.equal(scene.snapshot().visual[0].pose.height, 120);
  assert.equal(scene.snapshot().desired.cards[0].faces.front.elements.every(({ visible }) => visible === false), true);
  scene.destroy();
});

test("fixed-size cards retain explicit dimensions when every element is hidden", async () => {
  const fixedCard = {
    ...card,
    sizing: { mode: "fixed" },
    dimensions: { width: 210, height: 330 },
    faces: {
      front: {
        elements: [
          { id: "title", type: "text", content: { text: "Title" }, layout: { mode: "flow" } },
          { id: "flavour", type: "text", content: { text: "Description" }, layout: { mode: "flow" } },
        ],
      },
    },
  };
  const scene = createCardScene({ renderer: () => ({ update() {}, destroy() {} }) });
  scene.apply({ cards: [fixedCard], zones: [zone] });
  const transition = scene.transact([
    { type: "element", cardId: "card-1", action: "hide", elementId: "title" },
    { type: "element", cardId: "card-1", action: "hide", elementId: "flavour" },
  ], { immediate: true });
  await transition.finished;

  const pose = scene.snapshot().visual[0].pose;
  assert.equal(pose.width, 210);
  assert.equal(pose.height, 330);
  scene.destroy();
});

test("reversing an element resize supersedes stale work and lands at the latest content size", async () => {
  const clock = testClock();
  const contentCard = {
    ...card,
    sizing: { mode: "content", minHeight: 120, maxHeight: 480 },
    faces: {
      front: {
        elements: [
          { id: "title", type: "text", content: { text: "Title" }, layout: { mode: "flow" } },
          { id: "image", type: "image", content: { src: "art.svg" }, layout: { mode: "flow" } },
          { id: "flavour", type: "text", content: { text: "A longer description." }, layout: { mode: "flow" } },
        ],
      },
    },
  };
  const scene = createCardScene({ clock, renderer: () => ({ update() {}, destroy() {} }), motion: { clock, duration: 700 } });
  scene.apply({ cards: [contentCard], zones: [zone] });
  const initialHeight = scene.snapshot().visual[0].pose.height;

  const hide = scene.transact([{ type: "element", cardId: "card-1", action: "hide", elementId: "flavour" }]);
  clock.tick(350);
  const show = scene.transact([{ type: "element", cardId: "card-1", action: "show", elementId: "flavour" }]);
  clock.tick(700);

  assert.deepEqual(await hide.finished, [{ type: "element", cardId: "card-1", status: "superseded" }]);
  assert.deepEqual(await show.finished, [{ type: "element", cardId: "card-1", status: "settled" }]);
  assert.equal(scene.snapshot().visual[0].pose.height, initialHeight);
  scene.destroy();
});

test("fixed-size cards keep their dimensions when flow elements are removed", async () => {
  const scene = createCardScene({ renderer: () => ({ update() {}, destroy() {} }) });
  scene.apply({ cards: [card], zones: [zone] });
  const transition = scene.transact([{ type: "element", cardId: "card-1", action: "remove", elementId: "flavour" }], { immediate: true });
  await transition.finished;
  assert.equal(scene.snapshot().visual[0].pose.height, 250);
  scene.destroy();
});

test("resize commits dimensions immediately and animates the visible size", async () => {
  const clock = testClock();
  const scene = createCardScene({ clock, renderer: () => ({ update() {}, destroy() {} }), motion: { clock, duration: 700 } });
  scene.apply({ cards: [card], zones: [zone] });

  const transition = scene.transact([{
    type: "resize",
    cardId: "card-1",
    dimensions: { width: 260, height: 300 },
  }]);
  assert.deepEqual(scene.snapshot().desired.cards[0].dimensions, { width: 260, height: 300 });
  assert.equal(scene.snapshot().visual[0].pose.width, 180);
  clock.tick(350);
  const halfway = scene.snapshot().visual[0].pose;
  assert.equal(halfway.width > 180 && halfway.width < 260, true);
  assert.equal(halfway.height > 250 && halfway.height < 300, true);
  clock.tick(350);
  await transition.finished;
  assert.equal(scene.snapshot().visual[0].pose.width, 260);
  assert.equal(scene.snapshot().visual[0].pose.height, 300);
  scene.destroy();
});

test("an interrupted resize retargets from the current visible dimensions", async () => {
  const clock = testClock();
  const scene = createCardScene({ clock, renderer: () => ({ update() {}, destroy() {} }), motion: { clock, duration: 700 } });
  scene.apply({ cards: [card], zones: [zone] });

  scene.transact([{ type: "resize", cardId: "card-1", dimensions: { width: 280, height: 320 } }]);
  clock.tick(350);
  const currentWidth = scene.snapshot().visual[0].pose.width;
  const transition = scene.transact([{ type: "resize", cardId: "card-1", dimensions: { width: 200, height: 220 } }]);
  assert.equal(scene.snapshot().visual[0].pose.width, currentWidth);
  clock.tick(700);
  await transition.finished;
  assert.equal(scene.snapshot().visual[0].pose.width, 200);
  assert.equal(scene.snapshot().visual[0].pose.height, 220);
  scene.destroy();
});

test("thickness is a first-class animated card property", async () => {
  const clock = testClock();
  const scene = createCardScene({ clock, renderer: () => ({ update() {}, destroy() {} }), motion: { clock, duration: 700 } });
  scene.apply({ cards: [card], zones: [zone] });
  assert.equal(scene.snapshot().visual[0].pose.thickness, 6);

  const transition = scene.transact([{ type: "thickness", cardId: "card-1", thickness: 18 }]);
  assert.equal(scene.snapshot().desired.cards[0].thickness, 18);
  assert.equal(scene.snapshot().visual[0].pose.thickness, 6);
  clock.tick(350);
  assert.equal(scene.snapshot().visual[0].pose.thickness > 6 && scene.snapshot().visual[0].pose.thickness < 18, true);
  clock.tick(350);
  await transition.finished;
  assert.equal(scene.snapshot().visual[0].pose.thickness, 18);
  scene.destroy();
});

test("custom thickness controls depth separation between cards", () => {
  const thickCard = { ...card, thickness: 18 };
  const secondCard = { ...card, id: "card-2", thickness: 30 };
  const scene = createCardScene();
  scene.apply({
    cards: [thickCard, secondCard],
    zones: [{ ...zone, cardIds: [thickCard.id, secondCard.id] }],
  });

  const [first, second] = scene.snapshot().visual;
  assert.equal(first.pose.thickness, 18);
  assert.equal(second.pose.thickness, 30);
  assert.equal(second.pose.z, 25);
  scene.destroy();
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

test("zone depth layers separate cards by their rendered thickness", () => {
  const scaledCard = { ...card, pose: { scale: 2 } };
  const secondCard = { ...scaledCard, id: "card-2" };
  const scene = createCardScene();
  scene.apply({
    cards: [scaledCard, secondCard],
    zones: [{ ...zone, cardIds: [scaledCard.id, secondCard.id] }],
  });

  const [first, second] = scene.snapshot().visual;
  assert.equal(first.pose.z, 0);
  assert.equal(second.pose.z, 13);
  scene.destroy();
});

test("orthographic layout does not apply perspective depth scaling", () => {
  const scene = createCardScene({ camera: { projection: "orthographic" } });
  scene.apply({
    cards: [card],
    zones: [{ ...zone, geometry: { ...zone.geometry, depth: 500 } }],
  });

  assert.equal(scene.snapshot().visual[0].pose.depthScale, 1);
  scene.destroy();
});

test("moving cards from separate zones into overlap resolves a new depth layer", () => {
  const firstCard = { ...card, positionMode: "absolute", pose: { x: 140, y: 240, scale: 2 } };
  const secondCard = { ...card, id: "card-2", positionMode: "absolute", pose: { x: 720, y: 240, scale: 2 } };
  const secondZone = { ...zone, id: "other-table", cardIds: [secondCard.id] };
  const scene = createCardScene();
  scene.apply({ cards: [firstCard, secondCard], zones: [{ ...zone, cardIds: [firstCard.id] }, secondZone] });

  scene.transact([{ type: "move", cardId: secondCard.id, position: { x: firstCard.pose.x, y: firstCard.pose.y } }], { immediate: true });

  const [first, second] = scene.snapshot().visual;
  assert.equal(first.pose.z, 0);
  assert.equal(second.pose.z, 13);
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

test("motion duration can be changed for future transitions", async () => {
  const clock = testClock();
  const scene = createCardScene({ motion: { clock, duration: 320 } });
  scene.apply({ cards: [card], zones: [zone] });
  assert.deepEqual(scene.setMotion({ duration: 640 }), { duration: 640 });

  const transition = scene.transact([{ type: "move", cardId: "card-1", position: { x: 400, y: 220 } }]);
  clock.tick(320);
  assert.equal(scene.snapshot().visual[0].pose.x, 322.5);
  clock.tick(320);
  assert.deepEqual(await transition.finished, [{ type: "move", cardId: "card-1", status: "settled" }]);
  assert.throws(() => scene.setMotion({ duration: 0 }), /positive and finite/);
  scene.destroy();
});

test("direct pose updates avoid target transitions while keeping state current", () => {
  const scene = createCardScene();
  scene.apply({ cards: [card], zones: [zone] });
  const changes = [];
  scene.on("pose-change", (detail) => changes.push(detail));

  const result = scene.updatePoses([{
    cardId: "card-1",
    pose: { x: 320, y: 180, angle: 15, scale: 1.2 },
  }]);
  const snapshot = scene.snapshot();

  assert.equal(result.length, 1);
  assert.deepEqual(result[0].pose, snapshot.visual[0].pose);
  assert.equal(snapshot.visual[0].pose.x, 320);
  assert.equal(snapshot.visual[0].pose.y, 180);
  assert.equal(snapshot.visual[0].pose.angle, 15);
  assert.equal(snapshot.visual[0].pose.scale, 1.2);
  assert.equal(snapshot.desired.cards[0].pose.x, 320);
  assert.equal(snapshot.desired.cards[0].pose.y, 180);
  assert.equal(snapshot.settling, false);
  assert.deepEqual(changes, [result]);
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
  assert.equal(halfway.x, 322.5);
  assert.equal(halfway.y, 196.25);
  assert.equal(halfway.angle, 67.5);
  assert.equal(halfway.scale, 1.1875);
  assert.equal(halfway.flipY, 135);

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
  assert.equal(scene.snapshot().visual[0].pose.flipY, 180);
});

test("card weight scales target motion without changing the target pose", async () => {
  const clock = testClock();
  const weightedCard = { ...card, weight: 2 };
  const speedControlledZone = {
    ...zone,
    motion: { positionSpeed: 1, orientationSpeed: 1, scaleSpeed: 1, faceSpeed: 1 },
  };
  const scene = createCardScene({ motion: { clock, duration: 100 } });
  scene.apply({ cards: [weightedCard], zones: [speedControlledZone] });

  const transition = scene.transact([
    { type: "move", cardId: weightedCard.id, position: { x: 400, y: 220 } },
    { type: "rotate", cardId: weightedCard.id, angle: 90 },
    { type: "scale", cardId: weightedCard.id, factor: 1.25 },
    { type: "face", cardId: weightedCard.id, face: "faceDown", axis: "y" },
  ]);

  clock.tick(100);
  const halfway = scene.snapshot().visual[0].pose;
  assert.equal(halfway.x, 245);
  assert.equal(halfway.y, 172.5);
  assert.equal(halfway.angle, 45);
  assert.equal(halfway.scale, 1.125);
  assert.equal(halfway.flipY, 90);

  clock.tick(100);
  await transition.finished;
  assert.equal(scene.snapshot().visual[0].pose.x, 400);
  assert.equal(scene.snapshot().visual[0].pose.angle, 90);
  assert.equal(scene.snapshot().visual[0].pose.scale, 1.25);
  assert.equal(scene.snapshot().visual[0].pose.flipY, 180);
  scene.destroy();
});

test("a logical face cycle advances independently of physical orientation", () => {
  const cycleCard = {
    ...card,
    activeFaceId: "a",
    faceCycle: ["a", "b", "c"],
    faces: {
      a: face({ title: "Face A" }),
      b: face({ title: "Face B" }),
      c: face({ title: "Face C" }),
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
      a: face({ title: "Face A" }),
      b: face({ title: "Face B" }),
      c: face({ title: "Face C" }),
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

test("concealing makes front content unavailable before the physical flip settles", async () => {
  const clock = testClock();
  const scene = createCardScene({ clock, motion: { clock, duration: 320 }, renderer: () => ({ update() {}, remove() {}, destroy() {} }) });
  scene.apply({ cards: [card], zones: [zone] });

  const transition = scene.transact([{ type: "face", cardId: "card-1", face: "faceDown", axis: "y" }]);
  assert.equal(scene.snapshot().desired.cards[0].faceUp, false);

  clock.tick(160);
  const halfway = scene.snapshot();
  assert.equal(halfway.desired.cards[0].faceUp, false);
  assert.ok(halfway.visual[0].pose.flipY > 0 && halfway.visual[0].pose.flipY < 180);

  clock.tick(160);
  await transition.finished;
  assert.equal(scene.snapshot().visual[0].physicalSide, "back");
});

test("an interrupted logical face transition does not consume a face", async () => {
  const clock = testClock();
  const cycleCard = {
    ...card,
    activeFaceId: "a",
    faceCycle: ["a", "b", "c"],
    faces: {
      a: face({ title: "Face A" }),
      b: face({ title: "Face B" }),
      c: face({ title: "Face C" }),
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
      a: face({ title: "Face A" }),
      b: face({ title: "Face B" }),
      c: face({ title: "Face C" }),
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
  assert.equal(scene.snapshot().visual[0].pose.flipY, 90);
  clock.tick(160);
  assert.equal(scene.snapshot().visual[0].pose.flipY, 120);
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
  assert.equal(scene.snapshot().visual[0].pose.flipX, 45);
  assert.equal(scene.snapshot().visual[0].pose.flipY, 90);
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
  assert.equal(scene.snapshot().spinning, true);
  clock.tick(500);
  assert.equal(scene.snapshot().visual[0].pose.flipY, 90);
  clock.tick(750);
  assert.equal(scene.snapshot().visual[0].pose.flipY, 225);

  assert.equal(spin.stop(), true);
  assert.equal(scene.snapshot().spinning, false);
  assert.equal(scene.snapshot().settling, false);
  clock.tick(500);
  assert.equal(scene.snapshot().visual[0].pose.flipY, 225);
  assert.equal(scene.stopSpin("card-1"), false);
});

test("snapshot spin state clears when another operation cancels spinning", () => {
  const clock = testClock();
  const scene = createCardScene({ motion: { clock, duration: 320 } });
  scene.apply({ cards: [card], zones: [zone] });

  scene.spin("card-1", { axis: "y", direction: 1, speed: 180 });
  assert.equal(scene.snapshot().spinning, true);
  scene.transact([{ type: "face", cardId: "card-1", face: "faceDown", axis: "y" }]);
  assert.equal(scene.snapshot().spinning, false);
});

test("continuous spinning supports the x flip axis", () => {
  const clock = testClock();
  const scene = createCardScene({ motion: { clock, duration: 320 } });
  scene.apply({ cards: [card], zones: [zone] });

  scene.spin("card-1", { axis: "x", direction: -1, speed: 180 });
  clock.tick(500);

  assert.equal(scene.snapshot().visual[0].pose.flipAxis, "x");
  assert.equal(scene.snapshot().visual[0].pose.flipX, -90);
  scene.stopSpin("card-1");
});

test("a face transition canonicalizes a flip angle after continuous spinning", () => {
  const clock = testClock();
  const scene = createCardScene({ motion: { clock, duration: 100 } });
  scene.apply({ cards: [card], zones: [zone] });

  scene.spin("card-1", { axis: "y", speed: 360 });
  clock.tick(1000);
  scene.stopSpin("card-1");
  scene.transact([{ type: "face", cardId: "card-1", face: "faceUp", axis: "y", angle: 0 }], { immediate: true });

  assert.equal(scene.snapshot().visual[0].pose.flipY, 0);
  scene.destroy();
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
  assert.equal(scene.snapshot().visual[0].pose.flipY, 382.5);
  clock.tick(160);
  assert.equal(scene.snapshot().visual[0].pose.flipY, 0);
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
  assert.equal(scene.snapshot().visual[0].pose.flipY, 180);
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
        elements: card.faces.front.elements.map((element) => element.id === "flavour"
          ? { ...element, content: { text: "alpha beta gamma delta epsilon" } }
          : element),
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
