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

## Responsive zones

Zones own the sole ordered membership list. Supply either spatial `geometry` or
an `anchor` CSS selector; selectors are resolved in the stage document. Card shells
remain in the same renderer layer when their membership changes.

```js
scene.apply({
  cards,
  zones: [
    { id: "archive", anchor: "#archive-area", depth: 0, cardIds: ["card-7"], capacity: 6 },
    { id: "reserve", geometry: { x: 40, y: 400, width: 600, height: 350, depth: 0 }, cardIds: [] },
  ],
});
await scene.transact([
  { type: "move", cardId: "card-7", to: "reserve", index: 0 },
  { type: "zone", zoneId: "reserve", changes: { capacity: 8 } },
]).finished;
```

`zone` changes may set geometry, anchored depth, visibility, capacity, or the
arrangement. A complete `apply()` snapshot can add/remove zones or replace an
anchor selector. Deleting an occupied zone requires assigning its cards to other
zones or explicitly omitting those cards from the same snapshot. Validation runs
before commit, including final batch capacity (so full zones can exchange cards).
Insertion indices apply in operation order; omitted indices append to the zone.

Grid layout uses the largest unscaled width and height in the zone as track sizes
and compacts its ordered IDs after a transfer. `arrangement.gap` defaults to 16.
Displaced neighbors animate together and participate in transaction completion.
Independent rotation, scale, and spin channels survive geometry retargeting.

Anchors are measured through the actual camera, including page scroll and CSS
position changes. An engine-owned frame check runs while anchored zones exist;
it only retargets when measurements change. `scene.refreshGeometry()` also permits
an immediate measurement after a project changes page layout. Hidden, missing,
or zero-sized anchors retain their last valid geometry and membership; their cards
are hidden from rendering, focus and hit testing. Reappearance uses fresh bounds.
An explicit `visible: false` has the same visibility effect for spatial zones.
Programmatic moves remain authoritative project commands, including into hidden zones.

`snapshot().desired.zones` contains the authored model. `snapshot().zones` adds
resolved geometry and visibility for diagnostics and zone outlines. Orthographic
projection is the default. With perspective, anchor world dimensions change to
preserve their CSS footprint; spatial dimensions remain fixed. Depth is signed
world Z: the camera sits on positive Z, so a more negative depth is farther away.
WebGL performs depth projection once, without another artificial card scale.

Open `/examples/card-engine-lab/zones.html` for the six-card, three-zone lab.
Advanced overflow policies, drag insertion previews and other arrangements belong
to later slices; this grid implementation does not silently scale cards to fit.

Faces use one canonical `elements` array. Element IDs are unique within a face,
and the array may contain repeated element types or project-defined types:

```js
const face = {
  background: "#f4c95d",
  elements: [
    { id: "title", type: "text", content: { text: "The Cardinal" }, layout: { mode: "flow" } },
    { id: "art", type: "image", content: { src: "/cardinal.png", alt: "A cardinal" }, layout: { mode: "flow" } },
    { id: "flavour", type: "text", content: { text: "One card from Cardinal." }, layout: { mode: "flow" } },
  ],
};
```

Legacy top-level `title`, `image`, and `flavour` fields are not accepted. This
keeps element presence, visibility, order, and layout explicit.

WebGL uses an orthographic camera by default, so moving a card across the stage
does not change its apparent shape, size, or flip orientation. Perspective remains
available explicitly when a consuming scene wants camera-relative depth effects:

```js
const scene = createCardScene({ element, camera: { projection: "perspective" } });
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

Cards are fixed-size by default. Opt into content-driven height while keeping a
stable width with a sizing policy:

```js
const card = {
  ...cardDefinition,
  sizing: { mode: "content", minHeight: 120, maxHeight: 480 },
};
```

Visible flow elements contribute to the measured height. Removing, hiding,
showing, or adding one animates the shell to its new height; overlay elements
and reflow-collapsed elements do not contribute. Fixed-size cards keep their
configured dimensions while their remaining content reflows.

Physical depth defaults to `6` scene units and can be set on a template or
overridden per card. It can also be changed through a transaction:

```js
scene.transact([{ type: "thickness", cardId: "card-7", thickness: 12 }]);
```

Thickness changes animate the closed WebGL cuboid, move both face surfaces with
the shell, and are included in zone depth separation.

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
snapshot exposes independent `flipX` and `flipY` values.

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
`arrangement.depthStep` is a minimum spacing: it defaults to `8` scene units, and
the solver increases it when adjacent cards' scaled 3D thickness requires more
room. A zone may set another finite, non-negative minimum. The scene also checks
resolved card footprints across zones; when cards overlap in X/Y, it creates a
separate physical layer even if they started in different zones. `drawOrder` is
resolved across the complete scene, and WebGL clears the previous card's depth
layer before drawing the next card so intentional overlap remains deterministic
during rotation and flipping.

Selection and target intent are engine-owned but do not commit application moves:

```js
scene.select(["card-7"], { mode: "replace" });
scene.select(["card-8"], { mode: "add" });
const target = scene.target({ eligibleCardIds: ["card-9"] });
target.update({ point: { x: 450, y: 250 } });
const intent = target.finish();
```

`scene.hitTest({ x, y })` uses the rendered card orientation and scale and returns
the hit card and physical side without exposing Three.js objects. `target()`
returns an intent session; `finish()` reports the chosen IDs but never changes
zone membership. `cancel()` abandons it. Projects can register renderers for
additional element types through `elementRenderers`; each renderer may provide
`measure({ element, width, dimensions })` and
`draw({ context, element, x, y, width, height, images, content })` callbacks.
The scene emits `renderer-status` with `reason: "asset-load-failed"` when a
registered card image cannot be loaded.
