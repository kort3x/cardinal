const copy = (value) => structuredClone(value);

const SORT_SOURCES = new Set(["card", "face", "element"]);
const SORT_DIRECTIONS = new Set(["asc", "desc"]);
const SORT_MISSING = new Set(["first", "last"]);

function normalizePath(path) {
  const parts = Array.isArray(path) ? path : typeof path === "string" ? path.split(".") : null;
  if (!parts || parts.length === 0 || parts.some((part) => typeof part !== "string" || part.length === 0)) {
    throw new TypeError("Sort key path requires one or more non-empty path segments");
  }
  return [...parts];
}

export function normalizeSortBy(by) {
  if (!by || typeof by !== "object" || Array.isArray(by)) throw new TypeError("Sort key requires an object");
  const source = by.source ?? "element";
  if (!SORT_SOURCES.has(source)) throw new TypeError(`Unknown sort key source: ${source}`);
  const result = { ...copy(by), source, path: normalizePath(by.path) };
  if (source !== "card") {
    const face = by.face ?? "active";
    if (typeof face !== "string" || face.length === 0) throw new TypeError("Sort key face requires a non-empty string");
    result.face = face;
  }
  if (source === "element" && (typeof by.elementId !== "string" || by.elementId.length === 0)) {
    throw new TypeError("Element sort keys require a non-empty elementId");
  }
  return result;
}

export function normalizeSortPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new TypeError("autoSort requires an object");
  }
  const by = normalizeSortBy(policy.by ?? policy);
  const direction = policy.direction ?? "asc";
  const missing = policy.missing ?? "last";
  if (!SORT_DIRECTIONS.has(direction)) throw new TypeError(`Unknown sort direction: ${direction}`);
  if (!SORT_MISSING.has(missing)) throw new TypeError(`Unknown sort missing policy: ${missing}`);
  return { ...copy(policy), by, direction, missing };
}

function faceFor(card, face) {
  if (face === "active") return card.faces?.[card.activeFaceId];
  if (face === "back") return card.back;
  return card.faces?.[face];
}

function valueAt(source, path) {
  let value = source;
  for (const segment of path) {
    if (value === null || value === undefined) return undefined;
    value = value[segment];
  }
  return value;
}

function sortValue(card, by) {
  if (by.source === "card") return valueAt(card, by.path);
  const face = faceFor(card, by.face);
  if (by.source === "face") return valueAt(face, by.path);
  const element = face?.elements?.find(({ id }) => id === by.elementId);
  return valueAt(element, by.path);
}

function missing(value) {
  return value === undefined || value === null || typeof value === "number" && Number.isNaN(value);
}

function comparePresent(first, second) {
  if (typeof first === "number" && typeof second === "number") return first - second;
  if (typeof first === "boolean" && typeof second === "boolean") return Number(first) - Number(second);
  const left = String(first);
  const right = String(second);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortCardIds(snapshot, { zoneId, cardIds, by, getValue, direction = "asc", missing: missingPolicy = "last" } = {}) {
  if (!snapshot || !Array.isArray(snapshot.cards) || !Array.isArray(snapshot.zones)) {
    throw new TypeError("Sorting requires a scene snapshot");
  }
  if (typeof zoneId !== "string" || zoneId.length === 0) throw new TypeError("Sort requires a non-empty zoneId");
  if (!SORT_DIRECTIONS.has(direction)) throw new TypeError(`Unknown sort direction: ${direction}`);
  if (!SORT_MISSING.has(missingPolicy)) throw new TypeError(`Unknown sort missing policy: ${missingPolicy}`);
  if (getValue !== undefined && typeof getValue !== "function") throw new TypeError("Sort getValue must be a function");
  if (by === undefined && getValue === undefined) throw new TypeError("Sort requires by or getValue");
  const key = by === undefined ? null : normalizeSortBy(by);
  const zone = snapshot.zones.find(({ id }) => id === zoneId);
  if (!zone) throw new Error(`Unknown zone: ${zoneId}`);
  const ids = cardIds ?? zone.cardIds;
  if (!Array.isArray(ids) || ids.length !== zone.cardIds.length
    || ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length
    || ids.some((id) => !zone.cardIds.includes(id))) {
    throw new TypeError(`Sort cardIds must be the complete ordered membership of zone ${zoneId}`);
  }
  const cards = new Map(snapshot.cards.map((card) => [card.id, card]));
  const callbackSnapshot = getValue ? copy(snapshot) : null;
  return ids.map((id, index) => ({
    id,
    index,
    value: getValue
      ? getValue({ card: cards.get(id), cardId: id, zone, index, snapshot: callbackSnapshot })
      : sortValue(cards.get(id), key),
  }))
    .sort((first, second) => {
      const firstMissing = missing(first.value);
      const secondMissing = missing(second.value);
      if (firstMissing || secondMissing) {
        if (firstMissing && secondMissing) return first.index - second.index;
        return firstMissing === (missingPolicy === "first") ? -1 : 1;
      }
      const result = comparePresent(first.value, second.value);
      return result === 0 ? first.index - second.index : (direction === "desc" ? -result : result);
    })
    .map(({ id }) => id);
}
