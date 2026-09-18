# Complete card textures before presentation

The Surface motion benchmark improved after active texture sharing, but the user
still observed card elements loading in. Warm motion results did not establish
correct cold-load presentation.

The renderer initially rasterized faces with only the images already available,
then repainted and rendered the entire scene for each arriving image. A Chrome
regression holds two real image requests before releasing them independently.
Before the fix, all three assertions failed: the incomplete card was drawn,
the first arrival repainted it, and the second arrival repainted it again.

The renderer now rasterizes each face once after its sources settle. A card is
visible and pickable only when its permitted textures are ready. Concealed fronts
remain suppressed and are not requested. Failed sources use the existing missing
image fallback; unrelated ready cards remain visible. Completion renders are
coalesced with requestAnimationFrame. Replacing content with an uncached image
temporarily hides that card rather than retaining potentially forbidden content.
This is per-card readiness, not a global loading screen or asset preloader.

`textures.pending` exposes textures awaiting rasterization. The Lab benchmark
waits for this count as well as image readiness before sampling motion. Neither
counter measures GPU completion or eliminates network latency.

## Verification

- `npm test`: 298 passed, zero failed or skipped, exit 0.
- `CARDINAL_CHROME_PORT=9338 node scripts/chrome-lab.mjs --headless --scenario texture-reuse`:
  16 passed, exit 0. Covers staged image completion, a ready peer, failure
  fallback, sharing, concealment/late callbacks, independent edits, release,
  context restoration, and custom drawing. The three initial cold-load
  assertions failed on the old renderer (exit 1).
- Chrome `elements`: 29 passed, exit 0.
- Chrome `inspection`: 30 passed, exit 0.
- Chrome `benchmark`: 4 passed, exit 0, including 1/5/10/50/100-card readiness
  and Lab restoration.
- `npm run build:pages` and `git diff --check`: exit 0.

Measured texture-test environment: macOS HeadlessChrome 153.0.0.0, viewport
2515 × 1322, DPR 1, stage 1741 × 994. The test exercises actual WebGL submission:
zero draw calls for the incomplete card, then drawing after completion. Failed
source coverage dispatches an image error through the renderer's normal handler.
These are rendering/readiness assertions, not a screenshot review or a new
Surface frame-rate measurement. Physical-device cold loading still needs user
confirmation.
