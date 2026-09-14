# WebGL browser evidence — 2026-09-14

This is an interim record for slice 01. It records observed facts and open gates;
it is not a browser acceptance sign-off.

## Reference environment

- OS: macOS 26.6.2, build 25G83
- GPU: Apple M4, 10 cores, Metal 4
- Chrome: 152.0.7977.83
- Firefox: 155.0.1
- Safari: 26.6.2
- Display: 5120 × 1440 at 120 Hz

## Evidence available

- The deterministic card-engine suite passes: 60 tests.
- The user confirmed after reboot that WebGL is active in Chrome and Safari.
- The lab reports the WebGL renderer and orthographic camera when initialization
  succeeds; CSS fallback is not automatically selected.
- WebGL context-loss/restoration status propagation is covered by an engine test,
  and the adapter refreshes mounted card content after restoration.
- A real Chrome context-loss run reported `webgl-context-lost`, then
  `webgl-context-restored`; the canvas and one mounted card remained available.

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
scene settled after the animation completed, but this remains outside a responsive
supported envelope. Texture memory was not exposed by the browser API and was not
estimated from unrelated process memory.

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

## Still required before issue #2 can close

- Run the remaining documented visual checks in Chromium, Firefox, and
  WebKit/Safari, including edge-on and oblique views, X/Y/both-axis flips, reduced
  motion, resizing, and disposal.
- Record frame timing, missed frames, input latency, texture memory, card counts,
  and landing error for the agreed reference device.
- Texture memory is still not exposed by the browser API and needs a defined
  measurement method or browser tooling capture.

Issue #2 remains In progress until those gates have evidence.
