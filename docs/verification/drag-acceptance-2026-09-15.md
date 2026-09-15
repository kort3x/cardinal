# Issue #4: extended drag acceptance

This follows the [initial implementation evidence](drag-interactions-2026-09-15.md).
The [browser runbook](browser-testing.md) owns execution instructions. Results
below are from the uncommitted implementation after `ad418b5`; no issue closure,
commit or push is implied.

## Engine regression found and fixed

A second touch beginning outside the stage was not observed by the input adapter,
so the first touch continued dragging. A deterministic input-adapter test failed
before the fix. The adapter now observes outside pointer-down events during a
local touch gesture and cancels that gesture without preventing the outside
interaction. Listener disposal and pointer-capture release are covered.

`node --test packages/card-engine/test/input.test.js packages/card-engine/test/interaction.test.js`
passed 34/34 after the fix. The full `npm test` run passed 118/118. Added public-scene
tests also cover pending source-membership changes, capacity reduction, and
rejection after live element/dimension changes; input tests cover cancellation
cleanup and starting another gesture while approval is pending.

A real perspective-browser probe then found a stationary-pointer resize failure:
the grab offset drifted 10.011 CSS pixels when a 1200×800 stage became 1000×600
with its center unchanged. The pointer's world coordinate remained unchanged, so
the adapter skipped the projection update. It now also samples a neighboring
pixel to detect projection-scale changes and reuses the ordinary pointer-update
path. An unchanged projection still avoids a scene update. A deterministic test
failed before this fix and passes afterward.

`CARDINAL_CHROME_PORT=9342 npm run test:chrome:drag-geometry` then passed 9/9,
exit 0. Both normal perspective dragging at depth 240 and the stationary-center
resize report attachment error 0.000 CSS pixels (rounded to three decimals).
The other checks cover rounded/shield corner misses, front/back/edge mesh hits,
overlap draw order, denied foreground zones and explicit transparent targeting.
The full engine suite after this fix passes 119/119.

Geometry-run environment: HeadlessChrome/152.0.0.0, inner 2515×1322, outer
756×556, position (22, 22), DPR 1. The final temporary fixture was 1000×600 at
(124, 124). Only the temporary fixture changed size; the browser window was not
moved or resized. The fixture was disposed after the run.

The independent standards review also identified a pre-existing renderer teardown
gap. A deferred image-completion browser test reproduced one late texture draw
after destruction and, separately, one late asset-error status callback. Renderer
and texture disposal now guard completion callbacks; cached image handlers are
detached and pending promises settled during teardown. The geometry/lifecycle
suite now passes 10/10, including both late-success and late-error cases.

## Expanded Chrome interaction checks

`CARDINAL_CHROME_PORT=9341 npm run test:chrome:drag` passes 17/17, with no skips.
Coverage includes allowed/denied mouse, keyboard and emulated touch, pending
rejection, Escape, pickup while spinning, same-zone reorder, live element/size
changes, inside/outside second touches, late rule invalidation and removed cards.
The responsive case holds a stationary pointer across stage resize, ancestor and
page auto-scroll, and full-window entry before moving toward the destination.

The applicable attachment and settled landing measurements round to 0.000 CSS
pixels, with errors over one CSS pixel failing the scenario. Keyboard decisions
are state/focus checks, not pointer-offset measurements. Main-lab stage bounds
were (388, 138), 1726×994 at inner 2515×1322, DPR 1, HeadlessChrome/152.0.0.0.

Harness corrections are distinct from engine fixes: input acknowledgement is not
touch-event delivery; rejection lands in the current committed layout, not in the
rejected preview; logical cancellation can precede the end of return motion.
The early expanded-run failures included wrong calibration/expectations and
premature measurements. They are not evidence of hundreds of pixels of final
engine landing error. The corrected assertions wait for input delivery/settlement,
not for the measured error to become small, and retain the one-pixel bound.
Skipped touch cases now make coverage incomplete instead of counting as passes.

## Isolated drag timing

`CARDINAL_CHROME_PORT=9343 npm run test:chrome:drag-performance` passed 10/10
execution/cleanup checks, exit 0. There is no performance pass threshold.
Other automated browser work was paused. Host: Mac16,10, Apple M4, 24 GiB RAM;
browser/page geometry as above. See the [raw measurements](drag-performance-2026-09-15.json).

Each population used a one-second rest sample, a one-second sample with all cards
spinning, and one 24-pointermove drag to Workbench with 20 ms requested pacing.
Cards were mounted in Reserve using the lab's existing arrangement, so high
populations include intentional overlap. Each drag's membership transfer and
restoration of the original scene/selection/controls were checked.

| Mounted cards | Drag frame interval P95 / max | Next observed motion frame P95 / max |
| --- | --- | --- |
| 1 | 16.7 / 16.7 ms | 2.2 / 7.4 ms |
| 10 | 16.7 / 16.8 ms | 4.6 / 8.8 ms |
| 50 | 16.8 / 83.2 ms | 5.2 / 96.2 ms |

The response column measures pointermove to the next rAF callback observing a
changed primary-card position, not paint completion or end-to-end device latency.
There are 24 matched pointermove samples per drag. Snapshot/probe work is included
in the workload. Rest and spin frame intervals were mostly 16.7 ms; the 50-card
spin sample included one 33.3 ms interval. This table is the pre-optimization
baseline; one short local sample does not define a supported hardware/population
envelope.

### Preview-copy optimization rerun

After replacing per-slot deep snapshot cloning and normalization with shallow
immutable candidate snapshots, the same command was rerun on the same host and
browser. It passed 10/10 checks. The updated measurements were:

| Mounted cards | Drag frame interval P95 / max | Next observed motion frame P95 / max |
| --- | --- | --- |
| 1 | 16.7 / 16.8 ms | 2.1 / 6.8 ms |
| 10 | 16.8 / 16.8 ms | 4.5 / 6.4 ms |
| 50 | 16.7 / 33.3 ms | 5.8 / 31.9 ms |

The 50-card first-update spike dropped from 96.2 ms to 31.9 ms in this fixture.
This improves the engine path but does not establish performance on physical
devices; the Surface measurement remains required.

## Existing browser regressions

These runs preceded the outside-touch fix; they establish the session's baseline,
not coverage of that fix or of the new extended scenarios.

| Command | Result |
| --- | --- |
| `CARDINAL_CHROME_PORT=9340 npm run test:chrome` | 18/18, exit 0 |
| `CARDINAL_CHROME_PORT=9340 npm run test:chrome:layout` | 17/17, exit 0 |
| `npm run test:cross-browser -- firefox` | 24/24, exit 0 |
| `npm run test:cross-browser -- safari` | 24/24, exit 0 |

Firefox reported UA Firefox/155.0, inner 2500×1300, outer 1366×768, position
(0, 0), DPR 1. Safari reported Version/26.6.2, inner 2500×1248, outer 2500×1300,
position (100, 31), DPR 1. The Safari automation warning was given before the run;
no interruption was reported. This is another passing run, not proof of the cause
of the earlier failures retained in the initial evidence.

## Scope of evidence

Real automated input and scene-state checks do not establish texture sharpness,
physical-touch hardware behavior or performance on the user's Surface. Those
claims require their own visual/device evidence.

## Final integrated checks and review

After the engine fixes and shared runtime-helper extraction, the lead reran:

- Engine tests: 119/119, exit 0.
- `test:chrome:drag` on isolated port 9341: 17/17, no skips, exit 0.
- `test:chrome:drag-geometry` on isolated port 9342: 10/10, exit 0.
- `test:cross-browser`: Firefox 24/24 and Safari 24/24, exit 0, at the measured
  viewports recorded above. Safari was announced and no interruption reported.
- Shared evaluator value/error checks, JavaScript syntax and `git diff --check`:
  passed.

Two independent Luna reviewers rechecked the standards and specification findings.
Standards findings (late asset callbacks, skipped cases reported as passes) are
resolved. Specification findings (unenforced pixel bounds and missing outside-touch
event assertions) are resolved. No new core regression was found in their bounded
source recheck; runtime evidence comes from the lead's actual runs above, not from
review approval. All workers were closed after their results were collected.

Next: complete the remaining physical-device/visual checks and make the
issue/project closure decision.
This task did not commit, push, close #4 or change the GitHub project.
