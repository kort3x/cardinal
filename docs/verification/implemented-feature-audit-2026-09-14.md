# Implemented feature audit — 2026-09-14

This audit covers behavior implemented in Cardinal that is broader than issue
#2's slice-01 acceptance list. It distinguishes deterministic engine coverage
from a real WebGL lab run.

## Core engine coverage

The command `npm --prefix packages/card-engine test` passes all 72 tests.

| Area | Covered behavior |
| --- | --- |
| Element lifecycle | Repeated element types, targeted update/hide/show/reorder/add/remove, and elements on the physical back |
| Element layout | Auto-height reflow, fixed-size cards, preserved hidden space, stable bottom anchoring, and staged additions during shell growth |
| Card sizing | Width/height resize, interrupted resize retargeting, intrinsic image aspect ratio, and stable text line breaks while scaling |
| Physical card | First-class animated thickness, rounded extrusion/bevel, thin-card face clearance, shield profile, face materials, and visible intermediate edges |
| Depth | Thickness-aware separation, deterministic zone draw order, orthographic depth behavior, and overlap resolution after cards move between zones |
| Logical faces | One logical face by default, optional face cycles sharing one physical back, delayed face-cycle commit, interruption safety, and continuous-spin advancement |
| Combined motion | One transaction composing move, rotation, scale, and flip, independent-channel interruption, simultaneous X/Y flips, reduced motion, and safe destroy |

## Lab control run

The lab was exercised in Chrome 152.0.7977.83, Firefox 155.0.1, and Safari
26.6.2 with the Three.js WebGL renderer and orthographic projection. The
current-tree refresh used the real DOM controls and waited for each changed
element/content operation to settle.

Observed successful paths:

- Hide and restore the image. The rendered accessibility text removed and
  restored the image description, and the content-sized shell changed from
  `257` to `127` and back to `257` pixels high.
- Remove the middle flavour element. The shell shortened from `257` to `187`
  pixels without replacing the card shell.
- Add a custom text element, edit its content, reorder it, switch it to overlay
  layout, apply preserve-space policy, hide it, and remove it.
- Add two additional image instances. Both remained independently identified
  and rendered in the element list.
- Add a second card, select all cards, center the selection, change thickness
  for the selection, switch to the shield shape, and set three logical faces.
  The two cards retained separate depth values (`0.0` and `19.0`) after the
  thickness change.
- Remove all selected cards. The lab returned to an empty scene with zero
  shells and zero selected cards.
- Remove flavour during an active move. The card settled at the new position
  with the shortened shell.
- Add an element during an active flip. The card settled on the new physical
  side with the element present and one persistent shell.

The full current-tree matrix passed in Chrome (56 checks across the checked-in
scenarios). The current-tree acceptance flow passed 18/18 in Firefox and 18/18
in Safari, including movement, rotation, scale, face changes, simultaneous
flips, edge-on pose, combined motion, reduced motion, context loss/recovery,
and scene disposal/recreation. The focused element/content regression checks also
passed in both browsers. Chrome and the prior Firefox evidence verified that
adding one element to a two-card selection creates the element on both card
shells. The Chrome `elements` scenario is checked into the repository; the
Firefox and Safari passes remain additional external browser evidence.

## Remaining gaps

- The checked-in Chrome scenario and `test:cross-browser` now cover the
  current-tree functional matrix; screenshot quality and performance envelopes
  remain visual/release-review evidence rather than automated pixel assertions.
- Visual screenshot review of every added/reordered element during oblique
  motion remains manual; the DOM/accessibility checks above do not prove pixel
  quality.
- The larger future attachment scope in issue #8—registered stamps, counters,
  stickers, focused interactive controls, delayed asset races, and zone-level
  visibility—is not represented by the current lab and should not be described
  as implemented by this audit.
