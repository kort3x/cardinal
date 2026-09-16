# Issue #5: selection and batch dragging

Status: implemented locally with Luna workers; physical-device acceptance remains
open. See the [implementation evidence](../verification/batch-acceptance-2026-09-16.md).
Base revision: `82b4743`. Tracking: [issue #5](https://github.com/kort3x/cardinal/issues/5),
slice 04. The prerequisite [#4](https://github.com/kort3x/cardinal/issues/4) is closed.

## Outcome

Select cards from Lake and River, carry them together to Ocean, reject the first
drop, then accept the next. Every surviving card returns to its current source
layout on rejection. Acceptance moves the complete batch once, retains selection,
and allows a subsequent batch flip without changing membership or position.

The engine owns selection, gesture state, projection, placement previews, and
atomic commits. The consuming project owns selection eligibility and action
permission. Keep existing card shells and independent motion channels.

## Foundation at the start of implementation

- `scene.select()` already supports replace/add/toggle/remove, an ordered ID
  array, a primary card, an anchor, and basic multiple/count configuration.
- `scene.transact()` validates a cloned result before committing a list of moves,
  transforms, or element operations. Individual moves currently mutate membership
  sequentially; this alone does not establish correct cohort insertion indices.
- The #4 drag interface has `cardIds`, `primaryCardId`, sources, correlated drop
  intents, and cancellation hooks, but explicitly rejects more than one card.
  Preview, presentation, input pickup, and commit still assume a single member.
- The lab already has multi-selection controls and batch transform commands.
  Integrate these controls with the completed engine selection contract.

## Decisions for implementation

1. Preserve `scene.select`, `scene.drag`, `scene.resolveDrop`, and `scene.transact`
   as the public entry points. Extract selection policy into a focused internal
   module if needed; scene integration has a single owner.
2. Selection stores ordered IDs, primary, and anchor. Add project eligibility,
   count, and zone-scope constraints. Reconcile removed or newly ineligible cards
   with one coherent change event. Selection does not authorize a move.
3. Range selection follows committed zone membership. A cross-zone range needs
   explicit project order. Default cohort insertion order is configured zone
   order followed by each zone's committed card order, with an explicit custom
   order option. Capture cohort/order/sources once at pickup.
4. Picking up a selected card preserves the set. Picking up an unselected card
   replaces it by default; explicit modifiers may add before pickup. Later
   selection changes never modify the active cohort. The picked/focused card
   becomes the primary; preserve the range anchor unless selection changes it.
5. Preserve each member's sampled offset from the primary by default. Offer an
   explicit animated compact bundle, retaining individual shells and pivots.
   The primary stays attached to its grab point; ongoing flips, rotation, scale,
   dimensions, and content remain live. Projection uses the current camera.
6. Compute proposed membership by removing all cohort members first, then
   inserting the ordered cohort once. Share this calculation between preview
   and commit. Validate the final complete model before mutation.
   For `[A, B, C, D, E]`, moving `[B, D]` to post-removal index `3` must yield
   `[A, C, E, B, D]`. Sequential `index + offset` moves can incorrectly yield
   `[A, C, B, E, D]`; this is a required regression case.
   Clear `positionMode` on every moved member in both preview and commit so
   cards previously placed with absolute coordinates join the target arrangement.
7. Evaluate project rules and capacity for the complete batch. One denied member
   rejects the whole proposal. Emit one immutable intent; acceptance commits once.
   Pending approval holds every member at its proposed position while committed
   membership remains unchanged. Denied candidates reserve no slots.
8. Removal, changed source membership/order, invalidated rules, lost destination
   eligibility, or stale approval invalidate the whole gesture. Return survivors
   and affected neighbors to the latest committed layout. Never resurrect a card.
   Validate every member in both `beforeCommit()` and `reconcile()`, including
   secondary-member removal and authored-position changes.
9. Batch actions use the existing transaction path and each card's own pivot.
   Cover current transforms and element updates; future stamps and card-to-card
   attachments remain their own slices. Selection is not a persistent group.
10. Keep UI and accessibility text English, following the current repository
    specification and lab. The German-label sentence in live issue #5 is stale.
    Optional rectangle selection is deferred; do not add it as a prerequisite.

## API contract

These additions are the agreed implementation contracts:

```js
createCardScene({
  selection: {
    multiple: true,
    max: Infinity,
    scope: "scene", // "scene" or one source "zone"
    canSelect: ({ cardId, zoneId, snapshot }) => ({ allowed: true }),
    rangeOrder: undefined, // explicit ordered IDs enable cross-zone ranges
    zoneOrder: undefined, // defaults to desired.zones order
  },
  interaction: {
    touchSelection: false,
    dragPresentation: "preserve", // or "compact"
    rules,
  },
});

scene.select([targetId], { mode: "range", anchorCardId });
scene.drag({
  cardIds, primaryCardId, point,
  order: "source", // "provided" explicitly preserves the supplied cardIds order
  presentation: "preserve", // optional per-session override
});
scene.transact([
  { type: "moveBatch", cardIds, to: destinationId, index: postRemovalIndex },
]);
```

- Eligibility defaults to existing, visible cards. Policy callbacks are
  synchronous. Extend `scene.invalidateRules()` to reevaluate selection as well
  as drag authorization, and reconcile selection on authoritative scene changes.
  Invalidating selection cannot silently shrink a frozen drag cohort: cancel the
  gesture if a member loses eligibility.
- Validate a requested selection change as a whole. A denied/count/scope-invalid
  request leaves selection unchanged and returns current selection fields plus
  `accepted: false` and `reason`. Successful calls return the same fields plus
  `accepted: true`. Do not emit selection-change on a no-op. Remove/clear must
  remain possible. Reconciliation prunes invalid IDs and applies limits in stable
  retained order, emitting once if state changes.
- A zone-scoped selection uses the requested primary/anchor's zone for replacement
  and range; add/toggle uses the retained selection's zone. Validate primary and
  anchor IDs and make fallback behavior deterministic. Preserve a still-eligible
  anchor even if toggled out of selection; clear it when selection is cleared.
- Same-zone ranges use `zone.cardIds`. Cross-zone ranges require `rangeOrder`;
  without it, deny the attempt visibly. `zoneOrder` governs source ordering for
  drag and default logical focus traversal; it does not authorize cross-zone ranges.
  Validate explicit order lists for duplicates/unknown IDs; append unspecified
  zones in desired order for a partial `zoneOrder`.
- The selection module supplies an internal `context(focusedCardId)` to the
  input adapter through scene wiring: eligible navigation IDs, current scope,
  and range information. Input does not duplicate eligibility policy. Idle arrows
  traverse this logical order; Shift extends selection, while carrying keeps #4
  destination/slot navigation. Select-all submits eligible IDs in current scope;
  an exceeded max reports denial rather than silently truncating the request.
- Scene resolves and freezes source order before handing the request to
  `interaction.js`; the interaction module consumes that order verbatim. An
  explicit provided order must contain every cohort member exactly once.
- `moveBatch` uses the shared pure membership helper on the transaction's cloned
  model, preserving ordinary single-card move behavior. Track completion for
  every member and displaced neighbor with existing settled/superseded/destroyed
  semantics. The aggregate handle must not finish after only the primary settles.
  Lead owns result/operation-ticket integration and its public-scene tests.
- Compact presentation affects active carrying only. Animate from sampled poses
  using the engine clock; reduced motion settles the compact offsets immediately.
  Pending approval and final landing always use actual solved destination slots.
  Rejection always uses the latest solved sources, never compact offsets.
- Snapshot interaction diagnostics expose frozen `cardIds`, `primaryCardId`, all
  `sources`, candidate/index, and every member's target pose. Browser fixtures
  use those public observables plus persistent shell IDs and projected poses.

## Input contract

- Mouse/pen: plain click replaces; Ctrl/Cmd-click toggles; Shift-click selects a
  logical range. Defer collapsing a selected set until a click is known not to
  be a drag. Threshold motion picks up the selected cohort.
- Keyboard: preserve Space pickup and Enter/Space release from #4. Use
  `S` to toggle selection, Shift with logical navigation to extend a
  range, Ctrl/Cmd-A for eligible cards in scope, and Escape to clear when idle.
  Escape during a gesture cancels it. Carrying retains existing zone/slot keys.
- Touch: provide explicit tap-to-toggle selection mode, independent of touch
  drag capability. Moving beyond the threshold carries the selected set when
  touch drag is enabled. Keep second-contact cancellation and page scrolling
  outside the stage. The current WebGL stage is the drag surface and sets
  `touch-action: none` before contact when touch drag is enabled. Selection-only
  mode preserves native scrolling; combined mode uses taps to toggle and threshold
  movement to carry without a preceding tap toggle. Do not overload long press.
- Rail checkboxes, stage gestures, and keyboard input use the same scene API.
  Display selection count, primary card, eligibility/denial, and pending batch
  outcome visibly and accessibly.

## Delegation and ownership

Three GPT-5.6 Luna agents completed planning. Implementation used four workers
and an independent reviewer:

| Agent | Planning assignment | Intended implementation ownership |
| --- | --- | --- |
| Russell | Selection policy and input gaps | New selection module/tests, then `src/input.js` and `test/input.test.js` |
| Halley | Cohort lifecycle, preview and atomic membership | `src/interaction.js`, focused membership helper/tests, `test/interaction.test.js` |
| Pauli | Lab integration and diagnostics | `examples/card-engine-lab/main.js`, `index.html` |
| Lagrange | Real-input browser acceptance | `scripts/chrome-batch-scenario.mjs`, `scripts/cross-browser-lab.mjs` |
| Hubble | Independent correctness review | Read-only review; lead addresses findings with regression tests |
| Astra lead | Public contract, sequencing and integration | `src/scene.js`, shared renderer/layout hooks, `package.json`, shared runner registration, package docs and final review |

All engine paths above are under `packages/card-engine/`. Workers edit the shared
checkout with the disjoint write sets above. No concurrent ownership of shared
files. Stop and collect a writer before handing its files to another worker.

Workers must read `AGENTS.md`, its linked domain/issue guidance, `CONTEXT.md`,
applicable ADRs, the slice and relevant specification sections. Browser work also
requires `docs/verification/browser-testing.md`. Each return includes paths,
guidance read, checks/results, assumptions, and remaining blockers. Workers do not
spawn workers, publish, or change the project board independently.

Specific gaps confirmed by the delegated code review:

- Russell: `scene.select()` lacks range/policy invalidation; idle keyboard
  selection/navigation is absent, and input always starts a one-card request.
- Halley: `interaction.js` checks and presents only the primary, while
  `layout.js` retains absolute card positions unless cleared for every member.
  Existing renderer session hooks already iterate cohort IDs and target maps;
  extend those hooks only where acceptance demonstrates a gap.
- Pauli: CDP mouse/key helpers and WebDriver key helpers need modifier support
  with guaranteed release/cleanup. Existing fixtures assume the first card.
  Extend diagnostics to record `cardIds`, `primaryCardId`, `cohortCount`, all
  source zones, and the outcome separately from mounted `cardCount`.

Lagrange owns WebDriver input helpers and new batch scenarios. The lead owns
Chromium runner registration and package scripts. The lead retains
`test/scene.test.js`; Russell uses a
dedicated selection test file and `test/input.test.js`.

## Execution waves

1. **Contracts and deterministic core:** lead fixes shared interfaces; Russell
   builds selection policy with tests, Halley builds cohort membership/session
   behavior with tests. Pauli defines lab fixtures and observable acceptance
   cases against those contracts. Lead integrates `scene.js` changes.
2. **Input and presentation:** after core tests pass, Russell wires pointer,
   keyboard, and touch selection. Halley verifies cancellation and stale-intent
   races. Lead adds any required renderer cohort feedback. Pauli wires the lab
   controls to public commands and intent resolution.
3. **Real browser coverage:** after lab/input contracts settle, Lagrange implements
   a batch scenario using existing CDP/WebDriver helpers. Lead owns shared runner
   registration and npm scripts. Run correctness first; run performance serially.
4. **Independent review and acceptance:** a Luna worker who did not implement the
   reviewed area checks invariants and missed cases. Lead inspects critical diffs,
   integrates fixes, verifies relevant regressions, and records evidence.

## Acceptance and evidence

- Deterministic selection tests: ordering, primary/anchor, modifiers/ranges,
  eligibility, count/scope, removal, change events, valid selection after transfer.
- Public-scene batch tests: same-zone nonadjacent reordering, cross-zone ordering,
  complete capacity calculation, denied member, one intent/commit, pending
  rejection, removal/external updates/rules changes, stale approval, destruction.
- Assert no partial commit when an operation near the end of a batch is invalid.
  Rotate, scale, flip, and supported element operations retain individual state.
- Assert pickup continuity, independent spin, live element/dimension changes,
  latest-layout cancellation, neighbor restoration, and persistent shell identity.
- Real input: select across two zones; reject and accept into a third; flip the
  selection in place. Exercise mouse modifiers, keyboard selection/carrying, and
  emulated touch selection/carrying in Chrome and Edge, plus Firefox/Safari parity.
  Add pen protocol coverage where the installed driver supports it; otherwise
  record it as uncovered. Physical pen acceptance requires a device sample and
  cannot be inferred from passing mouse/touch tests.
- Measure primary attachment and all-member landing error through scroll,
  responsive resize, full-window changes, and orthographic/perspective projection.
  Keep the existing one-CSS-pixel tolerance where applicable.
- Reuse 1/10/50 mounted-card performance fixtures, adding representative cohort
  sizes. Record cohort size separately from mounted population and input type.
  Report observed rAF timings with hardware/browser/viewport details.
- Physical Surface touch for the new cohort interaction needs new evidence;
  #4's one-card sample is historical evidence only. Record software-rendered Edge
  separately from hardware-accelerated Chrome when the actual renderer/vendor
  evidence supports that classification. Never infer acceleration from brand.

Existing regression commands: `npm test`, `npm run test:chrome:drag`,
`npm run test:chrome:drag-geometry`, `npm run test:edge:drag`,
`npm run test:cross-browser -- firefox`, `npm run test:cross-browser -- safari`.
Dedicated cohort checks are `npm run test:chrome:batch` and
`npm run test:edge:batch`; Firefox/Safari include the shared batch scenario in
their cross-browser acceptance run. Drag timing also samples five selected cards
among ten mounted cards and ten selected cards among fifty mounted cards.
Preserve visible browser dimensions/position, reserve separate debug ports, and
follow the Safari interference protocol. Browser performance runs are serialized.

Issue #5 remains open until implementation, independent review, and acceptance
evidence are complete. Planning completion is not implementation or release.
