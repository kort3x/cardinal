# Cardinal

Cardinal is a standalone browser card engine. It owns reusable card presentation,
layout, motion, and interaction mechanics; consuming projects own business rules,
permissions, persistence, and networking.

## Card model

**Card**:
A stable visual object with an identity, named content faces, a concealed face,
presentation, and a current pose. An optional weight describes how strongly it
resists target motion; it affects settling animation time while leaving zone
membership and depth ownership to the zone.

**Face**:
A card presentation state: a named content face or the concealed face. Face
selection is independent from application-level meaning. Which large face is
presented is determined by the card's logical face state and orientation, never
by the camera's position relative to the card.

**Element**:
An independently identified piece of a card face's presentation, such as text,
image, metadata, badge, control, stamp, counter, sticker, or project-defined
content. A face may contain zero, one, or many elements, including multiple
elements of the same type; title, image, and flavour are only example elements.
Elements may participate in layout or appear as overlays, and their presence and
visibility are separate concerns.

**Logical face cycle**:
An optional ordered sequence of named content faces; without one, a card has a
single logical front face. An orientation-changing
flip advances the sequence when the card returns to its physical front, while
the physical back remains one shared presentation; for example,
`A → back → B → back → C`.

**Pose**:
The card's position, depth, orientation, scale, pivot, and flip orientation at a
particular instant.

**Scene**:
The authoritative collection of cards and zones together with their current visual
realization.

**Zone**:
An identified area that owns card membership, ordering, arrangement policy, and
optional automatic sort policy.
Its ordered membership resolves each card's local depth layer and draw order;
cards do not choose their own stacking depth.

**Arrangement**:
The policy that resolves the positions, orientations, and local depth of cards
inside a zone. Supported forms include grids, aligned rows and columns, splay,
piles, stacks, and held hands. Splay keeps cards on a line while rotating them
across a spread; hand follows a shared grip arc.

## Visual model

**Camera**:
The shared view that maps scene geometry into the displayed stage.

**Card geometry**:
The physical form of a card, including its two face surfaces, side surfaces,
thickness, and outline profile.

**Shape profile**:
The reusable 2D outline that defines a card's face silhouette before it is
extruded into three-dimensional card geometry.

**Renderer adapter**:
A presentation implementation that realizes the scene through the renderer seam
without changing the scene's public interface or ownership rules.

**Inspection**:
A temporary readable presentation of a card that does not become a second logical
card or alter the card's committed state.
