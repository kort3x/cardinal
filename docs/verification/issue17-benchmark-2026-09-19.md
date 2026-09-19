# Issue #17 benchmark coverage — 2026-09-19

The repeatable Chrome runner now includes an `benchmark-issue17` scenario for
the missing 6/50/200-card workload. Each population is sampled twice with the
same selected cohort and deterministic batched move, rotate, and physical flip
transaction: once with selection highlighting disabled and once with it
enabled.

Each row reports setup time, the first observed animation frame, readiness,
handler time, sample duration, FPS, median and p95 requestAnimationFrame
intervals, missed intervals over 20 ms, renderer work deltas, draw calls,
triangles, geometry/resource counters, and active texture information when the
renderer exposes them. The benchmark restores the original cards, selection,
and full-window state in a `finally` block.

## Commands and results

Runs were serialized on fresh Chromium debug ports:

```sh
CARDINAL_CHROME_PORT=9417 node scripts/chrome-lab.mjs --headless --scenario benchmark-issue17
CARDINAL_CHROME_PORT=9418 npm run test:chrome:benchmark
CARDINAL_CHROME_PORT=9419 CARDINAL_PROFILE_PATH=/tmp/cardinal-issue17.cpuprofile \
  npm run test:chrome:benchmark-profile
```

Results:

- `benchmark-issue17`: 7 checks passed, exit 0.
- Existing `benchmark`: 7 checks passed, exit 0.
- `benchmark-profile`: 9 checks passed, exit 0. The CPU profile covers the
  existing Lab Benchmark button; the issue-17 rows are reported in the same
  run after that profile completes.

The recorded profile run used Headless Chrome 153.0.8010.48 on macOS ARM with
an Apple M4 Metal renderer, DPR 1, a 2515×1322 CSS viewport, a 2515×1322 stage,
and WebGL 2.0. This is local emulated Chromium evidence, not a physical
Surface measurement.

| Cards | Highlight | Setup ms | First frame ms | FPS | Median / p95 ms | Missed >20 ms | Draw calls | Triangles | Geometries | Sample render CPU ms |
| ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 6 | disabled | 31.1 | 3.5 | 60.0 | 16.7 / 16.7 | 0 | 24 | 24,672 | 2 | 2.1 |
| 6 | enabled | 3.3 | 10.4 | 60.0 | 16.7 / 16.7 | 0 | 60 | 29,472 | 4 | 4.8 |
| 50 | disabled | 61.9 | 12.9 | 60.0 | 16.7 / 16.8 | 0 | 200 | 205,600 | 2 | 13.5 |
| 50 | enabled | 12.9 | 19.9 | 60.0 | 16.7 / 16.8 | 0 | 500 | 245,600 | 4 | 34.4 |
| 200 | disabled | 164.5 | 40.7 | 59.3 | 16.7 / 16.7 | 1 | 570 | 587,820 | 2 | 41.9 |
| 200 | enabled | 53.7 | 47.2 | 59.3 | 16.7 / 16.7 | 1 | 1,431 | 702,620 | 4 | 101.0 |

The rows are intentionally run in a fixed disabled-then-enabled order for each
population. Setup and readiness include browser and renderer warm-up effects,
so the enabled and disabled setup values should not be treated as a balanced
experimental estimate from one run. The renderer counters do show the visible
selection treatment's additional draw and CPU submission cost in this run.

The Surface acceptance gate remains separate. A physical Surface run must use
the Lab's built-in report and record the actual browser, device identity when
available, viewport, DPR, input mode, frame intervals, missed frames, and
renderer diagnostics. Headless Chrome cannot establish Surface GPU behavior,
paint latency, touch/pen behavior, or a supported card population envelope.
