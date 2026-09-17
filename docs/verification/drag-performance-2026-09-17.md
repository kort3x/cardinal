# Drag performance diagnosis · 2026-09-17

This report records the initial diagnosis and the final integrated performance
run below. The benchmark was run with
the repository command below on the exclusive Chrome debug port 9338:

```text
CARDINAL_CHROME_PORT=9338 npm run test:chrome:drag-performance
```

The browser was HeadlessChrome 152.0.0.0 on macOS (`MacIntel`), with a
2515×1322 CSS viewport, DPR 1, and a 1726×994 stage at `(388, 131)`. The
original captured run in `/tmp/cardinal-drag-analysis-performance.log` passed
all rest and existing-motion samples and the 1-card pointer drag. The 10-card
and 50-card pointer and cohort cases timed out waiting for all expected cards
in Ocean.

The fixture cloned the original River card into every mounted card and reused
the River `hand` arrangement. It selected the first generated ID as primary
and pressed `scene.sceneToClient(primaryPose)` directly. The actual WebGL
input path resolves a pointer to `scene.clientToScene()` followed by
`scene.hitTest()`, so the projected center is not a reliable pickup point when
the hand overlaps.

The diagnostic rerun established the cause. In the 10-card fixture, the
projected center of `drag-performance-10-1` hit
`drag-performance-10-3`; the first real-hit scan point resolved to the intended
card and the single-card and 5-card cohort transfers were accepted into Ocean.
In the 50-card fixture, the projected center of
`drag-performance-50-1` hit `drag-performance-50-9` on one rerun (and
`drag-performance-50-10` on the preceding rerun). None of the 49 bounded
interior points resolved to `drag-performance-50-1`. Those sampled points
failed to hit the intended card; this does not prove the entire card was
covered. The benchmark failed to find a pickup point before measuring drag.

The initial benchmark correction probed the public `scene.hitTest()` over a
bounded projected card grid. Single-card samples could select the first
hit-test-visible mounted card; cohort samples preserve the requested cohort and
choose a visible primary within it. The baseline path remains a separate
24-step, 20 ms-per-step drag. A separate 10-card, 5-card-cohort workload adds
slow free-space exit, direction reversal for rotational recovery, and slow
reentry into Ocean; it is reported as `free-space-recovery` and does not alter
the baseline samples.

Validation before the final integrated run:

- `node --check scripts/chrome-drag-performance.mjs` passed.
- `git diff --check` passed.
- `npm test` passed: 227 tests, 0 failures.
- The second diagnostic Chrome run passed 1-card rest/motion/drag, 10-card
  rest/motion/drag, and the 10-card 5-card-cohort drag; it failed only because
  the 50-card first primary had no sampled hit-test point under the old
  first-ID assumption.

Further performance runs were paused until the lead finished the other browser
checks and froze physics/renderer edits. The cause of the transient first
diagnostic run's 1/10-card pickup timeouts remains unproven; those cases passed
on its repeat while integration was still underway.

## First integrated measurement (failed)

After explicit GO, one run used the command above on unused port 9338. Full
stdout and stderr are preserved in `/tmp/cardinal-drag-final-performance.log`
(24,474 bytes). Capture timestamps span 16:38:46–16:39:08 UTC on 2026-09-17.
The process exited **1**, with **12 passed, 1 failed, 0 skipped** checks. Eleven
measurement records were produced; the twelfth workload failed before input.
There was no retry or engine edit. The fixture cleanup assertion passed, and
the runner closed its temporary browser: a subsequent port 9338 listener check
returned no listener.

Measured environment: HeadlessChrome **152.0.0.0**, `MacIntel`, language `de-DE`;
viewport **2515×1322**, DPR **1**. Outer window 756×556 at `(22, 22)`;
stage 1726×994 at `(388, 131)`. Input was CDP mouse input. Other browser work
had finished, and the lead reported engine/renderer edits frozen for this run.

Each row is one workload sample, not an aggregate of repeated trials. Rest
and existing-motion samples each run for 1,000 ms; existing motion spins all
mounted cards about Y at 180°/s. Baseline drags use 24 moves with 20 ms delays;
the separate recovery workload uses four segments of 24 moves with 35 ms
delays. Protocol and polling overhead are included in elapsed time.

| Mounted | Workload | Cohort | Probe rAF frames / intervals | Moves / matched response samples | Frame p95 (ms) | Pointer-to-observed-motion-frame p95 (ms) |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | Rest | — | 60 / 59 | 0 / 0 | 16.7 | — |
| 1 | Existing motion | — | 60 / 59 | 0 / 0 | 16.7 | — |
| 1 | Baseline drag | 1 | 49 / 48 | 24 / 24 | 16.8 | 1.7 |
| 10 | Rest | — | 60 / 59 | 0 / 0 | 16.7 | — |
| 10 | Existing motion | — | 60 / 59 | 0 / 0 | 16.7 | — |
| 10 | Baseline drag | 1 | 49 / 48 | 24 / 24 | 16.7 | 2.8 |
| 10 | Baseline cohort drag | 5 | 49 / 48 | 24 / 24 | 16.8 | 2.5 |
| 50 | Rest | — | 60 / 59 | 0 / 0 | 16.7 | — |
| 50 | Existing motion | — | 60 / 59 | 0 / 0 | 16.7 | — |
| 50 | Baseline drag | 1 | 52 / 51 | 24 / 24 | 16.7 | 4.6 |
| 50 | Baseline cohort drag | 10 | Not sampled | Not sampled | — | — |
| 10 | Free-space recovery | 5 | 289 / 288 | 96 / 96 | 16.8 | 2.4 |

All recorded probe frame intervals were at most 16.8 ms, with zero intervals
over 20 ms. No pointer moves were unmatched in the five recorded drags. The
50-card single drag's largest pointer-to-observed-motion-frame delay was
22.8 ms despite its 4.6 ms p95. The 50-card single drag selected
`drag-performance-50-50`; the 10-card workloads used primary
`drag-performance-10-1` and cohort IDs 1–5 where applicable. Parsing the lab
captures confirmed every successful drag's exact expected cohort, primary ID,
accepted outcome, and final Ocean memberships.

The lab's separate `eventToNextObservedRaf` capture has slightly different
sampling boundaries and observation overhead:

| Mounted / cohort | Workload | Lab frames / intervals | Lab response samples | Lab frame p95 (ms) | Lab input-to-next-observed-rAF p95 (ms) |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 / 1 | Baseline | 48 / 47 | 24 | 16.8 | 1.6 |
| 10 / 1 | Baseline | 48 / 47 | 24 | 16.7 | 2.7 |
| 10 / 5 | Baseline | 48 / 47 | 24 | 16.8 | 2.5 |
| 50 / 1 | Baseline | 50 / 49 | 24 | 16.7 | 4.5 |
| 10 / 5 | Recovery | 288 / 287 | 96 | 16.8 | 2.3 |

Each lab capture reported 60 FPS and no intervals over 20 ms. These metrics
observe page-side rAF callbacks and position changes, not paint completion or
end-to-end display latency. Probe snapshots and lab diagnostics contribute to
the workload. Recovery timing and accepted membership establish execution of
the path; they do not independently assert angular recovery or material-point
attachment. This local headless run provides no physical-device guarantee.

The sole failure was `50 mounted cards, 10-card cohort drag sample`:
`No real hit-test point for requested cards`. The intended cohort was
`drag-performance-50-1` through `drag-performance-50-10`. The scanner attempted
49 points per member (490 total); no sampled point hit its intended member.
Their centers hit cards 11 through 20 respectively. This failure occurred in
coordinate preparation before arming the measurement or dispatching drag
input. It supplies no performance or transfer result for that cohort and does
not establish an engine failure or complete occlusion. The remaining harness
limitation is finding a real pickup point within that fixed first-ten cohort;
the preceding successful single-card case could search all 50 cards and found
card 50. The failure is preserved for a deliberate fixture/pickup correction
and a separately authorized measurement, rather than an unchanged retry.

## Final measurement after the authorized fixture correction

The lead authorized selecting the exposed end of the Hand during setup.
`configureFixture` now chooses the last `cohortSize` IDs and the last card as
primary before any input. Pickup candidates are restricted to those IDs for
both single-card and cohort samples. The harness never substitutes a card
outside the chosen cohort. Ocean's final ordered membership and the recorded
drag's frozen IDs must exactly equal the chosen cohort. All prior checks remain.

The 10-card cohort at 50 mounted cards is now IDs 41–50, primary 50; the
5-card cohort at 10 mounted cards is IDs 6–10, primary 10. Single-card samples
use the last mounted card. This changes the workload setup. It does not
demonstrate a timing improvement over the first-ten cohort that could not be
picked at the sampled points; that failed workload produced no drag timing.

The same command ran once more on exclusive port 9338 after this correction.
Full stdout/stderr are in `/tmp/cardinal-drag-final-performance-2.log` (22,434
bytes); the original failed log remains intact. Exit **0**, **13 passed,
0 failed, 0 skipped**. All 12 measurement workloads produced records, plus
the fixture cleanup check. Drag capture timestamps span 16:41:21–16:41:36 UTC
on 2026-09-17. Syntax and diff whitespace checks passed; no engine file changed
and no unit-test rerun was made.

The measured environment remained HeadlessChrome **152.0.0.0**, `MacIntel`,
`de-DE`, viewport **2515×1322**, DPR **1**, outer window 756×556 at `(22, 22)`,
and stage 1726×994 at `(388, 131)`. The runner closed its temporary browser;
port 9338 had no listener afterward. The sample durations and input pacing
described above were unchanged. These are one sample per workload.

| Mounted | Workload | Cohort | Probe rAF frames / intervals | Moves / matched response samples | Frame p95 (ms) | Pointer-to-observed-motion-frame p95 (ms) |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | Rest | — | 60 / 59 | 0 / 0 | 16.8 | — |
| 1 | Existing motion | — | 61 / 60 | 0 / 0 | 16.8 | — |
| 1 | Baseline drag | 1 | 50 / 49 | 24 / 24 | 16.7 | 1.6 |
| 10 | Rest | — | 60 / 59 | 0 / 0 | 16.7 | — |
| 10 | Existing motion | — | 60 / 59 | 0 / 0 | 16.7 | — |
| 10 | Baseline drag | 1 | 49 / 48 | 24 / 24 | 16.7 | 2.1 |
| 10 | Baseline cohort drag | 5 | 51 / 50 | 24 / 24 | 16.8 | 2.6 |
| 50 | Rest | — | 60 / 59 | 0 / 0 | 16.8 | — |
| 50 | Existing motion | — | 60 / 59 | 0 / 0 | 16.7 | — |
| 50 | Baseline drag | 1 | 52 / 51 | 24 / 24 | 16.7 | 3.7 |
| 50 | Baseline cohort drag | 10 | 52 / 51 | 24 / 24 | 16.7 | 5.3 |
| 10 | Free-space recovery | 5 | 289 / 288 | 96 / 96 | 16.7 | 2.8 |

All recorded frame intervals were at most 16.8 ms, with zero over 20 ms.
Every drag move had a matched response sample. The largest probe response
was 23.2 ms for the 50-card single drag and 20.5 ms for the 10-card cohort
among 50 mounted cards. No performance pass/fail threshold is imposed.

| Mounted / cohort | Workload | Lab frames / intervals | Lab response samples | Lab frame p95 (ms) | Lab input-to-next-observed-rAF p95 (ms) |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 / 1 | Baseline | 49 / 48 | 24 | 16.7 | 1.5 |
| 10 / 1 | Baseline | 48 / 47 | 24 | 16.7 | 1.9 |
| 10 / 5 | Baseline | 49 / 48 | 24 | 16.7 | 2.5 |
| 50 / 1 | Baseline | 50 / 49 | 24 | 16.7 | 3.6 |
| 50 / 10 | Baseline | 50 / 49 | 24 | 16.7 | 5.2 |
| 10 / 5 | Recovery | 288 / 287 | 96 | 16.7 | 2.7 |

All six lab captures reported mouse input, 60 FPS, accepted outcomes, the
expected mounted/cohort counts and primary IDs, and exact cohort membership
in Ocean. In particular, the 50-card/10-card sample hit and picked
`drag-performance-50-50` through CDP, carried IDs 41–50, and recorded all ten
final Ocean memberships. Recovery retained IDs 6–10 and is reported separately
from baseline. These page-side measurements retain the latency and physical
device limitations stated above.
