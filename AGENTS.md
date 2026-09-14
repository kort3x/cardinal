## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues; use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

This is a single-context repository. See `docs/agents/domain.md`.

## Chrome lab verification

Chrome is the dominant interactive browser for lab verification. When the user
says “show me in Chrome”, run the relevant scenario through
`npm run show:chrome -- --scenario <name>` and leave the visible Chrome window
open so the user can inspect it. For repeatable checks use
`npm run test:chrome`; this launches a temporary headless Chrome when no debug
session is already available. The current checked-in scenario is `elements`.
