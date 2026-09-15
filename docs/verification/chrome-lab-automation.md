# Chrome lab automation

Chrome is the primary interactive verification browser for Cardinal. The
runner uses Chrome DevTools Protocol and Node's built-in WebSocket API, so it
does not require a browser automation dependency.

## Commands

From the repository root:

```sh
npm run test:chrome
npm run test:chrome:layout
npm run test:chrome:resize
npm run test:chrome:movement
npm run test:chrome:random
npm run test:chrome:spin-state
npm run test:chrome:performance
npm run show:chrome -- --scenario elements
```

`test:chrome` launches a temporary headless Chrome when port `9222` is not
already available, fixes a deterministic 2515×1322 desktop page viewport, opens the lab,
scrolls the stage into view, simulates the element workflow, waits for
animations to settle, and exits non-zero on a failed check. `show:chrome` uses
a visible Chrome window at its existing window dimensions and leaves it open
after the run; it never moves or resizes that window. Set
`CARDINAL_CHROME_PORT` or `CARDINAL_LAB_URL` when using a different endpoint.

The current `elements` scenario covers hide/show, remove, add, edit, reorder,
overlay, preserve-space, repeated image instances, multi-card element changes,
pointer hit testing, and element changes during movement and flipping. The
scenario also verifies that the lab's live FPS readout is present. The `layout`
scenario verifies the full-width element editors, compact actions, and
the usable element rail, model dropdown alignment, scale presets, and bundled
background presets. The acceptance scenario covers combined motion, edge-on
orientation, reduced motion, and scale transitions at 100%, 150%, and 200%.
The `resize` scenario changes the stage through narrow, wide, and tall sizes,
checks that stage-scaled camera resizing reveals more or less world space without
changing card pixel size, verifies logical-center mapping, and resizes during
movement. The engine test suite remains the fast deterministic gate; Chrome
automation is the browser behavior gate.

The `performance` scenario mounts 200 cards in the controlled headless
2515×1322 viewport, selects the cohort, triggers a move, samples one second of
`requestAnimationFrame` timing, reports setup/action/first-frame/median/P95
timings and intervals over 20 ms, then restores the lab to one card.
