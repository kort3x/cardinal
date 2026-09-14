---
status: proposed
---

# Use a true 3D renderer for card geometry

Cardinal will keep scene state, layout, and motion behind the existing scene
interface, and use a Three.js-backed WebGL renderer adapter as the default
implementation for card presentation. Cards will use a closed beveled rounded-box
mesh with real thickness and two content surfaces; the existing CSS renderer is an
explicit prototype/testing mode only, not an automatic fallback. This concentrates
WebGL complexity behind one seam while preserving callers, deterministic motion
tests, and a path for crisp high-resolution content textures. A renderer spike and
browser evidence must validate geometry, text quality, accessibility, and
performance before the adapter is considered complete.

## Considered options

- Continue with CSS 3D: rejected because the browser DOM cannot provide a clean,
  continuously curved volumetric card surface without visible approximation seams.
- Use a custom WebGL renderer immediately: deferred because camera, texture,
  material, lifecycle, and hit-test infrastructure would become Cardinal-owned
  maintenance before the geometry question is answered.
- Use a Three.js adapter: selected for the first true-3D implementation because
  it keeps mesh/camera/material complexity behind the renderer seam and can be
  replaced without changing the scene interface.
