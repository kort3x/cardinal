# Consumer-owned zone policy audit — 2026-09-19

Issue #22 follows the correction that omitted concealed-card reorder policy must
remain free. This audit records the boundary between reusable engine mechanisms
and consumer-owned gameplay choices.

| Area | Engine default | Consumer opt-in |
| --- | --- | --- |
| Capacity | Unbounded when omitted | `capacity: number` |
| Membership order | Ordinary insertion and reordering | `orderPolicy: { mode: "locked", order }` |
| Destination slots | Ordinary insertion slots | `slotPolicy: { mode: "fixed", slots }` |
| Concealed reorder | Allowed when omitted | `reorderPolicy: { concealed: "deny" }` |
| Selection | Ordinary selection when omitted | `selectionPolicy: { mode: "forced", count, from: "top" }` |
| Face state | Each card keeps its own state when omitted | `faceUp: true` or `false` |
| Information access | Consumer authorization rules; no zone-name game rules | `canTake`, `canPut`, `canReveal`, `canConceal`, `canInspectConcealed` |
| Draw stack | No stack semantics when omitted | `preset: "drawStack"` |

`drawStack` is an optional convenience preset. It combines a zero-offset stack,
forced selection of the top card, and a concealed zone. Consumers can override
its arrangement, selection policy, and face policy explicitly. It does not add
capacity, locked order, or concealed-card reorder protection. The engine enforces
any configured policy and delegates information access to consumer callbacks; it
does not infer game rules from a zone ID, concealment, capacity, or arrangement
alone.

Focused coverage lives in `packages/card-engine/test/zones.test.js` and verifies
that omitted policies remain permissive, capacity is unbounded when omitted,
concealed cards can be reordered unless denied explicitly, explicit draw-stack
overrides win over preset values, and information access remains consumer-owned.
