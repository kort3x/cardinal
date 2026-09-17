# Drag motion integration · 2026-09-17

The drag motion changes were implemented by Luna workers and integrated and
reviewed in the shared checkout. The engine now uses elapsed-time pointer
filtering and analytical springs, preserves orientation and tilt when crossing
zone boundaries, and carries angular velocity into landing. Pointer position
remains directly controlled by input. The WebGL renderer captures a local 3D
material point and keeps it under the pointer through lift, tilt, flip,
perspective and camera resize. The same screen translation is applied to the
whole carried cohort at each member's own depth.

Consumers configure `interaction.motion` and update it with
`scene.setDragMotion(patch)`. `snapshot().dragMotion` reports normalized settings.
The lab's **Drag → Motion tuning** controls expose the same API, with Crisp,
Natural and Floaty presets. Authored transitions retain their existing motion
timing; drag response and landing have independent timing. Edge hang remains
disabled, as previously requested.

Drag presentation updates are batched on the animation frame, with one update
per changed card. The renderer caches unchanged texture/accessibility inputs and
interaction ordering. Lab interaction diagnostics are limited to approximately
10 updates per second, while candidate and terminal changes remain immediate.

## Verification

`npm test`: **232 passed, 0 failed, 0 skipped**, exit 0. Regressions include
30/60/120 Hz pointer updates, long idle gaps, zone entry/exit continuity, reduced
motion, live configuration, one render per frame, accepted landing delay,
3D projection and cohort grab correction.

Browser commands used isolated Chrome debug port 9335 with
`CARDINAL_CHROME_PORT=9335`. Every final command below exited 0.

| Command | Passed | Failed / skipped |
| --- | ---: | ---: |
| `npm run test:chrome:drag` | 17 | 0 / 0 |
| `npm run test:chrome:batch` | 13 | 0 / 0 |
| `npm run test:chrome:drag-geometry` | 11 | 0 / 0 |
| `node scripts/chrome-lab.mjs --headless --scenario layout` | 40 | 0 / 0 |
| `node scripts/chrome-lab.mjs --headless --scenario elements` | 21 | 0 / 0 |
| `node scripts/chrome-lab.mjs --headless --scenario acceptance` | 13 | 0 / 0 |
| `npm run test:chrome:drag-performance` (isolated port 9338) | 13 | 0 / 0 |

The measured browser was HeadlessChrome 152.0.0.0 on macOS, viewport 2515×1322,
DPR 1, outer window 756×556 at `(22, 22)`. The final drag stage was 1741×994 at
`(388, 131)` after its scroll/resize cleanup; the final perspective geometry
fixture was 1000×600 at `(124, 124)`. Perspective dragged cards began at depths
240 and 255. Maximum material-point attachment and cohort-relative errors
rounded to **0.000 CSS pixels**, within the unchanged 1 CSS pixel requirement.
These are actual CDP pointer journeys with non-reduced motion. Batch coverage
also includes emulated touch and pen; it is not physical-device evidence.

The layout run checks all twelve motion controls and preset switching against
the live scene API, including scene identity and unchanged cards/selection.
Elements and acceptance cover content changes, resize, face changes, motion
composition and reduced motion after renderer caching changes.

Local final logs:

- `/tmp/cardinal-drag-final-tests-2.log`
- `/tmp/cardinal-drag-integrated-chrome-3.log`
- `/tmp/cardinal-drag-integrated-batch-2.log`
- `/tmp/cardinal-drag-final-geometry.log`
- `/tmp/cardinal-drag-integrated-layout-2.log`
- `/tmp/cardinal-drag-integrated-elements-3.log`
- `/tmp/cardinal-drag-integrated-acceptance-3.log`
- `/tmp/cardinal-drag-final-performance-2.log`

## Failures retained and corrected

Earlier runs are retained in `/tmp/cardinal-drag-integrated-*.log`. They exposed
both integration defects and stale fixtures. Independent review found that
correcting only the primary card's 3D grab point displaced the other cohort
members; the scene now corrects the whole group, with unit and browser relative
offset assertions retained.

The lifecycle fixtures previously assumed a single lab card, a grid/row rather
than the lab's newer Hand default, pointer attachment at the threshold event
rather than pointerdown, and engine default dimensions rather than lab template
dimensions. They now declare their arrangements and sizes explicitly. Their
fixed-center attachment checks use neutral lift/dangle/upright settings;
animated physical-point attachment is tested separately by drag-geometry.
Landing references independently solve committed membership with measured card
dimensions and fixed sizing. A shield's perspective side can legitimately be
hit through an upper corner; the transparent-corner fixture now probes its
empty lower taper through the full extrusion. The element test uses a single
flip action rather than the continuous Flip demo toggle.

## Timing evidence and remaining work

The serialized performance measurements are recorded separately in
[the drag performance report](drag-performance-2026-09-17.md). The final run
sampled 1, 10 and 50 mounted cards, including 5- and 10-card cohorts. P95 frame
intervals were 16.7–16.8 ms. The 50-card/10-card-cohort sample used 24 pointer
moves; pointer-event to next observed motion-frame P95 was 5.3 ms (maximum
20.5 ms), which is not paint or display latency. The cohort fixture selects
the exposed end of the Hand before pickup and preserves those exact members.
The prior run could not pick up its fixed first-ten cohort and remains recorded
as a failed fixture; these numbers are not a speedup comparison with that run.

Browser state and
projection checks establish attachment and lifecycle correctness; measured
frame timing does not establish visual preference or physical iPhone/Surface
performance. The new presets are available for hands-on tuning.

Cold candidate-slot solving still evaluates hypothetical layouts. Optimizing
that path or adding slot hysteresis should be driven by a measured bottleneck
or visible target jitter; neither was silently added to this motion change.
