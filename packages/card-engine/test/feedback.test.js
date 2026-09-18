import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardScene } from '../src/index.js';
import { createFeedback } from '../src/feedback.js';

class FakeEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatchEvent(event) {
    event.target ??= this;
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
  }
}

class FakeNode extends FakeEventTarget {
  constructor(ownerDocument) {
    super();
    this.ownerDocument = ownerDocument;
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.hidden = false;
  }
  append(child) { this.children.push(child); }
  remove() { this.removed = true; }
  setAttribute(name, value) { this[name] = value; }
  closest(selector) { return selector === '[data-card-id]' ? this : null; }
}

class FakeDocument {
  createElement() { return new FakeNode(this); }
}

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

test('focused feedback follows the WebGL card rotation in screen space', () => {
  const document = new FakeDocument();
  const element = new FakeNode(document);
  element.getBoundingClientRect = () => ({ left: 0, top: 0 });
  const scene = { sceneToClient: ({ x, y }) => ({ x, y }) };
  const feedback = createFeedback({ element, scene });
  const card = { id: 'card', feedback: {} };
  feedback.updateCard(card, { x: 100, y: 100, z: 0, width: 200, height: 300, scale: 1, angle: 20 });

  const shell = new FakeNode(document);
  shell.dataset.cardId = 'card';
  element.dispatchEvent({ type: 'focusin', target: shell });

  assert.equal(element.children[0].children[0].style.transform, 'translate(-50%, -50%) rotate(-20deg)');
  feedback.destroy();
});
