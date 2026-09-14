# Cardinal

A reusable browser card engine for spatial card layouts, composable motion, and
project-defined interaction rules.

Status: design and delivery planning. The engine and lab are not implemented yet.

## Start here

- [Design](docs/specs/cardinal.md)
- [Vertical slices](docs/slices/README.md)
- [Kanban project](https://github.com/users/kort3x/projects/3)
- [First slice: basic card actions](https://github.com/kort3x/cardinal/issues/2)

## Scope

Cards move, rotate, scale, and flip independently or simultaneously. Zones support
responsive geometry, multiple arrangements, and project-controlled presentation.
Cards can change shape as content changes, receive dynamic elements, attach to
other cards, and participate in multi-card selection and dragging.

Cardinal owns visual state, layout, animation, and interaction mechanics. Consuming
projects own business rules, permissions, networking, and persistence. Picko is one
possible future consumer; no Picko integration is part of this project.

## Development approach

Implement fresh modules in `packages/card-engine/`, with independent examples in
`examples/card-engine-lab/` and `examples/card-engine-use/`. Do not import or wrap
the old Picko engine. Backward compatibility is not required. The first slice will
establish runnable tooling; no build or test commands are claimed before then.

Repository documentation, comments, tests, and issues use English. Demo-facing
labels and accessibility text remain German until localization is requested;
consumers supply their own localized content.
