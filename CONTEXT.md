# Cardinal

Cardinal is a standalone browser card engine. It owns reusable card presentation,
layout, motion, and interaction mechanics; consuming projects own business rules,
permissions, persistence, and networking.

## Card model

**Card**:
A stable visual object with an identity, named content faces, a concealed face,
presentation, and a current pose.

**Face**:
A card presentation state: a named content face or the concealed face. Face
selection is independent from application-level meaning.

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
An identified area that owns card membership, ordering, and arrangement policy.

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
