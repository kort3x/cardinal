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
    return { ...copy(card), pose: normalizePose(card.pose) };
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
