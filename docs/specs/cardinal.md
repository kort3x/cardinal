# Cardinal design and delivery plan

Status: plan for a new implementation in new modules/files. Breaking changes are
explicitly accepted; backward compatibility is not a requirement.

## Objective

Build a reusable browser card engine whose primary product is the quality of card
appearance, movement, and interaction. Picko is one possible future consumer;
integration into it is outside this project. The standalone lab and an unrelated
example consumer are the proving grounds. Callers describe cards, zones, and intended changes.
The engine owns coherent visual realization of those changes.

## Lessons from the earlier Picko prototype

- `card.js` hard-codes hand/center/pile and zone-dependent presentations.
- `card-scene.js` reparents cards for flight, freezes computed styles, and retains
  app-specific home geometry. Movement formerly used that geometry instead of
  the requested destination anchor.
- `card-motion.js` changes logical card state at both departure and settlement.
- The demo assigns slots and maintains membership separately from the scene.
- App interaction routing includes selection, stamps, and center/pile rules.

These are ownership problems. Repackaging the current files would preserve them.
The new engine does not inherit the fixed zone names or LOD mechanism in ADR 0002.
Retain stable identity and application-owned business rules as requirements.
Document the new package's architecture separately; the existing application's
ADR and implementation remain untouched by this project.

## Breaking-change policy

Optimize the design for the intended engine, without backward compatibility.
The new implementation may define entirely new exports, state shapes, commands,
DOM structure, CSS selectors, zone names, and integration contracts.
Do not add compatibility shims, deprecated aliases, legacy rendering modes, or
dual-engine synchronization to preserve old behavior.

Build a new lab and unrelated demo consumer against the new interface. Write new tests
for the intended contracts, using prior bugs as behavioral scenarios rather than
copying old implementation assertions. Retiring existing application code and tests
belongs to a separate future integration effort.
Stable card identity is a requirement within the new engine, not a requirement to
preserve old JavaScript objects or DOM markup across the rewrite.

Implement in new files rather than incrementally rewriting the existing engine.
Leave the old engine, old lab, and old tests in place during independent development;
they are reference material, not dependencies. Coexistence requires no synchronization
or compatibility guarantees. Do not replace application wiring or remove legacy
files in this project. Completion requires the reusable package, new lab, unrelated
consumer, and documented acceptance gates; no Picko migration is required.

This permission applies to changes needed for the card-engine rewrite and its
consumers. It does not require unrelated application changes, loss of saved poll
data, or deployment of an unfinished build.

## New module and file structure

The dedicated repository is `kort3x/cardinal`. It contains only the engine package,
standalone examples, tests, and documentation. All paths below are relative to
this repository; none refer to files in the Picko checkout.

Use a standalone package and separate consumers. Proposed paths are:

```text
packages/card-engine/
  package.json
  src/
    index.js              Public scene interface
    scene.js              Transactions, reconciliation, orchestration
    model.js              State and validation
    layout.js             Geometry, projection, arrangements
    motion.js             Channels, clock, choreography
    renderer.js           Persistent DOM shells and presentation
    interaction.js        Input and presentation sessions
    styles.css            Engine-owned styles
  test/                   New package tests
examples/card-engine-lab/  New standalone lab and browser scenarios
examples/card-engine-use/  Second consumer demonstrating portability
```

Create files as their behavior is implemented; this is an initial organization,
not a requirement to create empty modules. Internal modules may split as needed,
but consumers import only the package's public entry point. The package and examples
have their own development/build setup; the lab must run without the poll server.
Example consumers use an explicit package build/import path, with generated
artifacts clearly separated from authored source. No Picko adapter is a deliverable.

Do not import or wrap `public/card.js`, `card-scene.js`, `card-motion.js`,
`card-interactions.js`, `live-cards.js`, or their styles as the new implementation.
Do not rename/copy the old engine wholesale into these directories. Reimplement
the design with fresh state ownership and interfaces. Existing code, recorded bugs,
and intended behavior may inform the new implementation. Engine changes must not
be hidden in old files during development; edits to existing build configuration
needed for the package/examples are permitted; existing application wiring is out of scope.

## Product model

| Concept | Responsibility |
| --- | --- |
| Card | Stable ID, content faces, optional logical face cycle, template, active face, independent faceUp/faceDown state |
| Zone | Arbitrary ID, spatial area and depth, membership, arrangement, presentation policy, optional automatic sort policy |
| Arrangement | Grid, aligned row/column, splay, pile, stack, or hand |
| Presentation | Visibility, internal layout, and content-driven dimensions of the card |
| Attachment | Independently identified card element added, updated, or removed at runtime |
| Pose | Position, orientation, uniform scale, pivot, and projected size of a card at an instant |
| Scene | Authoritative desired card/zone state and its current visual realization |
| Camera | Shared projection from stage coordinates and depth to screen coordinates |
| Inspection | Temporary readable view of a card and related information |
| Selection | Ordered set of selected card IDs with a primary card and range anchor |
| Relationship | Identified link or group connecting independent cards |
| Choreography | Visual sequencing of an already committed scene change |

All zones support zero, one, or many cards. An optional capacity is configured
explicitly. Zone IDs carry no built-in meaning. Face belongs to each card and is
independent of selection, arrangement, and region visibility. A card has one or
more named content faces and an `activeFaceId`. With no `faceCycle`, the default
card has one logical front face and one shared concealed back. A revealed card
displays that content face; a concealed card displays the concealed back/sleeve.
The public API names these states `faceUp` and `faceDown`. Cards may additionally declare a
`faceCycle`, an ordered list of at least two named content-face IDs. For such a
card, each completed return to the physical front advances the logical face to
the next entry and wraps to the first; every back-facing state uses the one
concealed back presentation. The physical card still has only two surfaces.
Changing the active content face does not reveal a concealed card. See the
content-face contract below.

Zone membership may optionally carry an `orderPolicy`, a `slotPolicy`, and a
`reorderPolicy`. Omitted policies leave ordinary insertion and reordering free,
including reordering concealed cards. `reorderPolicy: { concealed: "deny" }`
is an explicit consumer choice that makes a same-zone reorder preserve the
relative order of concealed cards. `reorderPolicy: { concealed: "allow" }`
explicitly keeps concealed-card reordering free. Revealed cards and cross-zone
transfers remain independently governed by the destination's other policies.
`orderPolicy: { mode: "locked", order }` defines the canonical relative order
for members, while `slotPolicy: { mode: "fixed", slots }` assigns zero-based
destination slots to selected card IDs. Both policies are enforced against the
complete hypothetical result before a preview or commit is accepted; omitted or
`free` policies preserve ordinary user-controlled insertion and reordering.

A zone may also carry `selectionPolicy: { mode: "forced", count, from: "top" }`.
This makes the final `count` members of the zone's bottom-to-top membership
sequence one atomic selection cohort. Selecting any eligible member selects the
whole cohort; lower members are unavailable, and removing or toggling one
removes the cohort. The consumer must enable multiple selection with a maximum
at least equal to `count`; the engine selection policy does not authorize the
resulting move or other game action.

The reusable zone preset `preset: "drawStack"` supplies a zero-offset vertical
stack, a forced top-card selection policy (`count: 1`), and `faceUp: false`.
Only the final member of the zone's bottom-to-top sequence is selectable or
pickable through engine interaction. An explicit `faceUp` value overrides the
preset's concealed side. The preset is opt-in; a zone without it has no
selection restriction, no capacity limit unless one is configured, and keeps
each card's own face state when `faceUp` is omitted. Explicit arrangement,
selection, and face policies override the preset's corresponding values.

A card belongs to exactly one zone in a committed scene. Zone membership is stored
once as a sequence of IDs. A stack uses that sequence as explicit bottom-to-top
order; a pile has deterministic visual scatter keyed by card ID. Stable ordering
also makes other arrangements reproducible without implying stack semantics. The
arrangement solver resolves both each card's local depth layer and a scene-wide
`drawOrder`; the renderer consumes those resolved values and never derives an
independent stacking order from animation timing or DOM/mesh insertion order.
The default local layer spacing is `8` scene units, separating the default
6-unit cuboids. `arrangement.depthStep` is a finite, non-negative minimum; the
solver increases the actual spacing when adjacent cards' scaled thicknesses
require it, including for mixed card scales. The scene-wide solver also compares
resolved X/Y footprints across zone boundaries and adds a physical depth layer
when cards that started apart are moved into overlap. WebGL treats each resolved
card layer as an ordered rendering layer: it clears the previous card's depth
buffer before drawing the next card, preserving intentional overlap even while a
card rotates or flips.

The engine exposes `sortBy()` for a one-time animated reorder and `autoSort` for
a zone-owned order policy. Sort keys can read card fields, face fields such as
`background` or `backgroundImage.src`, and paths inside exact elements selected
by ID. The active logical face is the default source; named faces and the back
are explicit choices. Missing values sort last by default, equal values preserve
current order, and automatic sorting re-evaluates after authoritative content,
membership, or policy changes.

The initial spatial model is a projected 2.5D stage: x/y plus real continuous depth
in the scene model. A scene has no intrinsic rectangular bounds. Card and zone
coordinates are world coordinates, while the camera owns the visible viewport,
center, and world-unit density. The default orthographic camera uses the current
stage as its viewport at one world unit per CSS pixel, preserving card pixel size
while a stage resizes and revealing more or less world space around the camera
center (the default camera center is the world origin). A consumer may opt into
an explicit fitted viewport when it wants a known
logical rectangle to fill the stage, or use a perspective camera when
camera-relative size and foreshortening are desired.
Individual cards are rendered as true 3D rounded cuboids inside that stage, while
draw order remains a separate resolved property rather than an implicit physics
result. Arbitrary tilted zone planes and physically simulated cards are outside v1.

## Zone placement and responsive geometry

The project owns placement of the stage on the page and placement of zones within
that stage. The engine owns card arrangement inside each zone. It does not impose
a board layout or infer positions from zone names.

Two geometry inputs may coexist in one stage and camera:

- **Page anchor:** a project-owned element, commonly arranged with CSS Grid or
  Flexbox, defines the zone's current screen footprint. Its configured depth maps
  that footprint to spatial geometry. The engine tracks bounds, scrolling, and
  visibility without parenting cards inside the anchor element.
- **Spatial geometry:** explicit stage-space position, dimensions, and depth are
  projected through the shared camera to obtain the zone's screen footprint.

Projection applies consistently to zone boundaries, spacing, card geometry, and
drop surfaces. A spatially defined zone becomes visually smaller as it moves away.
A page-anchored zone retains its specified screen footprint when only depth changes;
its inferred spatial extent changes instead. Card size still reflects depth and
the configured layout/fit policy. A project that wants the whole anchored zone to
visibly shrink must change its anchor bounds or use spatial geometry.

Both inputs resolve to one stage geometry model. Normalize page measurements into
stage coordinates before projection/layout; never mix viewport rectangles and
stage-space poses in a transition. Camera changes, page scrolling, viewport resizing,
or moved anchors update that geometry and continuously retarget resting cards.
During a drag, the card stays attached to the pointer while zones and insertion
previews update beneath it. Picking up near a horizontal edge adds a subtle
weight-bearing perspective tilt. A drop uses current geometry and gives the card
a weight-scaled overswing before settling; cancellation returns to the newly
solved committed rest pose.

Zones may intentionally overlap. The frontmost visible, non-transparent zone
surface receives a drop attempt, even when project rules deny that destination.
Do not pass through it automatically to an eligible zone behind it. Projects may
explicitly make a zone transparent to drag targeting. Use the zone's full visible
area, including empty space, as the target; its arrangement resolves an insertion
position and project rules may restrict that position. The dragged card and
temporary inspection visuals do not occlude destination-zone detection.

Ordinary card placement respects each zone's explicit overflow policy: scrolling,
intentional overlap, fitting to a minimum size, or rejection. There is no silent
unbounded shrinking or spill into another zone. Preserve readability by default;
projects may explicitly allow tiny distant cards while providing readable inspection.
Scaling alone preserves internal layout; simplified presentation is separately
requested. Dragging and inspection can temporarily extend beyond zone bounds without
changing membership or slot order.

Mixed card sizes are supported. Arrangements use actual unscaled dimensions rather
than stretching all cards to a common size. Grids allocate enough space per track
to avoid unintended overlap; uniform sizing is optional. Content-driven growth
re-solves the affected arrangement and animates displaced neighbors together. Keep
the changed card's configured anchor stable wherever the new arrangement permits.

Temporarily hiding a zone hides its cards and removes it from drop targeting while
preserving membership and state. Suspend layout against missing/zero-sized anchor
bounds; on reappearance solve from valid current bounds. Permanent deletion remains
a separate operation requiring explicit reassignment or removal of resident cards.

## One public scene interface

Ship a framework-independent browser package. Keep model, layout, and motion
DOM-independent. The renderer seam supports a required true-3D WebGL adapter by
default; CSS is available only when explicitly selected for prototype/testing.
Neither adapter leaks its implementation objects through the scene interface. The
CSS renderer cannot satisfy the true-3D visual acceptance gate.

The proposed interface is intentionally small:

```js
const scene = createCardScene({
  element: stage,
  templates: { illustrated: illustratedCard },
  camera,
  motion,
});

scene.apply({ cards, zones }); // Reconcile a complete desired snapshot by ID.
scene.setMotion({ duration: 500 }); // Change the duration of future transitions.

const transition = scene.transact([
  { type: "move", cardId: "card-7", to: "display", index: 0 },
  { type: "rotate", cardId: "card-7", angle: 15 },
  { type: "scale", cardId: "card-7", factor: 1.25 },
  { type: "resize", cardId: "card-7", dimensions: { width: 220, height: 300 } },
  { type: "thickness", cardId: "card-7", thickness: 12 },
  { type: "face", cardId: "card-7", face: "faceUp", axis: "y" },
]);

const spin = scene.spin("card-7", { axis: ["x", "y"], direction: 1, speed: 180 });
spin.stop();

scene.on("activate", ({ cardId }) => { /* application decides intent */ });
await transition.finished;
scene.destroy();
```

The public scene also owns interaction primitives without taking ownership of
application rules:

```js
scene.select(["card-7"], { mode: "replace" });
const target = scene.target({ eligibleCardIds: ["card-8"] });
target.update({ point: { x: 450, y: 250 } });
const intent = target.finish();
const hit = scene.hitTest({ x: 450, y: 250 });
```

`select()` exposes an ordered set with a primary card and range anchor.
`hitTest()` delegates transformed card geometry to the active renderer and
returns a card ID plus physical side. `target()` creates a cancellable session
for eligible card intent; finishing it reports IDs and pointer state but never
changes membership or commits a move. The engine emits `target-start`,
`target-change`, `target`, and `target-cancel` events.

`viewport()` is a read-only renderer view description when the active adapter
provides one. It reports the current visible world width and height, camera
center, scaling mode, and world-unit density so callers can translate pointer
coordinates without assuming a scene rectangle. It returns `null` for adapters
that do not expose a view.

This is the current Slice 01 interface; later slices may extend it. Snapshot
reconciliation and commands share one validation/commit path. Transactions can also update content,
zone geometry, arrangements, and presentation. Read-only snapshots expose desired
state and settling status; visual entries also expose the current physical side
(`front`, `back`, or `edge`) separately from each card's logical `activeFaceId`.
Visual poses also expose the currently displayed unscaled `width` and `height`.
Callers do not mutate card objects or DOM geometry.

Validate duplicate IDs, unknown references, multiple membership, invalid geometry,
and capacity violations before mutation. Reject an invalid transaction atomically.
Explicit removal or reassignment is required before deleting an occupied zone.
Use generation IDs per affected animation channel so an old animation cannot
commit state or clean up newer work. Independent channels keep running. Completion
reports each operation as settled, superseded, skipped, or destroyed; the aggregate
handle resolves once none of its operations remain active. Superseded work never
lands later. Reduced motion settles to the same final state immediately.

Keep application integration behind the same interface as features grow:

| Interface operation | Responsibility |
| --- | --- |
| `apply(snapshot)` | Reconcile authoritative cards, zones, relationships, and capabilities |
| `transact(operations, { choreography })` | Validate/commit changes and optionally describe their visual sequence |
| `sortBy(request, options)` | Sort one zone by card, face, or element data and animate the reorder |
| `inspect(cardId, options)` | Open an inspection session; its handle can close it |
| `select(cardIds, options)` | Replace/add/toggle/remove selection within project-defined limits |
| `target(request)` | Start an eligible-target selection session; return intent without committing a move |
| `on(event, listener)` | Subscribe to intent, presentation cues, and lifecycle events; return unsubscribe |
| `snapshot()` | Read desired state and visual settling status |
| `destroy()` | Release cards, auxiliary views, sessions, effects, and listeners |

Inspection and targeting are presentation sessions, not business transactions.
Applications supply capability flags, eligible IDs, and localized instructions;
the engine never calculates voting eligibility, combat legality, or resource costs.

## True 3D card rendering

Cardinal cards are closed extruded shape profiles, not flat DOM planes with
decorative depth. The primary renderer adapter uses a real beveled mesh with two
content surfaces, connecting side surfaces, continuous outline geometry, shared
thickness, perspective, materials, and controlled lighting/shadows. X/Y flipping,
local rotation/tilt, scale, and camera depth compose on that one object.

The WebGL implementation is hidden behind the renderer seam. It owns mesh,
material, camera, texture, render-target, context-loss, and disposal details; the
scene owns desired state, pose, motion channels, and face visibility. The public
scene interface must not expose Three.js objects or require callers to manage a
render loop. A CSS adapter may remain as an explicit prototype/testing mode, but
its simulated extrusion is not considered true-3D acceptance evidence.

Front and concealed content use managed high-resolution textures. Texture resolution
is derived from canonical card dimensions, device pixel ratio, and the supported
scale/inspection envelope. Pose-only updates do not rerasterize content. The lab
must verify stable line breaks and readable text/image detail at 100%, 150%, and
200% scale during motion and at rest.

## Placement and movement

Cards stay mounted in one persistent stage layer. Zone outlines and hit regions
are separate visuals. Moving between zones never changes a card's DOM parent.
The renderer uses nested wrappers to compose travel, rotation/flip, and inner
content presentation without competing writes to one transform.

The engine processes a change as one pipeline:

1. Validate and commit the desired scene state atomically.
2. Solve target poses for every card affected by membership or layout changes.
3. Sample each card's currently displayed pose and presentation.
4. Animate all affected cards toward the new targets on one timeline.
5. Finish exactly at the same poses used for the resting render.

Logical membership changes at commit, never again in an animation callback.
Physical movement follows that committed intent. Layout cannot assign another slot
at landing. Grid compaction is an explicit zone setting, and any displaced cards
participate in the same transition. No caller-supplied rectangles or homeRect exist
in the reusable interface.

New input, resize, scroll, or changed zone bounds re-solves targets and retargets
from current visual poses. Preserve position continuity and, where possible,
velocity. Use one motion driver per animated property. Start with a deterministic,
time-based interpolator that can be sampled in tests; compare rendering strategies
in the first lab milestone before committing to a backend.

Layouts define gap, alignment, splay spread, overlap, and deterministic ordering.
When cards overlap, the zone's ordered membership remains the source of truth for
bottom-to-top order. Arrangement resolves a small local depth separation and the
scene resolves a deterministic draw order across zones; motion operations preserve
both while changing x/y, rotation, scale, or flip state. Renderers apply the
resolved order without allowing individual cards to fight for Z ownership.
Each zone has an explicit overflow policy: fit to a configured minimum readable
size, scroll, intentional overlap, or reject. Exceeding capacity cannot silently
spill into another zone.

## Rotation, resize, scale, and flipping

Movement, rotation, resize, scale, and flipping are first-class operations. Each can occur
independently or concurrently in a single transaction, including during zone
transfers and region presentation changes. They use the same animation lifecycle
and interruption rules. A move-only command preserves explicit card rotation,
scale, and face state; omitted properties are not reset at arrival.

Rotation, resize, scale, and flipping require no zone transfer: a card can perform any
combination while resting in its current zone, preserving membership and slot
order. They can also begin, change, or finish while a move is already in progress.
A command affecting only one operation retargets that operation from its current
visual state while other active operations continue toward their existing targets.
An operation is never implicitly queued until movement finishes.

- **Rotation:** turn the card within the stage plane, with optional local x/y tilt
  for perspective effects. Layout orientation (such as a splay angle) composes with
  an explicit card rotation. A rotate command sets an absolute local angle;
  animations use the shortest path by default and allow explicit direction and
  full turns for spins. Center is the default pivot; normalized local pivots may
  be configured. A rotation does not change the logical face state.
- **Scale:** uniformly resize the whole card around its pivot. The default factor
  is 1 and factors must be finite and positive. Apparent size combines canonical
  layout dimensions, layout fit, camera depth projection, and explicit scale. Scaling preserves
  content geometry and line wrapping. It does not change zone membership or depth.
  Layout allocation uses the footprint before explicit card scaling; visual overflow or inspection
  elevation must follow an explicit scene policy.
- **Resize:** change the card's unscaled `{ width, height }` dimensions while
  preserving its shell identity and center anchor by default. Dimensions must be
  finite and positive. Desired dimensions commit immediately, while visible shell
  geometry interpolates from its current width and height. A resize retargets from
  the current visible dimensions and independently preserves active movement,
  rotation, scale, and flip channels. Zone arrangements resolve the new footprint
  and retarget displaced neighbors.
- **Flip:** turn between faceUp and faceDown around a configured local x or y axis.
  A face command may select both axes with `axis: ["x", "y"]`; its `angle`
  may be a number shared by both axes or `{ x, y }` for independent angles.
  The renderer composes both rotations on the same closed cuboid shell, so a
  card can flip around X and Y simultaneously without creating a second card
  or replacing its DOM shell.
  Both surfaces belong to the same persistent shell. Desired face changes at
  transaction commit; the visual angle reaches that face over time. Retargeting
  samples the current angle, including an interrupted half-flip. The renderer
  prevents mirrored backfaces and disables input to the concealed surface.
  A face command may provide an intermediate angle from 0° through 180° for
  direct manipulation. Persistent in-place spinning uses the same flip channels,
  accepts an axis, direction, and degrees-per-second speed, and stops at the
  current displayed angle without changing logical face state. For cards with a
  `faceCycle`, continuous spinning shows the shared back on every back-facing
  half-turn and advances the logical front cycle at each full revolution in the
  spin direction; ordinary cards retain their two-surface behavior.
  A card with `faceCycle: ["a", "b", "c"]` presents
  `A → back → B → back → C` as it alternates physical orientation. The
  renderer stages the next logical front during a return from the back; an
  interrupted turn does not advance the cycle.
  Camera perspective must not choose the logical side: moving a card while it
  is edge-on may change its apparent angle, but it must not reveal the concealed
  face for a logically revealed card or the content face for a logically
  concealed card. At the exact edge orientation, neither large face is treated
  as the displayed side; only the cuboid edge is visible.
  The primary renderer presents each card as a true closed beveled rounded
  cuboid: two large face surfaces and continuous side geometry spanning the
  shared thickness. CSS fallback implementation is deferred to issue #16; its
  simulated extrusion cannot satisfy the true-3D acceptance gate.
  Switching between named content faces can use the same turn animation without
  changing faceUp/faceDown. Only one driver owns the combined displayed-surface
  transition, so reveal and content-face changes cannot compete on the flip axis.

User initiated card access is consumer controlled. Interaction rules expose
`canTake`, `canPut`, `canReveal`, `canConceal`, and `canSpin`, each returning
`{ allowed, reason? }`; `canStart` and `canDrop` are compatibility aliases for
the first two. Pointer drag pickup and drop run these rules, including the
reveal or conceal rule required by a destination zone's `faceUp` policy.
Programmatic commands that represent a user action pass `{ origin: "user" }`
to `scene.transact()` or `scene.spin()`, and are denied when the corresponding
rule is absent or rejects the request. Trusted consumer reconciliation keeps
using the default system origin. This boundary lets a consumer restrict every
card entry point by source zone, destination, side change, and spin action.

Define transform composition explicitly, from outermost to innermost: stage
placement and camera projection, layout orientation, local card rotation/tilt,
uniform scale, then face flip and region presentation. Rotation and flipping share
the configured pivot. Temporary hover/inspection effects compose as separate
offsets; clearing them reveals the current base pose, never a saved old rectangle.
Temporary visual elevation does not reorder a stack's logical membership.

Hit testing follows the rendered orientation and scale. Hidden surfaces are excluded
from accessibility, and focus on a control becoming concealed moves to the stable
card shell. Reduced motion reaches the same orientation, scale, and face without
requiring the animated path. Local card tilt is supported without extending v1 to
arbitrary tilted zone planes or physical simulation.

## Card appearance and region changes

Provide an illustrated template with title, image, flavour text, and a back face.
Projects may supply templates with additional named regions and canonical layout
constraints. Templates support fixed dimensions or content-driven dimensions,
with preferred width, minimum/maximum dimensions, and optional aspect ratio rules.
The resulting unscaled width and height belong to the card's geometry and may
change independently of its scale factor. Template content and styles remain local to the card subtree; zone ancestry
selectors cannot control its appearance. Patch content without replacing the shell
or unnecessarily replacing focused controls.

Templates may also select a reusable shape profile for the card's face silhouette.
The WebGL renderer extrudes and bevels that profile into the card's closed volume.
The initial built-in profiles are `rounded-rectangle` and `shield`; shape profiles
do not change the scene's motion or face-transition interface.

Cards are fixed-size by default. A card may opt into content-driven height with
`sizing: { mode: "content", minHeight?, maxHeight? }`; width remains the
configured card or template width. The engine measures the active face's visible
flow elements, clamps the result to the optional bounds, and uses the existing
resize channel to animate the shell. Overlay elements and reflow-collapsed
elements contribute no height. This policy applies to element add/remove,
show/hide, and content updates; fixed-size cards only reflow their remaining
content.

Physical thickness defaults to 6 scene units. Templates may provide
`thickness`, and cards may override it with a positive finite value. A
`{ type: "thickness", cardId, thickness }` transaction animates the closed
cuboid, keeps both face surfaces attached, and causes the arrangement solver to
recalculate physical layer separation using the new thickness. Thickness is
independent of uniform visual scale; scale multiplies the configured thickness
when calculating rendered depth.

Cards may also provide a positive finite `weight`, defaulting to `1`. The
weight contributes to drag response through a bounded nonlinear
`weightInfluence`, so a heavier card can feel slower without losing its pointer
anchor. It also modifies the duration of target position, orientation, scale,
and face transitions. The normalized drag motion configuration is entered under
`interaction.motion`, resolved in `snapshot().dragMotion`, and can be patched
live with `scene.setDragMotion()` without rebuilding the scene or jumping the
active gesture. The `crisp`, `wizzard`, `natural`, `floaty`, and `dramatic` presets provide complete
starting profiles; changing a preset resets its defaults before applying
explicit fields in the same patch.
The `wizzard` profile is a restrained, responsive profile tuned against the
MTG Arena interaction research in
`docs/research/mtg-arena-drag-motion-2026-09-17.md`; it uses quick pickup,
responsive damping, strong movement tilt, no landing delay, no bounce, a
camera-facing 3D lift without scale enlargement, and an exaggerated grab-pivot
tilt.
The `dramatic` profile intentionally exaggerates free-drag dangle: it uses a
3× response, 0.2 damping, and larger tilt and twist limits so the spring
overshoots and visibly swings past its target.

Pointer pickup anchoring is configured independently of drag motion. The
default `interaction.dragAnchor: "grab"` keeps the clicked point under the
pointer. `interaction.dragAnchor: "center"` snaps the card midpoint under the
pointer at pickup; a programmatic `scene.drag()` may override it with
`anchor: "grab"` or `anchor: "center"`. Center anchoring also removes the
edge-grab correction for that pickup.

Natural drag motion uses `liftScale: 1.12`, `liftTime: 90`, `liftDepth: 0`,
`liftDepthTime: 80`,
`responseTime: 160`, `damping: 0.8`, `dangle: 1`, `maxTilt: 14`,
`maxTwist: 10`, `grabPivotTilt: 0`, `maxGrabTilt: 0`,
`grabPivotResponse: 100`, `upright: 1`, `landingTime: 180`, `landingBounce: 0.12`,
`landingDelay: 0`, and `weightInfluence: 0.5`. Strengths are finite and
non-negative; lift time and landing delay are finite and non-negative; response
and landing times are finite and positive, each at most 10 seconds. Damping is
finite and positive, tilt is limited to 90°, twist to 180°, and bounce and
weight influence are limited to 0–1. The free-drag upright response is a
stylistic choice. `scene.setMotion()` remains the base timing for authored
programmatic transitions; drag `responseTime` and `landingTime` govern the
interaction channels, while card weight and destination-zone speed fields
modify the matching landing channels.

Landing position uses smoothstep. Landing angle and tilt use an analytical
damped spring whose bounded overshoot is controlled by `landingBounce`; its
nominal `landingTime` may run through a bounded three-times tail before rest.
Edge pickup hang remains tracked in issue #19. Weight does not change the
resolved target pose, layout depth, zone membership, or direct pointer
attachment during a drag.

Movement alone preserves the current internal geometry. Explicit content or
presentation changes may reshape the card, including during movement. Depth uniformly scales
the entire card, including text; there is no implicit independent font scaling or LOD switch.

Zones can explicitly show/hide title, image, flavour, or project-defined regions.
Distinguish presentation from zone arrangement so a grid change does not implicitly
change card content. A template supplies baseline visibility; zone overrides resolve
against the card's own presentation (with template defaults), never against the
previous zone's overrides. A zone's explicit visibility override wins over the
card's preference while resident there; leaving restores the card preference unless
the next zone overrides it. Content is retained when merely hidden.

By default, a transfer morphs toward the destination presentation during travel,
coordinated with movement. Projects can explicitly schedule presentation changes
at another point, such as revealing content after arrival. In either case, resolve
final geometry before landing and schedule any dependent layout changes coherently.

Regions have separate presence and visibility. Adding/removing a region changes
the card's content structure. Hiding/showing retains its content and local state
for later use. Region IDs remain stable while present, including while hidden;
removing a region does not replace the card shell or unrelated regions. A region
absent from the card's content cannot be created merely by a zone's show override.
An outgoing region may remain visually mounted until its exit animation completes;
superseded cleanup must never remove a region that has since been shown or re-added.

These rules apply uniformly to every named card element: title, image, flavour,
metadata, badges, controls, and project-defined regions. No element has privileged
presence, visibility, or sizing behavior. Each can be added, removed, hidden, or
shown; its layout contribution determines how the remaining regions and the shell
adapt under the configured sizing policy. Templates define constraints for empty
cards and combinations of absent regions rather than assuming a title or image
always exists.

The content contract is an explicit `elements` array on every face. Each element
has a stable unique `id`, a string `type`, optional `content`, visibility, and
flow or overlay layout metadata. The engine has built-in `text` and `image`
renderers; projects may register additional types through `elementRenderers`.
Registered renderers can provide `measure({ element, width, dimensions })` for
content-driven sizing and `draw({ context, element, x, y, width, height,
images, content })` for WebGL texture output. Unknown types are rendered as an
explicit unsupported marker, never silently omitted. Top-level legacy content
fields such as `title`, `image`, and `flavour` are not part of the contract.

Any face content, including the physical back, may define `backgroundImage`
independently of its elements. It is either an image source string or
`{ src, fit }`, where `fit` is `cover`, `contain`, or `stretch` and defaults to
`cover`. The background image is drawn behind the content elements, does not
participate in flow measurement, and is clipped by the card shape. The WebGL
renderer loads and caches it like an image element; CSS fallback support remains
deferred with the fallback renderer.

Support two explicit region behaviors:

- Preserve space: fade a region while keeping its geometry.
- Reflow: fade outgoing regions, interpolate remaining region boxes, and reveal
  incoming regions as part of the same scene transition. Collapsed regions consume
  no space or leftover gap. With content-driven sizing, the shell's width/height
  also animates to fit the new layout. With fixed sizing, the shell keeps its size
  and the remaining regions rearrange inside it.

For example, hiding flavour text on a content-height card fades that text out and
shortens the card to fit its title and image. Showing it again restores the retained
text and expands the card. This changes the card's shape without shrinking the
title or image. Adding/removing content follows the same geometry pipeline.

Resolve target region boxes and unscaled shell dimensions before solving affected
zone layouts. Animate shell dimensions, region boxes, and any displaced neighbors
together. Reserve image dimensions where known; font/image loading that changes
intrinsic size triggers a fresh solve and continuous retargeting. Avoid circular
fit calculations by measuring content against the template's constrained width
before applying zone fit and explicit scale.

During an auto-height morph, render content against the current visible shell
height so elements retain their size while the shell changes. Fixed-size and
explicit resize textures may retain canonical target dimensions to keep text
wrapping stable. When a flow element is added, stage the incoming element until
the growing shell reaches its target height; when an element is removed, keep a
later surviving flow element bottom-anchored only when the removed element was
before it, so trailing removals reflow normally.

The card's configured anchor remains attached to its animated pose as dimensions
change. Default to the center; a top-center anchor allows shortening upward from
the bottom while keeping the top edge fixed. Compensate pivot transforms as needed
so resizing does not introduce a positional jump. Front and back share the same
animated shell dimensions throughout a flip.

Geometry changes may start, reverse, or be interrupted while the card rests or
moves, rotates, scales, and flips. Continue from the current visible dimensions
and region boxes. Only dependent layout targets are recalculated; unrelated
transform operations continue without resetting their progress.

Start with preserve-space, then implement and visually validate reflow. Text uses
stable wrapping during travel. For explicit reflow, pin wrapping during the geometry
morph and conceal any required discrete rewrap within the region fade; do not claim
that browser line breaking is continuously interpolatable. An all-hidden front is
valid and does not imply faceDown. The back face and its accessible description are
controlled separately; hidden front content must not leak through back-face input
or accessibility exposure.

## Dynamic card attachments

A card can receive stamps, counters, stickers, or project-defined elements at any
time. Attachments use the same element lifecycle and presentation rules as other
card regions, with instance IDs scoped to the card and registered render types.
Multiple instances of the same type may coexist. Updating a counter's value or
editing a stamp patches that instance while preserving the card and other elements.
An attachment's ID is its identity; its label, value, type, or position is not.

Attachment addition, update, hide/show, and removal are ordinary scene transaction
operations. They work while a card rests, travels, rotates, scales, flips, or changes
geometry. Changes animate from current visible state and do not restart unrelated
operations. Desired presence changes at commit; exit visuals may finish afterward.
Generation-aware cleanup cannot remove a replacement instance or resurrect a
removed one when an older animation finishes.

Each attachment declares its placement behavior:

- **Flow:** participates in card layout and can resize a content-driven shell.
- **Overlay:** anchors to the card or a named region without consuming layout space,
  such as a sticker over the image or a stamp over a corner.

Overlay placement specifies a normalized anchor, local offset, stacking order, and
whether the element is clipped to the shell or may extend beyond it. It follows the
card's current geometry and transforms. Region-anchored attachments declare what
happens when their anchor disappears: hide with the anchor by default, or use an
explicit card-level fallback. Never retain an obsolete screen rectangle as an anchor.

Attachments declare front, back, or both-face visibility independently of whether
they are present. A front stamp remains stored while the card is concealed. Templates
provide localized accessible descriptions and optional controls; concealed or
departing elements cannot retain active hit targets. Removing a focused attachment
returns focus to the stable card shell. Projects provide attachment rendering and
business meaning; the engine owns lifecycle, placement, and animation.

## Content faces and concealment

Each named content face can define its own elements, layout constraints, and art.
Attachment visibility may refer to particular content-face IDs, all content faces,
or the concealed back. Changing the active content face preserves card identity,
zone membership, and card-level attachments. Its different layout can reshape the
shell through the ordinary geometry pipeline.

Examples: a two-sided informational card switches from summary to details while
remaining faceUp; revealing a concealed card displays its previously selected
content face. Commands may select a face and reveal it in the same transaction.
Keep incoming and outgoing surfaces mounted as needed during a turn, while retaining
one scene shell. They share the current animated shell dimensions.

Concealment is visual state, not authorization. Applications provide only content
the current viewer is allowed to receive; unknown cards can use opaque IDs and
back-only data. Inspection, tooltips, labels, and asset requests must not reconstruct
or expose content absent from that viewer's data. The engine does not implement
multiplayer permission rules.

## Choreography, lifecycle, and pacing

Transactions commit desired state immediately. Optional choreography describes how
the resulting visual change is explained: sequence, parallel groups, stagger, delay,
straight/curved travel, anticipation, impact, and settling. References point to
operations in the transaction, not arbitrary callbacks that mutate application state.
Validate references and reject cyclic dependencies before committing anything.

For example: commit three cards to a hand, then visually deal them in a stagger;
or commit a counter increase and removal, visually pulse the counter before the
card exits. When later visual steps refer to changed layout, use resolved/current
poses and retarget them; never replay stale destination rectangles. A new independent
scale command may run while a previously scheduled travel sequence continues.

Lifecycle recipes compose ordinary operations:

- Spawn/deal: create a persistent shell at an explicit entry pose or zone, then
  animate to its allocated rest pose. The committed card already has membership.
- Reveal: expose the selected content face with coordinated turn and feedback.
- Dismiss/discard: move to a configured zone or remove, as explicitly requested.
- Remove: delete logical membership immediately, retain an inert exit visual until
  completion, then release resources. Focus transfers immediately to a valid target.
- Copy: the application creates a new card ID; the renderer may animate its origin
  from another card without treating the two as one identity.

If the same ID is reintroduced during an exit, cancel the old removal and reconcile
the retained shell from its current pose. Exit cleanup is generation-scoped. An
explicit new ID always means a distinct card.

Track logical actionability separately from visibility and physical hit testing.
An exit visual never blocks an eligible target. A card that has committed but has
not yet entered can be selected through logical navigation; a pointer hits its
actual visible geometry. Animations do not globally lock input. The engine provides
pending feedback only when the application explicitly reports pending work.

Provide normal, accelerated, and immediate presentation policies with a configurable
maximum backlog duration. Merge redundant visual updates, shorten optional motion,
and drop decorative effects before delaying essential feedback. Superseded steps
release sequence dependents without firing fake impact cues. Skipping reaches the
latest committed state and resolves handles; animation time never controls game time.
Reduced motion retains meaningful static highlights and announcements without
requiring decorative travel, spins, or flashes.

## Inspection and interaction states

Treat hover, focus, selection, dragging, actionable, eligible-target, disabled, and
pending as distinct state dimensions. Theme rules specify their composition and
precedence: disabled blocks actions, pending is application-supplied, dragging
controls pointer capture, and focus remains visibly identifiable alongside selection
or targeting. Feedback uses more than color alone. Keep these states separate from
card content, face, and zone membership.

Inspection supports pointer hover/focus previews and explicit keyboard/touch opening.
Use configurable dwell and dismissal behavior to avoid accidental hover flicker.
Clamp readable content to the viewport and allow scrolling for long descriptions.
Nested controls can operate without activating or dragging their parent card;
long-press inspection must coexist with scrolling and drag thresholds.

Two rendering modes serve different needs:

- In-place inspection raises/scales the existing scene shell temporarily, preserving
  slot membership. Closing returns to its current solved rest pose.
- A separate read-only preview shows full permitted content, related cards, and
  explanations while the scene card remains visible. It derives from the same card
  state with its own view ID; it is not registered as another scene card, and it
  never dispatches gameplay actions or duplicates editable controls/DOM IDs.

The invariant is one persistent scene shell per card, with explicitly identified
auxiliary views allowed. Preview navigation and dismissal may be interactive;
preview card content remains read-only. Both modes refresh during live content
changes and close cleanly on removal. Modal inspection restores prior valid focus;
nonmodal previews do not steal it. Inspection does not reveal concealed/unknown
content without an application-provided permission and data policy.

Inspection uses a dedicated readable presentation that can show full permitted
content even when the current zone simplifies or hides those regions. Closing
in-place inspection restores the zone's current presentation, including any changes
made during inspection; it never restores an obsolete saved layout.

## Multi-card selection and batch interaction

Selection is a first-class ordered set of card IDs, with a primary card for focus
and dragging and an anchor for range selection. It is independent of persistent
card groups, zone membership, face, and content. A project configures selectable
cards, single/multiple selection, maximum count, and whether selection may span
zones. Cross-zone selection is denied by default; `allowCrossZone: true` is an
explicit opt-in. `allowCrossZone: false` rejects any atomic selection request
that would span zones, including range requests, without changing the current
selection.
Selection alone neither moves cards nor grants permission to act on them.
Reconcile invalid/removed selections when project state changes and emit one
coherent selection-change event. Keep valid selected IDs across accepted moves
unless the project explicitly clears them.

Provide consistent pointer, touch, and keyboard controls:

- Plain selection replaces the set; modifier selection toggles membership.
- Range selection follows stable logical order within a zone, never transient
  animation coordinates. Cross-zone range selection requires explicit project order.
- Touch has an explicit selection mode with tap-to-toggle; long press remains
  available for inspection rather than being overloaded ambiguously.
- Keyboard supports toggling, extending a range, selecting eligible cards in the
  current scope, clearing selection, and invoking batch actions.
- Optional rectangle selection operates on visible projected card bounds and respects
  project eligibility. It starts on stage background and does not replace card dragging.

Dragging an already selected card preserves the selection rather than collapsing
it on pointer-down. The project-approved selected set becomes the drag cohort.
Dragging an unselected card selects it alone by default; modifiers may explicitly
add it before drag starts. Freeze the cohort and its ordering for the gesture so
later selection changes cannot silently add/remove cards from an active drag.

Use the same interaction path for one card and many. Requests carry an ordered
`cardIds` array, `primaryCardId`, source membership/indices, and the candidate
destination/index. The project evaluates the whole proposed batch, including
cross-zone combinations and ordering; per-card permission alone is insufficient.
Default to all-or-nothing acceptance. Never silently exclude denied cards or commit
a partial batch. If a project wants to act on a subset, it must establish and show
that subset explicitly before committing the action.

At pickup, sample every member's current pose. Preserve offsets from the primary
card by default so the selected cards follow the pointer without jumping into a
new arrangement. A project can opt into an animated compact drag bundle for widely
separated selections. Both preserve individual scene shells, face, and attachments.
Temporarily render each carried card at its configured `liftScale` to communicate
that it has been lifted from the table, then return it to the resolved scale when
the gesture ends. `liftTime` controls the scale transition. A separate
`liftDepth` moves only the carried render pose toward the camera, and
`liftDepthTime` controls that transition; it leaves logical zone depth and
authored card scale unchanged. Consumers can use either cue or both: set
`liftScale: 1` to disable scale lift and `liftDepth: 0` to disable 3D lift.
An off-center pointer grab can add a separate bounded pitch and roll around the
grabbed point through `grabPivotTilt`, capped by `maxGrabTilt` and eased by
`grabPivotResponse`. This pivot response is independent of movement dangle and
does not alter the card's logical position.
During free dragging, begin the in-plane angle at the card's current pose and
spring it toward upright. Scale the return by `upright`, bounded nonlinear card
weight influence, and pointer distance from the card center so an edge grab has
more leverage.
Derive filtered pointer motion and use it to drive bounded local tilt and
additional in-plane angular momentum. Direction changes carry momentum and
settle through `damping`; `responseTime`, `dangle`, `maxTilt`, and `maxTwist`
bound that movement response. Use the grab point as a separate 3D pivot:
`grabPivotTilt` controls its strength, `maxGrabTilt` caps it, and
`grabPivotResponse` controls its spring. Keep the card's grab point anchored to
the pointer while applying both rotations. Keep gravity-like edge pickup hang
disabled while its calibration is retried, and clear the temporary physics when
the gesture ends. Pending target
motion may pause for `landingDelay`, then uses smooth position easing and an
analytical damped spring for angle and tilt. `landingTime` is the nominal spring
time and `landingBounce` controls its bounded overshoot; card weight and zone
channel speeds modify the resulting landing.
When pointer input is quiet for the stop grace period, give the last directional
dangle a single momentum impulse before damping it toward rest. This makes the
card continue slightly in the drag direction after the pointer stops while
keeping the grab point anchored.
The position channel of each member follows the drag; its independent rotate,
scale, and flip channels continue. Give visible count/selection feedback and expose
the count accessibly. During the active drag and any pending approval, elevate the
cohort in the render layer for every arrangement type without changing logical
membership or the resolved resting depth. Drag cohort visuals never obscure
destination hit testing.

Resolve target positions for the entire batch with one arrangement preview, including
space for all members and displaced neighbors. Within-zone source order is retained;
cross-zone ordering uses configured zone order then card order. A custom order may
be supplied explicitly. Destination indices refer to the sequence after removing
cohort members already in that destination, avoiding same-zone reorder errors.
Validate capacity and placement against the whole proposed result.

One drop emits one intent for the cohort. Acceptance commits all member moves in
one transaction and animates them into their resolved positions. Pending approval
holds all members at their proposed targets, while committed memberships remain
unchanged. Rejection/cancellation returns every surviving member and previewed
neighbor to its current committed rest pose, including their different source zones.
If any member disappears, loses eligibility, or has its membership changed externally,
cancel the whole pending gesture and reconcile the latest authoritative state;
never resurrect removed members or process a late acceptance of the cancelled intent.

Selection is also the input to project-defined batch actions: move, rotate, scale,
flip, change presentation, or add/remove attachments. Applications validate the batch
and submit one transaction. Rotate/scale operate per card around each card's pivot
by default; transforming the selected formation around a shared pivot is a separate
explicit group operation. Each card retains its own face and transform state.

## Targeting and relationships

A target session has a source, eligible target IDs, minimum/maximum selection count,
localized instructions, and explicit confirm/cancel behavior. Render current target
feedback and optional source-to-target links. Support pointer, touch, and keyboard;
emit selected IDs to the application for acceptance. Revalidate eligibility when a
new snapshot arrives, invalidate removed targets, and dismiss stale sessions safely.

Drag insertion previews use the same arrangement solver as committed placement.
Neighbors temporarily make room, but membership/order remains unchanged until the
application accepts the intent. Rejection retargets all previewed cards to their
current committed poses. Preview reservations cannot become permanent empty slots.

### Cross-zone dragging and project rules

Cards can be dragged within their current zone or into another zone. The project
defines whether a card can start dragging and which destination zone/insertion
position is allowed in the current application state. Zone names, arrangement,
face, and card type never imply permission inside the engine. The same project-rule
decision applies to pointer, touch, and keyboard move requests.

The project adapter provides current drag capabilities and destination decisions
through a rule-provider interface configured on the scene. An illustrative request
is `{ cardIds, primaryCardId, sources, toZoneId, index }`, where `sources` records
each card's committed zone and index; its result indicates allowed/denied
with an optional localized reason. Initial dragging requires an explicit project
capability. Evaluation must be side-effect-free and fast for live feedback; cache
decisions by candidate and project-rule revision rather than evaluating every frame.
The adapter invalidates decisions when relevant project state changes. Remote
authorization happens at drop acceptance, not through network calls on pointermove.

The engine owns pointer capture, lifting the card, transformed hit testing, target
highlights, valid insertion previews, auto-scroll, and cancellation. Show valid and
invalid targets according to project decisions; denied targets do not cause a
placement preview. Structural constraints such as existing zone IDs and capacity
remain engine invariants even when the project allows an action.

A project-allowed drag may take over an automatically moving card immediately.
Start from its current visible pose and preserve the pointer's grab offset. The
drag supersedes the position channel; independent rotation, scale, and flip
channels keep running unless the project explicitly cancels them. Existing
operation handles report the superseded position operation without cancelling
unrelated work.

On release, re-evaluate the latest destination and emit one uniquely identified
drop intent. Pointer release does not commit a move. The application accepts by
submitting the corresponding scene change, or explicitly rejects/cancels the intent.
For asynchronous decisions, expose a pending state scoped to that intent/cohort and
hold its cards at the proposed destination with their visual preview while committed
membership stays unchanged; unrelated cards remain interactive. Every pending intent
must settle through acceptance, rejection, cancellation, or disposal. Removing the
card or destination, changing eligibility to denied, or superseding the intent
cancels its preview. A late decision cannot resurrect or complete a cancelled drag;
a newer authoritative snapshot is reconciled as a separate scene update.

Acceptance animates from the card's current dragged pose to the newly solved
destination. Rejection, Escape, pointer cancellation, or an invalid drop returns
the card and displaced neighbors to their current committed poses. No stale source
rectangle is used. Programmatic scene updates represent project-approved state;
the engine validates their structural consistency without implementing project
business rules or treating browser drag feedback as server authorization.

Relationships are keyed by ID and endpoints, which may reference cards or regions.
Links/arrows follow current transformed geometry, including rotation, scaling,
resizing, and movement. Removing an endpoint removes or suspends the relation under
an explicit policy; no orphan line remains. Direction and meaning are supplied by
the project.

A group associates independent card IDs; it does not own another copy of membership.
Grouped movement expands into one atomic transaction. Collapsed/expanded group
views retain individual IDs, inspection access, and input order. Group failure is atomic.
Selecting several cards does not create such a persistent group. A project rule
must explicitly expand a proposed selection action to a required group and expose
the affected set in its preview, or reject the action; the engine does not silently
drag unselected related cards. Card-to-card attachment is a stronger spatial
relationship with the explicit following behavior below.

## Cards attached to cards

A card can attach to another card like a stamp. The child remains a complete card
with its own ID, content faces, elements, selection state, and attachments. It keeps
its persistent scene shell; attachment never converts it into a decorative element
or destroys its identity. Several cards can attach to one parent, and attachments
can nest. Reject self-attachment, cycles, and multiple spatial parents atomically.

An attachment relation specifies parent/child IDs, an anchor on the parent card or
one of its regions, a child pivot, local offset, local rotation, local scale, and
surface affinity. Default to overlay placement on the parent's active content
surface without expanding its layout footprint. Clipping/overflow and layer order
are explicit. If the anchor region disappears, hide with it by default or follow
a configured card-level fallback, just as for decorative attachments.

The child follows its parent's current movement, rotation, scale, and flip at every
frame. Compose parent surface geometry with the child's local pose before camera
projection; do not project or scale it a second time. Parent resizing relocates the
attachment point coherently. Surface affinity determines concealment as the parent
turns. The child's own face state is preserved and its local rotation, scale, and
flip can animate independently. Hidden children do not receive input or expose
concealed content through inspection/accessibility.

Only attachment roots receive independent zone-layout slots. Every attached card
still belongs to the parent's zone and counts as a card for configured capacity
and project rules; the parent relationship owns its pose, not another zone slot.
Attaching across zones moves the child subtree into the parent's zone in the same
validated transaction. Moving a parent automatically includes its attached subtree
in the proposed move, permission checks, capacity checks, and visible drag preview.
Project rejection of any required member rejects the whole action. Selection need
not include descendants for them to follow their parent.

When both parent and child are selected, move the child once through the attachment
relation rather than applying the drag displacement twice. A child-only drag does
not silently detach it: the project explicitly chooses a permitted local reposition,
a detach-and-drag action, or rejection. Attach/detach are project-governed operations;
a card can be a candidate attachment target when the project's drop rules allow it.
Preview and intent identify whether the proposed drop attaches to a card or places
into a zone, so the two outcomes are never ambiguous.

Attach, detach, and reattach may happen during other animations. Sample the current
displayed child pose and animate toward the new local or zone-layout target without
teleporting or replacing the shell. Detach assigns the child an explicit zone/index
(its current zone by default) and resolves its target through that arrangement.
Parent removal requires an explicit atomic policy to remove descendants, detach
them into zones, or reattach them elsewhere; do not silently destroy child cards.
Cancelled/obsolete relation cleanup cannot affect a newer attachment.

## Feedback and visual treatments

Provide optional transient effect hooks anchored to cards, regions, or scene poses:
pulses, trails, impact flashes, particles, and synchronized sound cues. Effects do
not consume card layout or capture input. Effects and audio observe the scene clock,
cancellation, reduced-motion preferences, mute settings, and disposal. Milestone
cues fire once when actually presented; skipped or superseded work cannot produce
late sounds. Never trigger a vote, counter update, or other business action from a cue.

Themes may supply sleeves, frames, animated artwork, lighting, foil, or parallax
treatments. These are optional renderer extensions with static fallbacks. Cap effect
counts and asset memory, pause invisible loops, and degrade decoration before text
legibility or input responsiveness. Asset readiness has a bounded wait/fallback;
missing art or audio cannot indefinitely block a transition. Choose specific media
and rendering techniques only after the lab's performance measurements.

## Interaction and application integration

The engine owns hit testing, pointer capture, hover/focus feedback, keyboard
navigation, optional drag mechanics, and reduced motion. Project adapters decide
whether activation means selecting, voting, inspecting, or playing a card. A drop
emits intent; the app commits an accepted move or the engine returns the card to
its current committed pose. Supply an equivalent keyboard action for drag workflows.

Overlapping cards have explicit input precedence matching visual order. Keep a
predictable logical focus order despite the shared visual layer. Templates provide
localized labels; zones have accessible labels and membership relationships.

Consuming projects translate their own state into generic scene updates and provide
interaction permissions. Polls, votes, per-answer collections, community paging,
networking, persistence, and optimistic rollback policy are not engine concepts or
implementation tasks. A stamp in the engine is a generic visual attachment, not a
Picko vote stamp. Demonstrate permissions and asynchronous acceptance with local
example rules and simulated responses, without importing application logic. The
engine can animate reconciliation to an authoritative snapshot without understanding
its business meaning.

## Rewrite sequence and acceptance gates

1. **Contracts and walking skeleton.** Implement in `packages/card-engine/` and
   `examples/card-engine-lab/`, with independent lab tooling and no legacy imports;
   arbitrary zones, persistent cards, grid placement, one move command, shared
   camera and renderer, composed rotation, scale, and a two-sided flip. Prove a
   true 3D beveled extruded shape profiles behind the renderer seam before expanding
   the scene interface. Define
   active content face versus concealment, operation results, and channel ownership
   here, before expanding the interface. Define selection as a set and drag intent
   as a batch from the start, even when the initial lab gesture moves one card. Gate:
   combined move/rotate/scale/flip ends at the intended pose with no endpoint jump,
   readable scaled text, identical
   final state with reduced motion, and stable shell/region identity.
2. **Coherent scene changes.** Atomic multi-card moves, reordering, current-pose
   retargeting, resize handling, reconcile/remove/destroy lifecycle. Gate: rapid
   commands and viewport changes produce no teleport or stale completion effects;
   interrupting a spin, scale change, or half-flip preserves the current visual pose.
   Add spawn/remove/re-add with generation-safe cleanup; verify removal immediately
   releases logical membership and input without truncating the exit visual.
3. **Choreography and pacing.** Sequence/parallel/stagger composition, curved paths,
   lifecycle recipes, cue milestones, and bounded backlog policies. Gate: repeated
   dealing remains responsive; superseding one operation preserves independent
   channels; accelerating/skipping produces the same committed state, correct
   completion results, and no late callbacks. Use mock cue consumers initially.
4. **All arrangements.** Aligned, splay, pile, stack, capacity and overflow policies.
   Gate: deterministic layout, correct stack order, stable targets under population
   changes, and no accidental cross-zone overflow.
   Include mixed card dimensions, CSS-anchored and spatial zones in the same stage,
   camera/depth changes, hidden/restored zones, and page scroll/resize. Confirm
   page anchors retain their footprint while spatial geometry projects consistently.
5. **Appearance.** Named content faces and concealed back, per-card flips, region addition/removal,
   visibility overrides, then region reflow and content-driven shell dimensions.
   Gate: hiding flavour shortens an auto-height card and showing it restores content
   and height; fixed-size cards retain their dimensions. Verify both directions
   for title, image, flavour, and custom regions, including multiple simultaneous
   changes and an empty card. Exercise these changes
   during simultaneous moves, rotations, scale changes, flips, and interruptions,
   with no shell replacement, positional jump, stale removal, or unexplained rewrap.
   Include live counter updates, multiple stickers, stamp removal during a flip,
   and attachment add/remove/re-add during travel. Verify both flow and overlay
   placement, concealed-face behavior, and disappearing region anchors.
6. **Interaction and inspection.** Composable interaction states, activation,
   in-place and read-only preview inspection, related content, drag insertion
   previews, multi-card selection/dragging/batch actions, and keyboard/touch
   equivalents. Gate: visual/input order agrees,
   focus survives movement, nested controls work, inspection remains inside the
   viewport and updates live, hidden information is not exposed, and rejected
   drops leave no stale gaps. Verify all of this with reduced motion.
   Exercise cross-zone moves allowed/denied by project rules, rules changing during
   drag, delayed acceptance/rejection, target removal, and cancelled intents with
   late responses. Verify equivalent decisions for pointer, touch, and keyboard.
   Test picking up an animated card without stopping its independent transforms,
   invalid foreground zones blocking drops to zones behind, transparent zones,
   empty-zone drops, inspection over a drop surface, and zone movement during drag.
   Verify same-zone and cross-zone selections, stable batch ordering, full-batch
   capacity checks, one denied member rejecting the batch, pending batch rejection,
   member removal during drag, and per-card transforms continuing during pickup.
   Ensure dragging a selected card preserves the set and a successful batch leaves
   surviving cards selected. Test range/toggle selection and optional rectangle selection.
7. **Targeting and relationships.** Eligible-target sessions, moving endpoint links,
   atomic group movement, attached-card layouts, and group expand/collapse. Gate:
   removing a target mid-selection is safe; arrows follow geometry changes; cycles
   are rejected; grouped moves preserve individual identities and zone membership.
   Include nested card attachments, parent movement/rotation/scale/flip and resizing,
   child-local transforms, cross-zone attachment, attach/detach mid-animation,
   parent-plus-child selection without double movement, denied descendant moves,
   disappearing anchors, and explicit parent-removal policies.
8. **Feedback and visual treatments.** Connect the cue contract to optional audio
   and effect renderers; add one animated-art/sleeve treatment with a static fallback.
   Gate: effects cancel correctly, sound does not fire after supersession, mute and
   reduced motion work, resources are released, and overloaded decoration does not
   consume the interaction/frame budget. Broader cosmetic packs are follow-up work.
9. **Portability proof.** Build a second small consumer with unrelated zone names,
   content, and actions. Gate: no Picko imports or voting assumptions in the engine;
   loading from a page with different surrounding CSS still works.

Each milestone produces a usable lab scenario and its regression checks. Milestones
1–3 establish state and timing contracts; 4–6 establish the core visual interaction
experience. Milestones 7–8 are optional modules for consumers but remain planned
deliverables. Their absence must not prevent a basic scene from working. Complete
the portability check as the final engine acceptance gate. No Picko integration,
legacy cleanup, backend, combat system, turn
scheduler, or card-legality rules are included in this rewrite.

The lab is retained as a regression and tuning tool. Give it controls for population,
depth, zone size, layout, region visibility, face, rotation/tilt, scale, pivot,
flip axis, fixed/content-driven size, region addition/removal, motion speed,
repeated routes, and rapid retargeting, plus optional
current/target pose overlays. Include a combined move/rotate/scale/flip route.
Add controls to attach/remove stamps and stickers, update counters during movement,
and switch attachments between flow and overlay placement.
Retain a scenario gallery rather than relying only on individual controls:

- Deal several cards with stagger, inspect one, then reorder by drag or keyboard.
- Select multiple cards within/across zones, drag them together, reject the batch,
  then accept it; exercise batch flips and attachment updates without moving cards.
- During travel, rotate/scale/flip, hide a region, update a counter, and add a sticker.
- Reverse a half-flip, select another content face, and conceal/reveal the card.
- Remove and re-add a card during its exit; inspect another card while it updates.
- Select targets while endpoint cards move, resize, or disappear.
- Expand a group, move it atomically, then detach one member.
- Attach a card to another like a stamp, move/rotate/scale/flip the parent, then
  detach the child during travel. Repeat with nested attachments and batch selection.
- Generate a burst of events, accelerate/skip presentation, and verify latest state.
- Repeat scenarios with slow/missing assets, a resized viewport, reduced motion,
  touch/keyboard input, and effects disabled.

## Evidence required for release

Pure layout/state tests cover invariants and deterministic results. Browser tests
exercise real font/image loading, DOM identity, focus, projection, interruption,
and the last animated frame versus the resting frame. Require a landing delta of
at most one CSS pixel under stable viewport geometry.

Use an injectable clock and fixed layout seeds for reproducible choreography tests.
Cover per-channel supersession, zero-duration motion, delayed dependent steps,
input during exits, and teardown with pending cues. Compare final state across
normal/accelerated/immediate policies. Browser checks distinguish scene-shell
identity from permitted read-only preview views, verify hidden content accessibility,
and assert that each active property has only one animation owner. Record missed
frames and input latency under animation bursts; settle reference devices and
thresholds in milestone 1 and use them as later regression gates.

Evaluate Chromium, Firefox, and WebKit, including touch viewport sizes and reduced
motion. Use recorded animation samples and hands-on inspection to judge text
rasterization, card feel, and region reflow; unit-test counts cannot establish these.
Benchmark 6, 50, and 200 cards, varying the moving subset and template complexity.
Set the supported population/device envelope from measurements. Target a 60 Hz
frame budget on agreed reference hardware and report missed frames rather than
promising unlimited card counts or zero rasterization artifacts.

The first milestone must settle the highest-risk question: can the chosen true-3D
renderer deliver continuous card geometry, desired text quality, and motion quality
under depth scaling? If it cannot, resolve that before building out arrangements and
further engine capabilities.

## Comparison references

These references motivate capabilities from documented player-facing behavior;
they are not evidence about the games' internal engine architectures.

- [Arena dungeon/token inspection](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-digital-release-notes-adventures-forgotten-realms-2021-07)
  motivates inspection with related content and touch access.
- [Arena mobile controls](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-mobile-faqs-2021-01-28)
  motivates explicit source/target selection across input methods.
- [Hearthstone Battlegrounds positioning](https://hearthstone.blizzard.com/en-us/news/23156373/hearthstone-battlegrounds)
  motivates meaningful card ordering and placement interaction.
- [Arena transforming double-faced cards](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-release-notes-march-of-the-machine)
  motivates separating content faces from concealment.
- [Hearthstone animation/input fix](https://hearthstone.blizzard.com/en-us/news/23852687)
  motivates explicit separation of logical actionability and pending visual work.
- [Hearthstone animated golden artwork](https://hearthstone.blizzard.com/en-gb/news/18053404)
  and [Arena card styles](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-beta-march-2019-03-20)
  motivate optional animated-art and visual-treatment extensions.
