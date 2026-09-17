import { validateZonePolicies } from './model.js';

// Input is a normalized scene model. Build one final membership permutation;
// neither preview nor commit may interpret indices against intermediate moves.
export function resolveBatchMove(snapshot, { cardIds, toZoneId, index, validate = true } = {}) {
  if (!Array.isArray(cardIds) || cardIds.length === 0
    || cardIds.some((id) => typeof id !== 'string' || !id)
    || new Set(cardIds).size !== cardIds.length) {
    throw new TypeError('Batch cardIds must be a non-empty array of unique card IDs');
  }
  if (index !== undefined && (!Number.isInteger(index) || index < 0)) {
    throw new RangeError('Batch index must be a non-negative integer');
  }
  if (!snapshot || !Array.isArray(snapshot.cards) || !Array.isArray(snapshot.zones)) {
    throw new TypeError('Batch move requires a normalized scene snapshot');
  }
  const cards = new Map();
  for (const card of snapshot.cards) {
    if (typeof card?.id !== 'string' || !card.id || cards.has(card.id)) throw new Error('Card IDs must be unique non-empty strings');
    cards.set(card.id, card);
  }
  const zoneIds = new Set();
  const memberships = new Map();
  for (const zone of snapshot.zones) {
    if (typeof zone?.id !== 'string' || !zone.id || zoneIds.has(zone.id)) throw new Error('Zone IDs must be unique non-empty strings');
    zoneIds.add(zone.id);
    if (!Array.isArray(zone.cardIds)) throw new TypeError(`Zone ${zone.id} requires cardIds`);
    if (zone.capacity !== undefined && (!Number.isInteger(zone.capacity) || zone.capacity < 0)) throw new RangeError(`Zone ${zone.id} capacity must be a non-negative integer`);
    zone.cardIds.forEach((cardId, index) => {
      if (!cards.has(cardId)) throw new Error(`Unknown card: ${cardId}`);
      if (memberships.has(cardId)) throw new Error(`Card ${cardId} requires exactly one zone membership`);
      memberships.set(cardId, { cardId, zoneId: zone.id, index });
    });
  }
  for (const cardId of cards.keys()) {
    if (!memberships.has(cardId)) throw new Error(`Card ${cardId} requires exactly one zone membership`);
  }
  if (!zoneIds.has(toZoneId)) throw new Error(`Unknown zone: ${toZoneId}`);
  const cohort = new Set(cardIds);
  const sources = cardIds.map((cardId) => {
    if (!cards.has(cardId)) throw new Error(`Unknown card: ${cardId}`);
    return memberships.get(cardId);
  });
  // Card elements, faces and poses are read-only inputs to layout. Sharing them
  // avoids deep normalization/copying for every candidate insertion slot.
  const next = { ...snapshot,
    cards: snapshot.cards.map((card) => {
      if (!cohort.has(card.id)) return card;
      const moved = { ...card };
      delete moved.positionMode;
      return moved;
    }),
    zones: snapshot.zones.map((zone) => ({ ...zone, cardIds: zone.cardIds.filter((id) => !cohort.has(id)) })),
  };
  const destination = next.zones.find((zone) => zone.id === toZoneId);
  const destinationIndex = Math.min(index ?? destination.cardIds.length, destination.cardIds.length);
  destination.cardIds.splice(destinationIndex, 0, ...cardIds);
  if (validate) for (const zone of next.zones) {
    if (zone.cardIds.length > (zone.capacity ?? Infinity)) throw new RangeError(`Zone ${zone.id} exceeds capacity`);
    validateZonePolicies(zone, zone.cardIds, 'batch move');
  }
  return { sources, destinationIndex, nextSnapshot: next };
}
