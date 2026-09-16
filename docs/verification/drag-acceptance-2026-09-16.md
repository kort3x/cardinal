# Issue #4: cross-browser drag rerun

This is a follow-up to the [extended drag acceptance](drag-acceptance-2026-09-15.md).

## Harness correction

The cross-browser runner started the real-input journey after a fixed 250 ms
delay, although the lab's default scene motion lasts 320 ms. Safari intermittently
missed the first pointer pickup under that race, while keyboard dragging continued
to pass. The runner now waits for the observable `stable` status before beginning
pointer or keyboard interaction. The runner also uses the discrete rotate, scale,
and face controls rather than the lab's continuous demo toggles.

This is a test-harness correction; no engine input or renderer code changed in
this rerun.

## Results

The following clean run passed with exit status 0:

```text
node --check scripts/cross-browser-lab.mjs
git diff --check
npm test
npm run test:cross-browser -- firefox
npm run test:cross-browser -- safari
```

- Engine: 121/121 deterministic tests.
- Firefox 155.0.1: 25/25, inner 2500×1300, DPR 1.
- Safari 26.6.2: 25/25, inner 2500×1248, outer 2500×1300, position (100, 31), DPR 1.
- Both browsers passed the #4 pointer, denied-pointer, touch, and keyboard
  interaction checks.

The prior intermittent Safari pointer failure did not reproduce after the
readiness correction. This supports a test timing race as the working diagnosis;
it is not evidence of physical-touch-device behavior or a guarantee for every
Safari automation environment.

## Chrome drag rerun

The Chrome drag harness initially exposed two sequencing races: approval was
clicked before pointer-capture cleanup completed, and touch setup used a physical
checkbox click during scene recreation. Approval now uses DOM activation for the
project control, while the gesture remains real CDP input; touch setup uses the
existing control setter.

Fresh Chrome checks passed:

- `CARDINAL_CHROME_PORT=9791 npm run test:chrome:drag`: 17/17.
- `CARDINAL_CHROME_PORT=9792 npm run test:chrome:drag-geometry`: 10/10;
  orthographic and perspective attachment error 0.000 CSS pixels, including
  nonzero depth and center-preserving resize.
- `CARDINAL_CHROME_PORT=9793 npm run test:chrome:drag-performance`: 10/10;
  1-, 10-, and 50-card rest, motion, and real pointer-drag samples completed
  and the fixture was restored.

The Chrome performance sample reported pointer-to-next-observed-motion-frame P95
of 1.8 ms for 1 card, 3.9 ms for 10 cards, and 6.0 ms for 50 cards. These are
local rAF observation timings, not paint latency or a supported-device promise.

The same run also armed and verified the lab's user-facing **Record next drag**
capture for each real-pointer sample. The 50-card sample recorded one frame
interval over 20 ms and a 5.8 ms P95 event-to-next-observed-rAF value. These are
local browser observations, not physical-device or paint-latency guarantees.

## Visible Chrome review

`npm run show:chrome -- --scenario drag` completed with the visible Chrome
session left open. The preserved session reported inner 2515×1322, outer
2515×1409, position (89, 31), DPR 1. Manual inspection confirmed the WebGL card,
outlined zones, card-over-zone draw order, compact rails, and stable status rows.
No new visual drag defect was observed. This is a desktop visual review; it does
not replace physical touch or Surface testing.

## Remaining #4 work

Physical touch and Surface measurements and the final issue/project-board closure
decision remain open. The lab now exposes a **Record next drag** action inside
**Performance diagnostics**. It captures one real mouse, pen, or touch drag in
the page and includes its input and frame timing in the copied diagnostics
report; the procedure is documented in the browser-testing runbook. This does
not replace a physical-device run or claim paint latency.
