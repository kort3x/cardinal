# Issue #4: initial drag implementation evidence

Implementation is in progress, not closure-ready. Five GPT-5.6 Luna workers
handled the renderer, input adapter, lab integration, public-scene tests and
browser automation; the parent integrated the scene lifecycle and reviewed fixes.

## Delivered

- Engine-owned one-card drag sessions, temporary grid layouts and project rule
  decisions. Committed membership changes only after correlated approval.
- Pending/rejected/cancelled outcomes, rule invalidation, source/destination order
  guards, and late-response rejection. Independent spin/rotation/scale survives pickup.
- WebGL mesh picking with explicit draw-order precedence, camera projection,
  non-pickable preview outlines and draw-priority lift without changing depth.
- Mouse/pen threshold and stage capture, opt-in touch dragging, keyboard input,
  announcements, capture cancellation and elapsed-time ancestor/page auto-scroll.
- Primary lab Drag controls and Chrome `drag` scenario. Multi-card drag remains #5.

## Evidence

| Check | Result |
| --- | --- |
| `npm test` | 112 passing |
| `npm run test:chrome:drag` | 9 passing, including emulated touch |
| `npm run test:chrome` | 18 passing element/regression checks |
| `npm run test:chrome:layout` | 17 passing layout checks |
| `node scripts/cross-browser-lab.mjs firefox` | 24 passing: 18 existing checks plus 6 interaction checks |
| `node scripts/cross-browser-lab.mjs safari` | Latest rerun: 24/24 passing, with no code changes. Earlier runs included 21/24 results; possible user interference is noted below. |

### Safari rerun and possible interference

After the earlier three pointer-check failures, the user reported that they may
have interrupted the automated Safari run. A fresh Safari-only rerun on
2026-09-15 passed all 24 checks, including permitted/denied pointer drops and
keyboard interaction, without any code changes.

User interference is therefore a possible explanation for the earlier failures,
not a confirmed root cause. Preserve those results as potentially affected runs;
do not treat them alone as proof of an engine defect or dismiss future failures.
Subsequent runs follow the general
[Safari interference protocol](browser-testing.md#safari-automation-and-user-interference).

Measured environments (not assumed from requested window sizes):

- Chrome temporary headless: inner 2515×1322, outer 756×556, stage 1726×994,
  DPR 1. Existing visible Chrome windows were not moved or resized by the parent.
- Firefox headless: inner 2500×1300, outer 1366×768, DPR 1.
- Safari: inner 2500×1248, outer 2500×1300, actual position (100, 31), DPR 1.
  The requested Y=0 is constrained by macOS window placement.

Real-input testing exposed issues beyond the unit doubles: capture needed a
stable stage target and capture-loss filtering; the Chrome harness also used an
incorrect focus selector and waited for pickup before threshold motion. These
were fixed rather than bypassing engine gestures in the lab.

A headless engine-only timing sample with 1/10/50 cards measured pickup at
0.76/1.31/19.48 ms and update P95 at 0.08/0.06/0.09 ms. These are local JavaScript
measurements, not GPU frame rates, browser latency guarantees or Surface evidence.

## Still required before closing #4

- Confirm Safari results with repeatable, uninterrupted runs; investigate any
  recurring pointer failures before attributing them to the engine or user interference.
- Measure pointer attachment/landing error during scroll, resize and full-window
  changes using actual input. Exercise perspective, shield corners and overlaps.
- Extend browser coverage for touch denial/second contact, same-zone reorder,
  live card-element/dimension changes, late approval and removal races.
- Measure browser drag responsiveness with 1/10/50 cards; test physical touch
  hardware and the reported Surface separately when available.
- Finish review, acceptance checklist and project-board transition. CSS remains deferred.
