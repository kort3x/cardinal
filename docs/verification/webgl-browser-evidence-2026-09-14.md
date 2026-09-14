# WebGL browser evidence — 2026-09-14

This record combines the original slice-01 acceptance evidence with a
current-tree regression refresh. It records observed facts and open gates; it
is not a browser acceptance sign-off.

## Reference environment

- OS: macOS 26.6.2, build 25G83
- GPU: Apple M4, 10 cores, Metal 4
- Chrome: 152.0.7977.83
- Firefox: 155.0.1
- Safari: 26.6.2
- Display: 5120 × 1440 at 120 Hz

## Evidence available

- The deterministic card-engine suite passes: 72 tests.
- The user confirmed after reboot that WebGL is active in Chrome and Safari.
- The lab reports the WebGL renderer and orthographic camera when initialization
  succeeds; CSS fallback is not automatically selected.
- WebGL context-loss/restoration status propagation is covered by an engine test,
  and the adapter refreshes mounted card content after restoration.
- A real Chrome context-loss run reported `webgl-context-lost`, then
  `webgl-context-restored`; the canvas and one mounted card remained available.

## Current-tree regression refresh

After the latest card-background, physical-back, and element-layout changes, the
following checks were rerun on 2026-09-14:

- Chrome 152.0.7977.83: the full checked-in matrix passed 56 checks across
  elements, acceptance, layout, resize, movement, random motion, and spin
  state. The acceptance run measured 1.60 ms input-to-next-frame latency and a
  0 px landing delta.
- Firefox 155.0.1: a current-tree WebDriver BiDi pass ran in headless mode and
  passed the full current-tree acceptance flow (18/18), including move to the
  browser-visible maximum (`x=680` in this headless viewport), rotation, scale,
  face-down, simultaneous X/Y flip, edge-on pose, combined motion, reduced
  motion, context loss/recovery, and scene disposal/recreation. The element/content
  regression checks also passed.
- Safari 26.6.2: a current-tree WebDriver pass ran and passed WebGL startup,
  and the full current-tree acceptance flow (18/18), including rotation, scale,
  face-down, simultaneous X/Y flip, edge-on pose, combined motion, reduced
  motion, context loss/recovery, scene disposal/recreation, and the element/content
  regression paths.

The checked-in `npm run test:cross-browser` runner now executes these Firefox
and Safari checks using real browser automation and the current tree. Their
broader visual screenshot review and performance samples remain the
previously recorded evidence below; the latest functional acceptance flow now
covers the same motion and recovery decisions in both browsers.

### Latest visible Chrome 200-card spot-check

The existing visible Chrome debug session was then used for a current 200-card
cohort spot-check. It used a `1694×992` page viewport without moving or resizing
the Chrome window. Adding the cohort took `3,615.7 ms`; the move action handler
took `20.7 ms`. During the following one-second animation sample, Chrome
produced 120 frames, with a `15.7 ms` first-frame delay, `8.3 ms` median frame,
`8.9 ms` P95 frame, and zero frame intervals over 20 ms. The lab reported 200
mounted shells and a stable final pose. The lab was restored to its normal
single-card state afterward.

This is a live spot-check under the current visible-session viewport, not a
replacement for the controlled 200-card baseline in the table below; the two
results should not be compared as identical benchmark conditions.

Firefox was exercised headlessly through WebDriver BiDi on the same machine. It
reported WebGL 2.0 (`Apple M1, or similar` under Firefox's software compositor),
the required orthographic renderer status, and successful context loss/restoration
with the mounted card still available.

Three repeated Firefox full-spin cycles completed with a stable renderer status
and no reported JavaScript errors after the flip-angle canonicalization fix.

Safari was exercised through WebDriver on the same machine. It reported WebGL
2.0 (`WebKit WebGL`), the required orthographic renderer status, successful context
loss/restoration with the mounted card intact, and three repeated full-spin cycles
that settled successfully.

## Chrome performance sample

Synthetic lab measurements on the reference Chrome profile used a 1-second
cohort-animation sample after all listed cards were selected. Frame intervals are
browser `requestAnimationFrame` intervals, not a product target.

| Cards | Setup | Median frame | P95 frame | Missed frames over 20 ms | Result |
| ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 0.7 ms | 8.3 ms | 9.8 ms | 0 | pass for this sample |
| 6 | 37.8 ms | 8.3 ms | 9.8 ms | 0 | pass for this sample |
| 50 | 237.8 ms | 8.3 ms | 9.7 ms | 0 | pass for this sample |
| 200 | 2,495.3 ms | 8.1 ms | 297 ms | 2 | fails responsiveness sample |

The post-batching 200-card sample produced six frames during the 1-second
observation window and its first frame arrived about 896 ms after the action. The
scene settled after the animation completed. This is retained as historical
evidence from the earlier run; the current controlled rerun is recorded below.
The managed texture estimate is recorded below; browser and driver overhead are
intentionally excluded.

### Current controlled 200-card rerun

The checked-in `npm run test:chrome:performance` scenario was run in the
controlled headless Chrome viewport (`2515×1322`, device scale factor 1). It
mounted 200 cards and sampled one second of cohort movement:

| Setup | Handler | Frames | First frame | Median frame | P95 frame | Missed over 20 ms | Result |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 3,576.3 ms | 19.4 ms | 61 | 20.0 ms | 16.7 ms | 16.7 ms | 0 | pass for this sample |

The scenario verified 200 mounted WebGL shells and a stable final pose, then
restored the lab to one card. This current result supersedes the earlier
six-frame observation for the current tree and runner; the measurements are
still a baseline rather than a universal device guarantee.

Firefox's 1-second post-batching cohort samples were:

| Cards | Setup | Median frame | P95 frame | Missed frames over 20 ms |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 1 ms | 8 ms | 9 ms | 0 |
| 6 | 39 ms | 8 ms | 9 ms | 0 |
| 50 | 234 ms | 8 ms | 10 ms | 0 |

Safari's 1-second post-batching cohort samples were:

| Cards | Setup | Median frame | P95 frame | Missed frames over 20 ms |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 2 ms | 17 ms | 18 ms | 1 |
| 6 | 68 ms | 17 ms | 20 ms | 2 |
| 50 | 301 ms | 17 ms | 21 ms | 3 |

## Acceptance run and measurement method

The checked-in Chrome acceptance scenario was run after the visual review:

```text
npm run test:chrome:acceptance
13 checks passed
input latency: 1.60 ms
landing delta: 0 px
```

The scenario covers a settled move, rotate, scale, 100%/150%/200% scale states,
an in-flight scale transition, face-down transition, simultaneous X/Y flip,
edge-on pose, combined motion, and reduced motion. The
landing delta is the absolute difference between the requested X position and
the settled pose reported by the lab. Input latency is the time from dispatching
the range-input event to the next `requestAnimationFrame` sample; it is a
responsiveness sample, not a complete end-to-end device latency measurement.

For texture memory, Cardinal uses a managed RGBA8 estimate because WebGL does
not expose driver allocation totals. Each content canvas is allocated at
`min(4, max(2, devicePixelRatio * 2))` resolution, with no mipmaps. The estimate
is therefore:

```text
sum(canvas.width * canvas.height * 4) for every front/back texture
```

On the reference display (`devicePixelRatio = 1`), the default content-sized
card is 180×257 CSS pixels, so each side is 360×514 texels and both sides use
approximately 1,480,320 bytes (1.41 MiB) per mounted card. This excludes driver
overhead and decoded source-image memory. At that content size, 50 cards are
approximately 70.6 MiB and 200 cards approximately 282.8 MiB by the same
estimate.

The Chrome visual review covered face-on, oblique X/Y rotation at 200% scale,
and edge-on Y rotation. The rounded silhouette stayed closed, the side volume
remained coherent, and front content stayed readable in the inspected captures.

The Safari acceptance run used Safari 26.6.2 at a 1600×1000 desktop viewport.
All 10 checks passed for baseline WebGL, move, rotate, scale, face-down,
simultaneous X/Y flip, edge-on pose, oblique 200% content, combined motion, and
reduced motion. Safari measured a 5 ms next-frame input sample and a 0 px landing
delta. Its managed texture estimate was 1.41 MiB for the default card at
`devicePixelRatio = 1`. The inspected face-on, oblique, and edge-on captures
showed the card, side volume, and content surfaces without the earlier off-stage
blank result from the smaller 800×600 window.

The Firefox acceptance run used Firefox 155.0.1 with a 1280×815 headless desktop
viewport. All 9 checks passed for baseline WebGL, move, rotate, scale, face-down,
simultaneous X/Y flip, edge-on pose, combined motion, and reduced motion. Firefox
measured a 1 ms next-frame input sample and a 0 px landing delta. Its managed
texture estimate was 1.41 MiB for the default card at `devicePixelRatio = 1`.
The inspected face-on, edge-on, and oblique 200% captures showed the closed
rounded cuboid, coherent side volume, and readable card content.

## Remaining review

The original Chrome, Firefox, and Safari runtime, motion, measurement, and
visual gates remain recorded, and the latest element/content regression paths
passed in all three browsers. The current controlled 200-card sample passes its
frame-timing checks, and the full Firefox/Safari acceptance flow is now checked
in as `npm run test:cross-browser`. Issue #2 remains open for final reviewer
sign-off.
