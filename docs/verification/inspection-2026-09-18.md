# Inspection and named content faces — 2026-09-18

Issue: [#7](https://github.com/kort3x/cardinal/issues/7).
Verified working tree based on `aa9e25b5432581ebc5f57f953cc11fd70d3e1520`; local, uncommitted,
not pushed or published. These results cover the new slice, not every browser or
physical device.

## Results

| Check | Result |
| --- | --- |
| `npm test` | 274 passed, 0 failed/skipped |
| `CARDINAL_CHROME_PORT=9386 npm run test:chrome:inspection` | 29 passed |
| `CARDINAL_CHROME_PORT=9386 npm run test:chrome:acceptance` | 13 passed |
| `CARDINAL_CHROME_PORT=9386 npm run test:chrome:drag` | 15 passed, 2 failed |
| Same drag journey against an isolated unchanged base checkout | The same 15 passed and same 2 failed |
| Changed entry-point syntax checks and `git diff --check` | Passed |

The drag failures are **spin to start timed out** and **live element and dimension
change attachment error exceeded 1 CSS px** (40 px). Both reproduce on the base
revision. The spin fixture inherits enforced zone-face policy; the resize failure
needs a separate investigation. They are not counted as passes or newly fixed.
The first integration run also failed responsive drag pickup; suppressing
inspection dwell while dragging resolved that new failure.

## Environment and input

Headless Chrome 153.0.0.0 on macOS, Node 22.22.3. Isolated debug port 9386;
existing user windows were not navigated. Measured desktop viewport 2515×1322,
outer window 756×556 at (22,22), DPR 1. Inspection fixture stage bounds:
left/top (40,40), size 2435×1242. The scenario temporarily requested a 390×844
mobile viewport for a separate bounds assertion, then restored its viewport.

Keyboard, hover, related-button navigation, mouse drag and touch hold used CDP
input. Programmatic commands set up fixtures and exercised the consumer API.
Desktop touch emulation is not physical iPhone/Surface evidence. Firefox, Safari,
and performance timings were not measured for this slice.

## What is covered

- Separate content-face selection, permission denial, hidden selection followed
  by reveal, unknown back-only data, and atomic rejection of invalid batches.
- Face selection during spin/flip/movement, stable shell identity, latest state
  after in-place dismissal, and current zone presentation restoration.
- Live read-only previews, distinct auxiliary identities, related navigation and
  revocation, scrolling long content, modal focus/escape, nonmodal focus retention.
- Concealed content and private image URLs absent from unauthorized previews,
  accessible shells, and resource requests in both WebGL and CSS adapters.
- Explicit permission to inspect supplied concealed content; revocation closes it.
  Change events expose reconciled inspection content after concealment.
- Hover dwell cancellation/reentry, dismissal cancellation on preview reentry,
  no hover opening during held mouse drag, keyboard I and touch hold cleanup.
- Narrow viewport bounds, reduced motion at an edge, transformed in-place clamp,
  selection with pending/actionable feedback and disabled selection eligibility.

The Lab exposes **Inspection → Set up inspection** for two simplified cards,
a named face selector, in-place/read-only modes, conceal/reveal and live updates.
The fixture marks one card actionable and another pending. Full presentation is
inspection-owned; source membership and committed poses remain engine-owned.

## Corrections preserved for future work

- Validate a content-face batch before canceling its active spin. Invalid batches
  must not change animation ownership.
- A stage with CSS perspective establishes a containing block for fixed children.
  Auxiliary previews therefore portal to the document body and clamp there.
- Clearing a timeout must also clear its stored ID; returning to a preview must
  cancel queued dismissal. Ignore dwell initiation while pointer buttons are down.
- Cancel the underlying touch gesture on long press, then retain the inspection
  handle for input cleanup. Preview controls never reuse scene `data-card-id`.
- Concealment is not authorization for browser JavaScript. Consumers must omit
  data they do not authorize; inspection rules govern presentation of supplied data.
