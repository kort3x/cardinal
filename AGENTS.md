## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues; use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

This is a single-context repository. See `docs/agents/domain.md`.

## Browser testing

Before running, extending, diagnosing or reporting Chrome, Firefox or Safari
tests, read the [browser testing runbook](docs/verification/browser-testing.md).
It owns command selection, setup, window preservation, Safari interference,
input helpers and evidence requirements. For “show me in Chrome”, it also owns
the required visible window size/position contract. “Show me in Chrome” means
a visible demonstration left open for inspection, not a headless substitute.
