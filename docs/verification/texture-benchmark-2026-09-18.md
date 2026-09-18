# Texture benchmark investigation — 2026-09-18

The Surface report in [NOTES #21](https://github.com/kort3x/cardinal/issues/21#issuecomment-5736116951)
measured Chrome 138 / Qualcomm Adreno X1-85 at DPR 1.25: 23.5 FPS at 50 cards
and 7.2 FPS at 100 cards, with a 100-card p95 interval of 866.6 ms. All observed
image sources were loaded. This establishes frame stalls in the Lab workload;
it does not identify the GPU, exclude texture uploads, or prove the cause of
initial element loading. At 100 cards only 13 intervals were observed, so that
p95 was also the largest observed interval.

## Protocol and evidence

The new `benchmark-profile` scenario runs the existing Lab Benchmark button,
with its 1/5/10/50/100 populations, 1.5-second sampling duration, and combined
random movement/rotation/flip workload. It pins Math.random to seed 123456789
and restores it afterward. It does not suppress Lab controls or lower quality.
Completion-driven motion cycles mean different speeds can produce different
cycle counts and final poses despite the same seed.

Commands (run serially on an unused debug port):

```sh
CARDINAL_CHROME_PORT=9338 CARDINAL_DEVICE_SCALE_FACTOR=1.25 \
  CARDINAL_PROFILE_PATH=/tmp/cardinal.cpuprofile \
  npm run test:chrome:benchmark-profile
CARDINAL_CHROME_PORT=9338 npm run test:chrome:texture-reuse
```

[Recorded measurements](evidence/2026-09-18-texture-benchmark.json) preserve the
instrumented baseline and both post-change profiles. The initial uninstrumented
profile also observed 55.4 FPS at 100 cards, p95 33.3 ms. CPU profiles include
setup/restoration and remain local temporary artifacts. Source baseline was
`4b94f84`; the instrumented baseline added reporting probes before texture pooling.

Measured local environment: HeadlessChrome 153.0.8010.48 on macOS ARM, Apple M4
Metal, 2515×1322 CSS viewport, 1741×994 stage, DPR 1.25, framebuffer 2173×1240.
This is not the Surface environment. The regression browser scenarios used the
runner's DPR 1 default; the inspection scenario uses its own 2435×1242 stage.

| 100-card measurement | Instrumented baseline | First optimized run | Final optimized run |
| --- | ---: | ---: | ---: |
| Setup ms | 199.3 | 168.8 | 188.4 |
| Initial motion handler ms | 29.6 | 18.3 | 18.8 |
| Texture creations during work window | 240 | 1 | 1 |
| Texture upload submissions | 319 | 1 | 1 |
| Geometry rebuilds during work window | 0 | 0 | 0 |
| Observed FPS | 55.4 | 58.7 | 59.3 |
| Frame intervals over 20 ms | 4 | 2 | 1 |
| Frame p95 ms | 16.8 | 16.8 | 16.8 |

These short runs show a consistent reduction in resource work and modest local
frame-rate improvement, not a confidence interval or device guarantee. The final
100-card sample still submitted 760 draw calls / 446,480 triangles in its last
render (baseline: 744 / 444,912 at a different final pose). Pooling does not reduce
geometry submissions. It held two active card textures, approximately 3.37 MB
of RGBA surface pixels excluding mipmaps and driver overhead. Unique card content
will share less than the benchmark's cloned cards; common backs still benefit.

## Changes and decisions

- Share identical built-in textures only while mounted surfaces reference them.
  Keys include filtered content, dimensions, transition drawing options, face
  identity, and device pixel ratio. There is no idle composed-texture cache.
- Concealment immediately detaches its front; the final reference evicts and
  disposes the texture. Pending image callbacks check texture disposal, so they
  can update a remaining revealed peer but cannot resurrect an evicted front.
- Custom element renderers get private textures. Their external drawing state
  cannot safely be represented by serialized face keys.
- Reuse the emitted scene snapshot in inspection input and in Lab card-list
  updates. This removes redundant deep copies without suppressing UI behavior.
- Preserve presentation filtering across WebGL context restoration; the renderer
  previously replayed the last card without its zone presentation.
- Add explicit renderer diagnostics for creations, redraws, upload submissions,
  render CPU time, geometry builds, resources, draw calls and triangles. No
  counters are added to scene snapshots. Per-row counters include the initial
  action; `workWindowMs` measures that window. `sampleMs` retains the prior FPS
  timestamp window. `firstFrameMs` now uses callback-entry time, not an rAF
  timestamp that can precede the synchronous action. The baseline's first-frame
  metric in the raw data is therefore not a valid action-latency measurement.
- Preserve existing textures if canvas allocation is unavailable and restore the
  benchmark fixture only once on the successful path.

The earlier hypotheses of a proven GPU bottleneck, a persistent fanned-Hand
workload, and roughly 900 draw submissions were too definite. Benchmark cards
use absolute positions and move randomly; counters are now the source of truth.
Geometry rebuilds were zero during sampled motion, so geometry caching and
adaptive quality were deferred. GPU completion timing remains unmeasured.

## Verification

All final checks exited 0:

- `npm test`: 298 passed, no skips/failures.
- `test:chrome:texture-reuse`: 11 checks. This exercises real WebGL pooling,
  cohort conceal/reveal, independent edits, failed 2D allocation, resident GPU
  count returning to baseline, fresh remount, delayed image completion, idle
  context restoration with filtering, and private custom drawing.
- `test:chrome`: 29 element checks, including dynamic reshape during motion.
- `test:chrome:inspection`: 30 checks, including concealed content and requests.
- `test:chrome:acceptance`: 13 animation checks; zero-pixel landing error.
- `test:chrome:benchmark`: 4 checks with exact population and metric assertions.
- `test:chrome:benchmark-profile`: 2 checks; both optimized profiles retained.
- `npm run build:pages`, syntax checks and `git diff --check` passed.

The texture regression went red before the pooling change: mounting 100 identical
cards created 200 textures and revealing them created another 100. It now requires
two and one, respectively. Initial fixture mistakes (missing zone membership and
depth) were corrected before that meaningful red run. The first context-loss test
timed out because it requested restoration within the loss-event dispatch;
yielding one animation callback allows the browser to finish the cancellation
policy before restoration. The final test also waits for an idle scene so another
animation cannot mask lost presentation filtering.

## Delegation and remaining gate

Two workers shared the checkout with disjoint write ownership. Popper audited
benchmark confounds and implemented inspection-input snapshot reuse and tests.
Kepler audited renderer churn, implemented the active texture pool and lifecycle
tests, and reviewed integration. They used the inherited session model; no Luna
model override was selected. The lead owned renderer integration, profiling,
Lab reporting, browser scenarios and final evidence. Reviews identified nullable
allocation handling, resident-resource assertions, context presentation replay,
and counter timing windows; all were addressed. Workers completed and closed.

The remaining acceptance gate is the same Surface rerun with this version.
Compare the renderer work counters and initial-handler time alongside FPS and
long intervals. If severe stalls remain despite lower uploads, capture that
browser's CPU/GPU trace before changing resolution, selection rendering or mesh
batching. Initial cold-page loading is a separate unmeasured workload. These
changes and evidence are local until explicitly pushed/published.
