import { createCardScene } from "../../packages/card-engine/src/index.js";

const stage = document.querySelector("#stage");
const rendererStatus = document.querySelector("#renderer-status");
const status = document.querySelector("#status");
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

function configuredCard() {
  const faces = logicalFaceDefinitions.slice(0, Number(faceCount.value));
  const card = {
    ...baseCard,
    faces: Object.fromEntries(faces.map((face) => [face.id, face])),
  };
  if (faces.length > 1) card.faceCycle = faces.map(({ id }) => id);
  return card;
}

function desiredSnapshot() {
  const flipX = Number(flipXSlider.value);
  const flipY = Number(flipYSlider.value);
  const faceUp = Math.cos(flipX * Math.PI / 180) * Math.cos(flipY * Math.PI / 180) >= 0;
  return {
    cards: [{
      ...configuredCard(),
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
    }],
    zones: [{
      id: "demo-table",
      cardIds: [baseCard.id],
      geometry: { x: 0, y: 0, width: 900, height: 500, depth: 0 },
      arrangement: { type: "grid", gap: 16 },
    }],
  };
}

function currentCard() {
  return scene.snapshot().desired.cards[0];
}

let scene;
let spinHandle;
let spinTimer;
let spinning = false;
function startScene() {
  scene?.destroy();
  if (spinTimer) clearTimeout(spinTimer);
  spinTimer = undefined;
  spinHandle = undefined;
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
    scene.apply(desiredSnapshot());
    scene.on("change", updateStatus);
    updateStatus();
  } catch (error) {
    scene = undefined;
    const message = error instanceof Error ? error.message : String(error);
    rendererStatus.textContent = "Renderer: Three.js WebGL (required) — unavailable";
    status.textContent = message;
    document.querySelectorAll("button, input, select").forEach((control) => { control.disabled = true; });
  }
}

function updateStatus() {
  const state = scene.snapshot();
  const pose = state.visual[0]?.pose;
  const rendererLabel = state.renderer === "webgl"
    ? "Three.js WebGL (true 3D)"
    : state.renderer === "css" ? "CSS (explicit mode)" : state.renderer;
  rendererStatus.textContent = `Renderer: ${rendererLabel}${state.rendererReason && state.rendererReason !== "css" ? ` — ${state.rendererReason}` : ""}`;
  const physicalSide = state.visual[0]?.physicalSide ?? "unknown";
  status.textContent = pose
    ? `x ${pose.x.toFixed(0)} · y ${pose.y.toFixed(0)} · angle ${pose.angle.toFixed(0)}° · scale ${pose.scale.toFixed(2)} · logical ${state.desired.cards[0].activeFaceId.replace("face-", "").toUpperCase()} · physical ${physicalSide} · ${state.settling ? "animating" : "stable"}`
    : "No card";
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
  spinHandle?.stop();
  spinHandle = undefined;
  spinning = false;
  updateSpinButton();
}

function startFullSpin() {
  const state = scene.snapshot();
  const cardState = currentCard();
  const axis = flipAxis.value;
  const startingAngle = state.visual[0]?.pose[axis === "x" ? "flipX" : "flipY"] ?? 0;
  const handle = scene.spin(baseCard.id, { axis, direction: 1, speed: 360 });
  spinHandle = handle;
  spinning = handle.active;
  updateSpinButton();
  if (!handle.active) return;

  spinTimer = setTimeout(() => {
    if (spinHandle !== handle) return;
    handle.stop();
    spinHandle = undefined;
    spinning = false;
    spinTimer = undefined;
    scene.transact([{
      type: "face",
      cardId: baseCard.id,
      face: cardState.faceUp ? "faceUp" : "faceDown",
      axis,
      angle: startingAngle,
    }], { immediate: true });
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

function scaleTo(factor, options) {
  setControls({ scale: factor });
  run([{ type: "scale", cardId: baseCard.id, factor }], options);
}

function normalizeAngle(angle) {
  return ((angle + 180) % 360 + 360) % 360 - 180;
}

let pendingChannels = new Set();
let pendingModes = new Map();
let controlsFrame;
function controlOperations(channels) {
  const operations = [];
  if (channels.has("move")) {
    operations.push({
      type: "move",
      cardId: baseCard.id,
      position: { x: Number(moveXSlider.value), y: Number(moveYSlider.value) },
    });
  }
  if (channels.has("rotate")) {
    operations.push({ type: "rotate", cardId: baseCard.id, angle: Number(rotateSlider.value) });
  }
  if (channels.has("scale")) {
    operations.push({ type: "scale", cardId: baseCard.id, factor: Number(scaleSlider.value) });
  }
  if (channels.has("flip")) {
    const flipX = Number(flipXSlider.value);
    const flipY = Number(flipYSlider.value);
    const faceUp = Math.cos(flipX * Math.PI / 180) * Math.cos(flipY * Math.PI / 180) >= 0;
    operations.push({
      type: "face",
      cardId: baseCard.id,
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
  const x = scene.snapshot().visual[0].pose.x > 300 ? 140 : 600;
  setControls({ x, y: 240 });
  run([{ type: "move", cardId: baseCard.id, position: { x, y: 240 } }]);
});

document.querySelector("#rotate").addEventListener("click", () => {
  const angle = normalizeAngle(currentCard().pose.angle + 45);
  setControls({ angle });
  run([{ type: "rotate", cardId: baseCard.id, angle }]);
});

document.querySelector("#scale").addEventListener("click", () => {
  const factor = currentCard().pose.scale > 1 ? 1 : 1.25;
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
  const face = currentCard().faceUp ? "faceDown" : "faceUp";
  setControls({ faceUp: face === "faceUp" });
  run([{
    type: "face",
    cardId: baseCard.id,
    face,
    axis: ["x", "y"],
    angle: { x: 0, y: face === "faceUp" ? 0 : 180 },
  }]);
});

spinButton.addEventListener("click", () => {
  if (spinning) {
    stopContinuousFlip();
    return;
  }
  spinHandle = scene.spin(baseCard.id, { axis: flipAxis.value, direction: 1, speed: 180 });
  spinning = spinHandle.active;
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
  run([
    { type: "move", cardId: baseCard.id, position: { x: 450, y: 240 } },
    { type: "rotate", cardId: baseCard.id, angle },
    { type: "scale", cardId: baseCard.id, factor: scale },
  ]);
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
