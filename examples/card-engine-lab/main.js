import { createCardScene } from "../../packages/card-engine/src/index.js";

const stage = document.querySelector("#stage");
const rendererStatus = document.querySelector("#renderer-status");
const status = document.querySelector("#status");
const fpsStatus = document.querySelector("#fps-status");
const pointerStatus = document.querySelector("#pointer-status");
const collectDiagnosticsButton = document.querySelector("#collect-diagnostics");
const runDiagnosticsBenchmarkButton = document.querySelector("#run-diagnostics-benchmark");
const recordDragButton = document.querySelector("#record-drag");
const copyDiagnosticsButton = document.querySelector("#copy-diagnostics");
const diagnosticsStatus = document.querySelector("#diagnostics-status");
const diagnosticsReport = document.querySelector("#diagnostics-report");
const cardList = document.querySelector("#card-list");
const addCardButton = document.querySelector("#add-card");
const removeCardsButton = document.querySelector("#remove-cards");
const selectAllButton = document.querySelector("#select-all");
const deselectAllButton = document.querySelector("#deselect-all");
const selectionStatus = document.querySelector("#selection-status");
const zoneList = document.querySelector("#zone-list");
const zoneSlot = document.querySelector("#zone-slot");
const spawnZone = document.querySelector("#spawn-zone");
const transferZoneButtons = [...document.querySelectorAll("[data-transfer-zone]")];
const dragEnabled = document.querySelector("#drag-enabled");
const touchDrag = document.querySelector("#drag-touch");
const dragDeniedZone = document.querySelector("#drag-denied-zone");
const dragResponse = document.querySelector("#drag-response");
const dragAcceptButton = document.querySelector("#drag-accept");
const dragRejectButton = document.querySelector("#drag-reject");
const interactionStatus = document.querySelector("#interaction-status");
const shape = document.querySelector("#shape");
const faceCount = document.querySelector("#face-count");
const cardSizing = document.querySelector("#card-sizing");
const cardWidthSlider = document.querySelector("#card-width");
const cardHeightSlider = document.querySelector("#card-height");
const cardThicknessSlider = document.querySelector("#card-thickness");
const reduced = document.querySelector("#reduced");
const moveXSlider = document.querySelector("#move-x");
const moveYSlider = document.querySelector("#move-y");
const motionSpeedSlider = document.querySelector("#motion-speed");
const rotateSlider = document.querySelector("#rotate-slider");
const scaleSlider = document.querySelector("#scale-slider");
const flipXSlider = document.querySelector("#flip-x-slider");
const flipYSlider = document.querySelector("#flip-y-slider");
const flipAxis = document.querySelector("#flip-axis");
const moveButton = document.querySelector("#move");
const rotateButton = document.querySelector("#rotate");
const scaleButton = document.querySelector("#scale");
const flipButton = document.querySelector("#flip");
const spinButton = document.querySelector("#spin");
const randomButton = document.querySelector("#random");
const animationTestButton = document.querySelector("#animation-test");
const moveXValue = document.querySelector("#move-x-value");
const moveYValue = document.querySelector("#move-y-value");
const motionSpeedValue = document.querySelector("#motion-speed-value");
const cardWidthValue = document.querySelector("#card-width-value");
const cardHeightValue = document.querySelector("#card-height-value");
const cardThicknessValue = document.querySelector("#card-thickness-value");
const rotateValue = document.querySelector("#rotate-value");
const scaleValue = document.querySelector("#scale-value");
const flipXValue = document.querySelector("#flip-x-value");
const flipYValue = document.querySelector("#flip-y-value");
const elementList = document.querySelector("#element-list");
const elementType = document.querySelector("#element-type");
const addElementButton = document.querySelector("#add-element");
const backgroundSide = document.querySelector("#background-side");
const backgroundImageInput = document.querySelector("#background-image");
const backgroundFit = document.querySelector("#background-fit");
const applyBackgroundButton = document.querySelector("#apply-background");
const backgroundPresets = Object.freeze({
  modern: { src: "/examples/card-engine-lab/assets/backgrounds/modern-abstract.jpg", fit: "cover" },
  fantasy: { src: "/examples/card-engine-lab/assets/backgrounds/fantasy-forest.jpg", fit: "cover" },
  "science-fiction": { src: "/examples/card-engine-lab/assets/backgrounds/science-fiction-space.jpg", fit: "cover" },
  simple: { src: "/examples/card-engine-lab/assets/backgrounds/simple-paper.jpg", fit: "cover" },
});
const LAB_CAMERA_CENTER = Object.freeze({ x: 450, y: 250 });
const LAB_CAMERA_UNITS_PER_PIXEL = 1;
// Keep 1× at the lab's original 1.5× timing; the factor still scales
// proportionally from that baseline (higher is faster, lower is slower).
const LAB_MOTION_DURATION = 500 / 1.5;
// Match the lab's single-column mobile layout. This is a spawn default,
// not a resize rule: existing cards retain their user-selected scale.
function isMobileViewport() {
  return matchMedia("(max-width: 640px)").matches;
}

function isTouchCapable() {
  return (navigator.maxTouchPoints ?? 0) > 0
    || "ontouchstart" in globalThis
    || matchMedia("(pointer: coarse)").matches;
}

function defaultCardScale() {
  return isMobileViewport() ? 0.5 : 1;
}
scaleSlider.value = String(defaultCardScale());
touchDrag.checked = isTouchCapable();
const LAB_ZONE_DEFINITIONS = Object.freeze([
  { id: "archive", label: "Lake", anchor: "#zone-archive", arrangement: { type: "grid", gap: 16 } },
  { id: "workbench", label: "Ocean", anchor: "#zone-workbench", arrangement: { type: "grid", gap: 16 } },
  { id: "reserve", label: "River", anchor: "#zone-reserve", arrangement: { type: "grid", gap: 16 } },
]);

function syncSpawnZoneColor() {
  spawnZone.dataset.zoneId = spawnZone.value;
}

syncSpawnZoneColor();

let fpsFrameCount = 0;
let fpsWindowStart = performance.now();
let dragDiagnosticArmed = false;
let dragDiagnosticCapture;
let lastDragDiagnosticSample = null;

function diagnosticsDistribution(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = (fraction) => finite.length
    ? finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * fraction))]
    : null;
  return {
    count: finite.length,
    medianMs: percentile(0.5) === null ? null : Number(percentile(0.5).toFixed(1)),
    p95Ms: percentile(0.95) === null ? null : Number(percentile(0.95).toFixed(1)),
    maxMs: finite.length ? Number(finite.at(-1).toFixed(1)) : null,
  };
}

function detectedBrowser() {
  const userAgent = navigator.userAgent;
  const brands = navigator.userAgentData?.brands ?? [];
  const brand = brands.find(({ brand: name }) => !/Not A Brand/i.test(name));
  const match = userAgent.match(/(?:Edg|OPR|Firefox|FxiOS|Version|HeadlessChrome|Chrome|CriOS)\/([\d.]+)/);
  let name = brand?.brand ?? "Unknown";
  if (/Edg\//.test(userAgent)) name = "Microsoft Edge";
  else if (/Firefox|FxiOS/.test(userAgent)) name = "Firefox";
  else if (/Safari/.test(userAgent) && /Version\//.test(userAgent)) name = "Safari";
  else if (/Chrome|CriOS|HeadlessChrome/.test(userAgent)) name = "Chrome";
  return { name, version: match?.[1] ?? brand?.version ?? null };
}

function dragDiagnosticPose(cardId) {
  const visual = scene?.snapshot?.().visual?.find(({ cardId: id }) => id === cardId);
  const pose = visual?.pose;
  return pose ? { x: pose.x, y: pose.y, z: pose.z ?? 0 } : null;
}

function dragDiagnosticCardAtPointer(event) {
  try {
    const point = scene?.clientToScene?.({ x: event.clientX, y: event.clientY });
    return point ? scene?.hitTest?.(point)?.cardId : undefined;
  } catch {
    return undefined;
  }
}

function sameDragDiagnosticPose(first, second) {
  return Boolean(first && second)
    && first.x === second.x
    && first.y === second.y
    && first.z === second.z;
}

function finishDragDiagnostic(reason) {
  const capture = dragDiagnosticCapture;
  if (!capture) return;
  capture.endedAt = performance.now();
  capture.endReason = reason;
  const frameIntervals = capture.frameTimes.slice(1).map((time, index) => time - capture.frameTimes[index]);
  const frameElapsedMs = capture.frameTimes.length > 1
    ? capture.frameTimes.at(-1) - capture.frameTimes[0]
    : 0;
  const finalState = scene?.snapshot?.();
  const finalSession = finalState?.interaction?.sessions?.find(({ primaryCardId }) => primaryCardId === capture.cardId);
  const finalZone = finalState?.desired?.zones?.find(({ cardIds = [] }) => cardIds.includes(capture.cardId));
  const outcomeText = interactionStatus.textContent ?? "";
  const outcome = outcomeText.startsWith("Drop accepted")
    ? "accepted"
    : outcomeText.startsWith("Drop rejected")
      ? "rejected"
      : outcomeText.startsWith("Drop cancelled") || outcomeText.startsWith("Drag cancelled")
        ? "cancelled"
        : null;
  lastDragDiagnosticSample = {
    capturedAt: new Date().toISOString(),
    cardId: capture.cardId,
    cardCount: finalState?.desired?.cards?.length ?? null,
    browser: detectedBrowser(),
    deviceModel: navigator.userAgentData?.model || null,
    pointerType: capture.pointerType,
    sourceZoneId: capture.sourceZoneId,
    outcome,
    accepted: outcome === "accepted" ? true : outcome === "rejected" ? false : null,
    durationMs: Number((capture.endedAt - capture.startedAt).toFixed(1)),
    pointerEvents: capture.pointerEvents,
    pointerMoves: capture.pointerMoves,
    frames: capture.frameTimes.length,
    fps: Number((frameElapsedMs > 0 ? (capture.frameTimes.length - 1) * 1000 / frameElapsedMs : 0).toFixed(1)),
    observedMotionFrames: capture.observedMotionFrames,
    frameIntervals: diagnosticsDistribution(frameIntervals),
    missedFramesOver20Ms: frameIntervals.filter((interval) => interval > 20).length,
    eventToNextObservedRaf: diagnosticsDistribution(capture.eventToNextObservedRaf),
    unmatchedPointerMoves: capture.pointerMoves - capture.eventToNextObservedRaf.length,
    endReason: capture.endReason,
    finalInteractionPhase: finalSession?.phase ?? null,
    finalZoneId: finalZone?.id ?? null,
  };
  dragDiagnosticCapture = undefined;
  dragDiagnosticArmed = false;
  recordDragButton.textContent = "Record next drag";
  recordDragButton.setAttribute("aria-pressed", "false");
  void refreshDiagnostics("Drag sample captured; report refreshed.");
}

function captureDragDiagnosticFrame(now) {
  const capture = dragDiagnosticCapture;
  if (!capture) return;
  capture.frameTimes.push(now);
  const pose = dragDiagnosticPose(capture.cardId);
  if (pose && !sameDragDiagnosticPose(pose, capture.lastPose)) {
    capture.observedMotionFrames += 1;
    if (capture.pendingMoveAt !== null) {
      capture.eventToNextObservedRaf.push(performance.now() - capture.pendingMoveAt);
      capture.pendingMoveAt = null;
    }
  }
  capture.lastPose = pose;
}

function observeDragDiagnosticPointer(event) {
  const capture = dragDiagnosticCapture;
  if (!capture || event.pointerId !== capture.pointerId) return;
  capture.pointerEvents += 1;
  if (event.type === "pointermove") {
    capture.pointerMoves += 1;
    capture.pendingMoveAt = performance.now();
  }
  if (event.type === "pointerup") {
    capture.finishTimer = setTimeout(() => finishDragDiagnostic("pointerup"), 250);
  } else if (event.type === "pointercancel") {
    capture.finishTimer = setTimeout(() => finishDragDiagnostic("pointercancel"), 100);
  }
}

function armDragDiagnostic() {
  if (dragDiagnosticCapture) return;
  dragDiagnosticArmed = !dragDiagnosticArmed;
  recordDragButton.textContent = dragDiagnosticArmed ? "Waiting for drag…" : "Record next drag";
  recordDragButton.setAttribute("aria-pressed", String(dragDiagnosticArmed));
  diagnosticsStatus.textContent = dragDiagnosticArmed
    ? "Ready: drag one card with a mouse, pen, or touch contact."
    : "Drag capture cancelled.";
}

function updateFps(now) {
  fpsFrameCount += 1;
  captureDragDiagnosticFrame(now);
  const elapsed = now - fpsWindowStart;
  if (elapsed >= 500) {
    const fps = fpsFrameCount * 1000 / elapsed;
    fpsStatus.textContent = `FPS: ${fps.toFixed(0)}`;
    fpsStatus.dataset.fps = fps.toFixed(1);
    fpsFrameCount = 0;
    fpsWindowStart = now;
  }
  requestAnimationFrame(updateFps);
}
requestAnimationFrame(updateFps);

const logicalFaceDefinitions = [
  {
    id: "face-a",
    elements: [
      { id: "title", type: "text", content: { text: "The Cardinal" }, style: { variant: "title" }, layout: { mode: "flow", order: 0 } },
      { id: "image", type: "image", content: { src: "/examples/card-engine-lab/cardinal.png", alt: "A stylized red cardinal" }, layout: { mode: "flow", order: 1 } },
      { id: "flavour", type: "text", content: { text: "One card from the new independent engine." }, style: { variant: "flavour" }, layout: { mode: "flow", order: 2 } },
    ],
    background: "#f4c95d",
  },
  {
    id: "face-b",
    elements: [
      { id: "title", type: "text", content: { text: "Face B" }, style: { variant: "title" }, layout: { mode: "flow", order: 0 } },
      { id: "flavour", type: "text", content: { text: "The second logical face." }, style: { variant: "flavour" }, layout: { mode: "flow", order: 1 } },
    ],
    background: "#367c83",
    textColor: "#f7f4e9",
    mutedTextColor: "#c5e4df",
  },
  {
    id: "face-c",
    elements: [
      { id: "title", type: "text", content: { text: "Face C" }, style: { variant: "title" }, layout: { mode: "flow", order: 0 } },
      { id: "flavour", type: "text", content: { text: "The third logical face." }, style: { variant: "flavour" }, layout: { mode: "flow", order: 1 } },
    ],
    background: "#a85f3f",
    textColor: "#f7f4e9",
    mutedTextColor: "#f3d7b8",
  },
  {
    id: "face-d",
    elements: [
      { id: "title", type: "text", content: { text: "Face D" }, style: { variant: "title" }, layout: { mode: "flow", order: 0 } },
      { id: "flavour", type: "text", content: { text: "The fourth logical face." }, style: { variant: "flavour" }, layout: { mode: "flow", order: 1 } },
    ],
    background: "#367c83",
    textColor: "#f7f4e9",
    mutedTextColor: "#c5e4df",
  },
  {
    id: "face-e",
    elements: [
      { id: "title", type: "text", content: { text: "Face E" }, style: { variant: "title" }, layout: { mode: "flow", order: 0 } },
      { id: "flavour", type: "text", content: { text: "The fifth logical face." }, style: { variant: "flavour" }, layout: { mode: "flow", order: 1 } },
    ],
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
    elements: [
      { id: "title", type: "text", content: { text: "Card back" }, style: { variant: "title" }, layout: { mode: "flow", order: 0 } },
      { id: "flavour", type: "text", content: { text: "The back of the card." }, style: { variant: "flavour" }, layout: { mode: "flow", order: 1 } },
    ],
    background: "#17212b",
    textColor: "#f7f4e9",
    mutedTextColor: "#bdcbd0",
  },
  template: "illustrated",
};

let cardZoneIds = new Map([[baseCard.id, "reserve"]]);
let spawnZoneAuto = true;

let selectedCardIds = new Set([baseCard.id]);
let nextCardNumber = 2;
let nextElementNumber = 1;
let renderedElementKey;
let scene;
let interactionLifecycle;
let lastDiagnosticsBenchmark = [];
let zoneVisibility = new Map(LAB_ZONE_DEFINITIONS.map(({ id }) => [id, true]));

export function getScene() {
  return scene;
}

function webglDiagnosticValues(canvas) {
  let context;
  try {
    context = canvas?.getContext("webgl2") ?? null;
  } catch {
    context = null;
  }
  if (!context) return { available: false };
  const safeParameter = (parameter) => {
    try {
      const value = context.getParameter(parameter);
      return ArrayBuffer.isView(value) ? [...value] : value;
    } catch {
      return null;
    }
  };
  const debugInfo = (() => {
    try {
      return context.getExtension("WEBGL_debug_renderer_info");
    } catch {
      return null;
    }
  })();
  return {
    available: true,
    version: safeParameter(context.VERSION),
    shadingLanguageVersion: safeParameter(context.SHADING_LANGUAGE_VERSION),
    vendor: safeParameter(debugInfo?.UNMASKED_VENDOR_WEBGL ?? context.VENDOR),
    renderer: safeParameter(debugInfo?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER),
    antialias: context.getContextAttributes?.()?.antialias ?? null,
    maxTextureSize: safeParameter(context.MAX_TEXTURE_SIZE),
    maxRenderbufferSize: safeParameter(context.MAX_RENDERBUFFER_SIZE),
    maxViewportDimensions: safeParameter(context.MAX_VIEWPORT_DIMS),
    maxTextureImageUnits: safeParameter(context.MAX_TEXTURE_IMAGE_UNITS),
    extensionCount: context.getSupportedExtensions?.()?.length ?? null,
  };
}

async function collectDiagnostics() {
  const state = scene?.snapshot();
  const canvas = stage.querySelector(".cardinal-webgl-canvas");
  const stageRect = stage.getBoundingClientRect();
  const uaData = navigator.userAgentData;
  let highEntropy = null;
  try {
    highEntropy = await uaData?.getHighEntropyValues?.(["architecture", "bitness", "model", "platformVersion", "uaFullVersion"]);
  } catch {
    highEntropy = null;
  }
  return {
    collectedAt: new Date().toISOString(),
    browser: {
      userAgent: navigator.userAgent,
      platform: navigator.platform ?? null,
      language: navigator.language,
      userAgentData: uaData ? {
        brands: uaData.brands,
        mobile: uaData.mobile,
        platform: uaData.platform,
        highEntropy,
      } : null,
    },
    device: {
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGiB: navigator.deviceMemory ?? null,
      model: highEntropy?.model || uaData?.model || null,
      devicePixelRatio: globalThis.devicePixelRatio ?? 1,
      screen: {
        width: globalThis.screen?.width ?? null,
        height: globalThis.screen?.height ?? null,
        colorDepth: globalThis.screen?.colorDepth ?? null,
        refreshRateHz: globalThis.screen?.refreshRate ?? null,
      },
      prefersReducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      visibilityState: document.visibilityState,
    },
    viewport: {
      windowCss: { width: innerWidth, height: innerHeight },
      stageCss: { width: Number(stageRect.width.toFixed(1)), height: Number(stageRect.height.toFixed(1)) },
      canvasPixels: canvas ? { width: canvas.width, height: canvas.height } : null,
    },
    webgl: webglDiagnosticValues(canvas),
    lab: {
      renderer: state?.renderer ?? null,
      rendererReason: state?.rendererReason ?? null,
      cards: state?.desired.cards.length ?? 0,
      selectedCards: selectedCardIds.size,
      currentFps: fpsStatus.dataset.fps ? Number(fpsStatus.dataset.fps) : null,
      currentFpsLabel: fpsStatus.textContent,
      dragCapture: {
        armed: dragDiagnosticArmed,
        active: Boolean(dragDiagnosticCapture),
        lastSample: lastDragDiagnosticSample,
      },
      benchmark: lastDiagnosticsBenchmark,
    },
  };
}

async function refreshDiagnostics(message = "Report refreshed.") {
  diagnosticsStatus.textContent = "Collecting diagnostics…";
  const report = await collectDiagnostics();
  diagnosticsReport.textContent = JSON.stringify(report, null, 2);
  diagnosticsReport.dataset.report = diagnosticsReport.textContent;
  diagnosticsStatus.textContent = message;
  return report;
}

async function runDiagnosticsBenchmark() {
  if (!scene || runDiagnosticsBenchmarkButton.disabled) return;
  runDiagnosticsBenchmarkButton.disabled = true;
  collectDiagnosticsButton.disabled = true;
  copyDiagnosticsButton.disabled = true;
  diagnosticsStatus.textContent = "Running 1-, 5-, and 10-card random-motion tests…";
  const originalCards = structuredClone(scene.snapshot().desired.cards);
  const originalSelection = [...selectedCardIds];
  const benchmarkResults = [];
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  try {
    stopRandomMotion();
    stopDemoAnimations();
    const source = structuredClone(originalCards[0] ?? initialCards()[0]);
    for (const count of [1, 5, 10]) {
      const cards = [];
      for (let index = 0; index < count; index += 1) {
        cards.push({
          ...structuredClone(source),
          id: `diagnostics-card-${index + 1}`,
          positionMode: "absolute",
          pose: { ...structuredClone(source.pose ?? {}), ...nextCardPosition(cards), scale: 1 },
        });
      }
      selectedCardIds = new Set(cards.map(({ id }) => id));
      applyLabCards(cards);
      selectedCardIds = new Set(scene.select([...selectedCardIds]).cardIds);
      renderCardList();
      updateStatus();
      await sleep(1000);
      toggleRandomMotion();
      const frameTimes = [];
      const sampleStart = performance.now();
      await new Promise((resolve) => {
        const sample = (now) => {
          frameTimes.push(now);
          if (now - sampleStart < 1500) requestAnimationFrame(sample);
          else resolve();
        };
        requestAnimationFrame(sample);
      });
      stopRandomMotion();
      await sleep(900);
      const intervals = frameTimes.slice(1).map((time, index) => time - frameTimes[index]);
      const sorted = [...intervals].sort((a, b) => a - b);
      const percentile = (values, fraction) => values.length
        ? values[Math.min(values.length - 1, Math.floor(values.length * fraction))]
        : 0;
      const elapsedMs = frameTimes.length > 1 ? frameTimes.at(-1) - frameTimes[0] : 0;
      benchmarkResults.push({
        cards: count,
        fps: Number((elapsedMs > 0 ? (frameTimes.length - 1) * 1000 / elapsedMs : 0).toFixed(1)),
        frames: frameTimes.length,
        medianFrameMs: Number(percentile(sorted, 0.5).toFixed(1)),
        p95FrameMs: Number(percentile(sorted, 0.95).toFixed(1)),
        missedFramesOver20Ms: intervals.filter((interval) => interval > 20).length,
      });
    }
    lastDiagnosticsBenchmark = benchmarkResults;
    await refreshDiagnostics("Benchmark complete; the lab state was restored.");
  } catch (error) {
    diagnosticsStatus.textContent = `Benchmark failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    stopRandomMotion();
    stopDemoAnimations();
    selectedCardIds = new Set(originalSelection);
    applyLabCards(originalCards);
    runDiagnosticsBenchmarkButton.disabled = false;
    collectDiagnosticsButton.disabled = false;
    copyDiagnosticsButton.disabled = false;
  }
}

function sortedPointerElements(content) {
  return (content?.elements ?? [])
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => element.visible !== false || element.visibilityMode === "preserve-space")
    .sort((first, second) => (first.element.layout?.order ?? first.index) - (second.element.layout?.order ?? second.index));
}

function pointerTextLineCount(element, width) {
  const text = element.content?.text ?? element.content?.value ?? "";
  const style = element.style ?? {};
  const isTitle = style.variant === "title" || element.id === "title";
  const font = style.font ?? (isTitle ? "700 18.4px system-ui, sans-serif" : "14.4px system-ui, sans-serif");
  const context = document.createElement("canvas").getContext("2d");
  context.font = font;
  return String(text).split("\n").reduce((total, paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) return total + 1;
    let lines = 1;
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > width) {
        lines += 1;
        line = word;
      } else {
        line = candidate;
      }
    }
    return total + lines;
  }, 0);
}

function pointerElementAt(card, pose, content, localX, localTop) {
  const width = pose.width;
  const height = pose.height;
  const inner = 18;
  const innerWidth = Math.max(1, width - inner * 2);
  let cursor = inner;
  for (const { element } of sortedPointerElements(content)) {
    const layout = element.layout ?? {};
    if (layout.mode === "overlay") continue;
    const elementHeight = element.type === "image"
      ? (layout.height ? height * layout.height : 120)
      : pointerTextLineCount(element, innerWidth) * (element.style?.lineHeight ?? (element.id === "title" ? 21 : 20));
    if (element.visible !== false && localX >= inner && localX <= inner + innerWidth
      && localTop >= cursor && localTop <= cursor + elementHeight) {
      return { id: element.id, type: element.type };
    }
    cursor += elementHeight + 10;
  }
  for (const { element } of sortedPointerElements(content)) {
    const layout = element.layout ?? {};
    if (layout.mode !== "overlay" || element.visible === false) continue;
    const x = (layout.x ?? 0) * width;
    const y = (layout.y ?? 0) * height;
    const elementWidth = (layout.width ?? 0.5) * width;
    const elementHeight = (layout.height ?? 0.2) * height;
    if (localX >= x && localX <= x + elementWidth && localTop >= y && localTop <= y + elementHeight) {
      return { id: element.id, type: element.type };
    }
  }
  return undefined;
}

function stagePointerTarget(sceneX, sceneY) {
  const state = scene?.snapshot();
  if (!state) return { kind: "stage", label: "Card stage" };
  const engineHit = scene.hitTest({ x: sceneX, y: sceneY });
  const candidates = state.visual
    .map((visual) => ({
      visual,
      card: state.desired.cards.find((candidate) => candidate.id === visual.cardId),
    }))
    .filter(({ card, visual }) => card && visual.pose)
    .map(({ card, visual }) => {
      const pose = visual.pose;
      const scale = pose.scale ?? 1;
      const dx = (sceneX - pose.x) / scale;
      const dy = (sceneY - pose.y) / scale;
      const angle = (pose.angle ?? 0) * Math.PI / 180;
      const localX = Math.cos(angle) * dx + Math.sin(angle) * dy;
      const localY = -Math.sin(angle) * dx + Math.cos(angle) * dy;
      return { card, pose, visual, localX, localTop: pose.height / 2 - localY };
    })
    .filter(({ pose, localX, localTop, card }) => engineHit?.cardId === card.id
      && Math.abs(localX) <= pose.width / 2 && localTop >= 0 && localTop <= pose.height)
    .sort((first, second) => (second.pose.drawOrder ?? 0) - (first.pose.drawOrder ?? 0));
  const hit = candidates[0];
  if (!hit) return { kind: "stage", label: "Empty card stage" };
  const cardIndex = state.desired.cards.findIndex(({ id }) => id === hit.card.id) + 1;
  const side = engineHit?.side ?? hit.visual.physicalSide ?? "unknown";
  if (side === "edge") return { kind: "card", cardId: hit.card.id, label: `Card ${cardIndex} · edge` };
  const content = side === "back"
    ? hit.card.back
    : hit.card.faces?.[hit.card.faceCycleNextFaceId ?? hit.card.activeFaceId];
  const element = pointerElementAt(hit.card, hit.pose, content, hit.localX + hit.pose.width / 2, hit.localTop);
  return {
    kind: element ? "card-element" : "card",
    cardId: hit.card.id,
    elementId: element?.id,
    elementType: element?.type,
    side,
    label: element ? `Card ${cardIndex} · ${side} · ${element.id}` : `Card ${cardIndex} · ${side}`,
  };
}

function pagePointerTarget(event, sceneX, sceneY) {
  const element = document.elementFromPoint(event.clientX, event.clientY);
  if (element && stage.contains(element)) return stagePointerTarget(sceneX, sceneY);
  if (!element) return { kind: "page", label: "Page" };
  const control = element.closest("button, input, select, textarea, label, fieldset, [role=button], [role=group]");
  if (!control) return { kind: "page", label: element.id ? `#${element.id}` : element.tagName.toLowerCase() };
  const label = control.getAttribute("aria-label")
    ?? control.labels?.[0]?.textContent?.trim()
    ?? control.querySelector("legend")?.textContent?.trim()
    ?? control.textContent?.trim().replace(/\s+/g, " ");
  return { kind: "control", label: label || control.tagName.toLowerCase(), id: control.id || undefined };
}

function setPointerStatus(state) {
  pointerStatus.dataset.pointerState = JSON.stringify(state);
  if (state.status === "not-observed") {
    pointerStatus.textContent = "Pointer: not observed yet";
    return;
  }
  const viewport = `viewport x ${state.viewportX} · y ${state.viewportY}`;
  if (!state.insideStage) {
    pointerStatus.textContent = `Pointer: ${viewport} · outside stage · target ${state.target?.label ?? "page"}`;
    return;
  }
  pointerStatus.textContent = `Pointer: ${viewport} · scene x ${state.sceneX} · y ${state.sceneY} · target ${state.target?.label ?? "stage"}`;
}

function updatePointerStatus(event) {
  const rect = stage.getBoundingClientRect();
  const viewport = scene?.viewport?.() ?? {
    width: rect.width / LAB_CAMERA_UNITS_PER_PIXEL,
    height: rect.height / LAB_CAMERA_UNITS_PER_PIXEL,
    center: LAB_CAMERA_CENTER,
  };
  const insideStage = event.clientX >= rect.left
    && event.clientX <= rect.right
    && event.clientY >= rect.top
    && event.clientY <= rect.bottom;
  const sceneX = Math.round(viewport.center.x - viewport.width / 2 + ((event.clientX - rect.left) / rect.width) * viewport.width);
  const sceneY = Math.round(viewport.center.y - viewport.height / 2 + ((event.clientY - rect.top) / rect.height) * viewport.height);
  setPointerStatus({
    status: "observed",
    insideStage,
    viewportX: Math.round(event.clientX),
    viewportY: Math.round(event.clientY),
    sceneX,
    sceneY,
    target: pagePointerTarget(event, sceneX, sceneY),
  });
}

function visibleWorldBounds() {
  const view = scene?.viewport?.();
  const stageRect = stage.getBoundingClientRect();
  const viewport = view ?? {
    width: stageRect.width / LAB_CAMERA_UNITS_PER_PIXEL,
    height: stageRect.height / LAB_CAMERA_UNITS_PER_PIXEL,
    center: LAB_CAMERA_CENTER,
  };
  return {
    left: viewport.center.x - viewport.width / 2,
    right: viewport.center.x + viewport.width / 2,
    top: viewport.center.y - viewport.height / 2,
    bottom: viewport.center.y + viewport.height / 2,
    centerX: viewport.center.x,
    centerY: viewport.center.y,
  };
}

function updateMoveControlBounds(state = scene?.snapshot()) {
  const bounds = visibleWorldBounds();
  const selected = state?.desired?.cards?.filter(({ id }) => selectedCardIds.has(id)) ?? [];
  const xValues = selected.map(({ pose }) => pose?.x).filter(Number.isFinite);
  const yValues = selected.map(({ pose }) => pose?.y).filter(Number.isFinite);
  const minX = Math.floor(Math.min(bounds.left, ...xValues));
  const maxX = Math.ceil(Math.max(bounds.right, ...xValues));
  const minY = Math.floor(Math.min(bounds.top, ...yValues));
  const maxY = Math.ceil(Math.max(bounds.bottom, ...yValues));
  moveXSlider.min = String(minX);
  moveXSlider.max = String(maxX);
  moveYSlider.min = String(minY);
  moveYSlider.max = String(maxY);
}

function movePresetPosition(preset) {
  const bounds = visibleWorldBounds();
  const x = preset === "left" ? bounds.left : preset === "right" ? bounds.right : bounds.centerX;
  const y = preset === "top" ? bounds.top : preset === "bottom" ? bounds.bottom : bounds.centerY;
  return { x: Math.round(x), y: Math.round(y) };
}

window.addEventListener("pointermove", updatePointerStatus, { passive: true });
document.addEventListener("mouseleave", () => setPointerStatus({ status: "not-observed" }));
setPointerStatus({ status: "not-observed" });

function mergeFace(defaultFace, sourceFace = {}) {
  const defaults = defaultFace.elements ?? [];
  const sourceElements = sourceFace.elements ?? [];
  const sourceById = new Map(sourceElements.map((element) => [element.id, element]));
  const elements = defaults.map((element) => {
    const override = sourceById.get(element.id);
    if (!override) return structuredClone(element);
    return {
      ...structuredClone(element),
      ...structuredClone(override),
      content: { ...element.content, ...override.content },
      layout: { ...element.layout, ...override.layout },
      style: { ...element.style, ...override.style },
    };
  });
  const extras = sourceElements.filter((element) => !defaults.some(({ id }) => id === element.id)).map((element) => structuredClone(element));
  return { ...defaultFace, ...sourceFace, elements: [...elements, ...extras] };
}

function configuredCard(sourceCard) {
  const faces = logicalFaceDefinitions.slice(0, Number(faceCount.value)).map((face) => ({
    ...mergeFace(face, sourceCard.faces?.[face.id]),
  }));
  const card = {
    ...sourceCard,
    faces: Object.fromEntries(faces.map((face) => [face.id, face])),
    template: shape.value,
    sizing: cardSizing.value === "content" ? { mode: "content", minHeight: 120, maxHeight: 480 } : { mode: "fixed" },
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

function zoneSnapshot(cards) {
  const cardIds = new Set(cards.map(({ id }) => id));
  for (const id of cardZoneIds.keys()) {
    if (!cardIds.has(id)) cardZoneIds.delete(id);
  }
  const memberships = new Map(LAB_ZONE_DEFINITIONS.map(({ id }) => [id, []]));
  for (const card of cards) {
    const zoneId = memberships.has(cardZoneIds.get(card.id)) ? cardZoneIds.get(card.id) : "reserve";
    cardZoneIds.set(card.id, zoneId);
    memberships.get(zoneId).push(card.id);
  }
  return LAB_ZONE_DEFINITIONS.map(({ id, label, anchor, geometry, arrangement }) => ({
    id,
    label,
    ...(anchor ? { anchor } : { geometry }),
    cardIds: memberships.get(id),
    arrangement,
    visible: zoneVisibility.get(id) !== false,
  }));
}

function desiredSnapshot(cards = sceneCards()) {
  return {
    cards: cards.map(configuredCard),
    zones: zoneSnapshot(cards),
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
  const candidate = { ...baseCard, pose: { ...LAB_CAMERA_CENTER, scale } };
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
      const position = { x: LAB_CAMERA_CENTER.x + x * stepX, y: LAB_CAMERA_CENTER.y + y * stepY };
      const placed = { ...candidate, pose: { ...candidate.pose, ...position } };
      if (!cards.some((card) => footprintsOverlap(card, placed, gap))) return position;
    }
  }
  return { x: LAB_CAMERA_CENTER.x + cards.length * (size.width + gap), y: LAB_CAMERA_CENTER.y };
}

function currentCard(state = scene.snapshot()) {
  return state.desired.cards.find(({ id }) => selectedCardIds.has(id));
}

let spinHandles = new Map();
let spinTimer;
let spinning = false;
let randomTimer;
let randomGeneration = 0;
let randomMotion = false;
let demoFrame;
let demoFrameTime;
let demoTransaction = false;
let moveAnimation;
let rotateAnimation;
let scaleAnimation;
let flipAnimation;
let flipGeneration = 0;
let animationTestGeneration = 0;
let animationTestRunning = false;

function activeMotionLabels() {
  return [
    moveAnimation && "move",
    rotateAnimation && "rotate",
    scaleAnimation && "scale",
    flipAnimation && "flip",
    spinning && "spin",
    randomMotion && "random motion",
  ].filter(Boolean);
}

function updateDemoButtons() {
  const buttons = [
    [moveButton, moveAnimation, "Move"],
    [rotateButton, rotateAnimation, "Rotate"],
    [scaleButton, scaleAnimation, "Scale"],
    [flipButton, flipAnimation, "Flip"],
  ];
  for (const [button, active, label] of buttons) {
    button.textContent = active ? "Stop" : label;
    button.setAttribute("aria-pressed", String(Boolean(active)));
  }
}

function stopDemoFrame() {
  if (demoFrame !== undefined) cancelAnimationFrame(demoFrame);
  demoFrame = undefined;
  demoFrameTime = undefined;
}

function stopMoveAnimation() {
  moveAnimation = undefined;
  updateDemoButtons();
  if (!rotateAnimation && !scaleAnimation) stopDemoFrame();
}

function stopRotateAnimation() {
  rotateAnimation = undefined;
  updateDemoButtons();
  if (!moveAnimation && !scaleAnimation) stopDemoFrame();
}

function stopScaleAnimation() {
  scaleAnimation = undefined;
  updateDemoButtons();
  if (!moveAnimation && !rotateAnimation) stopDemoFrame();
}

function stopDemoAnimations() {
  stopMoveAnimation();
  stopRotateAnimation();
  stopScaleAnimation();
  stopFlipAnimation();
}

function bouncePosition(value, velocity, minimum, maximum) {
  if (maximum <= minimum) return { value: minimum, velocity: 0 };
  let nextValue = value;
  let nextVelocity = velocity;
  while (nextValue < minimum || nextValue > maximum) {
    if (nextValue < minimum) {
      nextValue = minimum + (minimum - nextValue);
      nextVelocity = Math.abs(nextVelocity);
    } else if (nextValue > maximum) {
      nextValue = maximum - (nextValue - maximum);
      nextVelocity = -Math.abs(nextVelocity);
    }
  }
  return { value: nextValue, velocity: nextVelocity };
}

function movementBounds(card, pose) {
  const width = (card.dimensions?.width ?? 180) * (pose.scale ?? 1);
  const height = (card.dimensions?.height ?? 250) * (pose.scale ?? 1);
  const angle = (pose.angle ?? 0) * Math.PI / 180;
  const halfWidth = (Math.abs(Math.cos(angle) * width) + Math.abs(Math.sin(angle) * height)) / 2;
  const halfHeight = (Math.abs(Math.sin(angle) * width) + Math.abs(Math.cos(angle) * height)) / 2;
  const stageBounds = visibleWorldBounds();
  return {
    left: Math.min(stageBounds.right, stageBounds.left + halfWidth),
    right: Math.max(stageBounds.left, stageBounds.right - halfWidth),
    top: Math.min(stageBounds.bottom, stageBounds.top + halfHeight),
    bottom: Math.max(stageBounds.top, stageBounds.bottom - halfHeight),
  };
}

function ensureDemoFrame() {
  if (demoFrame !== undefined) return;
  demoFrameTime = performance.now();
  demoFrame = requestAnimationFrame(runDemoFrame);
}

function runDemoFrame(time) {
  demoFrame = undefined;
  if (!scene || (!moveAnimation && !rotateAnimation && !scaleAnimation)) return;
  const elapsed = Math.min(0.05, Math.max(0, (time - (demoFrameTime ?? time)) / 1000));
  demoFrameTime = time;
  const state = scene.snapshot();
  const operations = [];
  const live = (cardId) => state.visual.find(({ cardId: visualCardId }) => visualCardId === cardId)?.pose;

  if (moveAnimation) {
    for (const [cardId, velocity] of moveAnimation.cards) {
      const card = state.desired.cards.find(({ id }) => id === cardId);
      const pose = live(cardId);
      if (!card || !pose) {
        moveAnimation.cards.delete(cardId);
        continue;
      }
      const bounds = movementBounds(card, pose);
      const x = bouncePosition(pose.x + velocity.x * elapsed, velocity.x, bounds.left, bounds.right);
      const y = bouncePosition(pose.y + velocity.y * elapsed, velocity.y, bounds.top, bounds.bottom);
      velocity.x = x.velocity;
      velocity.y = y.velocity;
      operations.push({ type: "move", cardId, position: { x: x.value, y: y.value } });
    }
    if (moveAnimation.cards.size === 0) stopMoveAnimation();
  }
  if (rotateAnimation) {
    for (const cardId of rotateAnimation) {
      const pose = live(cardId);
      if (!pose) {
        rotateAnimation.delete(cardId);
        continue;
      }
      operations.push({ type: "rotate", cardId, angle: normalizeAngle(pose.angle + 120 * elapsed * Number(motionSpeedSlider.value)) });
    }
    if (rotateAnimation.size === 0) stopRotateAnimation();
  }
  if (scaleAnimation) {
    for (const [cardId, direction] of scaleAnimation) {
      const pose = live(cardId);
      if (!pose) {
        scaleAnimation.delete(cardId);
        continue;
      }
      const nextScale = pose.scale + direction * elapsed * 0.5 * Number(motionSpeedSlider.value);
      if (nextScale >= 1.5) {
        scaleAnimation.set(cardId, -1);
        operations.push({ type: "scale", cardId, factor: 1.5 });
      } else if (nextScale <= 0.75) {
        scaleAnimation.set(cardId, 1);
        operations.push({ type: "scale", cardId, factor: 0.75 });
      } else {
        operations.push({ type: "scale", cardId, factor: nextScale });
      }
    }
    if (scaleAnimation.size === 0) stopScaleAnimation();
  }
  if (operations.length > 0) {
    demoTransaction = true;
    try {
      scene.transact(operations, { immediate: true });
    } finally {
      demoTransaction = false;
    }
  }
  if (moveAnimation || rotateAnimation || scaleAnimation) ensureDemoFrame();
}

function startMoveAnimation() {
  const state = scene.snapshot();
  const cards = selectedVisualEntries(state);
  if (cards.length === 0) return false;
  moveAnimation = { cards: new Map(cards.map(({ card }) => {
    const direction = randomBetween(0, Math.PI * 2);
    const speed = randomBetween(130, 210);
    return [card.id, { x: Math.cos(direction) * speed, y: Math.sin(direction) * speed }];
  })) };
  updateDemoButtons();
  ensureDemoFrame();
  return true;
}

function startRotateAnimation() {
  const cards = selectedCardIdsArray();
  if (cards.length === 0) return false;
  rotateAnimation = new Set(cards);
  updateDemoButtons();
  ensureDemoFrame();
  return true;
}

function startScaleAnimation() {
  const cards = selectedVisualEntries();
  if (cards.length === 0) return false;
  scaleAnimation = new Map(cards.map(({ card, visual }) => [
    card.id,
    visual.pose.scale >= 1.5 ? -1 : 1,
  ]));
  updateDemoButtons();
  ensureDemoFrame();
  return true;
}

function startFlipAnimation() {
  const cards = selectedCardIdsArray();
  if (cards.length === 0) return false;
  const generation = ++flipGeneration;
  flipAnimation = { generation, cardIds: cards };
  updateDemoButtons();
  runFlipCycle(generation);
  return true;
}

async function runFlipCycle(generation) {
  if (!flipAnimation || flipAnimation.generation !== generation || !scene) return;
  const state = scene.snapshot();
  const operations = flipAnimation.cardIds
    .filter((cardId) => state.desired.cards.some(({ id }) => id === cardId))
    .map((cardId) => toggleFaceOperation(cardId, state, flipAxis.value));
  if (operations.length === 0) {
    stopFlipAnimation();
    return;
  }
  try {
    await scene.transact(operations).finished;
  } catch {
    return;
  }
  if (flipAnimation?.generation === generation) {
    flipAnimation.timer = setTimeout(() => runFlipCycle(generation), 700 / Number(motionSpeedSlider.value));
  }
}

function stopFlipAnimation() {
  if (flipAnimation?.timer) clearTimeout(flipAnimation.timer);
  flipGeneration += 1;
  flipAnimation = undefined;
  updateDemoButtons();
}

function updateRandomButton() {
  randomButton.textContent = randomMotion ? "Stop" : "Random";
  randomButton.setAttribute("aria-pressed", String(randomMotion));
}

function stopRandomMotion() {
  randomGeneration += 1;
  if (randomTimer) clearTimeout(randomTimer);
  randomTimer = undefined;
  randomMotion = false;
  updateRandomButton();
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomMoveTarget(card, pose, bounds) {
  pose ??= card.pose ?? {};
  const scale = pose.scale ?? 1;
  const halfWidth = ((card.dimensions?.width ?? 180) * scale) / 2;
  const halfHeight = ((card.dimensions?.height ?? 250) * scale) / 2;
  const left = Math.min(bounds.right, bounds.left + halfWidth);
  const right = Math.max(bounds.left, bounds.right - halfWidth);
  const top = Math.min(bounds.bottom, bounds.top + halfHeight);
  const bottom = Math.max(bounds.top, bounds.bottom - halfHeight);
  return {
    x: Math.round(randomBetween(left, right)),
    y: Math.round(randomBetween(top, bottom)),
  };
}

async function runRandomCycle(generation) {
  if (!randomMotion || generation !== randomGeneration) return;
  const cards = selectedCards();
  if (cards.length === 0) {
    randomTimer = setTimeout(() => runRandomCycle(generation), 200);
    return;
  }
  const bounds = visibleWorldBounds();
  const state = scene.snapshot();
  const operations = cards.flatMap((card) => {
    const visual = state.visual.find(({ cardId }) => cardId === card.id);
    const pose = visual?.pose ?? card.pose ?? {};
    const move = randomMoveTarget(card, pose, bounds);
    const angle = normalizeAngle((pose.angle ?? 0) + randomBetween(90, 360) * (Math.random() < 0.5 ? -1 : 1));
    const axis = Math.random() < 0.5 ? "x" : "y";
    return [
      { type: "move", cardId: card.id, position: move },
      { type: "rotate", cardId: card.id, angle },
      toggleFaceOperation(card.id, state, axis),
    ];
  });
  try {
    await scene.transact(operations).finished;
  } catch (error) {
    if (randomMotion && generation === randomGeneration) console.error("Cardinal random motion stopped", error);
    return;
  }
  if (randomMotion && generation === randomGeneration) randomTimer = setTimeout(() => runRandomCycle(generation), 0);
}

function toggleRandomMotion() {
  if (randomMotion) {
    stopRandomMotion();
    return;
  }
  stopDemoAnimations();
  randomGeneration += 1;
  randomMotion = true;
  updateRandomButton();
  runRandomCycle(randomGeneration);
}

async function runAnimationTest() {
  if (animationTestRunning || !scene) return;
  const cardIds = selectedCardIdsArray();
  if (cardIds.length === 0) {
    showStatusMessage("Animation test needs at least one selected card");
    return;
  }
  stopDemoAnimations();
  stopRandomMotion();
  const generation = ++animationTestGeneration;
  const started = performance.now();
  animationTestRunning = true;
  animationTestButton.disabled = true;
  animationTestButton.textContent = "Test…";
  const liveCards = () => {
    const state = scene?.snapshot();
    return cardIds.filter((cardId) => state?.desired.cards.some((card) => card.id === cardId));
  };
  const runStep = async (createOperations) => {
    if (generation !== animationTestGeneration || !scene) return false;
    const stepStarted = performance.now();
    const state = scene.snapshot();
    const ids = liveCards();
    if (ids.length === 0) return false;
    const operations = createOperations(ids, state);
    if (operations.length > 0) await scene.transact(operations).finished;
    const remainingStepTime = 700 - (performance.now() - stepStarted);
    if (remainingStepTime > 0 && generation === animationTestGeneration) {
      await new Promise((resolve) => setTimeout(resolve, remainingStepTime));
    }
    return generation === animationTestGeneration;
  };
  const target = (preset, state, cardId) => {
    const card = state.desired.cards.find((item) => item.id === cardId);
    const visual = state.visual.find((item) => item.cardId === cardId);
    const pose = visual?.pose ?? card?.pose ?? {};
    const scale = pose.scale ?? 1;
    const width = (card?.dimensions?.width ?? 180) * scale;
    const height = (card?.dimensions?.height ?? 250) * scale;
    const angle = (pose.angle ?? 0) * Math.PI / 180;
    const halfWidth = (Math.abs(Math.cos(angle) * width) + Math.abs(Math.sin(angle) * height)) / 2;
    const halfHeight = (Math.abs(Math.sin(angle) * width) + Math.abs(Math.cos(angle) * height)) / 2;
    const bounds = visibleWorldBounds();
    const minX = Math.min(bounds.left + halfWidth, bounds.right - halfWidth);
    const maxX = Math.max(bounds.left + halfWidth, bounds.right - halfWidth);
    const minY = Math.min(bounds.top + halfHeight, bounds.bottom - halfHeight);
    const maxY = Math.max(bounds.top + halfHeight, bounds.bottom - halfHeight);
    const centerX = Math.min(maxX, Math.max(minX, bounds.centerX));
    const centerY = Math.min(maxY, Math.max(minY, bounds.centerY));
    const travelX = Math.min(centerX - minX, maxX - centerX) * 0.35;
    const travelY = Math.min(centerY - minY, maxY - centerY) * 0.35;
    return {
      x: Math.round(preset === "left" ? centerX - travelX : preset === "right" ? centerX + travelX : centerX),
      y: Math.round(preset === "top" ? centerY - travelY : preset === "bottom" ? centerY + travelY : centerY),
    };
  };
  const steps = [
    (ids, state) => ids.map((cardId) => ({ type: "move", cardId, position: target("left", state, cardId) })),
    (ids, state) => ids.map((cardId) => {
      const pose = state.visual.find((item) => item.cardId === cardId)?.pose;
      return { type: "rotate", cardId, angle: normalizeAngle((pose?.angle ?? 0) + 45) };
    }),
    (ids, state) => ids.map((cardId) => {
      const pose = state.visual.find((item) => item.cardId === cardId)?.pose;
      return { type: "scale", cardId, factor: (pose?.scale ?? 1) >= 1.25 ? 1 : 1.25 };
    }),
    (ids, state) => ids.map((cardId) => {
      const card = state.desired.cards.find((item) => item.id === cardId);
      return toggleFaceOperation(cardId, state, "y");
    }),
    (ids, state) => ids.map((cardId) => ({ type: "move", cardId, position: target("right", state, cardId) })),
    (ids, state) => ids.flatMap((cardId) => {
      const pose = state.visual.find((item) => item.cardId === cardId)?.pose;
      return [
        { type: "move", cardId, position: target("center", state, cardId) },
        { type: "rotate", cardId, angle: normalizeAngle((pose?.angle ?? 0) + 90) },
        { type: "scale", cardId, factor: 1.5 },
        { type: "face", cardId, face: "faceUp", axis: ["x", "y"], angle: { x: 180, y: 180 } },
      ];
    }),
    (ids, state) => ids.map((cardId) => ({ type: "move", cardId, position: target("bottom", state, cardId) })),
    (ids, state) => ids.map((cardId) => {
      const pose = state.visual.find((item) => item.cardId === cardId)?.pose;
      return { type: "rotate", cardId, angle: normalizeAngle((pose?.angle ?? 0) - 135) };
    }),
    (ids, state) => ids.map((cardId) => {
      const pose = state.visual.find((item) => item.cardId === cardId)?.pose;
      return { type: "scale", cardId, factor: (pose?.scale ?? 1) >= 1.25 ? 0.75 : 1.25 };
    }),
    (ids, state) => ids.map((cardId) => ({ type: "move", cardId, position: target("left", state, cardId) })),
    (ids, state) => ids.map((cardId) => {
      const card = state.desired.cards.find((item) => item.id === cardId);
      return toggleFaceOperation(cardId, state, "x");
    }),
    (ids, state) => ids.map((cardId) => {
      const pose = state.visual.find((item) => item.cardId === cardId)?.pose;
      return { type: "rotate", cardId, angle: normalizeAngle((pose?.angle ?? 0) + 45) };
    }),
    (ids, state) => ids.flatMap((cardId) => [
      { type: "move", cardId, position: target("center", state, cardId) },
      { type: "rotate", cardId, angle: 0 },
      { type: "scale", cardId, factor: 1 },
      { type: "face", cardId, face: "faceUp", axis: ["x", "y"], angle: { x: 0, y: 0 } },
    ]),
  ];
  try {
    let completed = true;
    for (const step of steps) {
      if (!await runStep(step)) {
        completed = false;
        break;
      }
    }
    if (completed && generation === animationTestGeneration) {
      const state = scene.snapshot();
      const cardId = liveCards()[0];
      const position = cardId ? target("center", state, cardId) : undefined;
      setControls({ ...position, scale: 1, angle: 0, faceUp: true, flipX: 0, flipY: 0 });
    }
    const remaining = 10000 - (performance.now() - started);
    if (remaining > 0 && generation === animationTestGeneration) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  } catch (error) {
    if (generation === animationTestGeneration) {
      showStatusMessage(`Animation test failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    if (generation === animationTestGeneration) {
      animationTestRunning = false;
      animationTestButton.disabled = false;
      animationTestButton.textContent = "Test";
    }
  }
}

function interactionDestination(request = {}) {
  return request.toZoneId
    ?? request.candidate?.toZoneId
    ?? request.destination?.toZoneId
    ?? request.destination?.id
    ?? null;
}

const interactionRules = {
  canStart() {
    return dragEnabled.checked
      ? { allowed: true }
      : { allowed: false, reason: "Dragging is disabled in the lab." };
  },
  canDrop(request) {
    const toZoneId = interactionDestination(request);
    if (!toZoneId) return { allowed: false, reason: "No visible destination zone." };
    if (dragDeniedZone.value && toZoneId === dragDeniedZone.value) {
      const label = LAB_ZONE_DEFINITIONS.find(({ id }) => id === toZoneId)?.label ?? toZoneId;
      return { allowed: false, reason: `${label} is denied by the lab rule.` };
    }
    return { allowed: true };
  },
};

function renderPendingDropControls() {
  const hasPending = Boolean(interactionLifecycle?.pending.size);
  dragAcceptButton.hidden = !hasPending;
  dragRejectButton.hidden = !hasPending;
  dragAcceptButton.disabled = !hasPending;
  dragRejectButton.disabled = !hasPending;
}

function disposeInteractionLifecycle() {
  if (interactionLifecycle) {
    interactionLifecycle.active = false;
    for (const timer of interactionLifecycle.timers.values()) clearTimeout(timer);
    interactionLifecycle.timers.clear();
    interactionLifecycle.pending.clear();
    interactionLifecycle.outcome = "";
  }
  interactionLifecycle = undefined;
  renderPendingDropControls();
  interactionStatus.textContent = "";
}

function prunePendingDrops(lifecycle, interaction) {
  const live = new Set((interaction?.sessions ?? [])
    .filter((session) => session.phase === "pending")
    .map((session) => session.id));
  for (const intentId of lifecycle.pending.keys()) {
    if (live.has(intentId)) continue;
    const timer = lifecycle.timers.get(intentId);
    if (timer) clearTimeout(timer);
    lifecycle.timers.delete(intentId);
    lifecycle.pending.delete(intentId);
  }
  renderPendingDropControls();
}

function interactionZoneLabel(state, zoneId) {
  return state?.zones?.find(({ id }) => id === zoneId)?.label
    ?? state?.desired?.zones?.find(({ id }) => id === zoneId)?.label
    ?? zoneId
    ?? "destination";
}

function updateInteractionStatus(state = scene?.snapshot(), interaction = state?.interaction) {
  renderPendingDropControls();
  if (!interaction) {
    interactionStatus.textContent = dragEnabled.checked
      ? "Drag ready. Use Space or pointer input to pick up a card."
      : "Dragging is disabled in the lab.";
    return;
  }
  const sessions = interaction.sessions ?? [];
  const session = sessions.at(-1);
  if (!session) {
    interactionStatus.textContent = interactionLifecycle?.outcome || (dragEnabled.checked
      ? "Drag ready. Use Space or pointer input to pick up a card."
      : "Dragging is disabled in the lab.");
    return;
  }
  if (interactionLifecycle) interactionLifecycle.outcome = "";
  const cardLabel = session.primaryCardId ?? session.cardIds?.[0] ?? "card";
  const candidate = session.candidate;
  const destination = candidate?.toZoneId ? interactionZoneLabel(state, candidate.toZoneId) : "outside a zone";
  const slot = candidate?.index === undefined ? "" : ` at slot ${candidate.index}`;
  if (session.phase === "pending") {
    interactionStatus.textContent = `Drop pending approval: ${cardLabel} → ${destination}${slot}.`;
  } else if (session.phase === "dragging") {
    interactionStatus.textContent = candidate
      ? candidate.allowed
        ? `Dragging ${cardLabel} → ${destination}${slot}.`
        : `Dragging ${cardLabel}: ${candidate.reason ?? "destination denied"}.`
      : `Dragging ${cardLabel}; move over a zone to preview a drop.`;
  } else if (session.phase === "accepted") {
    interactionStatus.textContent = `Drop accepted: ${cardLabel} → ${destination}${slot}.`;
  } else if (session.phase === "rejected") {
    interactionStatus.textContent = `Drop rejected for ${cardLabel}.`;
  } else if (session.phase === "cancelled") {
    interactionStatus.textContent = `Drag cancelled for ${cardLabel}.`;
  }
}

function resolvePendingDrop(sceneInstance, lifecycle, intentId, accepted) {
  if (!lifecycle.active || scene !== sceneInstance) return;
  const pending = lifecycle.pending.get(intentId);
  if (!pending) return;
  lifecycle.pending.delete(intentId);
  const timer = lifecycle.timers.get(intentId);
  if (timer) clearTimeout(timer);
  lifecycle.timers.delete(intentId);
  renderPendingDropControls();
  try {
    const outcome = sceneInstance.resolveDrop(intentId, { accepted });
    const intent = pending.intent;
    lifecycle.outcome = outcome?.status === "accepted"
      ? `Drop accepted: ${intent.primaryCardId} → ${interactionZoneLabel(sceneInstance.snapshot(), intent.toZoneId)} at slot ${intent.index}.`
      : outcome?.status === "rejected"
        ? `Drop rejected for ${intent.primaryCardId}.`
        : `Drop response is stale for ${intent.primaryCardId}.`;
    interactionStatus.textContent = lifecycle.outcome;
  } catch (error) {
    interactionStatus.textContent = `Drop response failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function respondToDrop(sceneInstance, lifecycle, intent) {
  if (!lifecycle.active || scene !== sceneInstance) return;
  lifecycle.pending.set(intent.id, { intent });
  const mode = dragResponse.value;
  if (mode === "manual") {
    updateInteractionStatus(sceneInstance.snapshot());
    return;
  }
  if (mode === "delay") {
    const timer = setTimeout(() => {
      lifecycle.timers.delete(intent.id);
      resolvePendingDrop(sceneInstance, lifecycle, intent.id, true);
    }, 500);
    lifecycle.timers.set(intent.id, timer);
    updateInteractionStatus(sceneInstance.snapshot());
    return;
  }
  resolvePendingDrop(sceneInstance, lifecycle, intent.id, mode === "immediate");
}

function startScene(cards = sceneCards()) {
  disposeInteractionLifecycle();
  stopDemoAnimations();
  scene?.destroy();
  if (spinTimer) clearTimeout(spinTimer);
  stopRandomMotion();
  spinTimer = undefined;
  spinHandles = new Map();
  spinning = false;
  updateSpinButton();
  try {
    const createdScene = createCardScene({
      element: stage,
      templates: {
        illustrated: { width: 180, height: 250, thickness: 6, shape: "rounded-rectangle" },
        shield: { width: 180, height: 250, thickness: 6, shape: "shield" },
      },
      camera: {
        projection: "orthographic",
        scaleMode: "stage",
        unitsPerPixel: LAB_CAMERA_UNITS_PER_PIXEL,
        center: LAB_CAMERA_CENTER,
      },
      motion: {
        reducedMotion: reduced.getAttribute("aria-pressed") === "true",
        duration: LAB_MOTION_DURATION / Number(motionSpeedSlider.value),
      },
      interaction: {
        rules: interactionRules,
        touchDrag: touchDrag.checked,
      },
    });
    scene = createdScene;
    const lifecycle = { active: true, scene: createdScene, timers: new Map(), pending: new Map(), outcome: "" };
    interactionLifecycle = lifecycle;
    createdScene.apply(desiredSnapshot(cards));
    createdScene.on("change", updateStatus);
    createdScene.on("renderer-status", updateStatus);
    createdScene.on("selection-change", (selection) => {
      if (scene !== createdScene || !lifecycle.active) return;
      selectedCardIds = new Set(selection.cardIds);
      syncControlsFromSelection();
    });
    createdScene.on("interaction-change", (interaction) => {
      if (scene !== createdScene || !lifecycle.active) return;
      prunePendingDrops(lifecycle, interaction);
      updateStatus(createdScene.snapshot(), interaction, true);
    });
    createdScene.on("drop", (intent) => respondToDrop(createdScene, lifecycle, intent));
    selectedCardIds = new Set([...selectedCardIds].filter((id) => cards.some((card) => card.id === id)));
    if (selectedCardIds.size === 0 && cards[0]) selectedCardIds.add(cards[0].id);
    selectedCardIds = new Set(scene.select([...selectedCardIds]).cardIds);
    renderCardList();
    syncControlsFromSelection();
    updateStatus();
  } catch (error) {
    disposeInteractionLifecycle();
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
  selectedCardIds = new Set(scene.select([...selectedCardIds]).cardIds);
  renderCardList();
  syncControlsFromSelection();
  updateStatus();
}

function syncZoneMembership(state) {
  const next = new Map();
  for (const zone of state.desired.zones) {
    for (const cardId of zone.cardIds) next.set(cardId, zone.id);
  }
  cardZoneIds = next;
}

function renderZones(state = scene.snapshot()) {
  syncZoneMembership(state);
  const zones = state.zones;
  const selectedSlot = Number.parseInt(zoneSlot.value, 10) || 0;
  const slotCount = Math.max(1, state.desired.cards.length + 1);
  zoneSlot.replaceChildren(...Array.from({ length: slotCount }, (_, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = String(index);
    return option;
  }));
  zoneSlot.value = String(Math.min(selectedSlot, slotCount - 1));
  zoneList.replaceChildren(...zones.map((zone) => {
    const row = document.createElement("div");
    row.className = "zone-row";
    row.dataset.zoneId = zone.id;
    row.setAttribute("role", "listitem");
    row.setAttribute("aria-hidden", String(zone.visible === false));
    const name = document.createElement("span");
    name.className = "zone-name";
    name.textContent = `${zone.label ?? zone.id}${zone.visible === false ? " · hidden" : ""}`;
    const count = document.createElement("span");
    count.className = "zone-count";
    count.textContent = `${zone.cardIds.length} card${zone.cardIds.length === 1 ? "" : "s"}`;
    const visibility = document.createElement("button");
    visibility.type = "button";
    visibility.textContent = zone.visible === false ? "Show" : "Hide";
    visibility.addEventListener("click", () => toggleZone(zone.id));
    row.append(name, count, visibility);
    return row;
  }));
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  for (const button of transferZoneButtons) {
    const target = zoneById.get(button.dataset.transferZone);
    button.disabled = selectedCardIds.size === 0 || target?.visible === false;
  }
}

function renderCardList() {
  const state = scene.snapshot();
  syncZoneMembership(state);
  const zoneNames = new Map(state.zones.map((zone) => [zone.id, zone.label ?? zone.id]));
  const items = state.desired.cards.map((card, index) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    const depth = document.createElement("output");
    const zone = document.createElement("span");
    input.type = "checkbox";
    input.checked = selectedCardIds.has(card.id);
    input.setAttribute("aria-label", `Select card ${index + 1}`);
    depth.className = "card-z";
    depth.dataset.cardId = card.id;
    zone.className = "card-zone";
    zone.dataset.zoneId = cardZoneIds.get(card.id) ?? "";
    zone.textContent = zoneNames.get(cardZoneIds.get(card.id)) ?? "zone —";
    input.addEventListener("change", () => {
      selectedCardIds = new Set(scene.select([card.id], { mode: "toggle" }).cardIds);
      syncControlsFromSelection();
      updateStatus();
      renderCardList();
    });
    label.append(input, document.createTextNode(`Card ${index + 1}`), depth, zone);
    return label;
  });
  cardList.replaceChildren(...items);
  selectionStatus.textContent = `${selectedCardIds.size} of ${state.desired.cards.length} selected`;
  updateCardListDepth(state);
}

function updateCardListDepth(state = scene.snapshot()) {
  for (const depth of cardList.querySelectorAll(".card-z")) {
    const visual = state.visual.find(({ cardId }) => cardId === depth.dataset.cardId);
    const z = visual?.pose.z;
    depth.textContent = z === undefined ? "z —" : `z ${z.toFixed(1)}`;
  }
}

function syncControlsFromSelection() {
  const state = scene.snapshot();
  const card = currentCard(state);
  if (!card) return;
  updateMoveControlBounds(state);
  const pose = state.visual.find(({ cardId }) => cardId === card.id)?.pose ?? card.pose;
  setControls({
    x: pose.x,
    y: pose.y,
    width: pose.width,
    height: pose.height,
    thickness: pose.thickness,
    angle: pose.angle,
    scale: pose.scale,
    flipX: pose.flipX ?? 0,
    flipY: pose.flipY ?? 0,
  });
  renderElementList(state);
}

function selectedElementOperations(makeOperation) {
  return selectedCards().flatMap((card) => {
    const face = card.faces[card.activeFaceId];
    return face?.elements?.some(({ id }) => id === makeOperation.elementId) || makeOperation.action === "add"
      ? [{ type: "element", cardId: card.id, faceId: card.activeFaceId, ...makeOperation }]
      : [];
  });
}

function applyElementOperation(operation) {
  if (selectedCards().length === 0) return;
  const operations = selectedElementOperations(operation);
  if (operations.length === 0) return;
  try {
    run(operations);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showStatusMessage(`Element update failed: ${message}`);
    console.error("Cardinal element update failed", error);
  }
}

function applyBackgroundImage() {
  const source = backgroundImageInput.value.trim();
  const fit = backgroundFit.value;
  const cards = sceneCards().map((card) => {
    if (!selectedCardIds.has(card.id)) return card;
    if (backgroundSide.value === "back") {
      const nextBack = { ...(card.back ?? { elements: [] }) };
      if (source) nextBack.backgroundImage = { src: source, fit };
      else delete nextBack.backgroundImage;
      return { ...card, back: nextBack };
    }
    const face = card.faces?.[card.activeFaceId];
    if (!face) return card;
    const nextFace = { ...face };
    if (source) nextFace.backgroundImage = { src: source, fit };
    else delete nextFace.backgroundImage;
    return { ...card, faces: { ...card.faces, [card.activeFaceId]: nextFace } };
  });
  applyLabCards(cards);
}

function backgroundContentFor(card) {
  return backgroundSide.value === "back" ? card?.back : card?.faces?.[card?.activeFaceId];
}

function elementEditorValue(element) {
  if (element.type === "image") return element.content?.src ?? "";
  return element.content?.text ?? element.content?.value ?? "";
}

function renderElementList(state = scene.snapshot()) {
  const card = currentCard(state);
  const face = card?.faces?.[card.activeFaceId];
  const backgroundContent = backgroundContentFor(card);
  const key = face ? JSON.stringify([card.id, card.activeFaceId, face.elements, face.backgroundImage, card.back?.backgroundImage, backgroundSide.value]) : "empty";
  if (key === renderedElementKey) return;
  renderedElementKey = key;
  if (!face) {
    elementList.replaceChildren(document.createTextNode("Select a card to inspect its elements."));
    addElementButton.disabled = true;
    elementType.disabled = true;
    backgroundSide.disabled = true;
    backgroundImageInput.disabled = true;
    backgroundFit.disabled = true;
    applyBackgroundButton.disabled = true;
    return;
  }
  addElementButton.disabled = false;
  elementType.disabled = false;
  backgroundSide.disabled = false;
  backgroundImageInput.disabled = false;
  backgroundFit.disabled = false;
  applyBackgroundButton.disabled = false;
  const backgroundImage = backgroundContent?.backgroundImage;
  backgroundImageInput.value = typeof backgroundImage === "string" ? backgroundImage : backgroundImage?.src ?? "";
  backgroundFit.value = typeof backgroundImage === "object" ? backgroundImage.fit ?? "cover" : "cover";
  const rows = (face.elements ?? []).map((element, index) => {
    const row = document.createElement("div");
    row.className = "element-row";

    const visibility = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = element.visible !== false;
    checkbox.setAttribute("aria-label", `Show ${element.id}`);
    checkbox.addEventListener("change", () => applyElementOperation({
      action: checkbox.checked ? "show" : "hide",
      elementId: element.id,
    }));
    visibility.append(checkbox);

    const name = document.createElement("span");
    name.className = "element-name";
    name.textContent = `${element.id} · ${element.type}`;
    visibility.append(name);

    const editor = document.createElement("input");
    editor.type = "text";
    editor.value = elementEditorValue(element);
    editor.setAttribute("aria-label", `Content for ${element.id}`);
    editor.placeholder = element.type === "image" ? "Image URL" : "Text";
    editor.addEventListener("change", () => {
      const content = { ...(element.content ?? {}) };
      if (element.type === "image") content.src = editor.value;
      else content.text = editor.value;
      applyElementOperation({ action: "update", elementId: element.id, element: { content } });
    });

    const mode = document.createElement("select");
    mode.setAttribute("aria-label", `Layout mode for ${element.id}`);
    mode.innerHTML = '<option value="flow">Flow</option><option value="overlay">Overlay</option>';
    mode.value = element.layout?.mode ?? "flow";
    mode.addEventListener("change", () => applyElementOperation({
      action: "update",
      elementId: element.id,
      element: { layout: { ...(element.layout ?? {}), mode: mode.value } },
    }));

    const policy = document.createElement("select");
    policy.setAttribute("aria-label", `Hidden layout policy for ${element.id}`);
    policy.innerHTML = '<option value="reflow">Hidden: Reflow</option><option value="preserve-space">Hidden: Preserve space</option>';
    policy.value = element.visibilityMode ?? "reflow";
    policy.addEventListener("change", () => applyElementOperation({
      action: "update",
      elementId: element.id,
      element: { visibilityMode: policy.value },
    }));

    const actions = document.createElement("div");
    actions.className = "element-actions";
    const moveButton = (label, targetIndex, disabled) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.disabled = disabled;
      button.addEventListener("click", () => applyElementOperation({ action: "reorder", elementId: element.id, index: targetIndex }));
      return button;
    };
    actions.append(moveButton("↑", index - 1, index === 0), moveButton("↓", index + 1, index === face.elements.length - 1));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => applyElementOperation({ action: "remove", elementId: element.id }));
    actions.append(remove);

    row.append(visibility, editor, mode, policy, actions);
    return row;
  });
  elementList.replaceChildren(...rows);
}

function updateStatus(state = scene.snapshot(), interaction = state.interaction, presentationOnly = false) {
  if (!state?.desired) {
    state = scene.snapshot();
    interaction = state.interaction;
  }
  syncSpinState(state);
  presentationOnly ||= demoTransaction;
  if (!presentationOnly) {
    updateMoveControlBounds(state);
    renderCardList();
    renderZones(state);
    renderElementList(state);
  }
  if (!demoTransaction) updateCardListDepth(state);
  const card = currentCard(state);
  const visual = card && state.visual.find(({ cardId }) => cardId === card.id);
  const pose = visual?.pose;
  updateInteractionStatus(state, interaction);
  const rendererLabel = state.renderer === "webgl"
    ? "Three.js WebGL (true 3D)"
    : state.renderer === "css" ? "CSS (explicit mode)" : state.renderer;
  const projectionLabel = state.projection ? ` · ${state.projection}` : "";
  const viewport = scene.viewport?.();
  const viewportLabel = viewport
    ? ` · view ${viewport.width.toFixed(0)}×${viewport.height.toFixed(0)} @ ${viewport.center.x.toFixed(0)},${viewport.center.y.toFixed(0)} · ${viewport.scaleMode}`
    : "";
  rendererStatus.textContent = `Renderer: ${rendererLabel}${projectionLabel}${viewportLabel}${state.rendererReason && state.rendererReason !== "css" ? ` — ${state.rendererReason}` : ""}`;
  const physicalSide = visual?.physicalSide ?? "unknown";
  const summaryText = `${state.desired.cards.length} cards`;
  const selectionText = `${selectedCardIds.size} selected`;
  const statusParts = [summaryText, selectionText];
  if (pose) {
    const poseParts = {
      x: pose.x.toFixed(0),
      y: pose.y.toFixed(0),
      z: pose.z.toFixed(1),
      size: `${pose.width.toFixed(0)}×${pose.height.toFixed(0)}`,
      depth: pose.thickness.toFixed(1),
      angle: `${pose.angle.toFixed(0)}°`,
      scale: pose.scale.toFixed(2),
      logical: card.activeFaceId.replace("face-", "").toUpperCase(),
      physical: physicalSide,
      motion: state.settling
        ? "animating"
        : activeMotionLabels().length > 0 ? `${activeMotionLabels().join("+")} active` : "stable",
    };
    statusParts.push(
      `x ${poseParts.x}`,
      `y ${poseParts.y}`,
      `z ${poseParts.z}`,
      `size ${poseParts.size}`,
      `depth ${poseParts.depth}`,
      `angle ${poseParts.angle}`,
      `scale ${poseParts.scale}`,
      `logical ${poseParts.logical}`,
      `physical ${poseParts.physical}`,
      poseParts.motion,
    );
  }
  status.textContent = statusParts.join(" · ");
  status.setAttribute("aria-label", status.textContent);
  selectionStatus.textContent = `${selectedCardIds.size} of ${state.desired.cards.length} selected`;
}

function showStatusMessage(message) {
  status.textContent = message;
  status.setAttribute("aria-label", message);
}

function run(operations, options) {
  scene.transact(operations, options);
}

function updateSpinButton() {
  spinButton.textContent = spinning ? "Stop" : "Spin";
  spinButton.setAttribute("aria-pressed", String(spinning));
}

function syncSpinState(state) {
  const engineSpinning = Boolean(state.spinning);
  if (engineSpinning === spinning) return;
  if (!engineSpinning && spinTimer) clearTimeout(spinTimer);
  if (!engineSpinning) {
    spinTimer = undefined;
    spinHandles = new Map();
  }
  spinning = engineSpinning;
  updateSpinButton();
}

function stopContinuousFlip() {
  stopFlipAnimation();
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
      face: faceUpForVisual(visual) ? "faceUp" : "faceDown",
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
  motionSpeedValue.textContent = `${Number(motionSpeedSlider.value)}×`;
  cardWidthValue.textContent = cardWidthSlider.value;
  cardHeightValue.textContent = cardHeightSlider.value;
  cardThicknessValue.textContent = cardThicknessSlider.value;
  cardHeightSlider.disabled = cardSizing.value === "content";
  rotateValue.textContent = `${rotateSlider.value}°`;
  scaleValue.textContent = `${Math.round(scale * 100)}%`;
  flipXValue.textContent = `${flipX}°`;
  flipYValue.textContent = `${flipY}°`;
}

function setControls({ x, y, width, height, thickness, angle, scale, faceUp, flipX, flipY } = {}) {
  if (x !== undefined) moveXSlider.value = String(x);
  if (y !== undefined) moveYSlider.value = String(y);
  if (width !== undefined) cardWidthSlider.value = String(width);
  if (height !== undefined) cardHeightSlider.value = String(height);
  if (thickness !== undefined) cardThicknessSlider.value = String(thickness);
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

function updateMotionSpeed() {
  if (!scene) return;
  const speed = Number(motionSpeedSlider.value);
  scene.setMotion({ duration: LAB_MOTION_DURATION / speed });
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

function faceUpForVisual(visual) {
  const pose = visual?.pose ?? {};
  return Math.cos((pose.flipX ?? 0) * Math.PI / 180)
    * Math.cos((pose.flipY ?? 0) * Math.PI / 180) >= 0;
}

function toggleFaceOperation(cardId, state, axis) {
  const visual = state.visual.find(({ cardId: visualCardId }) => visualCardId === cardId);
  return {
    type: "face",
    cardId,
    face: faceUpForVisual(visual) ? "faceDown" : "faceUp",
    axis,
  };
}

function selectedVisualEntries(state = scene.snapshot()) {
  return selectedCards(state).map((card) => ({
    card,
    visual: state.visual.find(({ cardId }) => cardId === card.id),
  })).filter(({ visual }) => visual?.pose);
}

function moveSelectedAsGroup(preset, state = scene.snapshot()) {
  const entries = selectedVisualEntries(state);
  const primary = currentVisual(state);
  if (!primary || entries.length === 0) return [];
  const target = movePresetPosition(preset);
  const delta = { x: target.x - primary.pose.x, y: target.y - primary.pose.y };
  return entries.map(({ card, visual }) => ({
    type: "move",
    cardId: card.id,
    position: { x: Math.round(visual.pose.x + delta.x), y: Math.round(visual.pose.y + delta.y) },
  }));
}

function flipSelectedOperations(state = scene.snapshot()) {
  const axis = flipAxis.value;
  const angleKey = axis === "x" ? "flipX" : "flipY";
  const otherAngleKey = axis === "x" ? "flipY" : "flipX";
  return selectedVisualEntries(state).map(({ card, visual }) => {
    const currentAngle = visual.pose[angleKey] ?? 0;
    const normalizedAngle = ((currentAngle % 360) + 360) % 360;
    const angle = normalizedAngle < 90 || normalizedAngle >= 270 ? 180 : 0;
    const otherAngle = visual.pose[otherAngleKey] ?? 0;
    const facing = Math.cos(angle * Math.PI / 180) * Math.cos(otherAngle * Math.PI / 180) >= 0;
    return {
      type: "face",
      cardId: card.id,
      face: facing ? "faceUp" : "faceDown",
      axis,
      angle,
    };
  });
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
  if (channels.has("move")) {
    const x = Number(moveXSlider.value);
    const y = Number(moveYSlider.value);
    for (const card of selected) operations.push({
      type: "move",
      cardId: card.id,
      position: { x, y },
    });
  }
  if (channels.has("rotate")) {
    for (const card of selected) operations.push({ type: "rotate", cardId: card.id, angle: Number(rotateSlider.value) });
  }
  if (channels.has("scale")) {
    for (const card of selected) operations.push({ type: "scale", cardId: card.id, factor: Number(scaleSlider.value) });
  }
  if (channels.has("resize")) {
    const dimensions = { width: Number(cardWidthSlider.value), height: Number(cardHeightSlider.value) };
    for (const card of selected) operations.push({ type: "resize", cardId: card.id, dimensions });
  }
  if (channels.has("thickness")) {
    const thickness = Number(cardThicknessSlider.value);
    for (const card of selected) operations.push({ type: "thickness", cardId: card.id, thickness });
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

function applyPresetControl(channel) {
  // Presets are discrete commands. Apply them immediately after reading the
  // current controls so a queued slider frame cannot swallow the command.
  if (controlsFrame) cancelAnimationFrame(controlsFrame);
  controlsFrame = undefined;
  pendingChannels = new Set();
  pendingModes = new Map();
  const operations = controlOperations(new Set([channel]));
  if (operations.length > 0) run(operations);
}

moveButton.addEventListener("click", () => {
  if (moveAnimation) stopMoveAnimation();
  else startMoveAnimation();
});

rotateButton.addEventListener("click", () => {
  if (rotateAnimation) stopRotateAnimation();
  else startRotateAnimation();
});

scaleButton.addEventListener("click", () => {
  if (scaleAnimation) stopScaleAnimation();
  else startScaleAnimation();
});

document.querySelectorAll("[data-scale]").forEach((button) => {
  button.addEventListener("click", () => {
    stopScaleAnimation();
    setControls({ scale: Number(button.dataset.scale) });
    queueControl("scale", { immediate: false });
  });
});

flipButton.addEventListener("click", () => {
  if (flipAnimation) stopFlipAnimation();
  else startFlipAnimation();
});

spinButton.addEventListener("click", () => {
  if (spinning) {
    stopContinuousFlip();
    return;
  }
  stopFlipAnimation();
  spinHandles = new Map(selectedCardIdsArray().map((cardId) => [
    cardId,
    scene.spin(cardId, { axis: flipAxis.value, direction: 1, speed: 180 }),
  ]));
  spinning = [...spinHandles.values()].some((handle) => handle.active);
  updateSpinButton();
});

randomButton.addEventListener("click", toggleRandomMotion);
animationTestButton.addEventListener("click", runAnimationTest);

[moveXSlider, moveYSlider].forEach((slider) => slider.addEventListener("input", () => {
  stopMoveAnimation();
  queueControl("move");
}));
motionSpeedSlider.addEventListener("input", updateMotionSpeed);
[cardWidthSlider, cardHeightSlider].forEach((slider) => slider.addEventListener("input", () => queueControl("resize")));
cardThicknessSlider.addEventListener("input", () => queueControl("thickness"));
rotateSlider.addEventListener("input", () => {
  stopRotateAnimation();
  queueControl("rotate");
});
scaleSlider.addEventListener("input", () => {
  stopScaleAnimation();
  queueControl("scale");
});
[flipXSlider, flipYSlider].forEach((slider) => slider.addEventListener("input", () => {
  stopContinuousFlip();
  queueControl("flip");
}));
flipAxis.addEventListener("change", () => {
  stopContinuousFlip();
});
shape.addEventListener("change", () => startScene());
faceCount.addEventListener("change", () => startScene());
cardSizing.addEventListener("change", () => startScene());

addCardButton.addEventListener("click", () => {
  const cards = sceneCards();
  const id = `cardinal-demo-${nextCardNumber}`;
  nextCardNumber += 1;
  if (spawnZoneAuto && cards.length >= 3) {
    spawnZone.value = "archive";
    syncSpawnZoneColor();
  }
  cardZoneIds.set(id, spawnZone.value);
  cards.push({
    ...baseCard,
    id,
    template: shape.value,
    pose: { scale: defaultCardScale() },
  });
  selectedCardIds = new Set([id]);
  applyLabCards(cards);
});

spawnZone.addEventListener("change", () => {
  spawnZoneAuto = false;
  syncSpawnZoneColor();
});

removeCardsButton.addEventListener("click", () => {
  const cards = sceneCards().filter(({ id }) => !selectedCardIds.has(id));
  selectedCardIds = new Set(cards[0] ? [cards[0].id] : []);
  applyLabCards(cards);
});

function transferCardsTo(destination) {
  const selected = selectedCardIdsArray();
  const target = scene.snapshot().zones.find(({ id }) => id === destination);
  if (selected.length === 0 || target?.visible === false) return;
  const start = Math.max(0, Number.parseInt(zoneSlot.value, 10) || 0);
  try {
    run(selected.map((cardId, index) => ({
      type: "move",
      cardId,
      to: destination,
      index: start + index,
    })));
  } catch (error) {
    showStatusMessage(`Zone transfer failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function toggleZone(zoneId) {
  const definition = LAB_ZONE_DEFINITIONS.find(({ id }) => id === zoneId);
  const current = scene.snapshot().zones.find(({ id }) => id === zoneId);
  if (!definition || !current) return;
  const visible = current.visible === false;
  zoneVisibility.set(zoneId, visible);
  const anchor = definition.anchor ? document.querySelector(definition.anchor) : null;
  if (anchor) anchor.hidden = !visible;
  try {
    run([{ type: "zone", zoneId, changes: { visible } }]);
  } catch (error) {
    zoneVisibility.set(zoneId, !visible);
    if (anchor) anchor.hidden = visible;
    showStatusMessage(`Zone update failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const button of transferZoneButtons) {
  button.addEventListener("click", () => transferCardsTo(button.dataset.transferZone));
}

selectAllButton.addEventListener("click", () => {
  selectedCardIds = new Set(scene.select(scene.snapshot().desired.cards.map(({ id }) => id)).cardIds);
  renderCardList();
  syncControlsFromSelection();
  updateStatus();
});

deselectAllButton.addEventListener("click", () => {
  selectedCardIds = new Set(scene.select([]).cardIds);
  renderCardList();
  syncControlsFromSelection();
  updateStatus();
});

document.querySelectorAll("[data-move-preset]").forEach((button) => {
  button.addEventListener("click", () => {
    stopMoveAnimation();
    setControls(movePresetPosition(button.dataset.movePreset));
    applyPresetControl("move");
  });
});
document.querySelectorAll("[data-rotate]").forEach((button) => {
  button.addEventListener("click", () => {
    stopRotateAnimation();
    setControls({ angle: Number(button.dataset.rotate) });
    applyPresetControl("rotate");
  });
});
document.querySelectorAll("[data-flip]").forEach((button) => {
  button.addEventListener("click", () => {
    stopContinuousFlip();
    setControls({ faceUp: button.dataset.flip === "0" });
    applyPresetControl("flip");
  });
});

addElementButton.addEventListener("click", () => {
  const id = `${elementType.value}-${nextElementNumber}`;
  nextElementNumber += 1;
  const element = elementType.value === "image"
    ? { id, type: "image", content: { src: "/examples/card-engine-lab/cardinal.png", alt: "A stylized red cardinal" }, layout: { mode: "flow" } }
    : { id, type: "text", content: { text: "New text element" }, layout: { mode: "flow" } };
  applyElementOperation({ action: "add", elementId: id, element });
});

applyBackgroundButton.addEventListener("click", applyBackgroundImage);
backgroundSide.addEventListener("change", () => renderElementList());
document.querySelectorAll("[data-background-preset]").forEach((button) => {
  button.addEventListener("click", () => {
    const preset = backgroundPresets[button.dataset.backgroundPreset];
    backgroundImageInput.value = preset?.src ?? "";
    backgroundFit.value = preset?.fit ?? "cover";
    applyBackgroundImage();
  });
});

document.querySelector("#combined").addEventListener("click", () => {
  stopDemoAnimations();
  const state = scene.snapshot();
  const primary = currentVisual(state);
  if (!primary) return;
  const angle = normalizeAngle(primary.pose.angle + 180);
  const scale = primary.pose.scale > 1 ? 1 : 1.3;
  setControls({ ...movePresetPosition("center"), angle, scale });
  run([
    ...moveSelectedAsGroup("center", state),
    ...selectedVisualEntries(state).flatMap(({ card, visual }) => [
      { type: "rotate", cardId: card.id, angle: normalizeAngle(visual.pose.angle + 180) },
      { type: "scale", cardId: card.id, factor: scale },
    ]),
  ]);
  startFullSpin();
});

reduced.addEventListener("click", () => {
  const enabled = reduced.getAttribute("aria-pressed") !== "true";
  reduced.setAttribute("aria-pressed", String(enabled));
  if (controlsFrame) cancelAnimationFrame(controlsFrame);
  controlsFrame = undefined;
  pendingChannels = new Set();
  pendingModes = new Map();
  startScene();
});

function invalidateInteractionRules() {
  if (!scene) return;
  try {
    scene.invalidateRules();
  } catch (error) {
    interactionStatus.textContent = `Rule update failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

dragEnabled.addEventListener("change", () => {
  invalidateInteractionRules();
  if (!scene) interactionStatus.textContent = dragEnabled.checked ? "Drag ready." : "Dragging is disabled in the lab.";
});
dragDeniedZone.addEventListener("change", invalidateInteractionRules);
touchDrag.addEventListener("change", () => startScene());

function respondToFirstPendingDrop(accepted) {
  const lifecycle = interactionLifecycle;
  const intentId = lifecycle?.pending.keys().next().value;
  if (intentId !== undefined) resolvePendingDrop(lifecycle.scene, lifecycle, intentId, accepted);
}

dragAcceptButton.addEventListener("click", () => respondToFirstPendingDrop(true));
dragRejectButton.addEventListener("click", () => respondToFirstPendingDrop(false));

collectDiagnosticsButton.addEventListener("click", () => { void refreshDiagnostics(); });
runDiagnosticsBenchmarkButton.addEventListener("click", () => { void runDiagnosticsBenchmark(); });
copyDiagnosticsButton.addEventListener("click", async () => {
  if (!diagnosticsReport.dataset.report) await refreshDiagnostics();
  try {
    await navigator.clipboard.writeText(diagnosticsReport.textContent);
    diagnosticsStatus.textContent = "Report copied to the clipboard.";
  } catch {
    diagnosticsStatus.textContent = "Clipboard access is unavailable; select and copy the report manually.";
  }
});
recordDragButton.addEventListener("click", armDragDiagnostic);

for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
  stage.addEventListener(type, (event) => {
    if (type === "pointerdown") {
      if (!dragDiagnosticArmed || dragDiagnosticCapture || event.isPrimary === false) return;
      const cardId = dragDiagnosticCardAtPointer(event);
      if (!cardId) return;
      dragDiagnosticCapture = {
        cardId,
        pointerId: event.pointerId,
        pointerType: event.pointerType ?? "unknown",
        startedAt: performance.now(),
        sourceZoneId: scene?.snapshot?.().desired?.zones?.find(({ cardIds = [] }) => cardIds.includes(cardId))?.id ?? null,
        pointerEvents: 0,
        pointerMoves: 0,
        frameTimes: [],
        observedMotionFrames: 0,
        eventToNextObservedRaf: [],
        pendingMoveAt: null,
        lastPose: dragDiagnosticPose(cardId),
        finishTimer: null,
      };
      dragDiagnosticArmed = false;
      recordDragButton.textContent = "Recording drag…";
      recordDragButton.setAttribute("aria-pressed", "true");
    }
    observeDragDiagnosticPointer(event);
  }, true);
}
updateControlLabels();
startScene();
void refreshDiagnostics("Initial report ready.");
