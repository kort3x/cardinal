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

scene.setMotion({ duration: 500 }); // Changes the duration of future transitions.

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
    { id: "lake", anchor: "#lake-area", depth: 0, cardIds: ["card-7"], capacity: 6 },
    { id: "river", geometry: { x: 40, y: 400, width: 600, height: 350, depth: 0 }, cardIds: [] },
  ],
});
await scene.transact([
  { type: "move", cardId: "card-7", to: "river", index: 0 },
  { type: "zone", zoneId: "river", changes: { capacity: 8 } },
]).finished;
```

`zone` changes may set geometry, anchored depth, visibility, capacity, or the
arrangement. A complete `apply()` snapshot can add/remove zones or replace an
anchor selector. Deleting an occupied zone requires assigning its cards to other
zones or explicitly omitting those cards from the same snapshot. Validation runs
before commit, including final batch capacity (so full zones can exchange cards).
Insertion indices apply in operation order; omitted indices append to the zone.

For a cohort, use one `moveBatch` operation. Its index is interpreted after
removing every member from its source, including members already in the target:

```js
await scene.transact([
  { type: "moveBatch", cardIds: ["card-7", "card-8"], to: "river", index: 0 },
]).finished;
```

The supplied order is preserved. Preview and commit use the same membership
calculation. All members join the destination arrangement, including cards that
previously had absolute positions. The completion handle includes every member
and displaced neighbor; final capacity validation permits exchanges between full
zones in one transaction. Invalid transactions leave the whole scene unchanged.

Zones support `grid`, aligned `row` and `column`, `splay`, deterministic `pile`,
ordered `stack`, and handheld fan `hand` arrangements. `arrangement.gap`
defaults to 16; use
`alignment: "start" | "center" | "end"`, `spread`, `overlap`, `step`,
`depthStep`, `axis`, `radius`, `curve: "convex" | "concave"`, and
`order: "forward" | "reverse"` for the arrangement's geometry. Rows and
columns use each card's actual dimensions, while piles use a stable card-ID
scatter, splay keeps cards on a line while rotating them across the spread,
stacks use the zone's membership order, and hands fan cards around a shared
grip arc. For `splay`, `spread` is the total rotation angle. For `hand`, it is
the maximum arc angle; smaller hands automatically use a narrower proportion of it.

Set `overflow` to `scroll`, `overlap`, `fit`, or `reject`. `fit` applies one
bounded `layoutScale` to the arrangement and honors `minScale`; `reject` throws
before a transaction commits. The renderer applies that layout scale without
changing each card's authored `pose.scale`. Displaced neighbors animate together
and participate in transaction completion. Independent rotation, scale, and spin
channels survive geometry retargeting.

Zones may also govern the target card presentation. `scale` sets the card scale
while it belongs to the zone, and optional `faceUp: true` or `faceUp: false`
locks the physical face side while cards belong to the zone. Direct face and spin
commands cannot override that policy. `motion` contains
independent speed multipliers for alignment channels; omitted values default to
`1.5×`, `1` uses the scene motion duration, values above `1` are faster, and
values below `1` are slower:

```js
{
  id: "river",
  geometry: { x: 40, y: 400, width: 600, height: 350, depth: 0 },
  cardIds: [],
  scale: 0.75,
  faceUp: false,
  motion: {
    positionSpeed: 1.5,
    orientationSpeed: 0.8,
    scaleSpeed: 2,
    faceSpeed: 1,
  },
}
```

Zones can also enforce membership order and destination slots. Both policies are
optional and are checked during previews as well as commits, so a rejected drag
does not briefly show an invalid arrangement:

```js
{
  id: "river",
  cardIds: ["card-a", "card-b"],
  orderPolicy: { mode: "locked", order: ["card-a", "card-b", "card-c"] },
  slotPolicy: { mode: "fixed", slots: { "card-b": 1 } },
}
```

`orderPolicy.mode: "locked"` keeps members in the relative order supplied by
`order`; `slotPolicy.mode: "fixed"` pins configured cards to their zero-based
destination slots. Use `{ mode: "free" }` or omit a policy to allow ordinary
reordering. A locked order may include cards currently in other zones so a
later transfer can be validated against the same canonical order.

The zone speed settings apply to position, arrangement orientation, target
scale, and face transitions independently. Set a channel to `1` when it should
use the scene's base motion duration.

Use `scene.sortBy()` for a one-time animated reorder. Sort keys can read card
fields, face fields such as `background` or `backgroundImage.src`, and a path
inside an exact element on the active face, a named face, or the back:

```js
scene.sortBy({
  zoneId: "river",
  by: { source: "element", face: "active", elementId: "specimen", path: "content.text" },
  direction: "asc",
});
```

Set `zone.autoSort` to keep a zone ordered whenever its cards, relevant element
content, or sort policy changes. Missing values sort last by default, equal
values retain their current order, and the policy remains part of the zone
snapshot:

```js
{
  id: "river",
  cardIds: [],
  autoSort: {
    by: { source: "face", face: "active", path: "background" },
    direction: "asc",
    missing: "last",
  },
}
```

Sorting changes zone membership order atomically and reuses the normal layout
motion. One-time `sortBy()` calls may instead provide `getValue({ card, cardId,
zone, snapshot })` for a project-specific key. Automatic policies use the
declarative `by` form so they remain serializable; the exported `sortCardIds()`
helper plus a `reorder` transaction covers the same custom-key case.

Cards may provide an optional positive `weight`, which defaults to `1`. Target
position, orientation, scale, and face transitions multiply their duration by
the card's weight: `2` takes twice as long and `0.5` takes half as long. Direct
pointer dragging remains attached to the pointer; weight affects the settling
animation after a target is chosen and the inertia of free-drag rotation.

Use `scene.setMotion({ duration })` to change the duration used by future
animated transitions without rebuilding the scene. Transitions already in
progress keep the duration they were scheduled with.

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

Open `/examples/card-engine-lab/zones.html` for the six-card, three-zone lab, or
use the main lab's Zones controls to cycle a populated zone through every
arrangement, reverse its explicit order, and exercise overflow handling.

## Selection and drag interaction

Input is opt-in, and missing project rules deny pickup. The engine owns pointer
capture, keyboard navigation, temporary grid previews and cancellation. The project
decides whether a released intent may become a committed move:

```js
const scene = createCardScene({
  element,
  selection: { multiple: true, max: 10, scope: "scene", allowCrossZone: false },
  interaction: {
    touchDrag: false, // opt in before touch contact; otherwise preserve scrolling
    touchSelection: false, // explicit tap-to-toggle selection mode
    dragPresentation: "preserve", // or an animated "compact" bundle
    rules: {
      canStart: ({ cardIds }) => ({ allowed: cardIds.length <= 10 }),
      canDrop: ({ toZoneId }) => ({ allowed: toZoneId !== "locked" }),
    },
  },
});
scene.on("drop", async (intent) => {
  const accepted = await projectApproves(intent);
  const result = scene.resolveDrop(intent.id, { accepted });
  if (result.status === "accepted") await result.finished;
});
scene.apply({ cards, zones });
```

`canStart` and `canDrop` are synchronous and return `{ allowed, reason? }`.
Call `scene.invalidateRules()` when project permissions change; pending approvals
are cancelled, so their late replies return `stale`. Membership remains committed
to its source until approval; rejection returns to the latest committed layout.
Removing cards/destinations or making a conflicting authoritative move cancels
the whole session. Picking up a selected card carries the complete selection.
The picked card becomes primary and its grab offset stays attached to the pointer;
every member retains its own face and independent rotation, scale, and flip.
The cohort and source order are frozen at pickup. Later selection changes cannot
alter an active gesture. One denied member or insufficient capacity rejects the
whole batch. One release emits one intent and one approval commits the batch once.
A new gesture supersedes older gesture previews; there is no global pending lock.

For programmatic interaction, `scene.drag({ cardIds: [id], primaryCardId: id,
point: { x, y } })` returns `update`, `release`, `cancel`, `snapshot`, and `finished`.
Update with `{ point: { x, y } }` or `{ toZoneId, index }`. Points refer to the
world Z=0 plane. `clientToScene({ x, y }, depth)` and `sceneToClient({ x, y, z })`
convert through the actual camera and canvas bounds. `release()` returns an intent
or null; `finished` resolves the logical outcome, not the decorative return motion.
Diagnostics are in `snapshot().interaction.sessions` and `interaction-change`.
Pass multiple IDs to carry a batch. Default `order: "source"` uses configured
zone order then committed card order; `order: "provided"` preserves the supplied
ID order. `presentation: "preserve" | "compact"` overrides carrying presentation
for one session. Compact offsets affect active carrying only: pending approval
always previews the actual solved destination slots. Cancellation returns every
survivor and displaced neighbor to the latest committed source layouts.
Cards are temporarily rendered at the configured `liftScale` while carried,
then return to their resolved scale when the drag ends. A separate `liftDepth`
can move the carried render pose toward the camera without changing logical
zone depth; `liftDepthTime` controls that pickup. Set `liftScale: 1` to disable
scaling or `liftDepth: 0` to disable 3D lift, and combine them when both cues
are wanted. These are visual interaction states and do not change authored card
scale or zone depth. `liftTime` and `responseTime` tune pickup and free-drag
response; `dangle`, `maxTilt`, `maxTwist`, `grabPivotTilt`, `maxGrabTilt`, and
`grabPivotResponse` tune the bounded physical styling.
During free dragging, the card starts from its current arrangement angle and
swings toward upright through a damped, weight-sensitive spring. The response
also uses the distance of the pointer from the card center: an edge grab gives
the return more leverage while the grab point remains anchored. Filtered
pointer motion adds bounded local tilt and in-plane angular response;
an off-center grab adds an independent pitch and roll around the grabbed point;
direction changes carry momentum and settle back through damping. The grab pivot
response is separate from gravity-like edge hang, which remains disabled while
its calibration is being retried. Snapping
into a target waits for the configured delay, then uses a smooth position
landing and weight-scaled orientation overswing before settling on the resolved
pose. The response clears when the drag ends.
When the pointer becomes quiet, the engine gives the last directional dangle a
single momentum impulse before damping it back, so a card continues slightly in
the direction it was dragged before swinging toward rest. The pointer anchor is
preserved throughout.
The legacy `dragHangFactor`, `dragUprightFactor`, and `dragSnapDelay` options
are accepted as aliases for `motion.dangle`, `motion.upright`, and
`motion.landingDelay` when the corresponding nested field is omitted. The
nested configuration takes precedence. `landingTime`, `landingBounce`, and
`landingDelay` tune target landing; zone position, orientation, scale, and face
speed settings continue to modify their matching landing channels. Edge hang
remains tracked in [issue #19](https://github.com/kort3x/cardinal/issues/19).

Configure selection through `selection.canSelect({ cardId, zoneId, snapshot })`,
returning `{ allowed, reason? }`, plus `multiple`, `max`, `scope: "scene" | "zone"`,
and `allowCrossZone`. Cross-zone selection is denied by default; consumers must
set `allowCrossZone: true` to permit a selection spanning more than one zone.
`allowCrossZone: false` rejects any replace, add, toggle, or range request that
would contain cards from more than one zone and leaves the previous selection
unchanged.
The callback receives the desired model. Changing permissions requires
`scene.invalidateRules()`, which reconciles selection and invalidates drag rules.
Selection is presentation state and never grants move permission.

`scene.select(ids, { mode })` accepts `replace`, `add`, `toggle`, `remove`, and
`range`. A range request names one endpoint and uses the saved anchor or explicit
`anchorCardId`. Same-zone ranges follow committed membership, while cross-zone
ranges require an explicit `selection.rangeOrder` array. `selection.zoneOrder`
controls source ordering and default logical navigation.

Selection results include ordered `cardIds`, `primaryCardId`, `anchorCardId`, and
`accepted`; denied changes include `reason` and leave the prior selection intact.
Count/scope failures never silently truncate the requested set. Removal and clear
remain available. `selection-change` fires only when the actual state changes.
Reconciliation removes invalid selections while preserving eligible members.

Zones default to `dropTarget: "surface"`: a denied foreground zone blocks zones
behind it. `dropTarget: "transparent"` excludes a zone from drag targeting.
Equal-depth zones use later authored zone order as the foreground tie-break.

Plain click replaces selection, Ctrl/Cmd-click toggles, and Shift-click selects a
logical range. Idle arrows move focus, Shift-arrows extend a range, and the
plain `S` key toggles the focused card without relying on an operating-system
or button-activation shortcut. Ctrl/Cmd-A selects eligible cards in scope, and
idle Escape clears.
Focus a card and press Space to pick up, arrows to choose insertion position,
Tab/Shift+Tab to choose a zone, Enter/Space to release, and Escape to cancel.
The main lab includes Drag controls for denial and immediate/rejected/delayed/manual
approval. Batch acceptance is tracked in #5; CSS input is not supported.
With touch dragging enabled, the stage is the explicit touch-action surface;
normal page scrolling remains available outside it. Tap-to-toggle selection is
separate from dragging and does not claim long press. A second touch cancels an
active gesture.

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

Cardinal also provides a built-in `spacer` element for intentional adjustable
white space in a flow. Its `content.height` is measured in scene units and it
renders no pixels:

```js
{ id: "breathing-room", type: "spacer", content: { height: 24 }, layout: { mode: "flow" } }
```

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

Zones with faceUp enforce their side by default. Deliberate presentation demos
or consumer controlled reveals may opt out for one command with
`{ zoneFacePolicy: "override" }` on transact() or spin(); ordinary movement
and drag commits continue to enforce the zone policy.

Drag previews preserve a concealed source card's physical back, even when the
candidate destination enforces face-up cards. The face-up transition starts
only after the drop is accepted and committed, so hovering over a destination
or waiting for asynchronous approval cannot reveal hidden information.

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
resolved across the complete scene, so intentional overlap remains deterministic
during rotation and flipping. While a drag or pending drop is active, the dragged
cohort also receives a temporary render-only front depth; its logical `z` and zone
membership remain unchanged, and the normal arrangement depth returns when the
interaction ends.

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

## Drag motion

Drag response is configured under `interaction.motion`. The engine resolves it
once at scene creation, keeps the result in `snapshot().dragMotion`, and accepts
live partial updates through `scene.setDragMotion()` without recreating the
scene or changing the pointer anchor:

```js
const scene = createCardScene({
  interaction: {
    motion: { preset: "natural", landingDelay: 80 },
  },
});

scene.setDragMotion({ responseTime: 140, maxTilt: 18 });
console.log(scene.snapshot().dragMotion);
```

The built-in presets are `crisp`, `wizzard`, `natural`, `floaty`, and `dramatic`.
`wizzard` is a restrained, responsive profile tuned against the supplied MTG
Arena recording: it uses camera-facing 3D lift without scale enlargement,
responsive damping, strong movement tilt, direct pointer response, and an
exaggerated 25° grab pivot tilt. The
`dramatic` profile is intentionally unrealistic, with 3× dangle response,
44° tilt, 18° twist, and 0.2 damping so the card visibly overshoots and swings
past its target.
A partial update
inherits the current normalized configuration. Changing `preset` starts from
that preset's defaults before applying the other fields in the same patch. The
normalizer returns a fresh flat object and never exposes mutable preset data.
Natural defaults are `liftScale: 1.12`, `liftTime: 90`, `liftDepth: 0`,
`liftDepthTime: 80`, `responseTime: 160`,
`damping: 0.8`, `dangle: 1`, `maxTilt: 14`, `maxTwist: 10`,
`grabPivotTilt: 0`, `maxGrabTilt: 0`, `grabPivotResponse: 100`, `upright: 1`,
`landingTime: 180`, `landingBounce: 0.12`, `landingDelay: 0`, and
`weightInfluence: 0.5`.

`liftScale`, `liftDepth`, `dangle`, and `upright` are finite non-negative
strengths. `liftTime`, `liftDepthTime`, and `landingDelay` are finite
non-negative times; `responseTime` and
`landingTime` are finite positive times. All times are limited to 10 seconds,
`damping` is finite and positive, `maxTilt` and `maxGrabTilt` are limited to
90°, `maxTwist` to 180°, and `landingBounce` and `weightInfluence` are in the
range 0–1. `grabPivotTilt` is non-negative and `grabPivotResponse` is a finite
positive time.

Card `weight` contributes through the bounded nonlinear `weightInfluence`
response, so heavier cards can feel slower without making the pointer lose its
grab point. `upright` controls a free-drag visual style and does not change
zone membership. `scene.setMotion()` controls authored transitions; drag pickup,
response, and landing use their own time settings. Each zone's position,
orientation, scale, and face speed fields modify the matching landing channels.
