# MTG Arena-like drag motion research

**Date:** 2026-09-17  
**Scope:** First-party Wizards of the Coast and MTG Arena support material, checked for documented interaction semantics and motion guidance.

## Result

Arena documents what a drag means and where it can go, but it does not document the underlying drag physics. I found no official values for lift scale, pointer lag, spring response, damping, tilt, twist, overshoot, landing time, or frame interpolation. The exact “Arena feel” therefore has to be treated as an implementation target to validate by observation, not as a recoverable specification.

## Documented behavior

- On mobile, Arena uses a hold-to-select gesture followed by dragging a card over the battlefield to cast it; the same article describes dragging cards from hand to the library during mulligan and dragging from a creature to another creature when declaring blockers. ([Wizards, *State of the Game – January 2021*](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-january-2021-01-21))
- The same source describes cards in hand fanning out when tapped, hold-to-inspect behavior, automatic hand tuck/untuck, and an explicit choice to tuck or expand the hand. Wizards says the goal was for this to feel “relatively natural,” but gives no timing or motion constants. ([Wizards, *State of the Game – January 2021*](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-january-2021-01-21))
- Wizards presents mobile as the full Magic experience with UX/UI changes for smaller screens and touch controls, while keeping the experience available across PC, Mac, and mobile. That supports one semantic drag interaction with platform-specific input adapters rather than separate card behaviors. ([Wizards, *MTG Arena on Mobile FAQs*](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-mobile-faqs-2021-01-28))
- Dragging is destination-sensitive and reversible in current Arena workflows. The March 2026 Pick-Two Draft update allows a card to be dragged directly into any mainboard column or the sideboard; the selected card leaves the pack and an undo control replaces it in the grid. ([Wizards, *MTG Arena Announcements – March 2, 2026*](https://magic.wizards.com/en/news/mtg-arena/announcements-march-2-2026); [Wizards support, *Patch Notes – 2026.57.0*](https://mtgarena-support.wizards.com/hc/en-us/articles/46578447874196-Patch-Notes-2026-57-0))
- Wizards’ client-design account emphasizes established targeting paradigms and a “clear and consistent visual presentation” for fast, fun digital play. In the same account, playtesting changed examined-card orientation to be contextual because an inappropriate orientation was distracting and harmed clarity. This is evidence for restrained motion and context-aware presentation, not evidence of a particular physics model. ([Wizards, *We Put Battles on MTG Arena: What Was That Like?*](https://magic.wizards.com/en/news/mtg-arena/we-put-battles-on-mtg-arena-what-was-that-like))
- Official material documents hold, tap, hover, right-click, drag, full-control, and undo paths, but I found no first-party specification for keyboard drag equivalents, screen-reader announcements, reduced-motion behavior, or accessible drag alternatives. ([Wizards, *State of the Game – January 2021*](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-january-2021-01-21); [Wizards, *MTG Arena on Mobile FAQs*](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-mobile-faqs-2021-01-28); [Wizards, *State of the Game – Adventures in the Forgotten Realms*](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-adventures-forgotten-realms-2021-07-02))

## Findings for Cardinal

The documented interaction suggests four perceptual requirements. Pickup should be easy to understand and should stay attached to the user’s grab point. While carrying, the card should follow the pointer directly enough for a player to trust the target. Zones and insertion destinations should provide the main feedback; motion should support that feedback rather than compete with it. Release should resolve quickly and offer a clear reversible path when the action is wrong.

Those requirements are inferences from the documented gestures, destination behavior, and presentation guidance. They do not establish that Arena uses a spring, a particular interpolation curve, a card-mass model, or any specific tilt effect. Cardinal’s existing spring and drag fields are an appropriate tuning surface, but their values remain Cardinal choices.

## Recommended `Wizzard` preset

Use `Wizzard` as the display name and `wizzard` as the identifier, matching Cardinal’s existing lower-case preset convention. This is a restrained, responsive Arena-like profile informed by the supplied recording. Every number below is an engineering recommendation, not an extracted Arena measurement.

```js
{
  preset: "wizzard",
  liftScale: 1.0,
  liftTime: 80,
  liftDepth: 40,
  liftDepthTime: 80,
  responseTime: 80,
  damping: 0.55,
  dangle: 1.75,
  maxTilt: 28,
  maxTwist: 18,
  grabPivotTilt: 2,
  maxGrabTilt: 25,
  grabPivotResponse: 55,
  upright: 0.9,
  landingTime: 120,
  landingBounce: 0,
  landingDelay: 0,
  weightInfluence: 0.2,
}
```

### Follow-up from the supplied recording

The 33-second user-provided `mtg.mov` reference was inspected frame by frame.
The demonstrated card stays upright while being carried; the strongest cues
are a quick pickup from the hand, direct translation with readable card scale,
a camera-facing depth or zoom cue, a subtle rotation around the pointer, a bright selection treatment, and a quiet landing. No visible movement dangle,
Z twist, landing bounce, or theatrical overshoot was observed in the sampled
drag. The recording does not separate optical enlargement from camera-facing
depth, so Cardinal exposes both controls and this profile chooses 3D lift with
authored scale held at 1×. The pointer-relative twist is represented by the
separate grab-pivot controls; gravity-like edge hang remains a separate
calibration concern. The highlight itself is a separate presentation concern
and is not encoded in drag motion.

Recommendations:

1. Keep pointer translation direct and preserve the initial grab offset. Use the short lift only to communicate pickup; do not make lift or weight create visible pointer lag.
2. Use critical damping and small tilt/twist caps as the default. A card may acknowledge movement, but it should not swing past a legal target or obscure destination feedback.
3. Keep landing delay at zero and bounce very small. The documented undo and destination behavior make action clarity more valuable than theatrical settling.
4. Tune the profile with mouse, touch, and pen journeys over empty, occupied, and rejected destinations. Record pointer-to-grab error, candidate stability, landing error, missed frames, and cancellation/reversal clarity. Treat subjective “naturalness” as a hands-on acceptance criterion because Wizards supplies no public numeric motion target.
5. Pair the preset with non-motion interaction affordances: keyboard pickup/release, an announced destination and outcome, Escape cancellation, and a visible undo or rejection path. The Arena sources establish that multiple input and reversal paths matter; they do not define their accessibility implementation.

## Limitations

This note describes public product behavior and design rationale, not private client code or a controlled capture of Arena’s animation frames. Official sources are strongest on gesture semantics, target selection, inspection, and presentation clarity. They are silent on the numerical motion model, so matching Arena exactly cannot be claimed from this research. The `Wizzard` values should remain a Cardinal preset candidate until browser measurements and hands-on review show that they produce the intended feel across the supported input methods.

## Primary sources

- [MTG Arena: State of the Game – January 2021](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-january-2021-01-21)
- [MTG Arena on Mobile FAQs](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-mobile-faqs-2021-01-28)
- [MTG Arena: State of the Game – Adventures in the Forgotten Realms](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-adventures-forgotten-realms-2021-07-02)
- [We Put Battles on MTG Arena: What Was That Like?](https://magic.wizards.com/en/news/mtg-arena/we-put-battles-on-mtg-arena-what-was-that-like)
- [MTG Arena Announcements – March 2, 2026](https://magic.wizards.com/en/news/mtg-arena/announcements-march-2-2026)
- [Patch Notes – 2026.57.0](https://mtgarena-support.wizards.com/hc/en-us/articles/46578447874196-Patch-Notes-2026-57-0)
