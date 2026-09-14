import { createCardScene } from "../../packages/card-engine/src/index.js";

const stage = document.querySelector("#stage");
const rendererStatus = document.querySelector("#renderer-status");
const status = document.querySelector("#status");
const cardList = document.querySelector("#card-list");
const addCardButton = document.querySelector("#add-card");
const removeCardsButton = document.querySelector("#remove-cards");
const selectAllButton = document.querySelector("#select-all");
const selectionStatus = document.querySelector("#selection-status");
const shape = document.querySelector("#shape");
const faceCount = document.querySelector("#face-count");
const reduced = document.querySelector("#reduced");
const moveXSlider = document.querySelector("#move-x");
const moveYSlider = document.querySelector("#move-y");
const rotateSlider = document.querySelector("#rotate-slider");
const scaleSlider = document.querySelector("#scale-slider");
const flipXSlider = document.querySelector("#flip-x-slider");
const flipYSlider = document.querySelector("#flip-y-slider");
const flipAxis = document.querySelector("#flip-axis");
const spinButton = document.querySelector("#spin");
const moveXValue = document.querySelector("#move-x-value");
const moveYValue = document.querySelector("#move-y-value");
const rotateValue = document.querySelector("#rotate-value");
const scaleValue = document.querySelector("#scale-value");
const flipXValue = document.querySelector("#flip-x-value");
const flipYValue = document.querySelector("#flip-y-value");

const logicalFaceDefinitions = [
  {
    id: "face-a",
    title: "The Cardinal",
    image: "/examples/card-engine-lab/cardinal.svg",
    imageAlt: "A stylized red cardinal",
    flavour: "One card from the new independent engine.",
    background: "#f4c95d",
  },
  {
    id: "face-b",
    title: "Face B",
    flavour: "The second logical face.",
    background: "#367c83",
    textColor: "#f7f4e9",
    mutedTextColor: "#c5e4df",
  },
  {
    id: "face-c",
    title: "Face C",
    flavour: "The third logical face.",
    background: "#a85f3f",
    textColor: "#f7f4e9",
    mutedTextColor: "#f3d7b8",
  },
  {
    id: "face-d",
    title: "Face D",
    flavour: "The fourth logical face.",
    background: "#367c83",
    textColor: "#f7f4e9",
    mutedTextColor: "#c5e4df",
  },
  {
    id: "face-e",
    title: "Face E",
    flavour: "The fifth logical face.",
    background: "#69527f",
    textColor: "#f7f4e9",
    mutedTextColor: "#ded0ed",
  },
];

const baseCard = {
  id: "cardinal-demo",
  activeFaceId: "face-a",
  faceUp: true,
  back: {
    title: "Concealed",
    flavour: "This side remains hidden.",
    background: "#17212b",
    textColor: "#f7f4e9",
    mutedTextColor: "#bdcbd0",
  },
  template: "illustrated",
};

let selectedCardIds = new Set([baseCard.id]);
let nextCardNumber = 2;

function configuredCard(sourceCard) {
  const faces = logicalFaceDefinitions.slice(0, Number(faceCount.value));
  const card = {
    ...sourceCard,
    faces: Object.fromEntries(faces.map((face) => [face.id, face])),
    template: shape.value,
  };
  delete card.faceCycleNextFaceId;
  if (!faces.some(({ id }) => id === card.activeFaceId)) card.activeFaceId = faces[0].id;
  if (faces.length > 1) card.faceCycle = faces.map(({ id }) => id);
  else delete card.faceCycle;
  return card;
}

function initialCards() {
  const flipX = Number(flipXSlider.value);
  const flipY = Number(flipYSlider.value);
  const faceUp = Math.cos(flipX * Math.PI / 180) * Math.cos(flipY * Math.PI / 180) >= 0;
  return [{
    ...baseCard,
    template: shape.value,
    faceUp,
    flipAxis: flipAxis.value,
    positionMode: "absolute",
    pose: {
      x: Number(moveXSlider.value),
      y: Number(moveYSlider.value),
      angle: Number(rotateSlider.value),
      scale: Number(scaleSlider.value),
      flipX,
      flipY,
    },
  }];
}

function sceneCards() {
  return scene?.snapshot().desired.cards ?? initialCards();
}

function desiredSnapshot(cards = sceneCards()) {
  return {
    cards: cards.map(configuredCard),
    zones: [{
      id: "demo-table",
      cardIds: cards.map(({ id }) => id),
      geometry: { x: 0, y: 0, width: 900, height: 500, depth: 0 },
      arrangement: { type: "grid", gap: 16 },
    }],
  };
}

function cardFootprint(card) {
  const scale = card.pose?.scale ?? 1;
  return {
    width: (card.dimensions?.width ?? 180) * scale,
    height: (card.dimensions?.height ?? 250) * scale,
  };
}

function footprintsOverlap(first, second, gap) {
  const firstSize = cardFootprint(first);
  const secondSize = cardFootprint(second);
  return Math.abs(first.pose.x - second.pose.x) < (firstSize.width + secondSize.width) / 2 + gap
    && Math.abs(first.pose.y - second.pose.y) < (firstSize.height + secondSize.height) / 2 + gap;
}

function nextCardPosition(cards) {
  const scale = Number(scaleSlider.value);
  const candidate = { ...baseCard, pose: { x: 450, y: 250, scale } };
  const offsets = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [-1, 1], [1, -1], [-1, -1],
  ];
  const gap = 24;
  const size = cardFootprint(candidate);
  const stepX = Math.max(size.width, ...cards.map((card) => cardFootprint(card).width)) + gap;
  const stepY = Math.max(size.height, ...cards.map((card) => cardFootprint(card).height)) + gap;
  for (let radius = 0; radius < 12; radius += 1) {
    const candidates = radius === 0
      ? [[0, 0]]
      : offsets.map(([x, y]) => [x * radius, y * radius]);
    for (const [x, y] of candidates) {
      const position = { x: 450 + x * stepX, y: 250 + y * stepY };
      const placed = { ...candidate, pose: { ...candidate.pose, ...position } };
      if (!cards.some((card) => footprintsOverlap(card, placed, gap))) return position;
    }
  }
  return { x: 450 + cards.length * (size.width + gap), y: 250 };
}

function currentCard(state = scene.snapshot()) {
  return state.desired.cards.find(({ id }) => selectedCardIds.has(id));
}

let scene;
let spinHandles = new Map();
let spinTimer;
let spinning = false;
function startScene(cards = sceneCards()) {
  scene?.destroy();
  if (spinTimer) clearTimeout(spinTimer);
  spinTimer = undefined;
  spinHandles = new Map();
  spinning = false;
  updateSpinButton();
  try {
    scene = createCardScene({
      element: stage,
      templates: {
        illustrated: { width: 180, height: 250, shape: "rounded-rectangle" },
        shield: { width: 180, height: 250, shape: "shield" },
      },
      motion: { reducedMotion: reduced.checked, duration: 700 },
    });
    scene.apply(desiredSnapshot(cards));
    scene.on("change", updateStatus);
    selectedCardIds = new Set([...selectedCardIds].filter((id) => cards.some((card) => card.id === id)));
    if (selectedCardIds.size === 0 && cards[0]) selectedCardIds.add(cards[0].id);
    renderCardList();
    syncControlsFromSelection();
    updateStatus();
  } catch (error) {
    scene = undefined;
    const message = error instanceof Error ? error.message : String(error);
    rendererStatus.textContent = "Renderer: Three.js WebGL (required) — unavailable";
    status.textContent = message;
    document.querySelectorAll("button, input, select").forEach((control) => { control.disabled = true; });
  }
}

function applyLabCards(cards) {
  scene.apply(desiredSnapshot(cards));
  selectedCardIds = new Set([...selectedCardIds].filter((id) => cards.some((card) => card.id === id)));
  if (selectedCardIds.size === 0 && cards[0]) selectedCardIds.add(cards[0].id);
  renderCardList();
  syncControlsFromSelection();
  updateStatus();
}

function renderCardList() {
  const state = scene.snapshot();
  const items = state.desired.cards.map((card, index) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = selectedCardIds.has(card.id);
    input.setAttribute("aria-label", `Select card ${index + 1}`);
    input.addEventListener("change", () => {
      if (input.checked) selectedCardIds.add(card.id);
      else selectedCardIds.delete(card.id);
      syncControlsFromSelection();
      updateStatus();
      renderCardList();
    });
    label.append(input, document.createTextNode(`Card ${index + 1}`));
    return label;
  });
  cardList.replaceChildren(...items);
  selectionStatus.textContent = `${selectedCardIds.size} of ${state.desired.cards.length} selected`;
}

function syncControlsFromSelection() {
  const state = scene.snapshot();
  const card = currentCard(state);
  if (!card) return;
  const pose = state.visual.find(({ cardId }) => cardId === card.id)?.pose ?? card.pose;
  setControls({
    x: pose.x,
    y: pose.y,
    angle: pose.angle,
    scale: pose.scale,
    flipX: pose.flipX ?? 0,
    flipY: pose.flipY ?? pose.flipAngle ?? 0,
  });
}

function updateStatus() {
  const state = scene.snapshot();
  const card = currentCard(state);
  const visual = card && state.visual.find(({ cardId }) => cardId === card.id);
  const pose = visual?.pose;
  const rendererLabel = state.renderer === "webgl"
    ? "Three.js WebGL (true 3D)"
    : state.renderer === "css" ? "CSS (explicit mode)" : state.renderer;
  const projectionLabel = state.projection ? ` · ${state.projection}` : "";
  rendererStatus.textContent = `Renderer: ${rendererLabel}${projectionLabel}${state.rendererReason && state.rendererReason !== "css" ? ` — ${state.rendererReason}` : ""}`;
  const physicalSide = visual?.physicalSide ?? "unknown";
  status.textContent = pose
    ? `${state.desired.cards.length} cards · ${selectedCardIds.size} selected · x ${pose.x.toFixed(0)} · y ${pose.y.toFixed(0)} · angle ${pose.angle.toFixed(0)}° · scale ${pose.scale.toFixed(2)} · logical ${card.activeFaceId.replace("face-", "").toUpperCase()} · physical ${physicalSide} · ${state.settling ? "animating" : "stable"}`
    : `${state.desired.cards.length} cards · 0 selected`;
  selectionStatus.textContent = `${selectedCardIds.size} of ${state.desired.cards.length} selected`;
}

function run(operations, options) {
  scene.transact(operations, options);
}

function updateSpinButton() {
  spinButton.textContent = spinning ? "Stop spinning" : "Spin in place";
  spinButton.setAttribute("aria-pressed", String(spinning));
}

function stopContinuousFlip() {
  if (spinTimer) clearTimeout(spinTimer);
  spinTimer = undefined;
  if (!spinning) return;
  for (const handle of spinHandles.values()) handle.stop();
  spinHandles = new Map();
  spinning = false;
  updateSpinButton();
}

function startFullSpin() {
  const state = scene.snapshot();
  const cards = state.desired.cards.filter(({ id }) => selectedCardIds.has(id));
  const axis = flipAxis.value;
  const starts = new Map(cards.map((card) => {
    const visual = state.visual.find(({ cardId }) => cardId === card.id);
    return [card.id, {
      face: card.faceUp ? "faceUp" : "faceDown",
      angle: visual?.pose[axis === "x" ? "flipX" : "flipY"] ?? 0,
    }];
  }));
  spinHandles = new Map(cards.map(({ id }) => [id, scene.spin(id, { axis, direction: 1, speed: 360 })]));
  spinning = [...spinHandles.values()].some((handle) => handle.active);
  updateSpinButton();
  if (!spinning) return;

  spinTimer = setTimeout(() => {
    for (const handle of spinHandles.values()) handle.stop();
    spinHandles = new Map();
    spinning = false;
    spinTimer = undefined;
    scene.transact([...starts.entries()].map(([cardId, { face, angle }]) => ({
      type: "face", cardId, face, axis, angle,
    })), { immediate: true });
    updateSpinButton();
  }, 1000);
}

function updateControlLabels() {
  const scale = Number(scaleSlider.value);
  const flipX = Number(flipXSlider.value);
  const flipY = Number(flipYSlider.value);
  moveXValue.textContent = moveXSlider.value;
  moveYValue.textContent = moveYSlider.value;
  rotateValue.textContent = `${rotateSlider.value}°`;
  scaleValue.textContent = `${Math.round(scale * 100)}%`;
  flipXValue.textContent = `${flipX}°`;
  flipYValue.textContent = `${flipY}°`;
}

function setControls({ x, y, angle, scale, faceUp, flipX, flipY } = {}) {
  if (x !== undefined) moveXSlider.value = String(x);
  if (y !== undefined) moveYSlider.value = String(y);
  if (angle !== undefined) rotateSlider.value = String(angle);
  if (scale !== undefined) scaleSlider.value = String(scale);
  if (flipX !== undefined) flipXSlider.value = String(flipX);
  if (flipY !== undefined) flipYSlider.value = String(flipY);
  if (faceUp !== undefined) {
    flipXSlider.value = "0";
    flipYSlider.value = faceUp ? "0" : "180";
  }
  updateControlLabels();
}

function selectedCards(state = scene.snapshot()) {
  return state.desired.cards.filter(({ id }) => selectedCardIds.has(id));
}

function selectedCardIdsArray() {
  return selectedCards().map(({ id }) => id);
}

function currentVisual(state = scene.snapshot()) {
  const card = currentCard(state);
  return card && state.visual.find(({ cardId }) => cardId === card.id);
}

function scaleTo(factor, options) {
  setControls({ scale: factor });
  run(selectedCardIdsArray().map((cardId) => ({ type: "scale", cardId, factor })), options);
}

function normalizeAngle(angle) {
  return ((angle + 180) % 360 + 360) % 360 - 180;
}

let pendingChannels = new Set();
let pendingModes = new Map();
let controlsFrame;
function controlOperations(channels) {
  const operations = [];
  const selected = selectedCards();
  if (selected.length === 0) return operations;
  const primary = selected[0];
  if (channels.has("move")) {
    const x = Number(moveXSlider.value);
    const y = Number(moveYSlider.value);
    for (const card of selected) operations.push({
      type: "move",
      cardId: card.id,
      position: { x: x + card.pose.x - primary.pose.x, y: y + card.pose.y - primary.pose.y },
    });
  }
  if (channels.has("rotate")) {
    for (const card of selected) operations.push({ type: "rotate", cardId: card.id, angle: Number(rotateSlider.value) });
  }
  if (channels.has("scale")) {
    for (const card of selected) operations.push({ type: "scale", cardId: card.id, factor: Number(scaleSlider.value) });
  }
  if (channels.has("flip")) {
    const flipX = Number(flipXSlider.value);
    const flipY = Number(flipYSlider.value);
    const faceUp = Math.cos(flipX * Math.PI / 180) * Math.cos(flipY * Math.PI / 180) >= 0;
    for (const card of selected) operations.push({
      type: "face",
      cardId: card.id,
      face: faceUp ? "faceUp" : "faceDown",
      axis: ["x", "y"],
      angle: { x: flipX, y: flipY },
    });
  }
  return operations;
}

function queueControl(channel, { immediate = true } = {}) {
  pendingChannels.add(channel);
  pendingModes.set(channel, immediate ? "immediate" : "animated");
  updateControlLabels();
  if (controlsFrame) return;
  controlsFrame = requestAnimationFrame(() => {
    controlsFrame = undefined;
    const channels = pendingChannels;
    const modes = pendingModes;
    pendingChannels = new Set();
    pendingModes = new Map();
    const operations = controlOperations(channels);
    const animated = [...channels].some((name) => modes.get(name) === "animated");
    if (operations.length > 0) run(operations, animated ? undefined : { immediate: true });
  });
}

document.querySelector("#move").addEventListener("click", () => {
  const visual = currentVisual();
  if (!visual) return;
  const x = visual.pose.x > 300 ? 140 : 600;
  setControls({ x, y: 240 });
  run(controlOperations(new Set(["move"])));
});

document.querySelector("#rotate").addEventListener("click", () => {
  const card = currentCard();
  if (!card) return;
  const angle = normalizeAngle(card.pose.angle + 45);
  setControls({ angle });
  run(controlOperations(new Set(["rotate"])));
});

document.querySelector("#scale").addEventListener("click", () => {
  const card = currentCard();
  if (!card) return;
  const factor = card.pose.scale > 1 ? 1 : 1.25;
  scaleTo(factor);
});

document.querySelectorAll("[data-scale]").forEach((button) => {
  button.addEventListener("click", () => {
    setControls({ scale: Number(button.dataset.scale) });
    queueControl("scale", { immediate: false });
  });
});

document.querySelector("#flip").addEventListener("click", () => {
  stopContinuousFlip();
  const card = currentCard();
  if (!card) return;
  const face = card.faceUp ? "faceDown" : "faceUp";
  setControls({ faceUp: face === "faceUp" });
  run(controlOperations(new Set(["flip"])));
});

spinButton.addEventListener("click", () => {
  if (spinning) {
    stopContinuousFlip();
    return;
  }
  spinHandles = new Map(selectedCardIdsArray().map((cardId) => [
    cardId,
    scene.spin(cardId, { axis: flipAxis.value, direction: 1, speed: 180 }),
  ]));
  spinning = [...spinHandles.values()].some((handle) => handle.active);
  updateSpinButton();
});

[moveXSlider, moveYSlider].forEach((slider) => slider.addEventListener("input", () => queueControl("move")));
rotateSlider.addEventListener("input", () => queueControl("rotate"));
scaleSlider.addEventListener("input", () => queueControl("scale"));
[flipXSlider, flipYSlider].forEach((slider) => slider.addEventListener("input", () => {
  stopContinuousFlip();
  queueControl("flip");
}));
flipAxis.addEventListener("change", () => {
  stopContinuousFlip();
});
shape.addEventListener("change", startScene);
faceCount.addEventListener("change", startScene);

addCardButton.addEventListener("click", () => {
  const cards = sceneCards();
  const id = `cardinal-demo-${nextCardNumber}`;
  nextCardNumber += 1;
  const position = nextCardPosition(cards);
  cards.push({
    ...baseCard,
    id,
    template: shape.value,
    positionMode: "absolute",
    pose: {
      ...position,
      scale: Number(scaleSlider.value),
    },
  });
  selectedCardIds = new Set([id]);
  applyLabCards(cards);
});

removeCardsButton.addEventListener("click", () => {
  const cards = sceneCards().filter(({ id }) => !selectedCardIds.has(id));
  selectedCardIds = new Set(cards[0] ? [cards[0].id] : []);
  applyLabCards(cards);
});

selectAllButton.addEventListener("click", () => {
  selectedCardIds = new Set(scene.snapshot().desired.cards.map(({ id }) => id));
  renderCardList();
  syncControlsFromSelection();
  updateStatus();
});

document.querySelectorAll("[data-move-x]").forEach((button) => {
  button.addEventListener("click", () => {
    setControls({ x: Number(button.dataset.moveX), y: Number(button.dataset.moveY) });
    queueControl("move", { immediate: false });
  });
});
document.querySelectorAll("[data-rotate]").forEach((button) => {
  button.addEventListener("click", () => {
    setControls({ angle: Number(button.dataset.rotate) });
    queueControl("rotate", { immediate: false });
  });
});
document.querySelectorAll("[data-flip]").forEach((button) => {
  button.addEventListener("click", () => {
    stopContinuousFlip();
    setControls({ faceUp: button.dataset.flip === "0" });
    queueControl("flip", { immediate: false });
  });
});

document.querySelector("#combined").addEventListener("click", () => {
  stopContinuousFlip();
  const cardState = currentCard();
  const angle = normalizeAngle(cardState.pose.angle + 180);
  const scale = cardState.pose.scale > 1 ? 1 : 1.3;
  setControls({ x: 450, y: 240, angle, scale });
  run(controlOperations(new Set(["move", "rotate", "scale"])));
  startFullSpin();
});

reduced.addEventListener("change", () => {
  if (controlsFrame) cancelAnimationFrame(controlsFrame);
  controlsFrame = undefined;
  pendingChannels = new Set();
  pendingModes = new Map();
  startScene();
});
updateControlLabels();
startScene();
