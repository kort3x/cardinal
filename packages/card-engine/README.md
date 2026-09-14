# @cardinal/card-engine

The Cardinal card engine owns card state, layout, rendering, and independent
motion channels. Consumers provide a complete snapshot through `apply()` and
issue visual/state changes through `transact()`. The renderer seam uses the true
3D WebGL adapter by default; CSS is available only when explicitly selected with
`renderMode: "css"` for prototype/testing use.

When no DOM element is supplied, the scene uses a headless adapter for
deterministic state tests. This is not a renderer or a CSS fallback; browser
scenes require an available WebGL context.

```js
const scene = createCardScene({ element, motion });

scene.apply({ cards, zones });

scene.transact([
  { type: "rotate", cardId: "card-7", angle: 15 },
  { type: "face", cardId: "card-7", face: "faceDown", axis: "y" },
]);
```

Templates may select a built-in WebGL shape profile:

```js
const scene = createCardScene({
  element,
  templates: { shield: { width: 180, height: 250, shape: "shield" } },
});
```

Cards using `template: "shield"` keep the same motion and face-transition
interface as rounded-rectangle cards.

By default, a card has one logical front face and one shared back. Cards may opt
into multiple logical front faces with `faceCycle`. Returning to
the physical front advances to the next named face and wraps back to the first;
the physical card has one shared back presentation and remains a two-sided
cuboid:

```js
scene.apply({
  cards: [{
    id: "card-7",
    activeFaceId: "a",
    faceCycle: ["a", "b", "c"],
    faceUp: true,
    faces: { a: faceA, b: faceB, c: faceC },
  }],
  zones,
});
```

The sequence is `A → back → B → back → C`, with one shared back presentation.
An interrupted transition does not consume a logical face.

Face transitions support `axis: "x" | "y"` or both axes as an array. A shared
angle applies to every selected axis; an object supplies independent angles:

```js
scene.transact([{
  type: "face",
  cardId: "card-7",
  face: "faceDown",
  axis: ["x", "y"],
  angle: { x: 60, y: 120 },
}]);
```

Angles range from 0° to 180°. Without an angle, a face transition ends at 0°
or 180° and takes the shortest visual path from the current angle. The visual
snapshot exposes independent `flipX` and `flipY` values; `flipAngle` remains as
the single-axis compatibility alias.

For persistent in-place motion, use the spin handle:

```js
const spin = scene.spin("card-7", {
  axis: ["x", "y"],
  direction: 1,
  speed: 180,
});

spin.stop(); // Stops at the current displayed angle.
// Or: scene.stopSpin("card-7");
```

`speed` is degrees per second and `direction` is `1` or `-1`. Spinning is a
visual presentation channel; it does not change the card's logical `faceUp`
state. For cards with `faceCycle`, the single back is shown on every back-facing
half-turn and each full revolution advances the front cycle in the spin
direction. Reduced-motion scenes return an inactive spin handle and do not start
continuous motion. `destroy()` safely releases active motion and rendering.

Snapshots keep the two concepts separate: `desired.cards[].activeFaceId` is the
logical content, while `visual[].physicalSide` reports the current physical
orientation as `front`, `back`, or `edge`. The resolved visual pose also includes
`z` and `drawOrder`: zone arrangement owns deterministic stacking, and renderers
consume those values rather than inventing per-card Z positions.

Cards in one zone use their `zone.cardIds` sequence as stable bottom-to-top order.
The default arrangement adds `8` scene units between local depth layers, enough to
separate the default 6-unit cuboids; a zone may set `arrangement.depthStep` to
another finite, non-negative value. `drawOrder` is resolved across the complete
scene, and WebGL clears the previous card's depth layer before drawing the next
card so intentional overlap remains deterministic during rotation and flipping.
