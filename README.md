# Cardinal

A reusable browser card engine for spatial card layouts, composable motion, and
project-defined interaction rules.

Status: Slice 01 core prototype and true 3D WebGL renderer are implemented.
The browser runtime matrix and Chrome acceptance measurements are recorded;
Firefox/WebKit visual acceptance remains in progress.

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

Card geometry is implemented as a true beveled rounded cuboid behind the same
scene interface. WebGL is required by default. The CSS renderer remains available
only as an explicit prototype mode; its implementation is deferred to [issue #16](https://github.com/kort3x/cardinal/issues/16).

Cardinal owns visual state, layout, animation, and interaction mechanics. Consuming
projects own business rules, permissions, networking, and persistence. Picko is one
possible future consumer; no Picko integration is part of this project.

## Development approach

Implement fresh modules in `packages/card-engine/`, with independent examples in
`examples/card-engine-lab/` and `examples/card-engine-use/`. Do not import or wrap
the old Picko engine. Backward compatibility is not required. The first slice has
runnable tooling. Run deterministic engine tests with
`npm --prefix packages/card-engine test`.

See the [true 3D renderer plan](docs/plans/true-3d-renderer.md) and
[ADR 0001](docs/adr/0001-true-3d-card-renderer.md) for the renderer seam, mesh,
content-texture, and browser-evidence plan.

Repository documentation, comments, tests, issues, demo-facing labels, and
accessibility text use English. Localization may be added later by consumers.
