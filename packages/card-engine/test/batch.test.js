import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBatchMove } from '../src/batch.js';
import { normalizeSnapshot } from '../src/model.js';

function fixture() {
  return normalizeSnapshot({
    cards: ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id, activeFaceId: 'front',
      faces: { front: { elements: [] } }, positionMode: 'absolute', pose: { x: 10, y: 20, angle: 35, scale: 1.2 } })),
    zones: [
      { id: 'source', cardIds: ['A', 'B', 'C', 'D', 'E'], capacity: 5, geometry: { x: 0, y: 0, width: 600, height: 400, depth: 0 } },
      { id: 'target', cardIds: [], capacity: 2, geometry: { x: 700, y: 0, width: 600, height: 400, depth: 0 } },
    ],
  });
}

test('batch membership removes all members before a same-zone insertion', () => {
  const snapshot = fixture();
  const before = structuredClone(snapshot);
  const result = resolveBatchMove(snapshot, { cardIds: ['B', 'D'], toZoneId: 'source', index: 3 });
  assert.deepEqual(result.nextSnapshot.zones[0].cardIds, ['A', 'C', 'E', 'B', 'D']);
  assert.equal(result.destinationIndex, 3);
  assert.deepEqual(result.sources, [{ cardId: 'B', zoneId: 'source', index: 1 }, { cardId: 'D', zoneId: 'source', index: 3 }]);
  assert.deepEqual(snapshot, before);
  for (const card of result.nextSnapshot.cards) {
    assert.equal(card.positionMode, ['B', 'D'].includes(card.id) ? undefined : 'absolute');
    assert.deepEqual(card.pose, before.cards.find(({ id }) => id === card.id).pose);
    const original = snapshot.cards.find(({ id }) => id === card.id);
    assert.equal(card.faces, original.faces);
    assert.equal(card.pose, original.pose);
    assert.equal(card === original, !['B', 'D'].includes(card.id));
  }
  for (let index = 0; index < snapshot.zones.length; index += 1) {
    assert.notEqual(result.nextSnapshot.zones[index].cardIds, snapshot.zones[index].cardIds);
  }
});

test('concealed cards cannot be reordered in place unless the zone opts in', () => {
  const snapshot = normalizeSnapshot({
    cards: ['A', 'B', 'C'].map((id) => ({ id, activeFaceId: 'front', faceUp: false,
      faces: { front: { elements: [] } } })),
    zones: [
      { id: 'source', cardIds: ['A', 'B', 'C'], geometry: { x: 0, y: 0, width: 600, height: 400, depth: 0 } },
    ],
  });
  assert.throws(() => resolveBatchMove(snapshot, { cardIds: ['A'], toZoneId: 'source', index: 2 }),
    /reorderPolicy denies batch move.*concealed card order/);

  snapshot.zones[0].reorderPolicy = { concealed: 'allow' };
  const result = resolveBatchMove(snapshot, { cardIds: ['A'], toZoneId: 'source', index: 2 });
  assert.deepEqual(result.nextSnapshot.zones[0].cardIds, ['B', 'C', 'A']);
});

test('cross-zone membership preserves supplied order and counts destination residents once', () => {
  const snapshot = fixture();
  snapshot.zones[0].cardIds = ['A', 'C', 'E'];
  snapshot.zones[1].cardIds = ['B', 'D'];
  snapshot.zones[1].capacity = 3;
  const result = resolveBatchMove(snapshot, { cardIds: ['D', 'A'], toZoneId: 'target', index: 0 });
  assert.deepEqual(result.nextSnapshot.zones.map(({ cardIds }) => cardIds), [['C', 'E'], ['D', 'A', 'B']]);
  assert.deepEqual(result.sources, [{ cardId: 'D', zoneId: 'target', index: 1 }, { cardId: 'A', zoneId: 'source', index: 0 }]);
});

test('omitted and out-of-range indices append after removal', () => {
  for (const index of [undefined, 100]) {
    const result = resolveBatchMove(fixture(), { cardIds: ['B', 'D'], toZoneId: 'source', index });
    assert.equal(result.destinationIndex, 3);
    assert.deepEqual(result.nextSnapshot.zones[0].cardIds, ['A', 'C', 'E', 'B', 'D']);
  }
});

test('insufficient batch capacity rejects without mutating its input', () => {
  const snapshot = fixture();
  const before = structuredClone(snapshot);
  assert.throws(() => resolveBatchMove(snapshot, { cardIds: ['A', 'B', 'C'], toZoneId: 'target', index: 0 }), /capacity/);
  assert.deepEqual(snapshot, before);
});

test('deferred validation allows full-zone exchanges then validates the complete result', () => {
  const snapshot = fixture();
  snapshot.zones[0].cardIds = ['A', 'C', 'E'];
  snapshot.zones[0].capacity = 3;
  snapshot.zones[1].cardIds = ['B', 'D'];
  const first = resolveBatchMove(snapshot, { cardIds: ['A', 'C'], toZoneId: 'target', validate: false });
  assert.throws(() => normalizeSnapshot(first.nextSnapshot), /capacity/);
  const second = resolveBatchMove(first.nextSnapshot, { cardIds: ['B', 'D'], toZoneId: 'source', validate: false });
  assert.deepEqual(normalizeSnapshot(second.nextSnapshot).zones.map(({ cardIds }) => cardIds), [['E', 'B', 'D'], ['A', 'C']]);
});

test('invalid requests are rejected even when final validation is deferred', () => {
  for (const validate of [true, false]) {
    for (const cardIds of [[], ['A', 'A'], ['missing'], [null], ['']]) {
      assert.throws(() => resolveBatchMove(fixture(), { cardIds, toZoneId: 'target', validate }));
    }
    for (const index of [-1, 0.5, NaN, Infinity, '1']) {
      assert.throws(() => resolveBatchMove(fixture(), { cardIds: ['A'], toZoneId: 'target', index, validate }), /index/);
    }
    assert.throws(() => resolveBatchMove(fixture(), { cardIds: ['A'], toZoneId: 'missing', validate }), /Unknown zone/);
    for (const duplicate of [false, true]) {
      const snapshot = fixture();
      if (duplicate) snapshot.zones[1].cardIds.push('A');
      else snapshot.zones[0].cardIds.shift();
      assert.throws(() => resolveBatchMove(snapshot, { cardIds: ['A'], toZoneId: 'target', validate }), /exactly one/);
    }
  }
});

test('deferred capacity never defers unrelated ID, membership or capacity-shape validation', () => {
  const mutations = [
    (snapshot) => snapshot.cards.push(snapshot.cards[0]),
    (snapshot) => snapshot.zones.push(snapshot.zones[1]),
    (snapshot) => snapshot.zones[0].cardIds.push('missing'),
    (snapshot) => snapshot.zones[0].cardIds.pop(),
    (snapshot) => snapshot.zones[1].cardIds.push('E'),
    (snapshot) => snapshot.zones[1].capacity = -1,
  ];
  for (const mutate of mutations) {
    const snapshot = fixture();
    mutate(snapshot);
    assert.throws(() => resolveBatchMove(snapshot, { cardIds: ['A'], toZoneId: 'source', validate: false }));
  }
});

test('locked order and fixed destination slots reject invalid hypothetical moves', () => {
  const snapshot = normalizeSnapshot({
    cards: ['A', 'B', 'C'].map((id) => ({ id, activeFaceId: 'front', faces: { front: { elements: [] } } })),
    zones: [
      { id: 'source', cardIds: ['A', 'B'], geometry: { x: 0, y: 0, width: 300, height: 300, depth: 0 } },
      { id: 'target', cardIds: ['C'], geometry: { x: 400, y: 0, width: 300, height: 300, depth: 0 },
        orderPolicy: { mode: 'locked', order: ['C', 'B', 'A'] },
        slotPolicy: { mode: 'fixed', slots: { B: 1 } } },
    ],
  });
  assert.throws(() => resolveBatchMove(snapshot, { cardIds: ['B'], toZoneId: 'target', index: 0 }), /slotPolicy.*slot 1/);
  const result = resolveBatchMove(snapshot, { cardIds: ['B'], toZoneId: 'target', index: 1 });
  assert.deepEqual(result.nextSnapshot.zones[1].cardIds, ['C', 'B']);
  assert.deepEqual(result.nextSnapshot.zones[1].orderPolicy, { mode: 'locked', order: ['C', 'B', 'A'] });
  assert.deepEqual(result.nextSnapshot.zones[1].slotPolicy, { mode: 'fixed', slots: { B: 1 } });
});

test('free zone policies preserve ordinary insertion behavior', () => {
  const snapshot = normalizeSnapshot({
    cards: ['A', 'B'].map((id) => ({ id, activeFaceId: 'front', faces: { front: { elements: [] } } })),
    zones: [
      { id: 'source', cardIds: ['A'], geometry: { x: 0, y: 0, width: 300, height: 300, depth: 0 } },
      { id: 'target', cardIds: ['B'], geometry: { x: 400, y: 0, width: 300, height: 300, depth: 0 },
        orderPolicy: { mode: 'free' }, slotPolicy: { mode: 'free' } },
    ],
  });
  const result = resolveBatchMove(snapshot, { cardIds: ['A'], toZoneId: 'target', index: 0 });
  assert.deepEqual(result.nextSnapshot.zones[1].cardIds, ['A', 'B']);
});
