import { createCardScene } from "../../packages/card-engine/src/index.js";
import { normalizeDragMotion } from "../../packages/card-engine/src/drag-motion.js";
import { createLabTutorial } from "./tutorial.js";
import { LAB_TUTORIAL_STEPS } from "./tutorial-steps.js";

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
const selectionDetail = document.querySelector("#selection-detail");
const zoneList = document.querySelector("#zone-list");
const zoneSlot = document.querySelector("#zone-slot");
const spawnZone = document.querySelector("#spawn-zone");
const transferZoneButtons = [...document.querySelectorAll("[data-transfer-zone]")];
const dragEnabled = document.querySelector("#drag-enabled");
const touchDrag = document.querySelector("#drag-touch");
const touchSelection = document.querySelector("#touch-selection");
const crossZoneSelection = document.querySelector("#cross-zone-selection");
const dragPresentation = document.querySelector("#drag-presentation");
const dragAnchor = document.querySelector("#drag-anchor");
const dragMotionPreset = document.querySelector("#drag-motion-preset");
const dragLiftScale = document.querySelector("#drag-lift-scale");
const dragLiftTime = document.querySelector("#drag-lift-time");
const dragLiftDepth = document.querySelector("#drag-lift-depth");
const dragLiftDepthTime = document.querySelector("#drag-lift-depth-time");
const dragResponseTime = document.querySelector("#drag-response-time");
const dragDamping = document.querySelector("#drag-damping");
const dragDangliness = document.querySelector("#drag-dangliness");
const dragMaxTilt = document.querySelector("#drag-max-tilt");
const dragMaxTwist = document.querySelector("#drag-max-twist");
const dragPivotTilt = document.querySelector("#drag-pivot-tilt");
const dragMaxPivotTilt = document.querySelector("#drag-max-pivot-tilt");
const dragPivotResponse = document.querySelector("#drag-pivot-response");
const dragUpright = document.querySelector("#drag-upright");
const dragLandingTime = document.querySelector("#drag-landing-time");
const dragLandingBounce = document.querySelector("#drag-landing-bounce");
const dragSnapDelay = document.querySelector("#drag-snap-delay");
const dragWeightInfluence = document.querySelector("#drag-weight-influence");
const dragSnapDelayValue = document.querySelector("#drag-snap-delay-value");
const dragDeniedCard = document.querySelector("#drag-denied-card");
const dragDeniedZone = document.querySelector("#drag-denied-zone");
const dragResponse = document.querySelector("#drag-response");
const dragAcceptButton = document.querySelector("#drag-accept");
const dragRejectButton = document.querySelector("#drag-reject");
const interactionStatus = document.querySelector("#interaction-status");

function capitalizeDisplayName(value) {
  return String(value ?? "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b([a-z])/g, (_, character) => character.toUpperCase());
}

function cardDisplayName(card, index) {
  if (card?.faceUp === false) return `Concealed Card${Number.isInteger(index) && index >= 0 ? ` ${index + 1}` : ""}`;
  const title = card?.faces?.[card.activeFaceId]?.elements?.find(({ id }) => id === "title")?.content?.text;
  return capitalizeDisplayName(title || card?.id || `Card ${Number(index) + 1}`);
}

function cardDisplayNameForId(cardId, state = scene?.snapshot()) {
  if (!cardId) return "None";
  const index = state?.desired?.cards?.findIndex(({ id }) => id === cardId) ?? -1;
  const card = index < 0 ? undefined : state.desired.cards[index];
  return card ? cardDisplayName(card, index) : capitalizeDisplayName(cardId);
}

function zoneDisplayName(zoneOrId) {
  return capitalizeDisplayName(typeof zoneOrId === "string" ? zoneOrId : zoneOrId?.label ?? zoneOrId?.id);
}

const summaryMeta = new Map();
const summaryTooltips = new Map([
  ["Shape", "Choose the card profile used by new and reset cards."],
  ["Logical faces", "Choose how many named content faces each card has."],
  ["Dimensions", "Choose fixed or content-driven sizing and set card dimensions."],
  ["Move", "Set the selected cards' scene position."],
  ["Rotate", "Set the selected cards' in-plane rotation."],
  ["Scale", "Set the selected cards' authored scale."],
  ["Flip", "Set the selected cards' physical side and flip angles."],
  ["Cards", "Add, remove, select, and inspect cards in the scene."],
  ["Zones", "Control zone membership, arrangements, policies, and transfers."],
  ["Drag", "Configure card dragging, pickup, and landing motion."],
  ["Inspection", "Preview a card without changing its committed scene state."],
  ["Elements", "Edit the selected card's face elements and backgrounds."],
]);
function installSummaryMeta() {
  for (const group of document.querySelectorAll("details.control-group")) {
    const summary = group.querySelector(":scope > summary");
    if (!summary) continue;
    const existingTitle = summary.querySelector(".inspection-summary-title")?.textContent.trim();
    const sourceTitle = existingTitle || summary.textContent.trim();
    const tooltip = summaryTooltips.get(sourceTitle);
    if (tooltip) summary.title = tooltip;
    if (group.id === "inspection-group" || summary.querySelector(".summary-meta")) {
      summary.querySelector(".inspection-summary-title")?.setAttribute("title", tooltip ?? "");
      continue;
    }
    const title = document.createElement("span");
    const value = document.createElement("span");
    title.className = "summary-title";
    value.className = "summary-meta";
    title.textContent = sourceTitle;
    if (tooltip) title.title = tooltip;
    if (tooltip) value.title = tooltip;
    summary.replaceChildren(title, value);
    summaryMeta.set(title.textContent, value);
  }
}

function updateSummaryMeta(state = scene?.snapshot()) {
  if (!state?.desired) return;
  const set = (title, value) => {
    const output = summaryMeta.get(title);
    if (output) {
      output.textContent = value;
      const tooltip = summaryTooltips.get(title);
      if (tooltip) output.title = `${tooltip} Current value: ${value}`;
    }
  };
  const optionLabel = (control) => control?.selectedOptions?.[0]?.textContent?.trim() ?? control?.value ?? "";
  const selectedCardId = state.selection?.primaryCardId ?? [...selectedCardIds][0];
  const selectedVisual = state.visual?.find(({ cardId }) => cardId === selectedCardId);
  const totalCards = state.desired.cards.length;
  const totalZones = state.desired.zones.length;
  set("Shape", optionLabel(shape));
  set("Logical faces", `${faceCount.value} face${Number(faceCount.value) === 1 ? "" : "s"}`);
  set("Dimensions", `${cardSizing.value === "content" ? "Auto" : "Fixed"} · ${cardWidthSlider.value}×${cardHeightSlider.value}`);
  set("Move", `${moveXSlider.value}, ${moveYSlider.value}`);
  set("Rotate", `${rotateSlider.value}°`);
  set("Scale", `${Math.round(Number(scaleSlider.value) * 100)}%`);
  set("Flip", selectedVisual ? (faceUpForVisual(selectedVisual) ? "Front" : "Back") : "Front");
  set("Cards", `${totalCards} cards · ${selectedCardIds.size} selected`);
  set("Drag", `${optionLabel(dragMotionPreset)} · ${optionLabel(dragAnchor)}`);
  set("Zones", `${totalZones} zones · ${state.desired.zones.reduce((count, zone) => count + zone.cardIds.length, 0)} cards`);
  set("Elements", selectedCardId ? "Selected card" : "No selection");
}

installSummaryMeta();

const shape = document.querySelector("#shape");
const inspectionFace = document.querySelector("#inspection-face");
const inspectionStatus = document.querySelector("#inspection-status");
const inspectionHover = document.querySelector("#inspection-hover");
let labInspection;
const faceCount = document.querySelector("#face-count");
const cardSizing = document.querySelector("#card-sizing");
const cardWidthSlider = document.querySelector("#card-width");
const cardHeightSlider = document.querySelector("#card-height");
const cardThicknessSlider = document.querySelector("#card-thickness");
const cardWeightSlider = document.querySelector("#card-weight");
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
const cardWeightValue = document.querySelector("#card-weight-value");
const dragLiftScaleValue = document.querySelector("#drag-lift-scale-value");
const dragLiftTimeValue = document.querySelector("#drag-lift-time-value");
const dragLiftDepthValue = document.querySelector("#drag-lift-depth-value");
const dragLiftDepthTimeValue = document.querySelector("#drag-lift-depth-time-value");
const dragResponseTimeValue = document.querySelector("#drag-response-time-value");
const dragDampingValue = document.querySelector("#drag-damping-value");
const dragDanglinessValue = document.querySelector("#drag-dangliness-value");
const dragMaxTiltValue = document.querySelector("#drag-max-tilt-value");
const dragMaxTwistValue = document.querySelector("#drag-max-twist-value");
const dragPivotTiltValue = document.querySelector("#drag-pivot-tilt-value");
const dragMaxPivotTiltValue = document.querySelector("#drag-max-pivot-tilt-value");
const dragPivotResponseValue = document.querySelector("#drag-pivot-response-value");
const dragUprightValue = document.querySelector("#drag-upright-value");
const dragLandingTimeValue = document.querySelector("#drag-landing-time-value");
const dragLandingBounceValue = document.querySelector("#drag-landing-bounce-value");
const dragWeightInfluenceValue = document.querySelector("#drag-weight-influence-value");
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
  b1: { src: "/examples/card-engine-lab/assets/backgrounds/b1.png", fit: "cover" },
  b2: { src: "/examples/card-engine-lab/assets/backgrounds/b2.png", fit: "cover" },
  b3: { src: "/examples/card-engine-lab/assets/backgrounds/b3.png", fit: "cover" },
  b4: { src: "/examples/card-engine-lab/assets/backgrounds/b4.png", fit: "cover" },
  b5: { src: "/examples/card-engine-lab/assets/backgrounds/b5.png", fit: "cover" },
});
const LAB_CAMERA_CENTER = Object.freeze({ x: 450, y: 250 });
const LAB_CAMERA_UNITS_PER_PIXEL = 1;
const LAB_CAMERA_FOV = 55;
// Keep 1× at the lab's original 1.5× timing; the factor still scales
// proportionally from that baseline (higher is faster, lower is slower).
const LAB_MOTION_DURATION = 500 / 1.5;
const DRAG_MOTION_CONTROL_FIELDS = Object.freeze([
  ["liftScale", dragLiftScale],
  ["liftTime", dragLiftTime],
  ["liftDepth", dragLiftDepth],
  ["liftDepthTime", dragLiftDepthTime],
  ["responseTime", dragResponseTime],
  ["damping", dragDamping],
  ["dangle", dragDangliness],
  ["maxTilt", dragMaxTilt],
  ["maxTwist", dragMaxTwist],
  ["grabPivotTilt", dragPivotTilt],
  ["maxGrabTilt", dragMaxPivotTilt],
  ["grabPivotResponse", dragPivotResponse],
  ["upright", dragUpright],
  ["landingTime", dragLandingTime],
  ["landingBounce", dragLandingBounce],
  ["landingDelay", dragSnapDelay],
  ["weightInfluence", dragWeightInfluence],
]);

function readDragMotionControls() {
  const patch = Object.fromEntries(DRAG_MOTION_CONTROL_FIELDS.map(([field, control]) => [field, Number(control.value)]));
  if (dragMotionPreset.value !== "custom") patch.preset = dragMotionPreset.value;
  return patch;
}

let dragMotionState = normalizeDragMotion(readDragMotionControls());

function syncDragMotionControls(motion, { custom = false } = {}) {
  for (const [field, control] of DRAG_MOTION_CONTROL_FIELDS) control.value = String(motion[field]);
  dragMotionPreset.value = custom ? "custom" : motion.preset;
  updateControlLabels();
}

function setDragMotionPatch(patch, { custom = true } = {}) {
  try {
    const next = scene?.setDragMotion?.(patch) ?? normalizeDragMotion(patch, dragMotionState);
    const projectionNeedsRestart = scene
      && (next.liftDepth > 0) !== (scene.snapshot().projection === "perspective");
    dragMotionState = next;
    syncDragMotionControls(next, { custom });
    if (projectionNeedsRestart) {
      startScene();
      return;
    }
    if (scene?.setDragMotion) status.textContent = `Drag motion tuned: ${next.preset}.`;
  } catch (error) {
    interactionStatus.textContent = `Drag motion update failed: ${error instanceof Error ? error.message : String(error)}`;
    syncDragMotionControls(dragMotionState, { custom: dragMotionPreset.value === "custom" });
  }
}

function selectDragMotionPreset() {
  if (dragMotionPreset.value === "custom") return;
  const next = normalizeDragMotion({ preset: dragMotionPreset.value });
  // Keep the lab's established 80 ms pause when selecting Natural.
  if (next.preset === "natural") next.landingDelay = 80;
  setDragMotionPatch(next, { custom: false });
}

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
  { id: "lake", label: "Lake", anchor: "#zone-lake", arrangement: { type: "column", gap: 16 }, faceUp: true },
  { id: "river", label: "River", anchor: "#zone-river", arrangement: { type: "hand", curve: "concave" }, faceUp: true },
  { id: "ocean", label: "Ocean", anchor: "#zone-ocean", preset: "drawStack", arrangement: { type: "stack", axis: "y", step: 0 }, faceUp: false, reorderPolicy: { concealed: "deny" } },
]);
const ARRANGEMENT_CYCLE = Object.freeze(["grid", "row", "column", "splay", "pile", "stack", "hand"]);
const OVERFLOW_POLICIES = Object.freeze(["scroll", "overlap", "fit", "reject"]);
const zoneArrangements = new Map(LAB_ZONE_DEFINITIONS.map(({ id, arrangement }) => [id, { ...arrangement }]));
const zonePresets = new Map(LAB_ZONE_DEFINITIONS.map(({ id, preset }) => [id, preset]));
const zonePolicies = new Map(LAB_ZONE_DEFINITIONS.map(({ id, faceUp, reorderPolicy }) => [id, { faceUp, ...(reorderPolicy ? { reorderPolicy } : {}) }]));
const zoneArrangementSettingsOpen = new Map();
const ARRANGEMENT_SETTING_DEFINITIONS = Object.freeze([
  { key: "gap", label: "Gap", types: ["grid", "row", "column", "splay", "stack"], kind: "range", min: 0, max: 80, step: 1, defaultValue: 16, title: "Set the spacing between arranged cards." },
  { key: "columns", label: "Cols", types: ["grid"], kind: "select", options: [["", "Auto"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"]], defaultValue: "", title: "Set the number of grid columns, or let the zone fit them automatically." },
  { key: "alignment", label: "Align", types: ["row", "column"], kind: "select", options: [["start", "Start"], ["center", "Center"], ["end", "End"]], defaultValue: "center", title: "Align cards across the secondary axis." },
  { key: "spread", label: "Spread", types: ["splay", "pile", "hand"], kind: "range", min: 0, max: 120, step: 1, defaultValue: (type) => type === "hand" ? 56 : type === "pile" ? 24 : 30, suffix: "°", title: "Set the maximum splay spread; smaller hands scale it to their card count." },
  { key: "radius", label: "Radius", types: ["hand"], kind: "range", min: 0, max: 600, step: 5, defaultValue: 300, title: "Set the hand fan radius from its shared grip arc." },
  { key: "curve", label: "Curve", types: ["hand"], kind: "select", options: [["convex", "Convex · outer cards rise"], ["concave", "Concave · outer cards dip"]], defaultValue: "concave", title: "Choose whether the hand arc rises or dips at the outer cards." },
  { key: "angle", label: "Angle", types: ["pile"], kind: "range", min: 0, max: 45, step: 1, defaultValue: 8, suffix: "°", title: "Set the maximum random pile rotation." },
  { key: "step", label: "Step", types: ["stack"], kind: "range", min: 0, max: 80, step: 1, defaultValue: 0, title: "Set the offset between cards in the stack." },
  { key: "axis", label: "Axis", types: ["splay", "stack"], kind: "select", options: [["x", "Horizontal"], ["y", "Vertical"]], defaultValue: (type) => type === "stack" ? "y" : "x", title: "Choose the axis used by this arrangement." },
  { key: "depthStep", label: "Depth", types: ["grid", "row", "column", "splay", "pile", "stack", "hand"], kind: "range", min: 0, max: 40, step: 1, defaultValue: 8, title: "Set the minimum depth separation between cards." },
]);
const ZONE_POLICY_SETTING_DEFINITIONS = Object.freeze([
  { key: "orderMode", label: "Order", kind: "select", options: [["free", "Free"], ["locked", "Locked"]], defaultValue: "free", title: "Allow free reordering or enforce the zone's current membership order." },
  { key: "slotMode", label: "Slots", kind: "select", options: [["free", "Free"], ["fixed", "Fixed"]], defaultValue: "free", title: "Allow free insertion or keep configured cards in their assigned destination slots." },
  { key: "concealedReorder", label: "Concealed", kind: "select", options: [["allow", "Allow reorder"], ["deny", "Deny reorder"]], defaultValue: "allow", title: "Allow or deny changing the order of concealed cards in this zone." },
  { key: "selectionMode", label: "Select", kind: "select", options: [["free", "Free"], ["forced", "Force top N"]], defaultValue: "free", title: "Allow individual selection or force the top cards to be selected as one cohort." },
  { key: "selectionCount", label: "Draw", kind: "range", min: 1, max: 6, step: 1, defaultValue: 3, suffix: " cards", title: "Set how many top cards are selected together." },
  { key: "scale", label: "Size", kind: "range", min: 0.25, max: 2, step: 0.05, defaultValue: 1, suffix: "×", title: "Set the target card scale governed by this zone." },
  { key: "positionSpeed", label: "Move", group: "motion", kind: "range", min: 0.25, max: 3, step: 0.25, defaultValue: 1.5, suffix: "×", title: "Set how quickly cards align to this zone's target position." },
  { key: "orientationSpeed", label: "Turn", group: "motion", kind: "range", min: 0.25, max: 3, step: 0.25, defaultValue: 1.5, suffix: "×", title: "Set how quickly cards align to this zone's target orientation." },
  { key: "scaleSpeed", label: "Scale", group: "motion", kind: "range", min: 0.25, max: 3, step: 0.25, defaultValue: 1.5, suffix: "×", title: "Set how quickly cards align to this zone's target scale." },
  { key: "faceSpeed", label: "Flip", group: "motion", kind: "range", min: 0.25, max: 3, step: 0.25, defaultValue: 1.5, suffix: "×", title: "Set how quickly cards align to this zone's face side." },
  { key: "faceUp", kind: "select", options: [["", "Keep side"], ["true", "Revealed"], ["false", "Concealed"]], defaultValue: "", title: "Keep cards in this zone revealed or concealed." },
  { key: "preset", label: "Preset", kind: "select", options: [["", "Custom"], ["drawStack", "Draw stack"]], defaultValue: "", title: "Apply a reusable zone behavior preset." },
]);

const LAB_CONTROL_TOOLTIPS = Object.freeze([
  ["#move", "Start or stop continuous movement of the selected cards."],
  ["#rotate", "Start or stop continuous rotation of the selected cards."],
  ["#scale", "Start or stop continuous scaling of the selected cards."],
  ["#flip", "Start or stop continuous face flipping of the selected cards."],
  ["#spin", "Spin the selected cards around the chosen flip axis."],
  ["#combined", "Run a short combined move, rotate, scale, and flip demo."],
  ["#random", "Start or stop random card movement."],
  ["#animation-test", "Run the animation and retargeting test."],
  ["#reduced", "Use immediate transitions so reduced-motion results can be compared."],
  ["#shape", "Choose the card profile used by new and reset cards."],
  ["#face-count", "Choose how many logical faces each card has."],
  ["#card-sizing", "Choose fixed dimensions or content-driven card height."],
  ["#card-width", "Set the authored card width."],
  ["#card-height", "Set the authored card height."],
  ["#card-thickness", "Set the card thickness used for depth separation."],
  ["#card-weight", "Set how long target position, orientation, scale, and face transitions take for the selected cards."],
  ["#move-x", "Set the selected card's scene X position."],
  ["#move-y", "Set the selected card's scene Y position."],
  ["#motion-speed", "Adjust the speed of the animated controls."],
  ["#rotate-slider", "Set the selected card's authored rotation."],
  ["#scale-slider", "Set the selected card's authored scale."],
  ["#flip-axis", "Choose the axis used for flipping and spinning."],
  ["#flip-x-slider", "Set the selected card's X flip angle."],
  ["#flip-y-slider", "Set the selected card's Y flip angle."],
  ["#add-card", "Add a new card in the selected spawn zone."],
  ["#remove-cards", "Remove all currently selected cards."],
  ["#select-all", "Select every card in the scene."],
  ["#deselect-all", "Clear the current card selection."],
  ["#spawn-zone", "Choose where newly added cards are placed."],
  ["#drag-enabled", "Allow cards to be picked up and moved."],
  ["#drag-touch", "Enable touch dragging when using a touch-capable device."],
  ["#touch-selection", "Use touch taps to toggle card selection."],
  ["#drag-presentation", "Choose whether a carried selection keeps offsets or compacts."],
  ["#drag-anchor", "Choose whether pickup keeps the grab point or centers the card under the pointer."],
  ["#drag-motion-preset", "Choose a complete drag motion profile."],
  ["#drag-lift-scale", "Set the temporary scale while a card is carried."],
  ["#drag-lift-time", "Set how quickly the carried card reaches its lift scale."],
  ["#drag-response-time", "Set how quickly pointer motion changes the card response."],
  ["#drag-damping", "Set the damping ratio for free drag motion."],
  ["#drag-dangliness", "Set pickup and movement dangle response."],
  ["#drag-max-tilt", "Set the maximum local tilt from pointer motion."],
  ["#drag-max-twist", "Set the maximum in-plane twist from pointer motion."],
  ["#drag-upright", "Set the visual strength of the free-drag return toward upright."],
  ["#drag-landing-time", "Set how quickly a dropped card settles into its target."],
  ["#drag-landing-bounce", "Set the bounded overshoot at the end of a landing."],
  ["#drag-snap-delay", "Pause before a dropped card starts moving to its target."],
  ["#drag-weight-influence", "Set how strongly card weight changes perceived response and landing."],
  ["#drag-denied-card", "Choose a card that the lab drag rules will deny."],
  ["#drag-denied-zone", "Choose a destination zone that the lab drag rules will deny."],
  ["#drag-response", "Choose whether drops are accepted, rejected, delayed, or manual."],
  ["#batch-fixture", "Create a four-card batch fixture for drag testing."],
  ["#flip-selection", "Flip every selected card once."],
  ["#zone-slot", "Choose the insertion slot used by zone transfer buttons."],
  ["[data-transfer-zone=lake]", "Move the selected cards to Lake."],
  ["[data-transfer-zone=river]", "Move the selected cards to River."],
  ["[data-transfer-zone=ocean]", "Move the selected cards to Ocean."],
  ["#collect-diagnostics", "Refresh the renderer and device diagnostics report."],
  ["#run-diagnostics-benchmark", "Run the 1, 5, 10, 50, and 100-card benchmark."],
  ["#record-drag", "Capture timing and input details for the next drag."],
  ["#copy-diagnostics", "Copy the current benchmark report."],
  ["#full-window-control", "Toggle the stage into full-window inspection mode."],
  ["#inspection-hover", "Open card inspection after hovering over a card for the dwell time."],
  ["#element-type", "Choose the type of card element to add."],
  ["#add-element", "Add the selected element type to the active card face."],
  ["#background-side", "Choose which face receives the background."],
  ["#background-image", "Enter an image URL for the card background."],
  ["#background-fit", "Choose how the background image fits the card face."],
  ["#apply-background", "Apply the background image settings."],
]);

for (const [selector, tooltip] of LAB_CONTROL_TOOLTIPS) {
  for (const control of document.querySelectorAll(selector)) control.title = tooltip;
}
for (const button of document.querySelectorAll("[data-move-preset]")) button.title = `Move the selected cards to the ${button.dataset.movePreset} position.`;
for (const button of document.querySelectorAll("[data-rotate]")) button.title = `Set the selected cards to ${button.dataset.rotate} degrees.`;
for (const button of document.querySelectorAll("[data-scale]")) button.title = `Set the selected cards to ${Number(button.dataset.scale) * 100}% scale.`;
for (const button of document.querySelectorAll("[data-flip]")) button.title = button.dataset.flip === "1" ? "Conceal the selected cards." : "Reveal the selected cards.";
for (const button of document.querySelectorAll("[data-background-preset]")) button.title = button.dataset.backgroundPreset === "none"
  ? "Remove the background image."
  : `Apply the ${button.textContent.trim()} background preset.`;

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

function observeDragDiagnosticSession(interaction) {
  const capture = dragDiagnosticCapture;
  if (!capture) return;
  const session = interaction.sessions.find((item) => capture.intentId
    ? item.id === capture.intentId : item.primaryCardId === capture.cardId);
  if (session && !capture.intentId) {
    capture.intentId = session.id;
    capture.cardIds = [...session.cardIds];
    capture.primaryCardId = session.primaryCardId;
    capture.sources = structuredClone(session.sources);
    capture.sourceZoneId = capture.sources.find(({ cardId }) => cardId === capture.primaryCardId)?.zoneId ?? null;
  }
  // Resolution may be synchronous inside the drop listener. Finish later so its
  // outcome is recorded before a terminal interaction snapshot is reported.
  if (capture.intentId && !session) {
    capture.releasedAt ??= performance.now();
    scheduleDragDiagnosticFinish(capture, "interaction-ended");
  }
}

function scheduleDragDiagnosticFinish(capture, reason) {
  clearTimeout(capture.finishTimer);
  capture.finishTimer = setTimeout(() => {
    if (dragDiagnosticCapture !== capture) return;
    const pending = scene?.snapshot().interaction.sessions.some(({ id }) => id === capture.intentId);
    if (!pending) finishDragDiagnostic(reason);
  }, 250);
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
  const outcome = capture.outcome ?? (capture.intentId ? "cancelled" : "not-dragged");
  lastDragDiagnosticSample = {
    capturedAt: new Date().toISOString(),
    cardId: capture.cardId,
    cardIds: [...capture.cardIds],
    primaryCardId: capture.primaryCardId,
    cohortCount: capture.cardIds.length,
    sources: structuredClone(capture.sources),
    intentId: capture.intentId ?? null,
    cardCount: finalState?.desired?.cards?.length ?? null,
    browser: detectedBrowser(),
    deviceModel: navigator.userAgentData?.model || null,
    pointerType: capture.pointerType,
    sourceZoneId: capture.sourceZoneId,
    outcome,
    accepted: outcome === "accepted" ? true : outcome === "rejected" ? false : null,
    durationMs: Number(((capture.releasedAt ?? capture.endedAt) - capture.startedAt).toFixed(1)),
    resolutionDurationMs: Number((capture.endedAt - capture.startedAt).toFixed(1)),
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
    finalSources: capture.cardIds.flatMap((cardId) => (finalState?.desired?.zones ?? []).flatMap((zone) =>
      zone.cardIds.includes(cardId) ? [{ cardId, zoneId: zone.id, index: zone.cardIds.indexOf(cardId) }] : [])),
  };
  clearTimeout(capture.finishTimer);
  dragDiagnosticCapture = undefined;
  dragDiagnosticArmed = false;
  recordDragButton.textContent = "Record next drag";
  recordDragButton.setAttribute("aria-pressed", "false");
  void refreshDiagnostics("Drag sample captured; report refreshed.");
}

function captureDragDiagnosticFrame(now) {
  const capture = dragDiagnosticCapture;
  if (!capture || capture.releasedAt !== undefined) return;
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
    capture.releasedAt = performance.now();
    scheduleDragDiagnosticFinish(capture, "pointerup");
  } else if (event.type === "pointercancel") {
    capture.releasedAt = performance.now();
    scheduleDragDiagnosticFinish(capture, "pointercancel");
  }
}

function armDragDiagnostic() {
  if (dragDiagnosticCapture) return;
  dragDiagnosticArmed = !dragDiagnosticArmed;
  recordDragButton.textContent = dragDiagnosticArmed ? "Waiting for drag…" : "Record next drag";
  recordDragButton.setAttribute("aria-pressed", String(dragDiagnosticArmed));
  diagnosticsStatus.textContent = dragDiagnosticArmed
    ? "Ready: drag a card or selection with a mouse, pen, or touch contact."
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

const CARDINAL_QUIP_POOL = Object.freeze([
  "Bright wing.\nSharp song.",
  "Red feather.\nBold heart.",
  "Wait. Watch.\nTake flight.",
  "First light.\nFind the branch.",
  "Small song.\nWide sky.",
  "Red in the\nwinter hush.",
  "Perch high.\nSee far.",
  "Brave color.\nQuiet woods.",
  "Stay bright.\nThrough the cold.",
  "Find the sun.\nKeep singing.",
  "One wingbeat.\nFrom wonder.",
  "Scarlet against\nthe snow.",
  "The red has\narrived.",
  "Stillness, then\nsudden flight.",
  "Where the branch bends,\nI sing.",
  "Bright eyes.\nBrighter feathers.",
  "Winter bows to\na flash of red.",
  "Take the\nopen sky.",
  "A scarlet spark\nin the pines.",
  "Song first.\nQuestions later.",
  "Red wings know\nthe shortest way.",
  "Perch lightly.\nLeave boldly.",
  "A little flame\nwith feathers.",
  "Look up.\nThe red is there.",
  "Branch, breeze,\nand bright eyes.",
  "The forest keeps\na crimson secret.",
  "Flap once.\nMake it count.",
  "Dawn finds me\nalready singing.",
  "A flash of red\nbeats winter gray.",
  "Small bird.\nLarge announcement.",
  "The boldest color\nchooses quiet woods.",
  "Keep watch.\nKeep warm.",
  "Feathers bright\nas a morning ember.",
  "No map needed\nfor the open branch.",
  "A red note\nthrough the trees.",
  "Still wings.\nSudden sky.",
  "The snow remembers\nwhere I landed.",
  "A bright answer\nto a gray day.",
  "Find a branch.\nFind your song.",
  "Red among leaves.\nHome among clouds.",
  "The wind turns.\nI turn with it.",
  "One clear note\ncan wake the woods.",
  "Scarlet feathers,\nsteady courage.",
  "A quiet perch\nfor a loud heart.",
  "Fly toward\nthe warmer light.",
  "The forest blushes\nwhen I arrive.",
  "Bright beak.\nBrighter morning.",
  "A wingbeat away\nfrom wonder.",
  "Red travels\nwell through snow.",
  "Sing softly.\nStand out anyway.",
]);
const KINGFISHER_QUIP_POOL = Object.freeze([
  "Blue fire over\nstill water.",
  "Dive fast.\nRise brighter.",
  "The river keeps\nmy best secrets.",
  "A flash of blue\nacross the current.",
  "Still branch.\nSudden splash.",
  "Wait for the\nperfect ripple.",
  "Water below.\nSky within.",
  "The shallows\nknow my name.",
  "One dive.\nOne bright answer.",
  "Blue wings\nfollow clear water.",
  "The current bends.\nI follow.",
  "Quiet perch.\nQuick plunge.",
  "A silver flash\nunder open sky.",
  "Patience makes\nthe best splash.",
  "The river moves.\nI wait.",
  "Deep blue\nand a sharp eye.",
  "Catch the light.\nCatch the moment.",
  "A ripple starts\nthe whole story.",
  "Cold water.\nWarm sun.",
  "The lake holds\na thousand reflections.",
  "Blue over stone.\nGold under wing.",
  "Look down.\nThen dive.",
  "The fastest path\nis through the water.",
  "A bright wingbeat\nagainst the reeds.",
  "River glass.\nKingfisher spark.",
  "Wait where\nthe shadows gather.",
  "The current carries\nwhat courage begins.",
  "A clear sky\nfor a clear dive.",
  "Small bird.\nPerfect timing.",
  "Blue feathers\nmake their own weather.",
  "The water speaks\nin silver circles.",
  "One quiet minute.\nOne sudden flight.",
  "The branch bends.\nThe beak points.",
  "A splash of blue\nfinds the sun.",
  "Follow the river\nuntil it shines.",
  "The lake waits.\nSo do I.",
  "Bright wings\nprefer bright mornings.",
  "Dive beneath\nthe ordinary.",
  "A blue spark\nwith a steady aim.",
  "Water below.\nWonder ahead.",
  "The reeds part\nfor one quick flash.",
  "Still water\nrewards stillness.",
  "A silver turn\nunder a blue sky.",
  "Find the ripple.\nFind the fish.",
  "The river runs.\nThe wing follows.",
  "Clear eyes.\nClean dive.",
  "Blue light\ntravels fast.",
  "From branch\nto bright water.",
  "A quiet hunter\nwith a loud entrance.",
  "The lake reflects\nwhat the wing remembers.",
]);
const OWL_QUIP_POOL = Object.freeze([
  "Night keeps watch\nover the wild.",
  "Moon above.\nSilence below.",
  "The dark has\nexcellent details.",
  "Quiet wings\nknow every path.",
  "Stay still.\nSee everything.",
  "The forest whispers.\nI listen.",
  "Stars out.\nEyes open.",
  "A soft flight\nthrough colder air.",
  "The dusk belongs\nto patient watchers.",
  "Look twice.\nThe night moves.",
  "Moonlit branch.\nPerfect view.",
  "Silence is\na useful signal.",
  "The wild sleeps.\nI do not.",
  "Dark feathers.\nSharp questions.",
  "A quiet turn\nthrough the pines.",
  "Night knows\nwhere the trails lead.",
  "One blink.\nOne hundred clues.",
  "The moon rises.\nThe watch begins.",
  "Soft wings\nleave no footnote.",
  "A patient gaze\nfinds the hidden path.",
  "The woods grow\nclearer after sunset.",
  "Still branch.\nRestless stars.",
  "Listen first.\nFly second.",
  "The dark keeps\nits own company.",
  "Night air\nsharpens every sound.",
  "A pale moon\nand a darker forest.",
  "Watch the branch.\nTrust the silence.",
  "The smallest rustle\ncan tell a story.",
  "Twilight opens\nthe hidden world.",
  "Quiet eyes\ncarry far.",
  "The pines hold\nold midnight secrets.",
  "A shadow moves.\nI already saw it.",
  "Cold stars.\nWarm feathers.",
  "The night is\nwide awake.",
  "Perch high.\nListen low.",
  "Darkness brings\nits own lanterns.",
  "The forest settles.\nI remain.",
  "A silent wing\ncan cross a thought.",
  "Moonlight makes\nevery branch honest.",
  "Watchful by nature.\nCurious by choice.",
  "The trail ends.\nThe story does not.",
  "A hush between\ntwo heartbeats.",
  "Night sees\nwhat daylight misses.",
  "Feathers soft.\nFocus sharp.",
  "Every shadow\nhas a direction.",
  "The owl knows\nwhen the wind changes.",
  "Stars overhead.\nWild below.",
  "A quiet perch\nfor a careful thought.",
  "Dusk falls.\nAttention rises.",
  "The woods speak\nin very small sounds.",
]);
const QUIP_POOLS = Object.freeze({
  cardinal: CARDINAL_QUIP_POOL,
  kingfisher: KINGFISHER_QUIP_POOL,
  owl: OWL_QUIP_POOL,
});
function randomQuip(kind = "cardinal") {
  const pool = QUIP_POOLS[kind] ?? CARDINAL_QUIP_POOL;
  return pool[Math.floor(Math.random() * pool.length)];
}

const logicalFaceDefinitions = [
  {
    id: "face-a",
    elements: [
      {
        id: "eyebrow",
        type: "text",
        content: { text: "FIELD GUIDE · 001" },
        style: { variant: "flavour", color: "#e5c07b", font: "700 10px ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: 13 },
        layout: { mode: "flow", order: 0 },
      },
      {
        id: "title",
        type: "text",
        content: { text: "The Cardinal" },
        style: { variant: "title", color: "#f7f4e9", font: "800 21px system-ui, sans-serif", lineHeight: 25 },
        layout: { mode: "flow", order: 1 },
      },
      {
        id: "image",
        type: "image",
        content: { src: "/examples/card-engine-lab/majestic.png", alt: "A majestic red cardinal perched on a branch in an autumn forest" },
        layout: { mode: "flow", order: 2, height: 0.472 },
      },
      {
        id: "flavour",
        type: "text",
        content: { text: "" },
        style: { variant: "flavour", color: "#d7dee8", font: "500 13px system-ui, sans-serif", lineHeight: 18 },
        layout: { mode: "flow", order: 3 },
      },
      {
        id: "specimen",
        type: "text",
        content: { text: "SPECIMEN · 001" },
        style: { variant: "flavour", color: "#9da7b3", font: "700 9px ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: 12 },
        layout: { mode: "flow", order: 4 },
      },
    ],
    background: "#17212b",
    backgroundImage: { src: "/examples/card-engine-lab/assets/backgrounds/b1.png", fit: "cover" },
    textColor: "#f7f4e9",
    mutedTextColor: "#d7dee8",
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
  quipPool: "cardinal",
  back: {
    elements: [
      {
        id: "cardinal-logo",
        type: "image",
        content: { src: "/examples/card-engine-lab/assets/cards/paint.png", alt: "Cardinal paint logo" },
        layout: { mode: "overlay", x: 0.2, y: 0.3, width: 0.6, height: 0.36, zIndex: 1 },
      },
    ],
    background: "#17212b",
    backgroundImage: { src: "/examples/card-engine-lab/assets/backgrounds/b4.png", fit: "cover" },
    textColor: "#f7f4e9",
    mutedTextColor: "#bdcbd0",
  },
  template: "illustrated",
};

function artCard({ id, zoneId, title, image, alt, quipPool, flavour, specimen, background, backgroundImage }) {
  return {
    ...baseCard,
    id,
    quipPool,
    pose: { scale: defaultCardScale() },
    faces: {
      "face-a": {
        background,
        backgroundImage: { src: backgroundImage, fit: "cover" },
        elements: [
          { id: "title", content: { text: title } },
          { id: "image", content: { src: image, alt } },
          { id: "flavour", content: { text: flavour ?? randomQuip(quipPool) } },
          { id: "specimen", content: { text: specimen } },
        ],
      },
    },
    zoneId,
  };
}

const additionalLabCards = [
  artCard({
    id: "ice-demo",
    zoneId: "ocean",
    quipPool: "kingfisher",
    title: "The Kingfisher",
    image: "/examples/card-engine-lab/assets/cards/ice.png",
    alt: "A blue kingfisher perched on a branch above a mountain lake",
    specimen: "SPECIMEN · 002",
    background: "#123f5a",
    backgroundImage: "/examples/card-engine-lab/assets/backgrounds/b2.png",
  }),
  artCard({
    id: "owl-demo",
    zoneId: "lake",
    quipPool: "owl",
    title: "The Owl",
    image: "/examples/card-engine-lab/assets/cards/owl.png",
    alt: "A stylized owl perched on a rocky overlook above a mountain lake",
    specimen: "SPECIMEN · 003",
    background: "#483323",
    backgroundImage: "/examples/card-engine-lab/assets/backgrounds/b3.png",
  }),
];

const LAB_CARD_PROTOTYPES = Object.freeze([
  baseCard,
  ...additionalLabCards.map(({ zoneId, ...card }) => card),
]);

const initialOceanCards = Array.from({ length: 47 }, (_, index) => {
  const prototype = LAB_CARD_PROTOTYPES[Math.floor(Math.random() * LAB_CARD_PROTOTYPES.length)];
  return {
    ...randomizeCardQuip(prototype),
    id: `ocean-card-${String(index + 1).padStart(2, "0")}`,
    zoneId: "ocean",
    faceUp: false,
    pose: { scale: defaultCardScale() },
  };
});

let cardZoneIds = new Map([
  [baseCard.id, "river"],
  ...additionalLabCards.map(({ id, zoneId }) => [id, zoneId]),
  ...initialOceanCards.map(({ id }) => [id, "ocean"]),
]);

let selectedCardIds = new Set([baseCard.id]);
let selectionReason = "";
let nextCardNumber = 2;
let nextElementNumber = 1;
let renderedElementKey;
let scene;
let interactionLifecycle;
let lastInteractionStatusAt = 0;
let lastInteractionStatusKey = "";
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
  const rendererDiagnostics = scene?.rendererDiagnostics?.() ?? null;
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
      rendererDiagnostics,
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

async function copyDiagnosticsText(text) {
  try {
    if (typeof navigator.clipboard?.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Try the document copy path for HTTP device sessions and restricted browsers.
  }
  const fallback = document.createElement("textarea");
  fallback.value = text;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.top = "0";
  fallback.style.left = "-9999px";
  document.body.append(fallback);
  fallback.focus();
  fallback.select();
  fallback.setSelectionRange(0, text.length);
  try {
    return document.execCommand?.("copy") === true;
  } catch {
    return false;
  } finally {
    fallback.remove();
  }
}

function selectDiagnosticsReport() {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(diagnosticsReport);
  selection?.removeAllRanges();
  selection?.addRange(range);
  diagnosticsReport.scrollIntoView({ block: "nearest" });
}

async function runDiagnosticsBenchmark() {
  if (!scene || runDiagnosticsBenchmarkButton.disabled) return;
  runDiagnosticsBenchmarkButton.disabled = true;
  collectDiagnosticsButton.disabled = true;
  copyDiagnosticsButton.disabled = true;
  diagnosticsStatus.textContent = "Running 1-, 5-, 10-, 50-, and 100-card benchmark…";
  const originalCards = structuredClone(scene.snapshot().desired.cards);
  const originalSelection = [...selectedCardIds];
  const originalZoneMembership = new Map(cardZoneIds);
  const benchmarkResults = [];
  let restored = false;
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const waitForReady = async (count, timeout = 20000) => {
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeout) {
      const current = scene.snapshot();
      const rendererDiagnostics = scene.rendererDiagnostics?.() ?? null;
      if (current.desired.cards.length === count
        && current.visual.length === count
        && rendererDiagnostics?.mountedCards === count
        && !current.settling
        && (rendererDiagnostics.imageSources?.pending ?? 0) === 0
        && (rendererDiagnostics.textures?.pending ?? 0) === 0) {
        return {
          state: current,
          rendererDiagnostics,
          readyMs: performance.now() - startedAt,
        };
      }
      await sleep(50);
    }
    throw new Error(`Benchmark fixture with ${count} cards did not become ready`);
  };
  try {
    stopRandomMotion();
    stopDemoAnimations();
    scene.setSelectionHighlightVisible(false);
    const source = structuredClone(originalCards[0] ?? initialCards()[0]);
    for (const count of [1, 5, 10, 50, 100]) {
      const cards = [];
      for (let index = 0; index < count; index += 1) {
        cards.push({
          ...structuredClone(source),
          id: `benchmark-card-${count}-${index + 1}`,
          faceUp: true,
          positionMode: "absolute",
          pose: { ...structuredClone(source.pose ?? {}), ...nextCardPosition(cards), scale: 1 },
        });
      }
      cardZoneIds = new Map(cards.map(({ id }) => [id, "river"]));
      selectedCardIds = new Set(cards.map(({ id }) => id));
      const setupStart = performance.now();
      applyLabCards(cards, { singleFace: true });
      const setupMs = performance.now() - setupStart;
      const ready = await waitForReady(count);
      const readyDiagnostics = ready.rendererDiagnostics ?? {};
      await sleep(150);
      const workBefore = scene.rendererDiagnostics?.()?.work;
      const actionStart = performance.now();
      toggleRandomMotion();
      const startHandlerMs = performance.now() - actionStart;
      const frameTimes = [];
      let firstFrameMs = null;
      const sampleStart = performance.now();
      await new Promise((resolve) => {
        const sample = (now) => {
          firstFrameMs ??= performance.now() - actionStart;
          frameTimes.push(now);
          if (now - sampleStart < 1500) requestAnimationFrame(sample);
          else resolve();
        };
        requestAnimationFrame(sample);
      });
      const sampledRenderer = scene.rendererDiagnostics?.();
      const workWindowMs = performance.now() - actionStart;
      stopRandomMotion();
      await sleep(500);
      const intervals = frameTimes.slice(1).map((time, index) => time - frameTimes[index]);
      const sorted = [...intervals].sort((a, b) => a - b);
      const percentile = (values, fraction) => values.length
        ? values[Math.min(values.length - 1, Math.floor(values.length * fraction))]
        : 0;
      const elapsedMs = frameTimes.length > 1 ? frameTimes.at(-1) - frameTimes[0] : 0;
      benchmarkResults.push({
        cards: count,
        setupMs: Number(setupMs.toFixed(1)),
        readyMs: Number(ready.readyMs.toFixed(1)),
        assets: readyDiagnostics.imageSources ?? null,
        startHandlerMs: Number(startHandlerMs.toFixed(1)),
        firstFrameMs: Number((firstFrameMs ?? 0).toFixed(1)),
        workload: "selected cards; random move, rotate and physical flip; warm active face and back",
        sampleMs: Number(elapsedMs.toFixed(1)),
        workWindowMs: Number(workWindowMs.toFixed(1)),
        renderer: sampledRenderer ? {
          ...sampledRenderer,
          work: Object.fromEntries(Object.entries(sampledRenderer.work).map(([key, value]) => [key,
            Number((value - (workBefore?.[key] ?? 0)).toFixed(2))])),
        } : null,
        fps: Number((elapsedMs > 0 ? (frameTimes.length - 1) * 1000 / elapsedMs : 0).toFixed(1)),
        frames: frameTimes.length,
        medianFrameMs: Number(percentile(sorted, 0.5).toFixed(1)),
        p95FrameMs: Number(percentile(sorted, 0.95).toFixed(1)),
        missedFramesOver20Ms: intervals.filter((interval) => interval > 20).length,
      });
    }
    lastDiagnosticsBenchmark = benchmarkResults;
    cardZoneIds = originalZoneMembership;
    selectedCardIds = new Set(originalSelection);
    applyLabCards(originalCards);
    restored = true;
    await refreshDiagnostics("Benchmark complete; the lab state was restored.");
  } catch (error) {
    diagnosticsStatus.textContent = `Benchmark failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    stopRandomMotion();
    stopDemoAnimations();
    cardZoneIds = originalZoneMembership;
    selectedCardIds = new Set(originalSelection);
    scene.setSelectionHighlightVisible(true);
    if (!restored) applyLabCards(originalCards);
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
  const cardLabel = cardDisplayName(hit.card, cardIndex - 1);
  const side = engineHit?.side ?? hit.visual.physicalSide ?? "unknown";
  if (side === "edge") return { kind: "card", cardId: hit.card.id, label: `${cardLabel} · Edge` };
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
    label: element ? `${cardLabel} · ${capitalizeDisplayName(side)} · ${element.id}` : `${cardLabel} · ${capitalizeDisplayName(side)}`,
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

function configuredCard(sourceCard, { singleFace = false } = {}) {
  const definitions = singleFace
    ? logicalFaceDefinitions.filter(({ id }) => id === sourceCard.activeFaceId)
    : logicalFaceDefinitions.slice(0, Number(faceCount.value));
  const faces = definitions.map((face) => {
    const sourceFace = sourceCard.faces?.[face.id];
    const merged = mergeFace(face, sourceFace);
    if (face.id === "face-a" && !sourceFace) {
      const flavour = merged.elements.find(({ id }) => id === "flavour");
      if (flavour) flavour.content = { ...flavour.content, text: randomQuip(sourceCard.quipPool) };
    }
    return merged;
  });
  const card = {
    ...sourceCard,
    faces: Object.fromEntries(faces.map((face) => [face.id, face])),
    template: shape.value,
    sizing: cardSizing.value === "content" ? { mode: "content", minHeight: 120, maxHeight: 480 } : { mode: "fixed" },
  };
  delete card.quipPool;
  delete card.faceCycleNextFaceId;
  if (!faces.some(({ id }) => id === card.activeFaceId)) card.activeFaceId = faces[0].id;
  if (faces.length > 1) card.faceCycle = faces.map(({ id }) => id);
  else delete card.faceCycle;
  return card;
}

function randomizeCardQuip(sourceCard) {
  const card = structuredClone(sourceCard);
  const flavour = card.faces?.["face-a"]?.elements?.find(({ id }) => id === "flavour");
  if (flavour) flavour.content = { ...flavour.content, text: randomQuip(card.quipPool) };
  return card;
}

function initialCards() {
  const flipX = Number(flipXSlider.value);
  const flipY = Number(flipYSlider.value);
  const faceUp = Math.cos(flipX * Math.PI / 180) * Math.cos(flipY * Math.PI / 180) >= 0;
  return [
    {
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
    },
    ...additionalLabCards.map(({ zoneId, ...card }) => ({ ...card, template: shape.value })),
    ...initialOceanCards.map((card) => ({ ...card, template: shape.value })),
  ];
}

function sceneCards() {
  return scene?.snapshot().desired.cards ?? initialCards();
}

function zoneSnapshot(cards) {
  const cardIds = new Set(cards.map(({ id }) => id));
  for (const id of cardZoneIds.keys()) {
    if (!cardIds.has(id)) cardZoneIds.delete(id);
  }
  const committed = scene?.snapshot().desired.zones ?? [];
  const memberships = new Map(LAB_ZONE_DEFINITIONS.map(({ id }) => [id,
    (committed.find((zone) => zone.id === id)?.cardIds ?? [])
      .filter((cardId) => cardIds.has(cardId) && cardZoneIds.get(cardId) === id),
  ]));
  for (const card of cards) {
    const zoneId = memberships.has(cardZoneIds.get(card.id)) ? cardZoneIds.get(card.id) : "river";
    cardZoneIds.set(card.id, zoneId);
    if (!memberships.get(zoneId).includes(card.id)) memberships.get(zoneId).push(card.id);
  }
  return LAB_ZONE_DEFINITIONS.map(({ id, label, anchor, geometry }) => {
    const committedZone = committed.find((zone) => zone.id === id);
    const policy = zonePolicies.get(id) ?? {};
    const preset = zonePresets.get(id);
    const zone = {
      ...committedZone,
      ...policy,
      ...(policy.motion ? { motion: { ...(committedZone?.motion ?? {}), ...policy.motion } } : {}),
      id,
      label,
      ...(preset ? { preset } : {}),
      ...(anchor ? { anchor } : { geometry }),
      cardIds: memberships.get(id),
      arrangement: zoneArrangements.get(id) ?? { type: "grid", gap: 16 },
      visible: zoneVisibility.get(id) !== false,
    };
    if (preset === undefined) delete zone.preset;
    if (zone.orderPolicy?.mode === "locked") {
      const currentIds = new Set(cards.map(({ id: cardId }) => cardId));
      const order = zone.orderPolicy.order.filter((cardId) => currentIds.has(cardId));
      order.push(...cards.map(({ id: cardId }) => cardId).filter((cardId) => !order.includes(cardId)));
      zone.orderPolicy = { mode: "locked", order };
    }
    if (zone.slotPolicy?.mode === "fixed") {
      const currentIds = new Set(cards.map(({ id: cardId }) => cardId));
      zone.slotPolicy = {
        mode: "fixed",
        slots: Object.fromEntries(Object.entries(zone.slotPolicy.slots).filter(([cardId]) => currentIds.has(cardId))),
      };
    }
    if (Object.hasOwn(policy, "faceUp")) {
      if (policy.faceUp === null) delete zone.faceUp;
      else zone.faceUp = policy.faceUp;
    }
    if (!Object.hasOwn(policy, "selectionPolicy")) delete zone.selectionPolicy;
    return zone;
  });
}

function desiredSnapshot(cards = sceneCards(), options = {}) {
  return {
    cards: cards.map((card) => configuredCard(card, options)),
    zones: zoneSnapshot(cards),
  };
}

function cardFootprint(card) {
  const scale = card.pose?.scale ?? 1;
  return {
    width: (card.dimensions?.width ?? 220) * scale,
    height: (card.dimensions?.height ?? 307) * scale,
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
  return state.desired.cards.find(({ id }) => id === state.selection.primaryCardId)
    ?? state.desired.cards.find(({ id }) => selectedCardIds.has(id));
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
    await scene.transact(operations, { zoneFacePolicy: "override" }).finished;
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
    await scene.transact(operations, { zoneFacePolicy: "override" }).finished;
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
    if (operations.length > 0) await scene.transact(operations, { zoneFacePolicy: "override" }).finished;
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
  canTake() {
    return dragEnabled.checked
      ? { allowed: true }
      : { allowed: false, reason: "Dragging is disabled in the lab." };
  },
  canPut(request) {
    if (!request.cardIds?.length) return { allowed: false, reason: "No cards in the proposed batch." };
    if (request.cardIds.includes(dragDeniedCard.value)) {
      return { allowed: false, reason: `${cardDisplayNameForId(dragDeniedCard.value)} is denied; the whole batch is unavailable.` };
    }
    const toZoneId = interactionDestination(request);
    if (!toZoneId) return { allowed: false, reason: "No visible destination zone." };
    if (dragDeniedZone.value && toZoneId === dragDeniedZone.value) {
      const label = zoneDisplayName(LAB_ZONE_DEFINITIONS.find(({ id }) => id === toZoneId) ?? toZoneId);
      return { allowed: false, reason: `${label} is denied by the lab rule.` };
    }
    return { allowed: true };
  },
  canReveal() {
    return { allowed: true };
  },
  canConceal() {
    return { allowed: true };
  },
  canSpin() {
    return { allowed: true };
  },
  canChangeFace() {
    return { allowed: true };
  },
};

function cohortLabel({ cardIds = [], primaryCardId } = {}) {
  return `${cardIds.length} card${cardIds.length === 1 ? "" : "s"} (primary ${primaryCardId
    ? cardDisplayNameForId(primaryCardId)
    : "None"})`;
}

function renderPendingDropControls() {
  const hasPending = Boolean(interactionLifecycle?.pending.size);
  dragAcceptButton.hidden = !hasPending;
  dragRejectButton.hidden = !hasPending;
  dragAcceptButton.disabled = !hasPending;
  dragRejectButton.disabled = !hasPending;
}

function disposeInteractionLifecycle() {
  if (dragDiagnosticCapture) {
    dragDiagnosticCapture.outcome = "cancelled";
    finishDragDiagnostic("scene-recreated");
  }
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

function interactionStatusKey(interaction) {
  return JSON.stringify((interaction?.sessions ?? []).map((session) => ({
    id: session.id,
    phase: session.phase,
    candidate: session.candidate && {
      toZoneId: session.candidate.toZoneId,
      index: session.candidate.index,
      allowed: session.candidate.allowed,
      reason: session.candidate.reason,
    },
  })));
}

function shouldPaintInteractionStatus(interaction) {
  const key = interactionStatusKey(interaction);
  const now = performance.now();
  const important = key !== lastInteractionStatusKey;
  if (important || now - lastInteractionStatusAt >= 100) {
    lastInteractionStatusKey = key;
    lastInteractionStatusAt = now;
    return true;
  }
  return false;
}

function interactionZoneLabel(state, zoneId) {
  return zoneDisplayName(
    state?.zones?.find(({ id }) => id === zoneId)
      ?? state?.desired?.zones?.find(({ id }) => id === zoneId)
      ?? zoneId
      ?? "Destination",
  );
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
  const cardLabel = cohortLabel(session);
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
      ? `Drop accepted: ${cohortLabel(intent)} → ${interactionZoneLabel(sceneInstance.snapshot(), intent.toZoneId)} at slot ${intent.index}.`
      : outcome?.status === "rejected"
        ? `Drop rejected for ${cohortLabel(intent)}.`
        : `Drop response is stale for ${cohortLabel(intent)}.`;
    if (dragDiagnosticCapture?.intentId === intentId) {
      dragDiagnosticCapture.outcome = outcome?.status === "stale" ? "cancelled" : outcome?.status;
    }
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
  const previousSelection = scene?.snapshot().selection;
  const desired = desiredSnapshot(cards);
  dragMotionState = normalizeDragMotion(readDragMotionControls(), dragMotionState);
  lastInteractionStatusAt = 0;
  lastInteractionStatusKey = "";
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
        illustrated: { width: 220, height: 307, thickness: 6, shape: "rounded-rectangle" },
        shield: { width: 220, height: 307, thickness: 6, shape: "shield" },
      },
      camera: {
        // A camera-facing lift is invisible in an orthographic projection.
        // Switch only while depth lift is enabled so the normal lab keeps its
        // established stage geometry and the 3D control gets a visible cue.
        projection: dragMotionState.liftDepth > 0 ? "perspective" : "orthographic",
        distance: Math.max(1, stage.getBoundingClientRect().height
          / (2 * Math.tan(LAB_CAMERA_FOV * Math.PI / 360))),
        fov: LAB_CAMERA_FOV,
        scaleMode: "stage",
        unitsPerPixel: LAB_CAMERA_UNITS_PER_PIXEL,
        center: LAB_CAMERA_CENTER,
      },
      motion: {
        reducedMotion: reduced.getAttribute("aria-pressed") === "true",
        duration: LAB_MOTION_DURATION / Number(motionSpeedSlider.value),
      },
      selection: { allowCrossZone: crossZoneSelection.checked },
      inspection: { input: { hover: inspectionHover.checked, dwell: 650, dismissDelay: 180, touchHold: 550 } },
      interaction: {
        rules: interactionRules,
        touchDrag: touchDrag.checked,
        touchSelection: touchSelection.checked,
        dragPresentation: dragPresentation.value,
        dragAnchor: dragAnchor.value,
        motion: readDragMotionControls(),
      },
    });
    scene = createdScene;
    labInspection = undefined;
    const lifecycle = { active: true, scene: createdScene, timers: new Map(), pending: new Map(), outcome: "" };
    interactionLifecycle = lifecycle;
    createdScene.apply(desired);
    createdScene.on("change", updateStatus);
    createdScene.on("renderer-status", updateStatus);
    createdScene.on("inspection-change", () => {
      const open = createdScene.snapshot().inspection.sessions.length > 0;
      inspectionStatus.textContent = "";
      inspectionStatus.dataset.open = String(open);
      inspectionStatus.setAttribute("aria-label", open ? "Inspection open" : "No inspection open");
      inspectionStatus.title = open ? "Inspection open" : "No inspection open";
    });
    createdScene.on("selection-change", (selection) => {
      if (scene !== createdScene || !lifecycle.active) return;
      selectedCardIds = new Set(selection.cardIds);
      selectionReason = "";
      syncControlsFromSelection();
    });
    createdScene.on("interaction-change", (interaction) => {
      if (scene !== createdScene || !lifecycle.active) return;
      observeDragDiagnosticSession(interaction);
      prunePendingDrops(lifecycle, interaction);
      if (shouldPaintInteractionStatus(interaction)) updateStatus(createdScene.snapshot(), interaction, true);
    });
    createdScene.on("drop", (intent) => respondToDrop(createdScene, lifecycle, intent));
    selectedCardIds = new Set([...selectedCardIds].filter((id) => cards.some((card) => card.id === id)));
    selectLabCards([...selectedCardIds], previousSelection ? {
      primaryCardId: previousSelection.primaryCardId,
      anchorCardId: previousSelection.anchorCardId,
    } : {});
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

function applyLabCards(cards, options = {}) {
  const previousSelection = scene.snapshot().selection;
  const requestedSelection = [...selectedCardIds].filter((id) => cards.some((card) => card.id === id));
  scene.apply(desiredSnapshot(cards, options));
  selectLabCards(requestedSelection, requestedSelection.includes(previousSelection.primaryCardId) ? {
    primaryCardId: previousSelection.primaryCardId,
    anchorCardId: previousSelection.anchorCardId,
  } : {});
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
  for (const row of zoneList.querySelectorAll(".zone-row")) {
    const settings = row.querySelector(".zone-arrangement-settings");
    if (settings) zoneArrangementSettingsOpen.set(row.dataset.zoneId, settings.open);
  }
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
    name.textContent = `${zoneDisplayName(zone)}${zone.visible === false ? " · Hidden" : ""}`;
    const count = document.createElement("span");
    count.className = "zone-count";
    count.textContent = `${zone.cardIds.length} card${zone.cardIds.length === 1 ? "" : "s"}`;
    const visibility = document.createElement("button");
    visibility.type = "button";
    visibility.textContent = zone.visible === false ? "Show" : "Hide";
    visibility.title = zone.visible === false ? "Show this zone and its cards." : "Hide this zone while preserving its cards.";
    visibility.addEventListener("click", () => toggleZone(zone.id));
    const arrangement = document.createElement("select");
    arrangement.dataset.zoneArrangement = zone.id;
    arrangement.setAttribute("aria-label", `Arrangement for ${zoneDisplayName(zone)}`);
    arrangement.title = "Choose grid, row, column, splay, pile, stack, or hand placement.";
    for (const type of ARRANGEMENT_CYCLE) {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type[0].toUpperCase() + type.slice(1);
      arrangement.append(option);
    }
    arrangement.value = zone.arrangement?.type ?? "grid";
    arrangement.addEventListener("change", () => updateZoneArrangement(zone.id, { type: arrangement.value }));
    const overflow = document.createElement("select");
    overflow.dataset.zoneOverflow = zone.id;
    overflow.setAttribute("aria-label", `Overflow for ${zoneDisplayName(zone)}`);
    overflow.title = "Choose scrolling, intentional overlap, bounded fitting, or rejection.";
    for (const policy of OVERFLOW_POLICIES) {
      const option = document.createElement("option");
      option.value = policy;
      option.textContent = policy[0].toUpperCase() + policy.slice(1);
      overflow.append(option);
    }
    overflow.value = zone.arrangement?.overflow ?? "scroll";
    overflow.addEventListener("change", () => updateZoneArrangement(zone.id, { overflow: overflow.value }));
    const cycle = document.createElement("button");
    cycle.type = "button";
    cycle.dataset.zoneCycle = zone.id;
    cycle.textContent = "Next";
    cycle.title = "Advance this zone to the next arrangement type.";
    cycle.addEventListener("click", () => cycleZoneArrangement(zone.id));
    const reorder = document.createElement("button");
    reorder.type = "button";
    reorder.dataset.zoneReorder = zone.id;
    reorder.textContent = "Reverse";
    reorder.title = "Reverse the zone's explicit card order.";
    reorder.addEventListener("click", () => reverseZoneOrder(zone.id));
    const controls = document.createElement("div");
    controls.className = "zone-row-controls";
    controls.append(visibility, arrangement, overflow, cycle, reorder);
    const settings = document.createElement("details");
    settings.className = "zone-arrangement-settings";
    settings.open = zoneArrangementSettingsOpen.get(zone.id) === true;
    settings.addEventListener("toggle", () => zoneArrangementSettingsOpen.set(zone.id, settings.open));
    const settingsSummary = document.createElement("summary");
    settingsSummary.textContent = "Arrangement & alignment";
    settingsSummary.title = "Adjust placement, target scale, face side, and alignment speeds for this zone.";
    const fields = document.createElement("div");
    fields.className = "zone-arrangement-fields";
    const arrangementType = zone.arrangement?.type ?? "grid";
    for (const definition of ARRANGEMENT_SETTING_DEFINITIONS.filter(({ types }) => types.includes(arrangementType))) {
      const label = document.createElement("label");
      label.className = "zone-arrangement-field";
      label.title = definition.title;
      const caption = document.createElement("span");
      caption.textContent = definition.label;
      const value = zone.arrangement?.[definition.key] ?? (typeof definition.defaultValue === "function" ? definition.defaultValue(arrangementType) : definition.defaultValue);
      const control = definition.kind === "select" ? document.createElement("select") : document.createElement("input");
      control.dataset.zoneSetting = zone.id;
      control.dataset.arrangementKey = definition.key;
      control.setAttribute("aria-label", `${definition.label} for ${zoneDisplayName(zone)}`);
      if (definition.kind === "select") {
        for (const [optionValue, optionLabel] of definition.options) control.append(new Option(optionLabel, optionValue));
        control.value = String(value);
      } else {
        control.type = "range";
        control.min = String(definition.min);
        control.max = String(definition.max);
        control.step = String(definition.step);
        control.value = String(value);
      }
      const output = document.createElement("output");
      if (definition.kind === "range") output.textContent = `${value}${definition.suffix ?? ""}`;
      control.addEventListener("input", () => {
        if (definition.kind === "range") output.textContent = `${control.value}${definition.suffix ?? ""}`;
      });
      control.addEventListener("change", () => {
        const nextValue = definition.key === "columns" && control.value === "" ? undefined
          : definition.kind === "range" ? Number(control.value) : control.value;
        updateZoneArrangement(zone.id, { [definition.key]: nextValue });
      });
      label.append(caption, control, output);
      fields.append(label);
    }
    for (const definition of ZONE_POLICY_SETTING_DEFINITIONS.filter((candidate) =>
      candidate.key !== "selectionCount" || zone.selectionPolicy?.mode === "forced")) {
      const label = document.createElement("label");
      label.className = "zone-arrangement-field";
      label.title = definition.title;
      const caption = document.createElement("span");
      caption.textContent = definition.label;
      const value = definition.key === "orderMode"
        ? zone.orderPolicy?.mode ?? definition.defaultValue
        : definition.key === "slotMode"
          ? zone.slotPolicy?.mode ?? definition.defaultValue
          : definition.key === "concealedReorder"
            ? zone.reorderPolicy?.concealed ?? definition.defaultValue
          : definition.group === "motion"
        ? zone.motion?.[definition.key] ?? definition.defaultValue
          : definition.key === "faceUp"
          ? zone.faceUp === undefined ? definition.defaultValue : String(zone.faceUp)
          : definition.key === "selectionMode"
            ? zone.selectionPolicy?.mode ?? definition.defaultValue
            : definition.key === "selectionCount"
              ? zone.selectionPolicy?.count ?? definition.defaultValue
          : zone[definition.key] ?? definition.defaultValue;
      const control = definition.kind === "select" ? document.createElement("select") : document.createElement("input");
      control.dataset.zoneSetting = zone.id;
      control.dataset.zonePolicyKey = definition.key;
      control.setAttribute("aria-label", `${definition.label} for ${zoneDisplayName(zone)}`);
      if (zone.preset === "drawStack" && ["selectionMode", "selectionCount"].includes(definition.key)) {
        control.disabled = true;
        control.title = "The draw stack preset keeps only its top card selectable.";
      }
      if (definition.kind === "select") {
        for (const [optionValue, optionLabel] of definition.options) control.append(new Option(optionLabel, optionValue));
        control.value = String(value);
      } else {
        control.type = "range";
        control.min = String(definition.min);
        control.max = String(definition.max);
        control.step = String(definition.step);
        control.value = String(value);
      }
      const output = document.createElement("output");
      if (definition.kind === "range") output.textContent = `${value}${definition.suffix ?? ""}`;
      control.addEventListener("input", () => {
        if (definition.kind === "range") output.textContent = `${control.value}${definition.suffix ?? ""}`;
      });
      control.addEventListener("change", () => {
        const nextValue = definition.kind === "range" ? Number(control.value)
          : definition.key === "faceUp" ? control.value === "" ? null : control.value === "true" : control.value;
        updateZonePolicy(zone.id, definition, nextValue);
      });
      label.append(caption, control, output);
      fields.append(label);
    }
    settings.append(settingsSummary, fields);
    row.append(name, count, controls, settings);
    return row;
  }));
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  for (const button of transferZoneButtons) {
    const target = zoneById.get(button.dataset.transferZone);
    button.disabled = selectedCardIds.size === 0 || target?.visible === false;
  }
}

function updateZoneArrangement(zoneId, changes) {
  const current = zoneArrangements.get(zoneId) ?? { type: "grid", gap: 16 };
  zoneArrangements.set(zoneId, { ...current, ...changes });
  try {
    scene.apply(desiredSnapshot(sceneCards()));
  } catch (error) {
    zoneArrangements.set(zoneId, current);
    renderZones();
    showStatusMessage(`Arrangement update failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function updateZonePolicy(zoneId, definition, value) {
  const current = structuredClone(zonePolicies.get(zoneId) ?? {});
  const next = structuredClone(current);
  const currentPreset = zonePresets.get(zoneId);
  if (definition.key === "preset") {
    const zoneDefinition = LAB_ZONE_DEFINITIONS.find(({ id }) => id === zoneId);
    if (value === "") {
      zonePresets.delete(zoneId);
      next.faceUp = zoneDefinition?.faceUp ?? null;
      delete next.selectionPolicy;
    } else {
      zonePresets.set(zoneId, value);
      if (value === "drawStack") {
        zoneArrangements.set(zoneId, { type: "stack", axis: "y", step: 0 });
        next.faceUp = false;
        delete next.selectionPolicy;
      }
    }
  } else if (definition.key === "orderMode") {
    if (value === "free") delete next.orderPolicy;
    else {
      const desired = scene.snapshot().desired;
      const zone = desired.zones.find(({ id }) => id === zoneId);
      const allCardIds = desired.cards.map(({ id }) => id);
      const currentIds = zone?.cardIds ?? [];
      next.orderPolicy = {
        mode: "locked",
        order: [...currentIds, ...allCardIds.filter((cardId) => !currentIds.includes(cardId))],
      };
    }
  } else if (definition.key === "slotMode") {
    if (value === "free") delete next.slotPolicy;
    else {
      const zone = scene.snapshot().desired.zones.find(({ id }) => id === zoneId);
      next.slotPolicy = {
        mode: "fixed",
        slots: Object.fromEntries((zone?.cardIds ?? []).map((cardId, index) => [cardId, index])),
      };
    }
  } else if (definition.key === "concealedReorder") {
    next.reorderPolicy = { concealed: value };
  } else if (definition.key === "selectionMode") {
    if (value === "free") delete next.selectionPolicy;
    else next.selectionPolicy = {
      mode: "forced",
      count: next.selectionPolicy?.count ?? 3,
      from: "top",
    };
  } else if (definition.key === "selectionCount") {
    if (next.selectionPolicy?.mode === "forced") {
      next.selectionPolicy = { ...next.selectionPolicy, count: value, from: "top" };
    }
  } else if (definition.group === "motion") {
    next.motion = { ...(next.motion ?? {}), [definition.key]: value };
  } else if (definition.key === "faceUp") {
    next.faceUp = value;
  } else {
    next[definition.key] = value;
  }
  zonePolicies.set(zoneId, next);
  try {
    scene.apply(desiredSnapshot(sceneCards()));
  } catch (error) {
    if (definition.key === "preset") {
      if (currentPreset === undefined) zonePresets.delete(zoneId);
      else zonePresets.set(zoneId, currentPreset);
    }
    zonePolicies.set(zoneId, current);
    renderZones();
    showStatusMessage(`Zone policy update failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function cycleZoneArrangement(zoneId) {
  const current = zoneArrangements.get(zoneId) ?? { type: "grid", gap: 16 };
  const index = ARRANGEMENT_CYCLE.indexOf(current.type);
  updateZoneArrangement(zoneId, { type: ARRANGEMENT_CYCLE[(index + 1) % ARRANGEMENT_CYCLE.length] });
}

function reverseZoneOrder(zoneId) {
  const snapshot = structuredClone(scene.snapshot().desired);
  const zone = snapshot.zones.find(({ id }) => id === zoneId);
  if (!zone || zone.cardIds.length < 2) return;
  const previousPolicy = structuredClone(zonePolicies.get(zoneId) ?? {});
  zone.cardIds.reverse();
  const policy = structuredClone(previousPolicy);
  if (policy?.orderPolicy?.mode === "locked") {
    const reversed = [...zone.cardIds];
    policy.orderPolicy = {
      ...policy.orderPolicy,
      order: [...reversed, ...policy.orderPolicy.order.filter((cardId) => !reversed.includes(cardId))],
    };
    zone.orderPolicy = policy.orderPolicy;
  }
  try {
    zonePolicies.set(zoneId, policy);
    scene.apply(snapshot);
  } catch (error) {
    zonePolicies.set(zoneId, previousPolicy);
    showStatusMessage(`Order update failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function renderCardList(state = scene.snapshot()) {
  syncZoneMembership(state);
  const zoneNames = new Map(state.zones.map((zone) => [zone.id, zoneDisplayName(zone)]));
  const items = state.desired.cards.map((card, index) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    const title = document.createElement("span");
    const depth = document.createElement("output");
    const zone = document.createElement("span");
    const pickability = document.createElement("span");
    const pickable = scene.isSelectable?.(card.id) ?? true;
    label.dataset.cardId = card.id;
    label.dataset.pickable = String(pickable);
    label.title = pickable
      ? `Select or drag Card ${index + 1}.`
      : `Card ${index + 1} is normally not pickable in its current zone. The card list can override this rule.`;
    input.type = "checkbox";
    input.checked = selectedCardIds.has(card.id);
    title.className = "card-title";
    title.textContent = cardDisplayName(card, index);
    input.setAttribute("aria-label", `Select ${title.textContent}`);
    input.title = `Select or deselect Card ${index + 1}. The card list can override zone selection rules.`;
    depth.className = "card-z";
    depth.dataset.cardId = card.id;
    zone.className = "card-zone";
    zone.dataset.zoneId = cardZoneIds.get(card.id) ?? "";
    zone.textContent = zoneNames.get(cardZoneIds.get(card.id)) ?? "Zone —";
    pickability.className = "card-pickability";
    pickability.textContent = "";
    pickability.hidden = pickable;
    pickability.setAttribute("aria-label", "Normally not pickable");
    pickability.title = "Normally not pickable in this zone; the card list can override the rule.";
    input.addEventListener("change", () => {
      scene.closeInspection?.();
      selectLabCards([card.id], { mode: "toggle", ignoreZoneSelectionPolicy: true });
      syncControlsFromSelection();
      updateStatus();
      renderCardList();
      // Keep keyboard actions attached to the card the user just selected,
      // rather than the checkbox that was replaced during list rendering.
      const shell = [...stage.querySelectorAll(".cardinal-webgl-card")]
        .find((candidate) => candidate.dataset.cardId === card.id);
      shell?.focus?.({ preventScroll: true });
    });
    label.append(input, title, zone, depth, pickability);
    return label;
  });
  cardList.replaceChildren(...items);
  const deniedId = dragDeniedCard.value;
  const deniedIds = [...dragDeniedCard.options].slice(1).map(({ value }) => value);
  if (JSON.stringify(deniedIds) !== JSON.stringify(state.desired.cards.map(({ id }) => id))) {
    dragDeniedCard.replaceChildren(new Option("None", ""), ...state.desired.cards.map((card, index) => new Option(cardDisplayName(card, index), card.id)));
    dragDeniedCard.value = state.desired.cards.some(({ id }) => id === deniedId) ? deniedId : "";
  }
  selectionStatus.textContent = `${selectedCardIds.size} of ${state.desired.cards.length} selected`;
  selectionDetail.textContent = selectionReason || `Primary: ${cardDisplayNameForId(state.selection.primaryCardId, state)} · Anchor: ${cardDisplayNameForId(state.selection.anchorCardId, state)}`;
  updateCardListDepth(state);
}

function updateCardListDepth(state = scene.snapshot()) {
  for (const depth of cardList.querySelectorAll(".card-z")) {
    const visual = state.visual.find(({ cardId }) => cardId === depth.dataset.cardId);
    const z = visual?.pose.z;
    if (z === undefined) {
      depth.textContent = "z —";
      continue;
    }
    const [whole, fraction] = Math.abs(z).toFixed(1).split(".");
    depth.textContent = `z ${z < 0 ? "-" : ""}${whole.padStart(3, "0")}.${fraction}`;
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
    weight: card.weight ?? 1,
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
  if (element.type === "spacer") return element.content?.height ?? 20;
  return element.content?.text ?? element.content?.value ?? "";
}

function renderElementList(state = scene.snapshot()) {
  const card = currentCard(state);
  const face = card?.faceUp === false ? undefined : card?.faces?.[card.activeFaceId];
  const backgroundContent = backgroundContentFor(card);
  const key = face ? JSON.stringify([card.id, card.activeFaceId, face.elements, face.backgroundImage, card.back?.backgroundImage, backgroundSide.value]) : "empty";
  if (key === renderedElementKey) return;
  renderedElementKey = key;
  if (!face) {
    elementList.replaceChildren(document.createTextNode(card?.faceUp === false ? "Reveal this card to edit its content." : "Select a card to inspect its elements."));
    addElementButton.disabled = true;
    elementType.disabled = true;
    backgroundSide.disabled = true;
    backgroundImageInput.disabled = true;
    backgroundImageInput.value = "";
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
    checkbox.title = `Show or hide the ${element.id} element.`;
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
    editor.type = element.type === "spacer" ? "number" : "text";
    editor.value = elementEditorValue(element);
    editor.setAttribute("aria-label", element.type === "spacer" ? `Height for ${element.id}` : `Content for ${element.id}`);
    editor.title = element.type === "spacer" ? `Set the height of ${element.id}.` : `Edit the content of ${element.id}.`;
    if (element.type === "spacer") {
      editor.min = "0";
      editor.max = "480";
      editor.step = "1";
      editor.placeholder = "Height";
    } else {
      editor.placeholder = element.type === "image" ? "Image URL" : "Text";
    }
    editor.addEventListener("change", () => {
      const content = { ...(element.content ?? {}) };
      if (element.type === "image") content.src = editor.value;
      else if (element.type === "spacer") content.height = Math.max(0, Number(editor.value));
      else content.text = editor.value;
      applyElementOperation({ action: "update", elementId: element.id, element: { content } });
    });

    const mode = document.createElement("select");
    mode.setAttribute("aria-label", `Layout mode for ${element.id}`);
    mode.title = `Choose flow or overlay layout for ${element.id}.`;
    mode.innerHTML = '<option value="flow">Flow</option><option value="overlay">Overlay</option>';
    mode.value = element.layout?.mode ?? "flow";
    mode.addEventListener("change", () => applyElementOperation({
      action: "update",
      elementId: element.id,
      element: { layout: { ...(element.layout ?? {}), mode: mode.value } },
    }));

    const policy = document.createElement("select");
    policy.setAttribute("aria-label", `Hidden layout policy for ${element.id}`);
    policy.title = `Choose whether hidden ${element.id} keeps its layout space.`;
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
      button.title = label === "↑" ? `Move ${element.id} earlier in the flow.` : `Move ${element.id} later in the flow.`;
      button.addEventListener("click", () => applyElementOperation({ action: "reorder", elementId: element.id, index: targetIndex }));
      return button;
    };
    actions.append(moveButton("↑", index - 1, index === 0), moveButton("↓", index + 1, index === face.elements.length - 1));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.title = `Remove the ${element.id} element.`;
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
    renderCardList(state);
    renderZones(state);
    renderElementList(state);
    syncInspectionControls(state);
  }
  if (!demoTransaction) updateCardListDepth(state);
  updateSummaryMeta(state);
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
      logical: card.faceUp === false ? "Concealed" : (card.activeFaceId ?? "Unknown").replace("face-", "").toUpperCase(),
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

function syncInspectionControls(state) {
  const card = currentCard(state);
  const faces = Object.keys(card?.faces ?? {});
  const cardName = document.querySelector("#inspection-card-name");
  if (cardName) cardName.textContent = card ? cardDisplayName(card, state.desired.cards.findIndex(({ id }) => id === card.id)) : "None";
  const key = JSON.stringify([card?.id, card?.faceUp, faces]);
  if (inspectionFace.dataset.optionsKey !== key) {
    inspectionFace.replaceChildren(...faces.map((id, index) => new Option(card.faceUp === false ? `Content ${index + 1}` : capitalizeDisplayName(id), id)));
    inspectionFace.dataset.optionsKey = key;
  }
  inspectionFace.value = card?.activeFaceId ?? "";
  inspectionFace.disabled = !faces.length;
  document.querySelector("#inspect-card").disabled = !card;
  document.querySelector("#inspection-conceal").disabled = !faces.length;
  document.querySelector("#inspection-update").disabled = !card || card.faceUp === false;
}

function inspectionAction(action) {
  try { action(); }
  catch (error) { inspectionStatus.textContent = error.message; }
}

inspectionFace.addEventListener("change", () => inspectionAction(() => {
  const card = currentCard();
  if (card) scene.transact([{ type: "contentFace", cardId: card.id, faceId: inspectionFace.value }], { origin: "user" });
}));
document.querySelector("#inspect-card").addEventListener("click", () => inspectionAction(() => {
  if (scene.snapshot().inspection.sessions.length) {
    scene.closeInspection();
    labInspection = undefined;
    return;
  }
  labInspection?.close();
  const card = currentCard();
  if (card) labInspection = scene.inspect(card.id, {
    mode: document.querySelector("#inspection-mode").value,
    modal: document.querySelector("#inspection-mode").value === "preview",
    relatedCardIds: scene.snapshot().desired.cards.filter((other) => other.id !== card.id && other.faceUp !== false).map(({ id }) => id).slice(0, 4),
  });
}));
document.querySelector("#close-inspection").addEventListener("click", () => scene.closeInspection());
document.querySelector("#inspection-conceal").addEventListener("click", () => inspectionAction(() => {
  const card = currentCard();
  if (card) scene.transact([{ type: "face", cardId: card.id, face: card.faceUp === false ? "faceUp" : "faceDown" }], { origin: "user", zoneFacePolicy: "override" });
}));
document.querySelector("#inspection-update").addEventListener("click", () => inspectionAction(() => {
  const card = currentCard();
  if (!card || card.faceUp === false) return;
  const face = card.faces[card.activeFaceId];
  const exists = face.elements.some(({ id }) => id === "inspection-note");
  scene.transact([{ type: "element", cardId: card.id, elementId: "inspection-note", action: exists ? "update" : "add",
    element: { type: "text", content: { text: `Live update at ${new Date().toLocaleTimeString()}` }, layout: { mode: "flow", order: 9 } } }]);
}));
document.querySelector("#inspection-fixture").addEventListener("click", () => inspectionAction(() => {
  stopDemoAnimations();
  stopRandomMotion();
  stopContinuousFlip();
  const cards = [configuredCard(baseCard), configuredCard(LAB_CARD_PROTOTYPES[2])].map((card, index) => ({
    ...card, id: `inspection-card-${index + 1}`, faceUp: true, faceCycle: undefined,
    activeFaceId: "face-a", pose: { scale: 0.55 }, feedback: index ? { pending: true } : { actionable: true },
    faces: { "face-a": card.faces["face-a"], "details": {
      elements: [
        { id: "title", type: "text", content: { text: index ? "Owl Details" : "Cardinal Details" }, style: { variant: "title" } },
        { id: "description", type: "text", content: { text: Array.from({ length: 20 }, (_, line) => `Observation ${line + 1}: A readable field note that stays available during movement and live updates.`).join("\n\n") } },
      ],
    } },
  }));
  const zones = LAB_ZONE_DEFINITIONS.map(({ id, label, anchor }) => ({ id, label, anchor,
    cardIds: id === "river" ? cards.map(({ id }) => id) : [], arrangement: { type: "row", gap: 24 },
    presentation: { elements: ["image"] },
  }));
  scene.apply({ cards, zones });
  selectLabCards([cards[0].id]);
  syncControlsFromSelection();
  updateStatus();
  inspectionStatus.textContent = "Two image-only cards. Inspect to read full content; switch to Details for scrolling text.";
}));

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
  spinHandles = new Map(cards.map(({ id }) => [id, scene.spin(id, {
    axis, direction: 1, speed: 360, zoneFacePolicy: "override",
  })]));
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
  cardWeightValue.textContent = `${Number(cardWeightSlider.value)}×`;
  dragLiftScaleValue.textContent = `${Number(dragLiftScale.value).toFixed(2)}×`;
  dragLiftTimeValue.textContent = `${dragLiftTime.value} ms`;
  dragLiftDepthValue.textContent = `${dragLiftDepth.value} units`;
  dragLiftDepthTimeValue.textContent = `${dragLiftDepthTime.value} ms`;
  dragResponseTimeValue.textContent = `${dragResponseTime.value} ms`;
  dragDampingValue.textContent = Number(dragDamping.value).toFixed(2);
  dragDanglinessValue.textContent = `${Number(dragDangliness.value)}×`;
  dragMaxTiltValue.textContent = `${dragMaxTilt.value}°`;
  dragMaxTwistValue.textContent = `${dragMaxTwist.value}°`;
  dragPivotTiltValue.textContent = `${Number(dragPivotTilt.value).toFixed(2)}×`;
  dragMaxPivotTiltValue.textContent = `${dragMaxPivotTilt.value}°`;
  dragPivotResponseValue.textContent = `${dragPivotResponse.value} ms`;
  dragUprightValue.textContent = `${Number(dragUpright.value)}×`;
  dragLandingTimeValue.textContent = `${dragLandingTime.value} ms`;
  dragLandingBounceValue.textContent = Number(dragLandingBounce.value).toFixed(2);
  dragSnapDelayValue.textContent = `${dragSnapDelay.value} ms`;
  dragWeightInfluenceValue.textContent = Number(dragWeightInfluence.value).toFixed(2);
  cardHeightSlider.disabled = cardSizing.value === "content";
  rotateValue.textContent = `${rotateSlider.value}°`;
  scaleValue.textContent = `${Math.round(scale * 100)}%`;
  flipXValue.textContent = `${flipX}°`;
  flipYValue.textContent = `${flipY}°`;
  updateSummaryMeta();
}

function setControls({ x, y, width, height, thickness, weight, angle, scale, faceUp, flipX, flipY } = {}) {
  if (x !== undefined) moveXSlider.value = String(x);
  if (y !== undefined) moveYSlider.value = String(y);
  if (width !== undefined) cardWidthSlider.value = String(width);
  if (height !== undefined) cardHeightSlider.value = String(height);
  if (thickness !== undefined) cardThicknessSlider.value = String(thickness);
  if (weight !== undefined) cardWeightSlider.value = String(weight);
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

function updateDragMotionField(field, control) {
  setDragMotionPatch({ [field]: Number(control.value) });
}

function applySelectedWeight() {
  if (!scene || selectedCardIds.size === 0) return;
  const weight = Number(cardWeightSlider.value);
  const selected = new Set(selectedCardIds);
  applyLabCards(scene.snapshot().desired.cards.map((card) => selected.has(card.id) ? { ...card, weight } : card));
}

function selectedCards(state = scene.snapshot()) {
  const cards = new Map(state.desired.cards.map((card) => [card.id, card]));
  return state.selection.cardIds.map((id) => cards.get(id)).filter(Boolean);
}

function selectLabCards(cardIds, options = {}) {
  const result = scene.select(cardIds, options);
  selectedCardIds = new Set(result.cardIds);
  selectionReason = result.accepted === false ? `Selection unavailable: ${result.reason ?? "project limit"}` : "";
  renderCardList();
  return result;
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
    const options = animated ? {} : { immediate: true };
    if (channels.has("flip")) options.zoneFacePolicy = "override";
    if (operations.length > 0) run(operations, options);
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
  if (operations.length > 0) run(operations, channel === "flip" ? { zoneFacePolicy: "override" } : undefined);
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
    scene.spin(cardId, { axis: flipAxis.value, direction: 1, speed: 180, zoneFacePolicy: "override" }),
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
cardWeightSlider.addEventListener("input", applySelectedWeight);
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
  const prototype = randomizeCardQuip(LAB_CARD_PROTOTYPES[Math.floor(Math.random() * LAB_CARD_PROTOTYPES.length)]);
  cardZoneIds.set(id, spawnZone.value);
  cards.push({
    ...prototype,
    id,
    template: shape.value,
    pose: { scale: defaultCardScale() },
  });
  selectedCardIds = new Set([id]);
  applyLabCards(cards);
});

spawnZone.addEventListener("change", () => {
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
    const state = scene.snapshot();
    const selectedSet = new Set(selected);
    const ordered = state.desired.zones.flatMap(({ cardIds }) => cardIds.filter((id) => selectedSet.has(id)));
    run([{ type: "moveBatch", cardIds: ordered, to: destination, index: start }]);
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
  const result = selectLabCards(
    scene.snapshot().desired.cards.map(({ id }) => id),
    { mode: "replace", ignoreZoneSelectionPolicy: true },
  );
  selectionReason = result.accepted === false ? `Selection unavailable: ${result.reason ?? "project limit"}` : "";
  syncControlsFromSelection();
  updateStatus();
});

deselectAllButton.addEventListener("click", () => {
  selectLabCards([]);
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
    ? { id, type: "image", content: { src: "/examples/card-engine-lab/majestic.png", alt: "A majestic red cardinal" }, layout: { mode: "flow" } }
    : elementType.value === "spacer"
      ? { id, type: "spacer", content: { height: 24 }, layout: { mode: "flow" } }
      : { id, type: "text", content: { text: "New text element" }, layout: { mode: "flow" } };
  applyElementOperation({ action: "add", elementId: id, element });
});

document.querySelector("#element-demo").addEventListener("click", async () => {
  const demoButton = document.querySelector("#element-demo");
  const card = currentCard();
  if (!card) return;
  const baseline = structuredClone(scene.snapshot().desired);
  const baselineSelection = structuredClone(scene.snapshot().selection);
  const face = card.faces?.[card.activeFaceId];
  if (!face) return;
  const original = structuredClone(face.elements ?? []);
  const flavour = original.find(({ id }) => id === "flavour");
  const image = original.find(({ id }) => id === "image");
  const imageIndex = original.findIndex(({ id }) => id === "image");
  const sourceZone = baseline.zones.find(({ cardIds }) => cardIds.includes(card.id));
  const destination = baseline.zones.find((zone) => zone.id !== sourceZone?.id
    && zone.visible !== false && zone.faceUp !== false
    && (zone.capacity === undefined || zone.cardIds.length < zone.capacity));
  if (card.faceUp === false || !sourceZone) return;
  const customId = original.some(({ id }) => id === "shape-demo-field") ? "shape-demo-field-run" : "shape-demo-field";
  const sourceIndex = sourceZone.cardIds.indexOf(card.id);
  const neighborIds = Array.from({ length: Math.max(0, 3 - sourceZone.cardIds.length) }, (_, index) => `shape-demo-neighbor-${index + 1}`);
  const neighborCards = neighborIds.map((id) => ({
    ...structuredClone(card),
    id,
    faceUp: true,
    pose: { ...structuredClone(card.pose), angle: 0 },
  }));
  const demoSnapshot = structuredClone(baseline);
  demoSnapshot.cards.push(...neighborCards);
  const demoSourceZone = demoSnapshot.zones.find(({ id }) => id === sourceZone.id);
  if (demoSourceZone) {
    demoSourceZone.cardIds = [...demoSourceZone.cardIds, ...neighborIds];
    demoSourceZone.arrangement = { type: "row", gap: 24, alignment: "center" };
    delete demoSourceZone.orderPolicy;
    delete demoSourceZone.slotPolicy;
    delete demoSourceZone.capacity;
  }
  const refreshDemo = () => {
    renderCardList();
    syncControlsFromSelection();
    updateStatus();
  };
  const moveToDestination = destination ? { type: "move", cardId: card.id, to: destination.id } : null;
  const moveBack = destination ? { type: "move", cardId: card.id, to: sourceZone.id, index: sourceIndex } : null;
  try {
    demoButton.disabled = true;
    demoButton.dataset.demoState = "running";
    scene.apply(demoSnapshot);
    selectLabCards([card.id], { primaryCardId: card.id, anchorCardId: card.id });
    refreshDemo();
    const first = [
      ...(flavour ? [{ type: "element", cardId: card.id, faceId: card.activeFaceId, action: "hide", elementId: "flavour" }] : []),
      ...(image ? [{ type: "element", cardId: card.id, faceId: card.activeFaceId, action: "remove", elementId: "image" }] : []),
      { type: "element", cardId: card.id, faceId: card.activeFaceId, action: "add", elementId: customId,
        element: { type: "text", content: { text: "Custom field added while the card reshapes." }, layout: { mode: "flow" } } },
    ];
    const firstTransition = scene.transact(moveToDestination ? [...first, moveToDestination] : first);
    await new Promise((resolve) => setTimeout(resolve, 180));
    const restore = [
      ...(flavour ? [{ type: "element", cardId: card.id, faceId: card.activeFaceId, action: flavour.visible === false ? "hide" : "show", elementId: "flavour" }] : []),
      { type: "element", cardId: card.id, faceId: card.activeFaceId, action: "remove", elementId: customId },
      ...(image ? [{ type: "element", cardId: card.id, faceId: card.activeFaceId, action: "add", elementId: "image", element: image }] : []),
      ...(image ? [{ type: "element", cardId: card.id, faceId: card.activeFaceId, action: "reorder", elementId: "image", index: imageIndex }] : []),
    ];
    const secondTransition = scene.transact(moveBack ? [...restore, moveBack] : restore);
    await Promise.all([firstTransition.finished, secondTransition.finished]);
    scene.apply(baseline);
    selectLabCards([...baselineSelection.cardIds], {
      primaryCardId: baselineSelection.primaryCardId,
      anchorCardId: baselineSelection.anchorCardId,
    });
    refreshDemo();
    demoButton.dataset.demoState = "complete";
    showStatusMessage("Reshape demo complete: the card and neighboring layout were restored.");
  } catch (error) {
    demoButton.dataset.demoState = "failed";
    showStatusMessage(`Reshape demo failed: ${error.message}`);
  } finally {
    demoButton.disabled = false;
  }
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
dragDeniedCard.addEventListener("change", invalidateInteractionRules);
touchDrag.addEventListener("change", () => startScene());
touchSelection.addEventListener("change", () => startScene());
crossZoneSelection.addEventListener("change", () => startScene());
inspectionHover.addEventListener("change", () => startScene());
dragPresentation.addEventListener("change", () => startScene());
dragAnchor.addEventListener("change", () => startScene());
dragMotionPreset.addEventListener("change", selectDragMotionPreset);
for (const [field, control] of DRAG_MOTION_CONTROL_FIELDS) {
  control.addEventListener("input", () => updateDragMotionField(field, control));
}

document.querySelector("#flip-selection").addEventListener("click", () => {
  stopContinuousFlip();
  run(flipSelectedOperations(), { zoneFacePolicy: "override" });
});

document.querySelector("#batch-fixture").addEventListener("click", () => {
  stopDemoAnimations();
  stopRandomMotion();
  stopContinuousFlip();
  const source = configuredCard(baseCard);
  const cards = Array.from({ length: 4 }, (_, index) => ({
    ...structuredClone(source),
    id: `batch-card-${index + 1}`,
    dimensions: { width: 110, height: 150 },
    sizing: { mode: "fixed" },
    faceUp: index !== 1,
    pose: { angle: index * 8, scale: 0.65, flipY: index === 1 ? 180 : 0 },
  }));
  dragDeniedZone.value = "";
  dragDeniedCard.value = "";
  dragResponse.value = "manual";
  dragEnabled.checked = true;
  scene.invalidateRules();
  const zones = LAB_ZONE_DEFINITIONS.map(({ id, ...zone }) => ({
    ...zone, id, visible: true,
    cardIds: id === "lake" ? [cards[0].id, cards[2].id] : id === "river" ? [cards[1].id, cards[3].id] : [],
  }));
  for (const zone of zones) {
    zoneVisibility.set(zone.id, true);
    document.querySelector(zone.anchor).hidden = false;
  }
  scene.apply({ cards, zones });
  selectLabCards([cards[0].id, cards[1].id], { primaryCardId: cards[0].id, anchorCardId: cards[0].id });
  updateStatus();
});

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
  const copied = await copyDiagnosticsText(diagnosticsReport.textContent ?? "");
  if (copied) {
    diagnosticsStatus.textContent = "Report copied to the clipboard.";
  } else {
    selectDiagnosticsReport();
    diagnosticsStatus.textContent = "Clipboard access is unavailable; the report is selected for manual copying.";
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
        cardIds: [],
        primaryCardId: cardId,
        sources: [],
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
createLabTutorial({ steps: LAB_TUTORIAL_STEPS, trigger: document.querySelector("#start-tutorial") });
void refreshDiagnostics("Initial report ready.");
