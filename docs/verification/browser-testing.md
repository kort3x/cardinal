# Browser testing runbook

This is the repository-owned workflow for running, extending, diagnosing and
reporting Cardinal browser tests. It applies to all agents; no locally installed
skill is required. Run commands from the repository root.

## Choose a run

| Request | Command | What runs |
| --- | --- | --- |
| Fast engine gate | `npm test` | Deterministic engine tests, not browser verification |
| Chrome element regressions | `npm run test:chrome` | The `elements` scenario only |
| Chrome drag verification | `npm run test:chrome:drag` | Real mouse, keyboard and emulated touch input |
| Chrome drag geometry | `npm run test:chrome:drag-geometry` | Mesh picking, overlap precedence and perspective drag fixtures |
| Chrome drag timing | `npm run test:chrome:drag-performance` | Isolated rest/motion/drag samples with 1, 10 and 50 cards |
| Show the user a Chrome scenario | `npm run show:chrome -- --scenario drag` | Visible Chrome; substitute the relevant scenario below |
| Safari only | `npm run test:cross-browser -- safari` | Safari acceptance, including interaction checks |
| Firefox only | `npm run test:cross-browser -- firefox` | Firefox acceptance, including interaction checks |
| Both additional browsers | `npm run test:cross-browser` | Firefox, then Safari; excludes Chrome and stops on failure |

`npm run` lists the available npm scripts. The two browser runners do not provide
a help/list mode: use this guide rather than executing them with guessed flags.
Existing scenarios can be rerun directly; reading protocol implementation code
is necessary only when extending or diagnosing them.

### Choose relevant Chrome coverage

| Changed behavior | Scenario names |
| --- | --- |
| Elements, backgrounds, content resize | `elements` |
| Rails, controls, full-window layout | `layout` |
| Camera/stage resizing and movement bounds | `resize`, `movement` |
| Composed motion, flipping, scale, reduced motion | `acceptance` |
| Continuous Move/Rotate/Scale/Flip demo toggles | `demo-toggles` |
| Random movement and spin toggle state | `random`, `spin-state` |
| Responsive zone geometry / integrated lab zone controls | `zones` / `main-zones` |
| Dragging, rules, pending approval, input cancellation | `drag` |
| Drag projection, shape hit regions and overlap precedence | `drag-geometry` |
| Single-card dragging with increasing mounted population | `drag-performance` |
| Mobile responsive defaults for card scale and touch drag | `mobile-scale` |
| Cohort rendering / random-motion performance / report collection | `performance` / `random-performance` / `diagnostics` |

For any listed scenario, use
`node scripts/chrome-lab.mjs --headless --scenario <name>` for a repeatable run,
or the `show:chrome` command for a visible demonstration. `zones` uses the separate
zones lab; the other scenarios use the main lab. `package.json` and runner
assertions are the source of truth for supported names and exact coverage.

Select the changed feature's scenario plus relevant regressions; `test:chrome`
does not run all Chrome scenarios. Cross-browser acceptance is its own suite,
not a promise that every Chrome scenario has Firefox/Safari parity.

Run `drag-performance` after other browser work has finished. Its local browser
timings are measurements, not a supported-device guarantee; report the actual
fixture, sample size and environment, and distinguish frame/handler timing from
end-to-end display latency. The Surface and physical touch devices require their
own measurements.

## Prepare and protect the session

1. Confirm Node 22+ (`node --version`) and dependencies. On a fresh checkout,
   run `npm --prefix packages/card-engine ci`; the engine owns the dependency
   lockfile. Both runners use Node's built-in WebSocket/fetch APIs.
2. Check the requested browser is installed. Chrome supports `CHROME_BIN`; its
   default macOS path is `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
   The current cross-browser runner is macOS-specific: Firefox is expected at
   `/Applications/Firefox.app/Contents/MacOS/firefox` and SafariDriver at
   `/System/Cryptexes/App/usr/bin/safaridriver`. An absent executable is a setup
   failure, not a failed engine assertion.
3. Safari requires Remote Automation enabled. If session creation reports that
   setup is missing, ask the user to enable it. Apple's installed
   `man safaridriver` documents `/usr/bin/safaridriver --enable`, which changes
   configuration and may require user authentication. Do not change machine
   permissions just to rerun a test. Follow the Safari protocol below.
4. Runners start the lab at port 4173 if unavailable and reuse it if running.
   `CARDINAL_LAB_URL` overrides the URL for either runner; it must point to a
   reachable compatible lab. To keep the lab running independently, use
   `npm --prefix examples/card-engine-lab start` in a separate terminal.
5. Reserve the browser session before parallel work. Chrome's debug port defaults
   to 9222 and may belong to the user's visible browser. Use a separate unused
   port for isolated checks, for example
   `CARDINAL_CHROME_PORT=9333 npm run test:chrome:drag`.
   Check ownership with `lsof -nP -iTCP:9333 -sTCP:LISTEN` on macOS; no output means
   no listener was found. Never navigate the same debug session from two workers.
   Firefox and Safari use fixed ports 9231 and 9523 respectively: serialize runs
   of each browser. Serialize performance measurements against other browser work.

### Window and viewport contract

- Preserve the user's existing Chrome window position and dimensions. A reused
  debug browser uses its actual viewport, even with `--headless`; a newly launched
  headless Chrome uses a 2515×1322 page viewport (DPR 1 by default).
- Firefox runs headlessly with a 2500×1300 page viewport and DPR 1.
- Safari requests a 2500×1300 outer window at (100, 0), keeping clear of the
  left-side Dock. macOS may constrain placement. Measure actual values; an outer
  window is not a page viewport.
- Stage-resize scenarios may temporarily resize the stage, not the browser window.
  Restore stage/scroll overrides before handing back a visible demonstration.
- Record `innerWidth`, `innerHeight`, `outerWidth`, `outerHeight`, `screenX`,
  `screenY`, `devicePixelRatio`, and stage bounds when relevant. The drag and
  cross-browser runners emit environment measurements; for other scenarios,
  collect missing measurements through the connected browser before making
  size-dependent claims. Never infer the actual viewport from requested settings.

## Run and hand off

1. Announce which browser/scenario is running. Execute its existing command;
   let the process finish and inspect both assertions and exit status. A timeout,
   skipped case or missing result is not a pass.
2. After implementation changes, run `npm test` and the relevant browser scenarios.
   For documentation-only changes, validate commands, references and skill
   metadata; browser reruns are not required unless executable behavior changed.
3. For `show:chrome`, preserve a visible browser and leave the requested scenario
   inspectable. Verify the debug endpoint remains reachable, for example
   `curl -fsS http://127.0.0.1:9222/json/list` (use the selected port).
   The runner reuses an existing debug browser; if that browser is headless,
   select an unused port to launch a visible session rather than claiming it is
   visible. Do not terminate an unrelated session to make room.
4. Cleanup belongs to the run: release input, restore temporary fixture overrides,
   and close only sessions/processes it created. Test runners normally terminate
   their temporary browsers and lab server; `show:chrome` keeps its launched
   browser/server alive. After an interrupted run, inspect ownership before
   cleaning up a leftover process.
5. Report using the evidence checklist below. A rerun request authorizes running
   tests, not changing engine code, closing issues or publishing results externally.

## Extend a test

Use the existing runner and public scene interface; engine mechanics stay in the
engine. Lab fixtures supply project rules and controls, not repairs for engine bugs.

1. Write the expected observable outcome first: committed membership, visual pose,
   eligibility, intent count, focus/capture state, shell identity or measured pixels.
   Distinguish setup operations from the user action under test.
2. Reuse the code-owned mechanics:
   - [Chrome runner](../../scripts/chrome-lab.mjs): server/browser lifecycle and CDP connection.
   - [Chrome drag scenario](../../scripts/chrome-drag-scenario.mjs): `evaluate`,
     `waitFor`, `focusCard`, mouse/key/touch sequences and case cleanup.
   - [Chrome runtime helper](../../scripts/chrome-runtime.mjs): shared
     `createPageEvaluator(command)` used by the drag, geometry and timing scenarios.
   - [Cross-browser runner](../../scripts/cross-browser-lab.mjs): shared
     `acceptance` journey and `createWebDriverActions` adapter for Firefox/Safari.
   Other scenario helpers remain scoped inside their modules. Extend them in
   place; when another module needs the same
   mechanic, extract that helper and its callers together rather than copying
   protocol code or inventing an import.
3. For input behavior, send actual CDP/WebDriver input. DOM `.click()` or direct
   `scene.drag()` calls may set up fixtures or test APIs, but cannot establish
   browser pointer capture, keyboard focus or touch behavior.
4. Use `.cardinal-webgl-card[data-card-id="…"]` for the accessible card shell;
   generic `[data-card-id]` also matches rail outputs. Escape dynamic IDs and
   assert focus actually moved. Project visual card poses with `sceneToClient`;
   use current camera/stage bounds rather than fixed screen coordinates.
5. Mouse pickup requires movement beyond the engine threshold after pointerdown.
   Keep button state consistent through moves and release it on failure. Touch
   drag must be enabled before contact. Reuse existing sequences for these details.
6. Wait for observable readiness and endpoints with bounded timeouts. Legacy
   scenarios still contain fixed delays; they are not the pattern for new tests.
   Continuous spinning is not a settling animation: assert membership and active
   spin separately rather than waiting for the whole scene to become motionless.
   CDP touch dispatch may complete before the page receives `pointermove`: wait
   for the recorded input event before measuring attachment. Measure rejected
   drops after return motion settles, against the current committed layout rather
   than the rejected candidate. Keep the one-CSS-pixel acceptance bound enforced.
7. Preserve failure diagnostics and clean up in `finally`. Assert return/landing
   state as well as intent, so a state-only pass cannot hide broken presentation.
   Run the new case and neighboring regression cases before reporting it complete.

## Diagnose a failure

Keep the layers separate:

| Evidence | First investigation |
| --- | --- |
| Missing browser/dependency, refused connection or session creation error | Setup, executable path, permissions, port ownership and lab reachability |
| No input event, wrong focus target or wrong screen point | Harness selectors, focus assertion, button sequence, threshold and current projection |
| Correct input reaches the card, but wrong intent/preview/membership follows | Engine input/session/rules/layout, through the public interface |
| State is correct but the card looks wrong | Renderer, screenshot and camera/material state |
| Expected state appears later than an assertion | Readiness/settling predicate and timing evidence; not an arbitrary longer sleep |

Capture the command, exit status, first failing assertion, event trace where
available, current scene/interaction snapshot and measured viewport. Confirm the
served code is current. Preserve failed runs alongside reruns. Diagnose before
changing code; test-only requests are not permission to implement a fix.

### Safari automation and user interference

This is a general risk for visible Safari automation, not a drag-test exception.
Manual input, focus changes, navigation or window movement can invalidate test
assumptions; a failed assertion alone does not establish an engine defect.

1. Tell the user before starting and ask them to leave the automation window
   untouched until completion. Keep other automation from competing for input focus.
2. Retain failures from reported or suspected interruptions and label them
   potentially interrupted. Distinguish observed interference from a hypothesis.
3. Rerun the affected scenario once in a fresh Safari session, without code
   changes or manual interaction. Record that run separately.
4. A passing rerun supports possible interference, not a proven cause. If an
   uninterrupted run fails too, investigate engine, harness and browser evidence.
   Avoid retrying until green or dismissing failures as user error.

The [2026-09-15 evidence](drag-interactions-2026-09-15.md) records one such case;
it does not establish the cause of every Safari failure.

## Report evidence

Include the command/scenario, actual browser/version (from the browser, not just
the runner's display label), measured viewport/DPR, pass/fail/skip counts and exit
status. For failures, include the first failed condition and any interruption.
For visible demonstrations, state what was left open and its final lab state.

State what the evidence proves: DOM/state assertions establish behavior, not
texture sharpness or smooth pixels. Inspect screenshots for visual claims and
collect frame timings for performance claims. Emulated touch is not a physical
device test. A passing suite is not closure of an issue with untested criteria.

When recording documentation or issue evidence is in scope, use dated files in
this directory and the issue tracker conventions. Keep historical run results
separate from this operational guide. The [manual WebGL matrix](webgl-browser-smoke.md#matrix)
covers visual checks beyond automated assertions.
