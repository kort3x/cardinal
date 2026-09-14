# WebGL browser evidence — 2026-09-14

This is an interim record for slice 01. It records observed facts and open gates;
it is not a browser acceptance sign-off.

## Reference environment

- OS: macOS 26.6.2, build 25G83
- GPU: Apple M4, 10 cores, Metal 4
- Chrome: 152.0.7977.83
- Display: 5120 × 1440 at 120 Hz
- Firefox: not installed on the reference machine
- Safari version: not recorded

## Evidence available

- The deterministic card-engine suite passes: 58 tests.
- The user confirmed after reboot that WebGL is active in Chrome and Safari.
- The lab reports the WebGL renderer and orthographic camera when initialization
  succeeds; CSS fallback is not automatically selected.
- WebGL context-loss/restoration status propagation is covered by an engine test,
  and the adapter refreshes mounted card content after restoration.

## Still required before issue #2 can close

- Run the documented lab and consumer smoke scenarios in Chromium, Firefox, and
  WebKit/Safari, including edge-on and oblique views, X/Y/both-axis flips, reduced
  motion, resizing, and disposal.
- Record frame timing, missed frames, input latency, texture memory, card counts,
  and landing error for the agreed reference device.
- Capture real-browser context-loss and restoration evidence.
- Record Safari's exact version and install/run Firefox for the third browser
  family.

Issue #2 remains In progress until those gates have evidence.
