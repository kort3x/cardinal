# True 3D renderer plan

## Decision

Cardinal will move from the current CSS card approximation to a real WebGL
renderer adapter backed initially by Three.js. The scene model, layout solver,
motion channels, transaction lifecycle, and public `createCardScene()` interface
remain renderer-independent. Picko is not a dependency, adapter, or source of
runtime state.

## Implementation status

The renderer seam and Three.js dependency are now in place. The lab requires the
WebGL adapter by default; it does not silently fall back to CSS. CSS development is
paused in [issue #16](https://github.com/kort3x/cardinal/issues/16), and the current
CSS adapter is available only through explicit `renderMode: "css"` selection. The first adapter slice renders beveled extruded
rounded-rectangle and shield profiles, front/back content planes, orthographic
projection by default, optional perspective, lighting, and depth,
and composed X/Y rotations. The scene also supports optional history-dependent
logical face cycles over the two physical surfaces. Renderer status now reports
WebGL context loss/restoration through the scene and the adapter refreshes card
content after restoration. Content-quality comparison, browser smoke, and
performance gates remain open; the browser procedure is documented in
[WebGL browser smoke checks](../verification/webgl-browser-smoke.md).

The renderer seam is the existing implementation slot with `mount`, `update`,
`remove`, and `destroy` responsibilities. The WebGL adapter mounts one stable
accessible card shell per card while the canvas remains a visual surface. The
interface stays internal so the scene can select WebGL without exposing Three.js
objects to callers. The CSS adapter remains useful only when explicitly selected
for simple tests or prototype work; it cannot satisfy the true-3D acceptance gate.

## Target geometry

Each card is one closed extruded shape profile:

- front and back content surfaces are part of one mesh/object identity;
- side surfaces connect the faces through real thickness;
- outline rounding is continuous extruded geometry, not DOM strips, repeated
  planes, or visible facet bands;
- the mesh shares the scene pose pivot, camera projection, X/Y flip rotations,
  local rotation, scale, and depth;
- material, lighting, and shadows are controlled by the renderer, not host-page CSS.

The geometry contract is independent of content. A face can change content while
the card is concealed, mid-flip, moving, or scaled without replacing the card's
scene identity.

The first built-in profiles are `rounded-rectangle` and `shield`. Profiles are
selected by card template and generated inside the WebGL adapter; callers do not
provide Three.js objects.

## Content and sharpness

The first implementation will render front/back content into managed high-resolution
textures. Texture resolution is derived from canonical card dimensions, device pixel
ratio, and the supported inspection/scale envelope. Content invalidation is separate
from pose updates so movement and flipping do not rerasterize text every frame.

Before committing to the texture strategy, the lab will compare high-resolution
canvas textures with an SDF/MSDF text path for title and flavour text. The selected
path must preserve canonical line breaks and readable text/image detail at 100%,
150%, and 200% scale, during motion and at rest.

## Interface and lifecycle

The public scene interface remains:

```js
const scene = createCardScene({ element, motion, camera });
```

Renderer selection/configuration is internal or narrowly configured at scene
creation; callers never manipulate meshes, materials, cameras, or render loops.
The adapter must:

1. mount one render object per card ID;
2. update pose/content without replacing that object during ordinary changes;
3. render both content/concealed surfaces with correct visibility and accessibility
   state supplied by the scene;
4. dispose textures, geometry, materials, render targets, and frame resources on
   removal and destroy;
5. pause rendering when the scene is hidden or reduced-motion policy allows it;
6. report unsupported WebGL or asset failures as explicit initialization failures;
   report context loss/restoration as renderer status changes and recover mounted
   card content after restoration.

Motion remains time-based and sampleable. X and Y flip channels continue to animate
independently and compose on the same 3D object. Stopping or retargeting one channel
must preserve the other channels' displayed pose.

## Delivery sequence

### 1. Renderer seam and spike

- Extract the renderer contract from the current scene implementation.
- Add a renderer capability/selection path without changing scene operations.
- Add a minimal Three.js scene, camera, renderer, resize handling, and disposal.
- Render a white beveled extruded profile with no card content.

Gate: a card can rotate around X, Y, and both axes while its extruded volume,
profile silhouette, thickness, and pivot remain coherent at face-on, edge-on, and
oblique angles.

### 2. Content surfaces

- Add front/back materials and high-resolution content textures.
- Preserve face concealment, active content face, image loading, and text wrapping.
- Compare texture and SDF/MSDF text quality at the lab's scale presets.

Gate: no blur, line-wrap change, texture swimming, or content replacement at 100%,
150%, and 200% scale; concealed content is not visible or requested incorrectly.

### 3. Motion and interaction parity

- Route existing move/rotate/scale/flip/spin channels through the WebGL adapter.
- Keep shell/object identity through interruptions, retargeting, reduced motion, and
  destroy.
- Add pointer/raycast hit testing only after geometry and content are stable; keep
  application intent separate from scene mechanics.

Gate: current deterministic scene tests remain green, and the lab reproduces the
combined motion scenarios with one render object per card.

### 4. Browser evidence and recovery

- Keep CSS as an explicit prototype/test adapter, never as evidence of true 3D.
- Add feature detection, context-loss handling, asset recovery, and disposal checks.
  Context-loss status propagation and mounted-card texture refresh are implemented;
  browser recovery evidence is still required.
- Run Chromium, Firefox, and WebKit smoke scenarios at touch and desktop sizes.
- Benchmark 1, 6, 50, and 200 cards with one-card and cohort animation.

CSS fallback implementation is deferred to [issue #16](https://github.com/kort3x/cardinal/issues/16)
and is not part of the WebGL delivery sequence.

Gate: record missed frames, input latency, texture memory, context recovery, and
landing error against agreed reference hardware. Set the supported envelope from
measurements rather than promising unlimited cards.

## Project changes

- Add the renderer dependency and browser test tooling only with the implementation
  slice; do not add a dependency to the scene model package speculatively.
- Add `packages/card-engine/src/renderers/` for the adapter and geometry modules.
- Keep `scene.js`, `model.js`, `layout.js`, and `motion.js` independent of Three.js.
- Extend the lab with renderer mode/capability status, camera/depth controls,
  scale presets, X/Y flip controls, and a texture-quality comparison route.
- Keep CSS fallback implementation paused until [issue #16](https://github.com/kort3x/cardinal/issues/16) is scheduled.

## Explicit non-goals

- No Picko integration, business rules, voting state, or legacy engine changes.
- No general 3D physics, arbitrary tilted zone planes, or card collision simulation.
- No WebGPU migration until browser evidence makes it necessary.
- No custom shader/effect system before geometry, text quality, and disposal are
  stable.
