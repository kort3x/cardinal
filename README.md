<div align="center">
  <img src="logo-github.png" alt="Cardinal Card Engine logo" width="220">

  <h1>Cardinal Card Engine</h1>

  <p>A reusable JavaScript library providing a browser card engine for spatial layouts, physical-feeling motion, and project-defined interaction.</p>

  <p>
    <a href="https://kort3x.github.io/cardinal/"><strong>Try the live Card Lab →</strong></a>
    · <a href="docs/lab-guide.md">Read the Lab guide</a>
    · <a href="docs/specs/cardinal.md">Read the design</a>
    · <a href="docs/slices/README.md">See the roadmap</a>
  </p>
</div>

Cardinal is an independent, browser-native JavaScript library. Its card engine
handles visual state, layout, rendering, motion, and interaction mechanics while
consuming projects keep control over their data and rules.

The [live Card Lab](https://kort3x.github.io/cardinal/) is the fastest way to see
it in action. Try moving, rotating, scaling, flipping, resizing, and dragging
cards through responsive zones. The lab also exposes dynamic card elements,
multiple logical faces, 3D depth, motion controls, and performance diagnostics.

> Cardinal is experimental and actively evolving. The public lab is a demo and
> test surface, not a production application.

## Why try Cardinal?

- **True 3D cards** — WebGL rounded cuboids with front, back, edge, thickness,
  depth, and smooth orientation changes.
- **Composable motion** — move, rotate, scale, and flip together without one
  animation channel cancelling another.
- **Dynamic card content** — explicit elements support text, images, repeated
  types, visibility, ordering, custom renderers, and content-sized cards.
- **Responsive zones** — ordered membership, grid placement, spatial geometry,
  responsive anchors, and animated reflow.
- **Project-owned rules** — consuming applications decide permissions,
  persistence, networking, and business logic; Cardinal provides the interaction
  mechanics and intent seam.
- **Built to inspect** — a standalone lab, deterministic engine tests, browser
  acceptance scenarios, FPS reporting, and diagnostics make behavior visible.

## Start here

| Resource | Purpose |
| --- | --- |
| [Live Card Lab](https://kort3x.github.io/cardinal/) | Explore the card engine in your browser |
| [Card Lab guide](docs/lab-guide.md) | Learn the controls, zones, arrangements, and motion fixtures |
| [Engine design](docs/specs/cardinal.md) | Read the authoritative model and API decisions |
| [Delivery roadmap](docs/slices/README.md) | Follow the vertical slices and next capabilities |
| [Browser testing guide](docs/verification/browser-testing.md) | Run and extend Chrome, Firefox, and Safari checks |
| [Kanban project](https://github.com/users/kort3x/projects/3) | See current work |

The lab requires a browser with WebGL enabled. Cardinal intentionally does not
silently substitute the deferred CSS prototype when WebGL is unavailable.

## Run locally

```sh
npm install --prefix packages/card-engine
npm --prefix examples/card-engine-lab start
```

Open <http://localhost:4173/>. The lab is served as a standalone example and
imports the engine directly from `packages/card-engine/`.

## Run the tests

```sh
npm test
npm run test:chrome:acceptance
npm run test:chrome:layout
```

See the [browser testing guide](docs/verification/browser-testing.md) for the
full workflow, interactive Chrome checks, cross-browser acceptance, and
performance scenarios.

## Scope and architecture

Cards are authored as complete snapshots and changed through explicit scene
transactions. Cardinal owns the current visual realization, card geometry,
animation channels, zone layout, and pointer/keyboard interaction mechanics.
Consuming projects own card meaning, authorization, persistence, networking,
and application-specific rules.

The library is developed in `packages/card-engine/`. Runnable examples live in
`examples/card-engine-lab/` and `examples/card-engine-use/`. The project does
not import or wrap the old Picko engine, and backward compatibility is not a
goal.

## Current status

The true 3D WebGL renderer, dynamic elements, responsive zones, interaction
intent flow, and public Card Lab are implemented. Work continues through the
[vertical slice roadmap](docs/slices/README.md), with browser evidence recorded
alongside the implementation.

CSS fallback is deferred to [issue #16](https://github.com/kort3x/cardinal/issues/16).
Picko integration, voting rules, community collections, and legacy cleanup are
outside this project.

## License

Cardinal's software and documentation are licensed under the
[Apache License 2.0](LICENSE). This permissive license allows commercial use,
modification, and redistribution, and includes an explicit contributor patent
grant.

Visual assets are separate from the software license. Check
[ASSET-LICENSE.md](ASSET-LICENSE.md) and the individual asset notes before
redistributing the lab artwork or logos.
