# Cardinal delivery

[Repository](https://github.com/kort3x/cardinal) · [Kanban](https://github.com/users/kort3x/projects/3) · [Specification #1](https://github.com/kort3x/cardinal/issues/1)

Start with [#2](https://github.com/kort3x/cardinal/issues/2), basic card actions.
Work moves through Backlog → Ready → In progress → Review → Done.
Native blockers define readiness; promotion is manual. The ready-for-agent label
indicates suitability, not cleared prerequisites. Issues are vertical slices:
each delivers working behavior through public commands, state, rendering, and a
runnable standalone example.

| Slice | Issue | Outcome | Blocked by |
| --- | --- | --- | --- |
| 01 | [#2](https://github.com/kort3x/cardinal/issues/2) | One card: move, rotate, scale, and flip in the new standalone lab | None |
| 02 | [#3](https://github.com/kort3x/cardinal/issues/3) | Move cards between responsive zones with stable grid placement | #2 |
| 03 | [#4](https://github.com/kort3x/cardinal/issues/4) | Drag a card across zones under project-defined rules | #3 |
| 04 | [#5](https://github.com/kort3x/cardinal/issues/5) | Select and drag several cards as one project-approved batch | #4 |
| 05 | [#6](https://github.com/kort3x/cardinal/issues/6) | Arrange cards as rows, fans, piles, and ordered stacks | #3 |
| 06 | [#7](https://github.com/kort3x/cardinal/issues/7) | Inspect cards and switch content faces without losing state | #4 |
| 07 | [#8](https://github.com/kort3x/cardinal/issues/8) | Add or hide card elements and animate the card's changing shape | #3 |
| 08 | [#9](https://github.com/kort3x/cardinal/issues/9) | Attach live stamps, counters, and stickers to cards | #8 |
| 09 | [#10](https://github.com/kort3x/cardinal/issues/10) | Attach cards to cards and drag the resulting set | #5, #6, #9 |
| 10 | [#11](https://github.com/kort3x/cardinal/issues/11) | Deal and remove cards with interruptible choreography | #3 |
| 11 | [#12](https://github.com/kort3x/cardinal/issues/12) | Choose card targets and show links and persistent groups | #5, #7 |
| 12 | [#13](https://github.com/kort3x/cardinal/issues/13) | Play synchronized card feedback without slowing interaction | #9, #11 |
| 13 | [#14](https://github.com/kort3x/cardinal/issues/14) | Apply reusable card skins and animated artwork with static fallback | #7, #13 |
| 14 | [#15](https://github.com/kort3x/cardinal/issues/15) | Run the engine in a second unrelated project and validate the full journey | #6, #7, #8, #10, #12, #14 |

Picko integration, voting rules, community collections, and legacy cleanup are
outside this project. Picko is one possible future consumer. Previously excluded
integration proposals remain closed in the Picko repository and are not Cardinal
work items. Original Picko issue URLs redirect to the transferred Cardinal issues.
