import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardScene } from '../src/index.js';

const fixture = (feedback) => ({
  cards: [{ id: 'card', activeFaceId: 'front', faceUp: true, feedback, faces: { front: { elements: [] } } }],
  zones: [{ id: 'zone', cardIds: ['card'], geometry: { x: 0, y: 0, width: 400, height: 400, depth: 0 } }],
});

test('disabled feedback blocks selection and user actions but preserves authoritative updates', () => {
  const scene = createCardScene({ motion: { reducedMotion: true }, interaction: { rules: {
    canReveal: () => ({ allowed: true }), canConceal: () => ({ allowed: true }),
  } } });
  scene.apply(fixture({ actionable: true, pending: true }));
  assert.equal(scene.select(['card']).accepted, true);
  scene.apply(fixture({ disabled: true, actionable: true, pending: true }));
  assert.deepEqual(scene.snapshot().selection.cardIds, []);
  assert.equal(scene.isSelectable('card'), false);
  assert.throws(() => scene.transact([{ type: 'face', cardId: 'card', face: 'faceDown' }], { origin: 'user' }), /disabled/i);
  scene.transact([{ type: 'face', cardId: 'card', face: 'faceDown' }]);
  assert.equal(scene.snapshot().desired.cards[0].faceUp, false);
  scene.destroy();
});
