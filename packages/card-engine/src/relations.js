const copy = (value) => structuredClone(value);

export const DEFAULT_CARD_RELATION = Object.freeze({
  anchor: "card",
  anchorX: 0.5,
  anchorY: 0.5,
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
  angle: 0,
  scale: 1,
  pivotX: 0.5,
  pivotY: 0.5,
  affinity: "front",
  missingAnchor: "hide",
  clip: true,
  zIndex: 0,
});

function finite(value, name, relationId, fallback) {
  const result = value ?? fallback;
  if (!Number.isFinite(result)) throw new TypeError(`Card relation ${relationId} ${name} must be finite`);
  return result;
}

export function normalizeCardRelation(relation, index = 0, knownCardIds = null) {
  if (!relation || typeof relation !== "object" || Array.isArray(relation)) {
    throw new TypeError("Card relation requires an object");
  }
  const parentId = relation.parentId;
  const childId = relation.childId;
  if (typeof parentId !== "string" || !parentId) throw new TypeError("Card relation parentId requires a non-empty string");
  if (typeof childId !== "string" || !childId) throw new TypeError("Card relation childId requires a non-empty string");
  if (parentId === childId) throw new Error(`Card relation cannot attach ${childId} to itself`);
  if (knownCardIds) {
    if (!knownCardIds.has(parentId)) throw new Error(`Card relation references unknown parent ${parentId}`);
    if (!knownCardIds.has(childId)) throw new Error(`Card relation references unknown child ${childId}`);
  }
  const id = relation.id ?? `${parentId}->${childId}`;
  if (typeof id !== "string" || !id) throw new TypeError("Card relation id requires a non-empty string");
  const anchor = relation.anchor ?? DEFAULT_CARD_RELATION.anchor;
  if (typeof anchor !== "string" || !anchor) throw new TypeError(`Card relation ${id} anchor requires a non-empty string`);
  const affinity = relation.affinity ?? DEFAULT_CARD_RELATION.affinity;
  if (!["front", "back", "both"].includes(affinity)) throw new TypeError(`Card relation ${id} affinity must be front, back, or both`);
  const missingAnchor = relation.missingAnchor ?? DEFAULT_CARD_RELATION.missingAnchor;
  if (!["hide", "card"].includes(missingAnchor)) throw new TypeError(`Card relation ${id} missingAnchor must be hide or card`);
  if (relation.clip !== undefined && typeof relation.clip !== "boolean") throw new TypeError(`Card relation ${id} clip must be boolean`);
  const result = {
    ...copy(relation),
    id,
    parentId,
    childId,
    anchor,
    anchorX: finite(relation.anchorX, "anchorX", id, DEFAULT_CARD_RELATION.anchorX),
    anchorY: finite(relation.anchorY, "anchorY", id, DEFAULT_CARD_RELATION.anchorY),
    offsetX: finite(relation.offsetX, "offsetX", id, DEFAULT_CARD_RELATION.offsetX),
    offsetY: finite(relation.offsetY, "offsetY", id, DEFAULT_CARD_RELATION.offsetY),
    offsetZ: finite(relation.offsetZ, "offsetZ", id, DEFAULT_CARD_RELATION.offsetZ),
    angle: finite(relation.angle, "angle", id, DEFAULT_CARD_RELATION.angle),
    scale: finite(relation.scale, "scale", id, DEFAULT_CARD_RELATION.scale),
    pivotX: finite(relation.pivotX, "pivotX", id, DEFAULT_CARD_RELATION.pivotX),
    pivotY: finite(relation.pivotY, "pivotY", id, DEFAULT_CARD_RELATION.pivotY),
    affinity,
    missingAnchor,
    clip: relation.clip ?? DEFAULT_CARD_RELATION.clip,
    zIndex: finite(relation.zIndex, "zIndex", id, DEFAULT_CARD_RELATION.zIndex),
  };
  if (result.scale <= 0) throw new RangeError(`Card relation ${id} scale must be positive`);
  for (const [name, value] of [["anchorX", result.anchorX], ["anchorY", result.anchorY], ["pivotX", result.pivotX], ["pivotY", result.pivotY]]) {
    if (value < 0 || value > 1) throw new RangeError(`Card relation ${id} ${name} must be between 0 and 1`);
  }
  return result;
}

export function normalizeCardRelations(relations, knownCardIds) {
  if (relations === undefined) return [];
  if (!Array.isArray(relations)) throw new TypeError("Snapshot relationships must be an array");
  const normalized = relations.map((relation, index) => normalizeCardRelation(relation, index, knownCardIds));
  const ids = new Set();
  const children = new Map();
  for (const relation of normalized) {
    if (ids.has(relation.id)) throw new Error(`Card relation ids must be unique: ${relation.id}`);
    ids.add(relation.id);
    if (children.has(relation.childId)) throw new Error(`Card ${relation.childId} cannot have multiple spatial parents`);
    children.set(relation.childId, relation);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (cardId) => {
    if (visited.has(cardId)) return;
    if (visiting.has(cardId)) throw new Error(`Card relation cycle includes ${cardId}`);
    visiting.add(cardId);
    const relation = children.get(cardId);
    if (relation) visit(relation.parentId);
    visiting.delete(cardId);
    visited.add(cardId);
  };
  for (const cardId of knownCardIds) visit(cardId);
  return normalized;
}

export function relationMaps(relations = []) {
  const byChild = new Map(relations.map((relation) => [relation.childId, relation]));
  const byParent = new Map();
  for (const relation of relations) {
    const children = byParent.get(relation.parentId) ?? [];
    children.push(relation);
    byParent.set(relation.parentId, children);
  }
  return { byChild, byParent };
}

export function relationDescendants(cardId, relations = []) {
  const { byParent } = relationMaps(relations);
  const result = [];
  const visit = (parentId) => {
    for (const relation of byParent.get(parentId) ?? []) {
      result.push(relation.childId);
      visit(relation.childId);
    }
  };
  visit(cardId);
  return result;
}

export function relationRoots(cardIds, relations = []) {
  const children = new Set(relations.map(({ childId }) => childId));
  return cardIds.filter((cardId) => !children.has(cardId));
}

export function relationGroup(cardIds, relations = []) {
  const requested = [...new Set(cardIds)].sort((first, second) => relationAncestors(first, relations).length - relationAncestors(second, relations).length);
  const result = [];
  const included = new Set();
  for (const cardId of requested) {
    if (included.has(cardId)) continue;
    result.push(cardId);
    included.add(cardId);
    for (const childId of relationDescendants(cardId, relations)) {
      if (included.has(childId)) continue;
      result.push(childId);
      included.add(childId);
    }
  }
  return result;
}

export function relationAncestors(cardId, relations = []) {
  const { byChild } = relationMaps(relations);
  const result = [];
  let relation = byChild.get(cardId);
  while (relation) {
    result.push(relation.parentId);
    relation = byChild.get(relation.parentId);
  }
  return result;
}
