# Issue #5: selection and batch-drag implementation

Implemented locally on base `82b4743`, using four GPT-5.6 Luna implementation
workers and an independent Luna reviewer. No commit, push, deployment or issue
closure is part of this result. See the [plan](../plans/multi-card-selection.md)
and [slice](../slices/04.md).

## Implemented

- Ordered selection, primary/anchor, eligibility/count/scope policy, logical
  ranges, modifier clicks, keyboard selection and explicit touch-selection mode.
- Frozen cross-zone cohorts, preserve-offset and animated compact carrying,
  all-member previews, immutable drop intent and one atomic `moveBatch` commit.
- Shared post-removal insertion semantics, complete capacity checks, whole-batch
  rejection/cancellation and stale-approval protection.
- Independent card faces/transforms, persistent shells, selection feedback and
  completion handles that include every member and displaced neighbor.
- Lab batch fixture, manual accept/reject, compact mode, denied-member control,
  one-shot selection flip and cohort-aware drag diagnostics.

Independent review found an event-ordering defect: eligibility reconciliation
published a pruned selection before cancelling its invalid frozen cohort. A
regression test reproduced it; cancellation now precedes selection publication
for rules, authoritative apply/transactions and hidden-zone geometry changes.
Another regression verifies that a failed commit restores displaced neighbors as
well as the dragged cohort.

## Automated evidence

All final commands below exited 0. Safari's two skips remain unverified, not passes.
Chromium runs used isolated debug ports 9810–9812; the user's visible Chrome
window was not moved or resized. Browser workloads and timing runs were serialized.

| Run | Result | Measured environment |
| --- | --- | --- |
| `npm test` | 180 passed | Deterministic engine tests |
| `npm run test:chrome:batch` | 13 passed | Chrome 152.0.7977.83; inner 2515×1322, DPR 1 |
| `npm run test:edge:batch` | 13 passed | Edge 153.0.4234.32; inner 2515×1322, DPR 1 |
| `npm run test:chrome:drag` | 17 passed | Chrome; inner 2515×1322, DPR 1 |
| `npm run test:chrome:drag-geometry` | 11 passed | Chrome; 1000×600 isolated fixture within the same viewport |
| `npm run test:cross-browser -- firefox` | 37 passed | Firefox 155.0.1; inner 2500×1300, DPR 1 |
| `npm run test:cross-browser -- safari` | 35 passed, 2 skipped | Safari 26.6.2; inner 2500×1248, outer 2500×1300, position (100,31), DPR 1 |
| `npm run test:chrome:drag-performance` | 12 checks passed | Isolated headless Chrome |
| `npm run test:edge:drag-performance` | 12 checks passed | Isolated headless Edge |
| `npm run build:pages` | Passed | Local build only; not published |

Syntax checks and `git diff --check` passed. The shared batch journey covers
cross-source selection/transfer, rejection and in-place flip, same-zone reorder,
denied secondary member, insufficient capacity, compact carrying/landing,
modifier/range selection, keyboard select-all/carrying, emulated touch, frozen
selection and stale approval, and secondary-member removal. DOM node references
are checked, not just reused card IDs.

Measured batch attachment errors: Chrome/Edge 0 CSS px, Firefox 0.35 CSS px,
Safari 0.048 CSS px. All measured batch landing errors were 0 CSS px, including
compact-to-slot landing. The orthographic/perspective geometry suite also
measured 0 CSS px, including single-card nonzero depth and camera resize plus a
two-card perspective cohort at different projected depths through a centered
resize.
The Chrome batch journey now also measures 0 CSS px for both selected members
through stage resize, ancestor scroll, page scroll, and full-window transition.
Chrome and Edge also run an emulated CDP pen journey that verifies
`pointerType: "pen"` during two-card selection and cohort transfer; this is
protocol coverage rather than physical pen evidence.
This does not establish an exhaustive physical/device perspective matrix or
constitute a screenshot-based visual review.

## Harness failures retained in the interpretation

- The keyboard select-all transfer initially advanced one destination with Tab
  but asserted the second destination. The journey now asserts the intermediate
  River candidate and sends the second Tab before accepting in Ocean.
- The cross-browser single-card keyboard assertion expected Lake after one Tab
  from River; the actual zone order advances to Ocean, where the card landed.
  The assertion now checks that committed destination.
- A new compact assertion initially used the press point instead of the actual
  threshold pickup point. The corrected assertion preserves the engine's
  sampled grab offset; no engine change was needed.
- Firefox's first batch attempt timed out because BiDi remote objects were read
  as ordinary JavaScript objects. The adapter now awaits and JSON-decodes the
  shared expressions. A subsequent keyboard case exposed missing named-key
  mappings; explicit WebDriver codes fixed it.
- Safari exposed property-order-sensitive object comparison and unreliable
  release-only cleanup. Source comparisons now use ordered field tuples and
  cleanup explicitly releases the pointer before releasing input sources.
- SafariDriver's requested touch source actually produced `pointerType: "mouse"`
  events. Its single-card and batch touch checks are explicitly skipped. Earlier
  Safari results labelled "touch" therefore do not prove actual touch input.
  Chrome, Edge and Firefox batch tests assert touch pointer events. No user
  interference was reported for these runs; it is not used to dismiss failures.

## Local timing samples

Host: Mac16,10, Apple M4, 24 GiB RAM, macOS 26.6.2. Raw environments, samples,
lab reports and measurement notes are in
[batch-performance-2026-09-16.json](batch-performance-2026-09-16.json).
Each pointer sample used 24 move events; all 24 had a following observed motion
frame, and every selected member landed in Ocean. Rest and existing-motion
samples also ran for 1/10/50 mounted cards. Fixture cleanup passed in both browsers.

| Browser | Mounted / dragged | Frame interval P95 | Event → observed-motion-frame P95 | Lab drag FPS |
| --- | --- | --- | --- | --- |
| Chrome | 1 / 1 | 16.7 ms | 3.7 ms | 60 |
| Chrome | 10 / 1 | 16.8 ms | 6.1 ms | 60 |
| Chrome | 10 / 5 | 16.7 ms | 8.2 ms | 60 |
| Chrome | 50 / 1 | 16.7 ms | 5.9 ms | 58.8 |
| Chrome | 50 / 10 | 16.8 ms | 6.4 ms | 60 |
| Edge | 1 / 1 | 16.8 ms | 1.5 ms | 60 |
| Edge | 10 / 1 | 16.7 ms | 4.3 ms | 60 |
| Edge | 10 / 5 | 16.8 ms | 10.2 ms | 60 |
| Edge | 50 / 1 | 16.8 ms | 7.9 ms | 60 |
| Edge | 50 / 10 | 16.7 ms | 10.1 ms | 60 |

These are one-run local rAF observations with probe overhead, not paint latency,
a performance threshold, a GPU-acceleration classification or a Surface guarantee.
The lab reports cohort count separately from mounted population and waits for
manual approval/rejection before finalizing the outcome.

## Physical device evidence from issue #5 comments

- iPhone Safari 26.6.1: accepted a two-card touch cohort from Lake/River into
  Ocean at 59.9 measured drag FPS, with 3 frame intervals over 20 ms.
- Surface Laptop, Chrome 138, touch: accepted the same two-card cohort using
  the Qualcomm Adreno X1-85 WebGL renderer at 60 measured drag FPS, with 1
  frame interval over 20 ms.
- Surface Laptop, Chrome 138, mouse: accepted the same cohort using the same
  Qualcomm renderer at 59.2 measured drag FPS, with 4 frame intervals over 20
  ms.
- No physical pen device is available for this acceptance. Chromium CDP pen
  protocol coverage is present in the automated batch journey, but it does not
  substitute for a physical pen report.

## Remaining acceptance

Issue #5 remains open and In progress. Fresh physical Surface touch and
Safari/iPhone batch reports are now recorded; physical pen coverage is
unavailable because no pen device is available. Issue #4's single-card device
report cannot substitute for this cohort interaction. The broader
physical/device perspective matrix remains unverified. Optional rectangle
selection, persistent groups, stamps and card-to-card attachments remain outside
this slice.
