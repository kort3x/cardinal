import { normalizeSortPolicy } from "./sort.js";

export const DEFAULT_POSE = Object.freeze({
  x: 0,
  y: 0,
  z: 0,
  angle: 0,
  tiltX: 0,
  tiltY: 0,
  scale: 1,
  pivotX: 0.5,
  pivotY: 0.5,
});

const copy = (value) => structuredClone(value);

export const ARRANGEMENT_TYPES = Object.freeze(["grid", "row", "column", "splay", "pile", "stack", "hand"]);
export const ZONE_PRESETS = Object.freeze({
  drawStack: Object.freeze({
    arrangement: Object.freeze({ type: "stack", axis: "y", step: 0 }),
    selectionPolicy: Object.freeze({ mode: "forced", count: 1, from: "top" }),
    faceUp: false,
  }),
});
const ALIGNMENTS = new Set(["start", "center", "end"]);
const OVERFLOW_POLICIES = new Set(["scroll", "overlap", "fit", "reject"]);
const ZONE_MOTION_SPEEDS = ["positionSpeed", "orientationSpeed", "scaleSpeed", "faceSpeed"];

function policyObject(value, name, zoneId) {
  if (value === undefined || value === null || value === false) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Zone ${zoneId} ${name} requires an object`);
  }
  return value;
}

function knownPolicyIds(ids, name, zoneId, knownCardIds) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !id)
    || new Set(ids).size !== ids.length) {
    throw new TypeError(`Zone ${zoneId} ${name} requires unique card IDs`);
  }
  for (const id of ids) if (!knownCardIds.has(id)) throw new Error(`Zone ${zoneId} ${name} references unknown card ${id}`);
  return [...ids];
}

function normalizeSlotMap(slots, zoneId, knownCardIds) {
  if (!slots || typeof slots !== "object" || Array.isArray(slots)) {
    throw new TypeError(`Zone ${zoneId} slotPolicy.slots requires an object`);
  }
  const normalized = {};
  const usedSlots = new Set();
  for (const [cardId, slot] of Object.entries(slots)) {
    if (!knownCardIds.has(cardId)) throw new Error(`Zone ${zoneId} slotPolicy references unknown card ${cardId}`);
    if (!Number.isInteger(slot) || slot < 0) throw new RangeError(`Zone ${zoneId} slotPolicy slot for ${cardId} must be a non-negative integer`);
    if (usedSlots.has(slot)) throw new Error(`Zone ${zoneId} slotPolicy assigns slot ${slot} more than once`);
    usedSlots.add(slot);
    normalized[cardId] = slot;
  }
  return normalized;
}

/**
 * Normalize the public zone policy shape. Policies are deliberately split so
 * consumers can map a JSON `zonePolicies` object directly onto a zone:
 *
 *   orderPolicy: { mode: "locked", order: ["card-a", "card-b"] }
 *   slotPolicy: { mode: "fixed", slots: { "card-b": 1 } }
 *   reorderPolicy: { concealed: "deny" }
 *
 * `order` is a canonical relative order and may include cards currently in
 * another zone. `slots` are absolute destination indices for configured cards.
 * Omitted order and slot policies and explicit `free` modes leave insertion
 * and ordinary reorder operations free. Concealed-card reorder is denied by
 * default and can be enabled with `reorderPolicy`.
 */
export function normalizeZonePolicies({ zoneId, orderPolicy, slotPolicy, reorderPolicy, cardIds = [], knownCardIds }) {
  const known = knownCardIds instanceof Set ? knownCardIds : new Set(knownCardIds ?? cardIds);
  const orderSource = policyObject(orderPolicy, "orderPolicy", zoneId);
  const slotSource = policyObject(slotPolicy, "slotPolicy", zoneId);
  const reorderSource = policyObject(reorderPolicy, "reorderPolicy", zoneId);
  let normalizedOrder;
  if (orderSource) {
    const mode = orderSource.mode ?? "locked";
    if (mode !== "free" && mode !== "locked") throw new TypeError(`Zone ${zoneId} orderPolicy mode must be free or locked`);
    if (mode === "free") normalizedOrder = { mode: "free" };
    else {
      const order = knownPolicyIds(orderSource.order, "orderPolicy.order", zoneId, known);
      for (const cardId of cardIds) if (!order.includes(cardId)) {
        throw new Error(`Zone ${zoneId} orderPolicy.order must include current member ${cardId}`);
      }
      normalizedOrder = { mode: "locked", order };
    }
  }
  let normalizedSlots;
  if (slotSource) {
    const mode = slotSource.mode ?? "fixed";
    if (mode !== "free" && mode !== "fixed") throw new TypeError(`Zone ${zoneId} slotPolicy mode must be free or fixed`);
    normalizedSlots = mode === "free" ? { mode: "free" }
      : { mode: "fixed", slots: normalizeSlotMap(slotSource.slots, zoneId, known) };
  }
  let normalizedReorder;
  if (reorderSource) {
    const concealed = reorderSource.concealed ?? "deny";
    if (concealed !== "allow" && concealed !== "deny") {
      throw new TypeError(`Zone ${zoneId} reorderPolicy concealed mode must be allow or deny`);
    }
    normalizedReorder = { concealed };
  }
  return { ...(normalizedOrder === undefined ? {} : { orderPolicy: normalizedOrder }),
    ...(normalizedSlots === undefined ? {} : { slotPolicy: normalizedSlots }),
    ...(normalizedReorder === undefined ? {} : { reorderPolicy: normalizedReorder }) };
}

/** Validate the final membership permutation used by previews and commits. */
export function validateZonePolicies(zone, cardIds = zone.cardIds, context = "operation") {
  const slotPolicy = zone.slotPolicy;
  if (slotPolicy?.mode === "fixed") {
    for (const [cardId, slot] of Object.entries(slotPolicy.slots)) {
      if (cardIds.includes(cardId) && cardIds[slot] !== cardId) {
        throw new Error(`Zone ${zone.id} slotPolicy denies ${context}: card ${cardId} must occupy destination slot ${slot}`);
      }
    }
  }
  const orderPolicy = zone.orderPolicy;
  if (orderPolicy?.mode === "locked") {
    let previous = -1;
    for (const cardId of cardIds) {
      const rank = orderPolicy.order.indexOf(cardId);
      if (rank < 0) throw new Error(`Zone ${zone.id} orderPolicy denies ${context}: card ${cardId} is not in the locked order`);
      if (rank <= previous) throw new Error(`Zone ${zone.id} orderPolicy denies ${context}: membership order must follow ${orderPolicy.order.join(", ")}`);
      previous = rank;
    }
  }
  return true;
}

function sameIds(first, second) {
  return first.length === second.length && first.every((id) => second.includes(id));
}

/** Prevent relative order changes among concealed cards when explicitly denied. */
export function validateReorderPolicy(previousZone, nextZone, cards = [], context = "reorder") {
  if (!previousZone || !nextZone || !sameIds(previousZone.cardIds, nextZone.cardIds)) return true;
  if (nextZone.reorderPolicy?.concealed !== "deny") return true;
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const concealed = (id) => nextZone.faceUp === false || cardById.get(id)?.faceUp === false;
  const previousConcealed = previousZone.cardIds.filter(concealed);
  const nextConcealed = nextZone.cardIds.filter(concealed);
  if (previousConcealed.every((id, index) => id === nextConcealed[index])) return true;
  throw new Error(`Zone ${nextZone.id} reorderPolicy denies ${context}: concealed card order cannot change`);
}

function normalizeDimensions(dimensions) {
  if (!dimensions || !Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height)) {
    throw new TypeError("Card dimensions require finite width and height");
  }
  if (dimensions.width <= 0 || dimensions.height <= 0) {
    throw new RangeError("Card dimensions must be positive");
  }
  return { width: dimensions.width, height: dimensions.height };
}

function normalizeThickness(thickness) {
  if (!Number.isFinite(thickness) || thickness <= 0) {
    throw new RangeError("Card thickness must be positive and finite");
  }
  return thickness;
}

function normalizeWeight(weight) {
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new RangeError("Card weight must be positive and finite");
  }
  return weight;
}

function normalizeSizing(sizing) {
  if (sizing === undefined) return undefined;
  if (!sizing || typeof sizing !== "object") throw new TypeError("Card sizing requires an object");
  const mode = sizing.mode ?? "fixed";
  if (mode !== "fixed" && mode !== "content") throw new TypeError(`Unknown card sizing mode: ${mode}`);
  for (const name of ["minHeight", "maxHeight"]) {
    if (sizing[name] !== undefined && (!Number.isFinite(sizing[name]) || sizing[name] <= 0)) {
      throw new RangeError(`Card sizing ${name} must be positive and finite`);
    }
  }
  if (sizing.minHeight !== undefined && sizing.maxHeight !== undefined && sizing.minHeight > sizing.maxHeight) {
    throw new RangeError("Card sizing minHeight cannot exceed maxHeight");
  }
  return { ...copy(sizing), mode };
}

function normalizeZoneMotion(motion) {
  if (motion === undefined) return undefined;
  if (!motion || typeof motion !== "object" || Array.isArray(motion)) {
    throw new TypeError("Zone motion requires an object");
  }
  for (const name of ZONE_MOTION_SPEEDS) {
    if (motion[name] !== undefined && (!Number.isFinite(motion[name]) || motion[name] <= 0)) {
      throw new RangeError(`Zone motion ${name} must be positive and finite`);
    }
  }
  return copy(motion);
}

function normalizeZoneSelectionPolicy(selectionPolicy, zoneId) {
  const source = policyObject(selectionPolicy, "selectionPolicy", zoneId);
  if (!source) return undefined;
  const mode = source.mode ?? "forced";
  if (mode !== "forced") throw new TypeError(`Zone ${zoneId} selectionPolicy mode must be forced`);
  if (!Number.isInteger(source.count) || source.count <= 0) {
    throw new RangeError(`Zone ${zoneId} selectionPolicy count must be a positive integer`);
  }
  const from = source.from ?? "top";
  if (from !== "top") throw new TypeError(`Zone ${zoneId} selectionPolicy from must be top`);
  return { mode, count: source.count, from };
}

export function normalizeZonePresentation(presentation, zoneId) {
  if (presentation === undefined || presentation === null || presentation === false) return undefined;
  if (!presentation || typeof presentation !== "object" || Array.isArray(presentation)) {
    throw new TypeError(`Zone ${zoneId} presentation requires an object`);
  }
  if (presentation.elements !== undefined
    && (!Array.isArray(presentation.elements)
      || presentation.elements.some((id) => typeof id !== "string" || id.length === 0)
      || new Set(presentation.elements).size !== presentation.elements.length)) {
    throw new TypeError(`Zone ${zoneId} presentation.elements requires unique element IDs`);
  }
  if (presentation.visibility !== undefined) {
    if (!presentation.visibility || typeof presentation.visibility !== "object"
      || Array.isArray(presentation.visibility)) {
      throw new TypeError(`Zone ${zoneId} presentation.visibility requires an object`);
    }
    for (const [id, visible] of Object.entries(presentation.visibility)) {
      if (!id || typeof visible !== "boolean") {
        throw new TypeError(`Zone ${zoneId} presentation.visibility values must be boolean`);
      }
    }
  }
  if (presentation.elements === undefined && presentation.visibility === undefined) {
    throw new TypeError(`Zone ${zoneId} presentation requires elements or visibility`);
  }
  return {
    ...copy(presentation),
    ...(presentation.elements === undefined ? {} : { elements: [...presentation.elements] }),
    ...(presentation.visibility === undefined ? {} : { visibility: { ...presentation.visibility } }),
  };
}

export function normalizeZonePreset(preset, zoneId = "zone") {
  if (preset === undefined || preset === null || preset === false) return undefined;
  if (typeof preset !== "string" || !Object.hasOwn(ZONE_PRESETS, preset)) {
    throw new TypeError(`Unknown zone preset for ${zoneId}: ${String(preset)}`);
  }
  return preset;
}

function normalizeBackgroundImage(backgroundImage) {
  const source = typeof backgroundImage === "string"
    ? { src: backgroundImage }
    : backgroundImage;
  if (!source || typeof source.src !== "string" || source.src.length === 0) {
    throw new TypeError("Face backgroundImage requires a non-empty src");
  }
  const fit = source.fit ?? "cover";
  if (!["cover", "contain", "stretch"].includes(fit)) {
    throw new TypeError(`Unknown face backgroundImage fit: ${fit}`);
  }
  return { ...copy(source), src: source.src, fit };
}

export function normalizeElement(element, index = 0) {
  if (!element || typeof element.id !== "string" || element.id.length === 0) {
    throw new TypeError("Every card element requires a non-empty string id");
  }
  if (typeof element.type !== "string" || element.type.length === 0) {
    throw new TypeError(`Element ${element.id} requires a type`);
  }
  const visibilityMode = element.visibilityMode ?? "reflow";
  if (visibilityMode !== "reflow" && visibilityMode !== "preserve-space") {
    throw new TypeError(`Element ${element.id} has unknown visibility mode: ${visibilityMode}`);
  }
  const layout = element.layout ?? {};
  const mode = layout.mode ?? "flow";
  if (mode !== "flow" && mode !== "overlay") {
    throw new TypeError(`Element ${element.id} has unknown layout mode: ${mode}`);
  }
  if (mode === "overlay") {
    for (const name of ["x", "y", "width", "height"]) {
      if (layout[name] !== undefined && (!Number.isFinite(layout[name]) || layout[name] < 0 || layout[name] > 1)) {
        throw new RangeError(`Element ${element.id} overlay ${name} must be between 0 and 1`);
      }
    }
  }
  if (layout.zIndex !== undefined && !Number.isFinite(layout.zIndex)) {
    throw new TypeError(`Element ${element.id} overlay zIndex must be finite`);
  }
  let content = element.content;
  if (element.type === "spacer") {
    const height = content?.height ?? 20;
    if (!Number.isFinite(height) || height < 0) {
      throw new RangeError(`Element ${element.id} spacer height must be finite and non-negative`);
    }
    content = { ...(content ?? {}), height };
  }
  return {
    ...copy(element),
    ...(content === undefined ? {} : { content: copy(content) }),
    visible: element.visible !== false,
    visibilityMode,
    layout: { ...layout, mode, order: layout.order ?? index, zIndex: layout.zIndex ?? 0 },
  };
}

function normalizeFace(face) {
  const source = face ?? {};
  if (!Array.isArray(source.elements)) throw new TypeError("Face elements must be an array");
  const elements = source.elements.map(normalizeElement);
  if (new Set(elements.map(({ id }) => id)).size !== elements.length) {
    throw new Error("Element ids must be unique within a face");
  }
  const normalized = { ...copy(source), elements };
  if (source.backgroundImage !== undefined) normalized.backgroundImage = normalizeBackgroundImage(source.backgroundImage);
  return normalized;
}

function normalizeFeedback(feedback, cardId) {
  if (feedback === undefined || feedback === null) return undefined;
  if (!feedback || typeof feedback !== "object" || Array.isArray(feedback)) {
    throw new TypeError(`Card ${cardId} feedback requires an object`);
  }
  for (const name of ["disabled", "actionable", "pending"]) {
    if (feedback[name] !== undefined && typeof feedback[name] !== "boolean") {
      throw new TypeError(`Card ${cardId} feedback.${name} must be boolean`);
    }
  }
  return {
    disabled: feedback.disabled ?? false,
    actionable: feedback.actionable ?? false,
    pending: feedback.pending ?? false,
  };
}

export function normalizePose(pose = {}) {
  const result = { ...DEFAULT_POSE, ...pose };
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Pose.${name} must be finite`);
    }
  }
  if (result.scale <= 0) throw new RangeError("Pose.scale must be positive");
  return result;
}

export function normalizeArrangement(arrangement = { type: "grid", gap: 16 }) {
  if (!arrangement || typeof arrangement !== "object" || Array.isArray(arrangement)) {
    throw new TypeError("Zone arrangement requires an object");
  }
  const type = arrangement.type ?? "grid";
  if (!ARRANGEMENT_TYPES.includes(type)) throw new TypeError(`Unknown arrangement: ${type}`);
  const result = { ...copy(arrangement), type };
  if (type === "hand" && result.curve === undefined) result.curve = "concave";
  if (result.gap !== undefined && (!Number.isFinite(result.gap) || result.gap < 0)) {
    throw new RangeError("Arrangement gap must be non-negative");
  }
  if (result.depthStep !== undefined && (!Number.isFinite(result.depthStep) || result.depthStep < 0)) {
    throw new RangeError("Arrangement depthStep must be finite and non-negative");
  }
  const alignment = result.alignment ?? result.align;
  if (alignment !== undefined && !ALIGNMENTS.has(alignment)) {
    throw new TypeError(`Unknown arrangement alignment: ${alignment}`);
  }
  if (result.overflow !== undefined && !OVERFLOW_POLICIES.has(result.overflow)) {
    throw new TypeError(`Unknown arrangement overflow policy: ${result.overflow}`);
  }
  if (result.minScale !== undefined && (!Number.isFinite(result.minScale) || result.minScale <= 0 || result.minScale > 1)) {
    throw new RangeError("Arrangement minScale must be positive and no greater than 1");
  }
  for (const name of ["spread", "overlap", "angle", "step", "radius"]) {
    if (result[name] !== undefined && (!Number.isFinite(result[name]) || result[name] < 0)) {
      throw new RangeError(`Arrangement ${name} must be finite and non-negative`);
    }
  }
  if (result.columns !== undefined && (!Number.isInteger(result.columns) || result.columns <= 0)) {
    throw new RangeError("Arrangement columns must be a positive integer");
  }
  if (result.axis !== undefined && result.axis !== "x" && result.axis !== "y") {
    throw new TypeError(`Unknown arrangement axis: ${result.axis}`);
  }
  if (result.order !== undefined && result.order !== "forward" && result.order !== "reverse") {
    throw new TypeError(`Unknown arrangement order: ${result.order}`);
  }
  if (result.curve !== undefined && result.curve !== "concave" && result.curve !== "convex") {
    throw new TypeError(`Unknown arrangement curve: ${result.curve}`);
  }
  return result;
}

export function normalizeSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.cards) || !Array.isArray(snapshot.zones)) {
    throw new TypeError("A scene snapshot requires cards and zones arrays");
  }

  const concealedByZone = new Set((snapshot.zones ?? []).flatMap((zone) => {
    const presetConceals = zone?.preset === "drawStack" && zone?.faceUp === undefined;
    return zone?.faceUp === false || presetConceals ? (zone.cardIds ?? []) : [];
  }));
  const cards = snapshot.cards.map((card) => {
    if (!card || typeof card.id !== "string" || card.id.length === 0) {
      throw new TypeError("Every card requires a non-empty string id");
    }
    const faces = card.faces && typeof card.faces === "object" && !Array.isArray(card.faces) ? card.faces : {};
    const concealed = card.faceUp === false || concealedByZone.has(card.id);
    if (Object.keys(faces).length === 0 && !concealed) {
      throw new TypeError(`Card ${card.id} requires at least one content face`);
    }
    if (Object.keys(faces).length > 0 && !faces[card.activeFaceId]) {
      throw new TypeError(`Card ${card.id} references an unknown active face`);
    }
    if (card.faceCycle !== undefined) {
      if (Object.keys(faces).length === 0) {
        throw new TypeError(`Card ${card.id} cannot define a faceCycle without content faces`);
      }
      if (!Array.isArray(card.faceCycle) || card.faceCycle.length < 2) {
        throw new TypeError(`Card ${card.id} faceCycle requires at least two face ids`);
      }
      if (new Set(card.faceCycle).size !== card.faceCycle.length || card.faceCycle.some((faceId) => typeof faceId !== "string" || !card.faces[faceId])) {
        throw new TypeError(`Card ${card.id} faceCycle must contain unique known face ids`);
      }
      if (!card.faceCycle.includes(card.activeFaceId)) {
        throw new TypeError(`Card ${card.id} activeFaceId must be in faceCycle`);
      }
    }
    const normalizedCard = { ...copy(card), pose: normalizePose(card.pose) };
    if (card.dimensions !== undefined) normalizedCard.dimensions = normalizeDimensions(card.dimensions);
    if (card.thickness !== undefined) normalizedCard.thickness = normalizeThickness(card.thickness);
    if (card.weight !== undefined) normalizedCard.weight = normalizeWeight(card.weight);
    if (card.sizing !== undefined) normalizedCard.sizing = normalizeSizing(card.sizing);
    const feedback = normalizeFeedback(card.feedback, card.id);
    if (feedback === undefined) delete normalizedCard.feedback;
    else normalizedCard.feedback = feedback;
    normalizedCard.faces = Object.fromEntries(Object.entries(faces).map(([faceId, face]) => [faceId, normalizeFace(face)]));
    if (card.back) normalizedCard.back = normalizeFace(card.back);
    return normalizedCard;
  });
  if (new Set(cards.map((card) => card.id)).size !== cards.length) {
    throw new Error("Card ids must be unique");
  }
  const knownCardIds = new Set(cards.map((card) => card.id));

  const zones = snapshot.zones.map((zone) => {
    if (!zone || typeof zone.id !== "string" || zone.id.length === 0) {
      throw new TypeError("Every zone requires a non-empty string id");
    }
    const geometry = zone.geometry;
    if (zone.anchor !== undefined && (typeof zone.anchor !== "string" || !zone.anchor.trim())) {
      throw new TypeError(`Zone ${zone.id} anchor requires a CSS selector`);
    }
    if (zone.anchor !== undefined && zone.geometry !== undefined) throw new TypeError(`Zone ${zone.id} requires either anchor or geometry`);
    if (zone.anchor === undefined && (!geometry || !["x", "y", "width", "height", "depth"].every((key) => Number.isFinite(geometry[key])))) {
      throw new TypeError(`Zone ${zone.id} requires finite x, y, width, height, and depth`);
    }
    if (geometry && (geometry.width <= 0 || geometry.height <= 0)) {
      throw new RangeError(`Zone ${zone.id} must have positive dimensions`);
    }
    if (!Array.isArray(zone.cardIds)) throw new TypeError(`Zone ${zone.id} requires cardIds`);
    if (zone.depth !== undefined && !Number.isFinite(zone.depth)) throw new TypeError(`Zone ${zone.id} depth must be finite`);
    if (zone.capacity !== undefined && (!Number.isInteger(zone.capacity) || zone.capacity < 0)) throw new RangeError(`Zone ${zone.id} capacity must be a non-negative integer`);
    if (zone.cardIds.length > (zone.capacity ?? Infinity)) throw new RangeError(`Zone ${zone.id} exceeds capacity`);
    if (zone.visible !== undefined && typeof zone.visible !== "boolean") throw new TypeError(`Zone ${zone.id} visible must be boolean`);
    if (zone.dropTarget !== undefined && !['surface', 'transparent'].includes(zone.dropTarget)) throw new TypeError(`Zone ${zone.id} dropTarget must be surface or transparent`);
    if (zone.scale !== undefined && (!Number.isFinite(zone.scale) || zone.scale <= 0)) throw new RangeError(`Zone ${zone.id} scale must be positive and finite`);
    if (zone.faceUp !== undefined && typeof zone.faceUp !== "boolean") throw new TypeError(`Zone ${zone.id} faceUp must be boolean`);
    const preset = normalizeZonePreset(zone.preset, zone.id);
    const presetDefinition = preset === undefined ? undefined : ZONE_PRESETS[preset];
    const faceUp = Object.hasOwn(zone, "faceUp") ? zone.faceUp : presetDefinition?.faceUp;
    const arrangement = normalizeArrangement(Object.hasOwn(zone, "arrangement")
      ? zone.arrangement : presetDefinition?.arrangement);
    const motion = normalizeZoneMotion(zone.motion);
    const presentation = normalizeZonePresentation(zone.presentation, zone.id);
    const selectionPolicy = normalizeZoneSelectionPolicy(Object.hasOwn(zone, "selectionPolicy")
      ? zone.selectionPolicy : presetDefinition?.selectionPolicy, zone.id);
    const policies = normalizeZonePolicies({ zoneId: zone.id, orderPolicy: zone.orderPolicy, slotPolicy: zone.slotPolicy,
      reorderPolicy: zone.reorderPolicy,
      cardIds: zone.cardIds, knownCardIds });
    const autoSort = zone.autoSort === undefined || zone.autoSort === null || zone.autoSort === false
      ? undefined : normalizeSortPolicy(zone.autoSort);
    const normalizedZone = { ...copy(zone), ...(preset === undefined ? {} : { preset }), ...(faceUp === undefined ? {} : { faceUp }), arrangement, ...(motion === undefined ? {} : { motion }),
      ...(presentation === undefined ? {} : { presentation }),
      ...(selectionPolicy === undefined ? {} : { selectionPolicy }), ...policies };
    if (policies.orderPolicy === undefined) delete normalizedZone.orderPolicy;
    if (policies.slotPolicy === undefined) delete normalizedZone.slotPolicy;
    if (policies.reorderPolicy === undefined) delete normalizedZone.reorderPolicy;
    if (selectionPolicy === undefined) delete normalizedZone.selectionPolicy;
    if (presentation === undefined) delete normalizedZone.presentation;
    validateZonePolicies(normalizedZone, normalizedZone.cardIds, "initial membership");
    if (autoSort === undefined) delete normalizedZone.autoSort;
    else normalizedZone.autoSort = autoSort;
    return normalizedZone;
  });

  const cardIds = new Set();
  const zoneIds = new Set();
  for (const zone of zones) {
    if (zoneIds.has(zone.id)) throw new Error(`Duplicate zone id: ${zone.id}`);
    zoneIds.add(zone.id);
    for (const cardId of zone.cardIds) {
      if (cardIds.has(cardId)) throw new Error(`Card ${cardId} belongs to multiple zones`);
      cardIds.add(cardId);
      if (!cards.some((card) => card.id === cardId)) throw new Error(`Zone ${zone.id} references unknown card ${cardId}`);
    }
  }
  for (const card of cards) {
    if (cardIds.has(card.id) === false) throw new Error(`Card ${card.id} has no zone membership`);
  }

  for (const zone of zones) {
    if (zone.faceUp === undefined) continue;
    for (const cardId of zone.cardIds) {
      const card = cards.find((candidate) => candidate.id === cardId);
      if (zone.faceUp && !Object.keys(card.faces).length) {
        throw new TypeError(`Card ${card.id} requires at least one content face`);
      }
      card.faceUp = zone.faceUp;
      delete card.pose.flipX;
      delete card.pose.flipY;
    }
  }

  return { cards, zones };
}

export function cardById(cards) {
  return new Map(cards.map((card) => [card.id, card]));
}

export function zoneById(zones) {
  return new Map(zones.map((zone) => [zone.id, zone]));
}
