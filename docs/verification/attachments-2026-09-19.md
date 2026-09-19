# Dynamic attachments — issue #9

Scope: card-owned stamps, counters and stickers, using the public attachment
transaction API and consumer-provided element renderers. Card-to-card
relationships belong to the following slice and are outside this change.

## Verification contract

- Engine checks cover per-card identity, atomic validation, surface affinity,
  visibility and anchor fallback, content sizing, and independent motion.
- Chrome acceptance exercises the Lab and engine controls through real mouse
  and keyboard input, including focus cleanup and replacement during a flip.
- Adjacent element and inspection scenarios guard existing content behavior.
- Screenshots supplement assertions for placement and clipping. Browser state
  alone does not establish correct pixels or physical-device performance.

## Results

All checks below exited 0 with no skips:

| Command | Result |
| --- | --- |
| `npm test` | 324 engine tests passed |
| `CARDINAL_CHROME_PORT=9475 npm run test:chrome:attachments` | 24 checks passed |
| `CARDINAL_CHROME_PORT=9475 npm run test:chrome` | 29 element checks passed |
| `CARDINAL_CHROME_PORT=9476 npm run test:chrome:inspection` | 30 checks passed |
| `CARDINAL_CHROME_PORT=9476 npm run test:chrome:texture-reuse` | 16 checks passed |
| `npm run build:pages` | Site built, including attachment assets/styles |
| `node --check` for 17 changed JavaScript files; `git diff --check` | Passed |

The final renderer/scene changes were checked locally on Node 22.22.3 and
HeadlessChrome 153.0.0.0 on macOS. Browser viewport was 2515×1322 CSS pixels,
DPR 1; outer window 756×556 at (22,22); measured stage 1741×994 at (388,136).
Ports were checked before use, temporary browser sessions were cleaned up, and
the user's existing browser windows were preserved. This is headless desktop
Chrome evidence, not Safari, Surface, physical touch/pen or timing evidence.

The attachment scenario uses actual CDP pointer and native Enter input for the
counter, checks focused removal and persistent card shells, and restores its
baseline. A separate solid-image fixture samples screenshot pixels at expected
positions. It checks positive/negative layer order, clipping on both faces,
region resizing, hidden anchors, explicit fallback, and replacement while an
actual browser image request is pending. Network emulation is restored in
`finally`. The deterministic suite additionally checks independent motion and
replacement during a flip.

The [Lab screenshot](evidence/attachments-lab-2026-09-19.png) was inspected:
the stamp, counter control and two staggered stickers are visible, and the
toolbox follows the existing dark/gold styling.

## Corrections established by verification

- Initial renderer patches required real clipping, unified layer ordering,
  disposal/generation guards and shared measured geometry. Texture drawing now
  excludes overlay attachments, avoiding duplicate compositing.
- Projection resolves missing/hidden anchors through attachment and ordinary
  region chains. Presentation overrides cannot revive missing-anchor content
  or reserve its flow space. Removed or concealed controls cannot remain active.
- Controls are engine-owned; the Lab supplies renderers and transactions.
  Native Enter required the full CDP key event, including carriage-return text.
  The initial pointer test also needed to wait for the resizing button to settle.
- Registering an unused custom type must not disable ordinary face texture
  sharing. The texture regression now expects two private custom fronts and one
  shared ordinary back, rather than four private textures.
- The two review axes were checked independently. Concrete findings were fixed;
  the claimed no-attachment presentation regression was disproved by the
  existing sizing path/tests. The local slice's English-label requirement
  supersedes the ticket's stale German wording.

Changes are committed locally for issue #9. No push, release, or issue closure
is part of this implementation. Card-to-card attachment topology remains #10.
