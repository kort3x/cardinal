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

function legacyElements(face) {
  const visibility = face.elements && !Array.isArray(face.elements) ? face.elements : {};
  const elements = [];
  if (face.title !== undefined) elements.push({ id: "title", type: "text", content: { text: face.title }, visible: visibility.title !== false, layout: { mode: "flow", order: 0 } });
  if (face.image !== undefined) elements.push({ id: "image", type: "image", content: { src: face.image, alt: face.imageAlt }, visible: visibility.image !== false, layout: { mode: "flow", order: 1 } });
  if (face.flavour !== undefined) elements.push({ id: "flavour", type: "text", content: { text: face.flavour }, visible: visibility.flavour !== false, layout: { mode: "flow", order: 2 } });
  return elements;
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
  return {
    ...copy(element),
    visible: element.visible !== false,
    visibilityMode,
    layout: { ...layout, mode, order: layout.order ?? index, zIndex: layout.zIndex ?? 0 },
  };
}

function normalizeFace(face) {
  const source = face ?? {};
  const rawElements = Array.isArray(source.elements) ? source.elements : legacyElements(source);
  if (!Array.isArray(rawElements)) throw new TypeError("Face elements must be an array");
  const elements = rawElements.map(normalizeElement);
  if (new Set(elements.map(({ id }) => id)).size !== elements.length) {
    throw new Error("Element ids must be unique within a face");
  }
  return { ...copy(source), elements };
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

export function normalizeSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.cards) || !Array.isArray(snapshot.zones)) {
    throw new TypeError("A scene snapshot requires cards and zones arrays");
  }

  const cards = snapshot.cards.map((card) => {
    if (!card || typeof card.id !== "string" || card.id.length === 0) {
      throw new TypeError("Every card requires a non-empty string id");
    }
    if (!card.faces || typeof card.faces !== "object" || Object.keys(card.faces).length === 0) {
      throw new TypeError(`Card ${card.id} requires at least one content face`);
    }
    if (!card.faces[card.activeFaceId]) {
      throw new TypeError(`Card ${card.id} references an unknown active face`);
    }
    if (card.faceCycle !== undefined) {
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
    if (card.sizing !== undefined) normalizedCard.sizing = normalizeSizing(card.sizing);
    normalizedCard.faces = Object.fromEntries(Object.entries(card.faces).map(([faceId, face]) => [faceId, normalizeFace(face)]));
    if (card.back) normalizedCard.back = normalizeFace(card.back);
    return normalizedCard;
  });
  if (new Set(cards.map((card) => card.id)).size !== cards.length) {
    throw new Error("Card ids must be unique");
  }

  const zones = snapshot.zones.map((zone) => {
    if (!zone || typeof zone.id !== "string" || zone.id.length === 0) {
      throw new TypeError("Every zone requires a non-empty string id");
    }
    const geometry = zone.geometry;
    if (!geometry || !["x", "y", "width", "height", "depth"].every((key) => Number.isFinite(geometry[key]))) {
      throw new TypeError(`Zone ${zone.id} requires finite x, y, width, height, and depth`);
    }
    if (geometry.width <= 0 || geometry.height <= 0) {
      throw new RangeError(`Zone ${zone.id} must have positive dimensions`);
    }
    if (!Array.isArray(zone.cardIds)) throw new TypeError(`Zone ${zone.id} requires cardIds`);
    const arrangement = zone.arrangement ?? { type: "grid", gap: 16 };
    if (arrangement.depthStep !== undefined && (!Number.isFinite(arrangement.depthStep) || arrangement.depthStep < 0)) {
      throw new RangeError(`Zone ${zone.id} arrangement.depthStep must be finite and non-negative`);
    }
    return { ...copy(zone), arrangement };
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

  return { cards, zones };
}

export function cardById(cards) {
  return new Map(cards.map((card) => [card.id, card]));
}

export function zoneById(zones) {
  return new Map(zones.map((zone) => [zone.id, zone]));
}
