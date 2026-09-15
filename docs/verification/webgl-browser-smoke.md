# WebGL browser smoke checks

These checks are the visual and runtime gate for the true-3D adapter. Unit tests
cannot establish texture sharpness, frame timing, input latency, or context
recovery.

The WebGL adapter emits `renderer-status` events for `webgl-context-lost` and
`webgl-context-restored`. The lab reflects those states in its renderer status
line; a real browser context-loss run is still required for acceptance evidence.

## Run

For automated runs, setup, browser selection and result reporting, use the
[browser testing runbook](browser-testing.md). Start a consumer manually for the
visual matrix below:

```sh
npm --prefix examples/card-engine-lab start
npm --prefix examples/card-engine-use start
```

Check the lab at `http://localhost:4173/` and the independent consumer at
`http://localhost:4174/` in Chromium, Firefox, and WebKit/Safari.

## Safari automation and user interference

Before Safari automation or interpretation of its failures, follow the general
[Safari interference protocol](browser-testing.md#safari-automation-and-user-interference).
This heading remains for existing links; the runbook owns the procedure.

## Matrix

For each browser, verify:

- the renderer status reports `Three.js WebGL (true 3D) · orthographic`, never CSS;
- the rounded rectangle and shield profiles remain closed, beveled, and coherent
  face-on, edge-on, and oblique;
- move, rotate, scale, flip, simultaneous X/Y flip, and continuous spin preserve
  one card object and settle at the committed pose;
- front content and the concealed back remain readable at 100%, 150%, and 200%
  during motion and at rest;
- text line breaks remain canonical and the image does not swim or jitter;
- keyboard focus reaches the stable accessible card shell and a concealed card is
  announced as concealed;
- resizing, browser zoom, reduced motion, and WebGL context loss do not leave a
  stale card or unresolved motion.

Record the reference browser/OS/device, card count, display scale, missed frames,
input latency, texture memory, and landing error in the issue or release note.
Do not mark the slice's browser acceptance checkbox until all three browser
families have evidence.

`test:cross-browser` runs the current acceptance flow in Firefox BiDi and Safari
WebDriver, including motion, scale, flips, edge-on pose, reduced motion,
context-loss recovery, scene disposal/recreation, and element lifecycle controls.
