# Chrome lab automation

Chrome is the primary interactive verification browser for Cardinal. The
runner uses Chrome DevTools Protocol and Node's built-in WebSocket API, so it
does not require a browser automation dependency.

## Commands

From the repository root:

```sh
npm run test:chrome
npm run show:chrome -- --scenario elements
```

`test:chrome` launches a temporary headless Chrome when port `9222` is not
already available, opens the lab, simulates the element workflow, waits for
animations to settle, and exits non-zero on a failed check. `show:chrome` uses
a visible Chrome window and leaves it open after the run. Set
`CARDINAL_CHROME_PORT` or `CARDINAL_LAB_URL` when using a different endpoint.

The current `elements` scenario covers hide/show, remove, add, edit, reorder,
overlay, preserve-space, repeated image instances, multi-card element changes,
and element changes during movement and flipping. The engine test suite remains
the fast deterministic gate; Chrome automation is the browser behavior gate.
