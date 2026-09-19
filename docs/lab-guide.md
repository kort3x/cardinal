# Cardinal Card Lab guide

The Card Lab is an interactive workbench for trying Cardinal's card engine. It
lets you change card content, faces, dimensions, motion, zone rules, and drag
behavior while the scene is running. It is a demonstration and development
tool, so reloading the page resets the current fixture.

## Open the Lab

Use the [live Card Lab](https://kort3x.github.io/cardinal/) or run it locally:

```sh
npm install --prefix packages/card-engine
npm --prefix examples/card-engine-lab start
```

Then open <http://localhost:4173/>. The main Lab requires WebGL. The **Zones
lab** link in the header opens a smaller fixture for comparing zone layouts.

## The workspace

The stage is in the middle. Cards are rendered inside the Lake, River, and
Ocean zones. The controls are arranged around it:

- The top toolbar runs motion demonstrations for the selected cards.
- The left rail manages cards, selection, dragging, and zones.
- The right rail manages inspection, card shape and size, motion targets, and
  card elements.
- The status lines below the stage report the renderer, frame rate, pointer
  hit target, current pose, logical face, physical side, and animation state.

Most controls have a tooltip. Hover the label or button when a control's name
is abbreviated.

The **Tutorial** button opens a read-only, opt-in walkthrough. It highlights
the relevant control as you move with **Next** and **Back**. Close it or press
Escape to leave the walkthrough. You can start it again at any time, and it
does not change the fixture or the current selection.

## A first experiment

1. Click a card on the stage or select it in **Cards**. The selected card has a
   gold outline. Use **Select all** or **Deselect all** to change the whole
   selection.
2. Open **Move**, **Rotate**, or **Scale** on the right. Sliders update the
   selected cards; the preset buttons apply common values immediately.
3. Drag a card to another zone. The card previews its destination while it is
   carried and settles into the destination arrangement when released.
4. Change the River arrangement or its settings in **Zones**. Neighboring
   cards reflow while the moved card keeps its independent motion channels.
5. Turn on **Reduced motion** in the top toolbar to compare immediate state
   changes with animated transitions.

The toolbar's **Move**, **Rotate**, **Scale**, **Flip**, and **Spin** buttons
start or stop continuous demonstrations. **Demo** combines several channels,
**Random** moves cards repeatedly, and **Test** runs a longer retargeting
sequence. These actions operate on the current selection.

## Cards and selection

The **Cards** panel contains:

- **Add** creates a card in the zone chosen by **Spawn in**.
- **Remove** removes the selected cards.
- **Select all** and **Deselect all** change the current selection. **Select all**
  also uses the Lab override to include cards normally blocked by zone rules.
- The scrollable card list shows each entry's card title, zone, and depth.
  Cards blocked by zone rules are marked **Normally not pickable**. Selecting a
  card from this list is a Lab testing override, so it can select any card even
  when the zone would normally block it.

Click selects one card. Ctrl-click on Windows/Linux or Cmd-click on macOS
toggles a card. Shift-click selects a range within a zone. When **Cross-zone
selection** is off, one selection cannot contain cards from different zones.

The normal fixture contains one revealed card in Lake, one revealed card in
River, and a concealed draw stack in Ocean. The Ocean stack contains 48 cards;
only its top card is pickable. The card list labels entries as Card 1, Card 2,
and so on, and marks cards blocked by the zone policy as **Normally not pickable**.
The list can still select those cards so you can inspect or manipulate them in
the Lab; stage clicks and drags continue to follow the zone policy.

## Card model controls

These controls are in the right rail:

- **Shape** switches between the rounded rectangle and shield profiles.
- **Logical faces** chooses one to five named front faces. A card still has
  one physical back; cycling the front visits A, B, and so on, then returns to
  A.
- **Dimensions** controls sizing mode, width, height, thickness, and weight.
  **Auto height** measures visible flow elements. **Fixed size** keeps the
  configured width and height while content changes.
- **Scale** changes the selected cards' rendered size.
- **Move** sets scene coordinates and alignment speed.
- **Rotate** sets the in-plane angle.
- **Flip** controls X and Y flip angles and the flip axis. **Reveal** and
  **Conceal** set the physical side explicitly.

Weight affects the perceived response of motion. It does not change the card's
meaning or its zone permissions.

## Zones and arrangements

The **Zones** panel lists each zone and its card count. Use the arrangement
selector on a populated zone to compare:

- **Grid** places cards in rows and columns.
- **Row** and **Column** place cards along one axis.
- **Splay** spreads cards along a line with changing angles.
- **Pile** overlaps cards with a visible offset.
- **Stack** places cards in membership order with a stack offset.
- **Hand** fans cards around a shared grip arc.

Open **Arrangement & alignment** on a zone to tune the settings supported by that
arrangement. Depending on the type, these include gap, columns, alignment,
spread, radius, curve, depth, and overflow. Hand arrangements expose the
**Concave** or **Convex** curve choice. The spread is scaled to the number of
cards, so a small hand does not use the same wide fan as a large hand.

Zone controls also expose target scale, forced face side, alignment speeds,
order policy, concealed-card reorder policy, fixed slots, and overflow policy.
Use **Sent to** to move the selected cards to Lake, River, or Ocean; **Slot**
chooses the destination index.

Some zone rules intentionally deny actions. A concealed draw stack permits
only its top card to be picked. A forced face side changes a card's physical
presentation when it enters the zone. These are Lab fixtures for exercising
engine capabilities; a consuming application supplies its own game rules.

## Dragging and motion tuning

The **Drag** panel controls both input and the physical feel of a carried card.

- **Enable dragging** turns pointer dragging on or off.
- **Touch drag** enables touch pickup. **Touch selection** makes taps toggle
  selection instead of immediately acting as ordinary card input.
- **Carry** compacts a multi-card selection by default; choose **Preserve
  offsets** when the original spacing should remain visible.
- **Anchor** keeps the original grab point or places the card center under the
  pointer.
- **Deny card**, **Deny zone**, and **Response** exercise accepted, rejected,
  delayed, and manual drop outcomes.

The motion presets are starting points:

- **Crisp** responds quickly.
- **Wizzard** gives a more pronounced game-like carry response.
- **Natural** is the default balanced response.
- **Floaty** uses slower, softer motion.
- **Dramatic dangle** exaggerates tilt and landing movement for tuning.
- **Custom tuning** keeps the individual slider values.

The detailed controls adjust lift scale, 3D lift depth, response, damping,
dangliness, tilt, twist, grab-pivot tilt, upright return, landing time,
landing bounce, snap delay, and weight influence. Start with a preset, then
change one control at a time. Set **Dangly** or **Grab pivot** to zero to remove
that response. Set **Lift scale** to 1× and **3D lift** to 0 to remove pickup
size and depth changes.

**Set up batch** replaces the scene with a four-card fixture for multi-card
dragging. Its default workflow is to drag the selection to Ocean with the
response set to manual, then use **Reject** or **Accept**. **Flip selection
once** tests a coordinated face change without moving the cards.

The keyboard drag flow is available when a card has focus: press Space to pick
up, use Arrow keys to choose a slot, Tab to change zones, Enter or Space to
drop, and Escape to cancel. Press S to toggle the focused card's selection;
Shift-Arrow extends a range, Ctrl/Cmd-A selects in scope, and Escape clears the
selection when no drag is active.

## Inspection and faces

The **Inspection** panel provides a read-only **Preview** or an **In place**
view. Use **Inspect** for the primary selected card, **Close** to dismiss it,
and Escape to close an open inspection. **Inspect on hover** is off by default;
enable it when hovering should open a preview after the dwell delay. Focus a card
to preview it, press I for keyboard inspection, or hold a card on touch.

**Set up inspection** loads a two-card fixture with simplified zone content.
The **Content face** selector changes the active logical face, **Update text**
changes that face while an inspection is open, and **Conceal / reveal** tests
the physical side. Concealed cards show their sleeve and their front element
editor is disabled until the card is revealed. This prevents the Lab from
editing or exposing concealed front content accidentally.

## Elements and the reshape demo

Elements belong to the selected cards' active logical face. In **Elements**:

- Toggle an element's checkbox to hide or show it.
- Edit text and spacer height where fields are available.
- Choose **flow** or **overlay** layout. Flow elements contribute to auto
  height; overlay elements do not.
- Choose **reflow** to remove hidden flow space or **preserve-space** to keep
  the element's footprint while hiding its pixels.
- Use the up and down buttons to reorder flow elements.
- Add text, image, or adjustable white-space elements.
- Apply a background to the active face or the physical back, using a URL or a
  preset.

Click **Run reshape demo** with a revealed card selected. The Lab temporarily
places the card in a three-card row, hides its flavour, removes its image, adds
a custom field, and moves it while neighboring cards reflow. The demo reverses
those changes during travel, then restores the original card and zone fixture.
Use **Auto height** and **Fixed size** to compare content-driven shell changes
with a stable shell while the same element controls are used.

The element list is intentionally unavailable while the selected card is
concealed. Reveal the card before editing its front content.

## Benchmark

Open **Benchmark** below the stage:

- **Refresh report** collects browser, WebGL, viewport, renderer, scene, and
  image readiness information.
- **Run 1 / 5 / 10 / 50 / 100 / 200-card benchmark** compares setup, readiness,
  asset sources, and frame behavior at exact mounted card counts.
- **Record next drag** captures pointer-to-render timing for one drag.
- **Copy report** copies the report, or selects it for manual copying when
  clipboard access is unavailable.

The motion sample combines random movement, rotation and flipping of selected
cards with already loaded images. Each row now includes the initial action's
blocking time, time until the first observed animation callback, actual sample
duration, and renderer work during the sample. Texture creations, redraws and
upload submissions distinguish repeated content work from steady drawing;
the last render's draw calls and triangles describe its geometry workload.
`renderCpuMs` measures submission time on the CPU, not GPU completion. Texture
memory is an RGBA estimate excluding driver overhead and mipmaps. Image readiness
does not establish completed GPU uploads or explain initial page loading.
`sampleMs` is the first-to-last animation timestamp interval used for FPS;
`workWindowMs` covers the counters from action start through their capture,
including the initial transaction. Use that duration when deriving work rates.

Identical built-in faces share textures while at least one permitted surface
uses them. Concealing the last revealed copy releases its front texture. Unique
card content and custom element renderers can need more textures than this
benchmark's repeated card fixture.

The **Renderer** and **FPS** lines are useful first checks when a visual result
looks wrong. Share the benchmark report with a bug report when reporting a
browser-specific rendering or performance problem.

## Resetting the fixture

Reload the page to restore the default cards, zones, arrangements, controls,
and motion settings. Use the browser's normal reload rather than navigating
back to a previous Lab state; the Lab is intentionally session-local and does
not persist changes.

For the engine API and consumer integration examples, see the [Card Engine
README](../packages/card-engine/README.md). For browser verification workflows,
see the [browser testing guide](verification/browser-testing.md).


## Dynamic attachments

The right rail's **Attachments** panel is collapsed initially and its actions are enabled only when a card is selected. It demonstrates the consumer-facing attachment API with three project renderers:

- **Stamp travelling card** adds a `stamp` overlay and moves the selected card.
- **Add counter** adds a flow `counter`; its renderer-owned projected button supports pointer and keyboard input, and the Lab's `onAction` callback increments the value through an attachment transaction.
- **Add two stickers** adds two independently identified `sticker` overlays anchored to the card's `image` element.
- **Hide image anchor** exercises the default `missingAnchor: "hide"` behavior.
- **Remove sticker mid-flip** removes one sticker while the card changes face.
- **Restore scenario** reapplies the original desired snapshot captured before the demo.

The existing scene fixtures clear the attachment demo state when they replace the scene. Attachment rendering and controls are owned by the engine renderer; the Lab supplies registered type renderers and business meaning in [attachments.js](../examples/card-engine-lab/attachments.js).

Run the focused browser acceptance after the attachment engine is ready. Check that port 9469 is unused before starting it:

```sh
lsof -nP -iTCP:9469 -sTCP:LISTEN
CARDINAL_CHROME_PORT=9469 npm run test:chrome:attachments
```

The acceptance uses public scene operations for setup and CDP mouse/keyboard input for the projected counter control. It records browser environment data and writes the visible attachment screenshot to `/tmp/cardinal-attachments-visible.png`. Follow [docs/verification/browser-testing.md](verification/browser-testing.md) for browser setup and evidence requirements.
