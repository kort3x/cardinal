# Issue #4: Drag cards across zones

Status: automated behavior acceptance and the bounded code review pass after
engine fixes for outside-stage touch cancellation, stationary-pointer projection
changes, and late image callbacks after disposal. A 50-card initial drag-update
timing spike remains a performance follow-up; hardware/visual acceptance and
issue closure remain open. The avoidable drag-preview timing spike was reduced by
removing repeated deep snapshot cloning and normalization; hardware performance
and visual acceptance remain separate follow-ups. See [extended evidence](../verification/drag-acceptance-2026-09-15.md).

Tracking specification: [Issue #4](https://github.com/kort3x/cardinal/issues/4)
(Slice 03). Depends on completed #3. Selection-cohort dragging follows in #5.
This plan applies the accepted rules in `docs/specs/cardinal.md`, particularly
“Zone placement and responsive geometry” and “Cross-zone dragging and project rules”.
All lab labels, accessibility messages, docs, and tests are English. Correct the
obsolete German-label instruction in GitHub #4 when recording implementation work.

## Outcome

Pick up a visible card, move it through responsive zones, preview an allowed grid
slot, and release it. The consuming project approves or rejects the move. The
same behavior works with mouse, touch, and keyboard, including while cards animate.

## Scope and defaults

- Deliver one-card gestures in #4. Requests already carry ordered `cardIds`,
  `primaryCardId`, and source membership/indices for #5. Reject multiple-card
  session requests explicitly until that slice implements them.
- Preserve an existing selection when picking up one selected card; visibly
  identify the one dragged card. Picking up an unselected card selects it alone.
  Multi-selection transform controls continue to work; cohort pickup comes in #5.
- Drag capability requires explicit project opt-in. Missing rule providers deny
  pickup. The lab supplies permissive example rules and denial/pending controls.
- Cards retain committed membership throughout dragging and pending approval.
  A drop outside a zone returns to the latest committed position. Free placement
  continues through the existing project-issued move command.
- Keep the existing primary lab and its three zones. The engine owns input,
  picking, previews, cancellation, and cleanup; lab code supplies example rules.
- WebGL implements browser presentation. CSS fallback remains deferred to #16.

## Current code and required seams

`scene.js` already provides transactions, selection, target sessions, independent
motion channels, and responsive geometry reconciliation. `layout.js` solves grid
poses; `zones.js` resolves anchors. Reuse these behaviors.

Three gaps need explicit work:

1. `transact(move)` commits immediately, while `apply()` and `refreshGeometry()`
   schedule resting positions. Add engine-owned temporary drag/preview poses and
   position ownership so geometry refresh cannot pull a dragged card away.
2. WebGL picking includes a flat rectangle fallback and returns the first ray hit,
   while rendering also uses explicit card draw order. Establish picking that
   matches the visible shield/rounded geometry, flip, and compositing order before
   using it for pickup. Test transparent corners and overlapping depth layers.
3. Preview and final placement need the same hypothetical membership solve.
   Extract reusable grid insertion/placement calculation; avoid a second layout
   implementation in the lab or in input event handlers.

Suggested internal modules: `interaction.js` for session/rule/intent lifecycle;
`input.js` for browser pointer/touch/keyboard events; existing layout and renderer
modules for placement and projection. Keep orchestration in the scene interface.

## Proposed public interface

The implemented scene interface is:

- `createCardScene({ interaction: { rules, ...inputOptions } })`: opt in to
  browser input. Rules expose synchronous `canStart(request)` and
  `canDrop(request)`, returning `{ allowed, reason? }`.
- `scene.drag({ cardIds, primaryCardId, point? })`: begin a session through the
  same path used by the browser adapter. Return `update`, `release`, `cancel`,
  `snapshot`, and a `finished` promise for the logical outcome. Pointer updates use scene coordinates; keyboard updates use
  explicit destination IDs/indices, validated by the same candidate evaluator.
- `scene.invalidateRules()`: advance the rule revision, invalidate cached
  decisions, and reevaluate active/pending sessions.
- `scene.on("drop", listener)`: emit one immutable intent per valid release,
  containing its ID, ordered cards, sources, destination/index, and revisions.
- `scene.resolveDrop(intentId, { accepted })`: validate a still-live intent and,
  on approval, submit its corresponding membership move through the existing
  atomic transaction path. Rejection restores current committed layout. Return
  `accepted`, `rejected`, or `stale`; accepted results also expose the landing
  transaction's `finished` promise. Never apply twice.
- Expose interaction diagnostics in `snapshot()` and change events, including
  phase, active card IDs, candidate, eligibility reason, and pending intent ID.

Projects own asynchronous authorization. They receive an intent and later call
`resolveDrop`; pointermove never performs network requests. The lab can approve
synchronously, reject, delay a response, or expose manual accept/reject buttons.
An unrelated authoritative `apply()`/membership update reconciles normally and
invalidates conflicting intent state; it never acts as an uncorrelated acceptance.

## Lifecycle and invariants

Gesture progression: idle → pressed → dragging → pending → accepted or rejected.
Escape, pointer cancellation, lost capture, removal, or supersession can cancel
work. Accepted/rejected/cancelled describe logical outcomes; return/landing motion
can continue afterward using the existing motion clock and completion handles.

- On pickup, sample the currently displayed pose and take over position only.
  Supersede its position-operation tickets; preserve rotation, scale, flip, resize,
  and thickness channels. Represent visual lift/draw priority separately from
  authored membership/depth; lifting must not change apparent size in perspective.
- Preserve the initial screen grab offset to the projected card center. Recompute
  its world position from the latest camera and pointer during scroll/resize.
  Continuing flips and scaling remain centered around the card's own pivot.
- Preview on a hypothetical snapshot. Remove the cohort before interpreting
  insertion indices, including same-zone moves. Solve the whole affected grid,
  animate displaced neighbors, and leave committed arrays untouched.
- A denied candidate shows denial feedback but creates no reserved grid slot.
- On release, refresh geometry, rules, capacity, and insertion before emitting.
  Capture source identity/membership and relevant revisions for later validation.
- While pending, hold a visual destination preview and release pointer capture.
  Unrelated cards remain usable. A conflicting gesture/update clears affected
  previews deterministically; multiple preview owners cannot write one card pose.
- Rule invalidation reevaluates active gestures; invalidated pending approvals
  are cancelled. Removed/hidden destinations, removed cards, external cohort
  membership changes, or capacity changes that invalidate the candidate cancel it.
  Geometry-only changes recompute preview poses at the proposed slot.
- Reject/cancel by solving the latest committed snapshot, including changed
  dimensions and anchors. Resolve all intent/operation handles, dispose temporary
  graphics, and restore valid focus. Late approval cannot resurrect a card.
- Destroy cancels sessions, listeners, captures, scrolling, and pending handles.

## Geometry and targeting

- Convert client coordinates through the renderer's actual camera and stage
  bounds. Support orthographic and perspective projection and both zone types.
- Use full visible zone surfaces, including empty zones. Choose the nearest
  projected plane, with a documented zone-order tie-break at equal depth.
  Preview outlines use that same projection and precedence.
- An ineligible foreground zone blocks zones behind it. Introduce an explicit
  zone targeting policy (proposed `dropTarget: "surface" | "transparent"`),
  defaulting to surface. Hidden/missing anchors cannot receive drops.
- Dragged cards and preview graphics never block destination picking. Preserve
  normal input exclusion for interactive nested elements.
- Derive insertion from the existing grid tracks, with deterministic before/after
  decisions and empty-zone index 0. Test mixed sizes, reordering, and capacity.
  More arrangements and configurable overflow policies remain in #6.

## Input behavior

- Mouse/pen: primary-button pickup after a small movement threshold; preserve
  click selection below the threshold. Capture during dragging and release on
  every terminal path; handle pointercancel and unexpected lost capture.
- Touch: provide an explicit touch-drag mode/handle that configures touch behavior
  before contact. Preserve normal page scrolling outside that affordance; do not
  depend on changing `touch-action` after a gesture has already begun. Pinch or a
  second contact cancels the active gesture safely. Long press stays available
  for future inspection.
- Keyboard: focus a card, Space to pick up; arrows choose insertion slots,
  Tab/Shift+Tab cycle visible zones while carrying, Enter/Space to release,
  Escape to cancel. Announce destination, position, denial reason, and pending
  outcome; release navigation capture on drop/cancellation.
- Auto-scroll: while carrying near an edge, scroll the nearest scrollable
  ancestor with available range, then the page. Reevaluate geometry from the last
  pointer after scrolling. Stop on release/cancel/destroy; scope behavior to the
  active gesture and use elapsed time, not a fixed distance per frame.
- Reduced motion preserves decisions and endpoints with immediate decorative
  transitions. Pointer tracking itself remains direct.

## Implementation sequence

| Step | Deliverable | Evidence before continuing |
| --- | --- | --- |
| 1 | Session lifecycle, position ownership, rule opt-in, cancellation | Public-scene tests pick up mid-move, preserve flip/rotation, and cancel to current layout; minimal mouse pickup/return in lab |
| 2 | Camera-correct pickup, full zone targeting, grid insertion previews | Actual mouse drag to empty/populated zones; same-zone reorder; preview equals committed solve; denied foreground and transparent-zone fixtures |
| 3 | One drop intent, project acceptance, pending/rejection and stale protection | Lab immediate/delayed/manual responses; deterministic races with rule revisions, removal, capacity and external updates; unrelated card remains usable |
| 4 | Responsive dragging, auto-scroll and complete touch/keyboard adapters | Real input sequences across scrolling, stage resize and full-window transitions; touch cancellation and keyboard parity |
| 5 | Primary lab controls and repeatable browser scenarios | Compact Drag controls for enablement, denial and response mode; live interaction status and keyboard help; existing cards/elements controls still work |
| 6 | Review and acceptance evidence | Engine regressions, Chrome drag scenario, Firefox/Safari drag coverage, measured viewport and landing/pointer errors, cleanup and responsiveness measurements |

## Verification and completion

Use the scene interface with a deterministic clock for state transitions and
asynchronous response ordering. Browser tests must also generate real input
through browser automation; calling the session directly or clicking toolbar
buttons alone does not verify pointer capture, keyboard focus, or touch behavior.

Acceptance matrix:

- Same permitted/denied result for mouse, touch, and keyboard, including empty
  zones and reorder indices. Denied destinations reserve no space.
- No pickup jump; pointer attachment and stable landing within one CSS pixel
  under a stable camera. During scroll/resize/full-window changes, measure
  against the latest camera and report attachment errors rather than only status.
- No stale commit after cancellation, rules change, hidden/removed destination,
  card removal, external membership update, or a late asynchronous approval.
- Preserve shell identity and independent motion, including pickup while spinning.
  Confirm shield/rounded corners and draw-order overlap visually and by picking.
- Rejection restores affected neighbors; pending approval scopes interaction
  restrictions to affected cards. No leftover gap, captured pointer, focus trap,
  event listener, or unresolved completion handle after cancellation/disposal.
- Exercise card element add/remove, content resize, and scale during drag; retain
  relevant existing element, zone, resize, and motion regression suites.

Chrome is the primary visible lab demonstration. Preserve its existing window
position and dimensions. Controlled headless Chrome uses the established
2515×1322 viewport. Firefox uses 2500×1300; Safari requests a 2500×1300 outer
window at x=100, y=0. Record actual inner/outer dimensions and device-pixel ratio:
an outer window size is not a page viewport. Record touch-emulated coverage
separately from any physical-device tests. Wait for observable outcomes with
timeouts and failure snapshots; fixed sleeps alone cannot establish readiness.

Measure pointer response and frame timing with 1, 10, and 50 mounted cards during
single-card dragging, comparing to the same fixture at rest/in existing motion.
Cache rules by candidate, scene validity, and rule revision; avoid reauthoring
snapshots or rebuilding textures on every pointer event. Performance on the
reported Surface remains unverified until measurements from that device exist.

Complete the acceptance matrix and review before closing #4. Record browser and
device evidence and synchronize the issue, slice checklist, and project board.
