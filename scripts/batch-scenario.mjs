const LAB_MODULE = "/examples/card-engine-lab/main.js";
const WAIT_MS = 5000;
const POLL_MS = 25;

const copy = (value) => structuredClone(value);

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function zoneCards(state, zoneId) {
  return state.snapshot?.desired?.zones?.find(({ id }) => id === zoneId)?.cardIds ?? [];
}

function lastSession(state) {
  return state.snapshot?.interaction?.sessions?.at(-1) ?? null;
}

function allZones(state) {
  return state.snapshot?.desired?.zones?.map(({ id, cardIds }) => ({ id, cardIds: [...cardIds] })) ?? [];
}

function compactDiagnostics(state) {
  return {
    environment: state?.environment,
    renderer: state?.renderer,
    status: state?.status,
    interactionStatus: state?.interactionStatus,
    selection: state?.snapshot?.selection,
    interaction: state?.snapshot?.interaction,
    scroll: state?.scroll,
    fullWindow: state?.fullWindow,
    zones: allZones(state),
    shells: state?.shells,
    probe: state?.probe,
    controls: state?.controls,
  };
}

function expectedOrder(cardIds, cohort, index) {
  const remaining = cardIds.filter((id) => !cohort.includes(id));
  remaining.splice(Math.min(index ?? remaining.length, remaining.length), 0, ...cohort);
  return remaining;
}

function noDuplicateMembership(state, cardIds) {
  return cardIds.every((cardId) => allZones(state).filter(({ cardIds: ids }) => ids.includes(cardId)).length === 1);
}

function shellIdentity(state, cardIds) {
  return cardIds.every((cardId) => state.shells.includes(cardId))
    && state.shells.length === state.snapshot?.desired?.cards?.length;
}

export async function runBatchAcceptance({
  evaluate,
  navigate,
  pointer,
  keyboard,
  touch,
  pen,
  label = "batch acceptance",
  labUrl,
} = {}) {
  if (typeof evaluate !== "function") throw new TypeError("Batch acceptance requires evaluate");
  if (!pointer || typeof pointer.drag !== "function" || typeof pointer.click !== "function") {
    throw new TypeError("Batch acceptance requires pointer click and drag helpers");
  }
  if (!keyboard || typeof keyboard.press !== "function") throw new TypeError("Batch acceptance requires keyboard helpers");
  if (!touch || typeof touch.drag !== "function" || typeof touch.tap !== "function") {
    throw new TypeError("Batch acceptance requires touch helpers");
  }

  async function state() {
    return evaluate(String.raw`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      const snapshot = scene?.snapshot?.() ?? null;
      const probe = window.__cardinalBatchProbe ?? { drops: [], changes: [], inputEvents: [] };
      const active = document.activeElement;
      return {
        environment: {
          innerWidth, innerHeight, outerWidth, outerHeight, screenX, screenY,
          devicePixelRatio, userAgent: navigator.userAgent,
          stage: (() => {
            const rect = document.querySelector("#stage")?.getBoundingClientRect();
            return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
          })(),
        },
        renderer: document.querySelector("#renderer-status")?.textContent ?? "",
        status: document.querySelector("#status")?.textContent ?? "",
        interactionStatus: document.querySelector("#interaction-status")?.textContent ?? "",
        selectionStatus: document.querySelector("#selection-status")?.textContent ?? "",
        snapshot,
        shells: [...document.querySelectorAll("#stage .cardinal-webgl-card")].map(({ dataset }) => dataset.cardId),
        focus: { cardId: active?.dataset?.cardId ?? null, isCardShell: Boolean(active?.matches?.(".cardinal-webgl-card[data-card-id]")) },
        scroll: {
          ancestor: (() => {
            const node = document.querySelector(".scene-column");
            return node ? {
              top: node.scrollTop,
              left: node.scrollLeft,
              height: node.clientHeight,
              scrollHeight: node.scrollHeight,
            } : null;
          })(),
          page: { x: scrollX, y: scrollY },
        },
        fullWindow: document.body.classList.contains("stage-full-window"),
        probe: {
          drops: structuredClone(probe.drops ?? []),
          changes: structuredClone(probe.changes ?? []),
          inputEvents: structuredClone(probe.inputEvents ?? []),
        },
        controls: {
          deniedCard: document.querySelector("#drag-denied-card")?.value ?? "",
          deniedZone: document.querySelector("#drag-denied-zone")?.value ?? "",
          response: document.querySelector("#drag-response")?.value ?? "",
          touchDrag: document.querySelector("#drag-touch")?.checked ?? false,
          touchSelection: document.querySelector("#touch-selection")?.checked ?? false,
        },
      };
    })()`);
  }

  async function waitFor(description, predicate, timeout = WAIT_MS) {
    const started = Date.now();
    let current;
    while (Date.now() - started < timeout) {
      current = await state();
      try {
        if (predicate(current)) return current;
      } catch {
        // The page can be between scene recreation and renderer realization.
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    current ??= await state();
    throw new Error(`${description} timed out: ${JSON.stringify(compactDiagnostics(current))}`);
  }

  async function page(expression) {
    return evaluate(`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      if (!scene) throw new Error("Cardinal lab scene is unavailable");
      return (${expression})(scene);
    })()`);
  }

  async function control(selector, value) {
    return evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error("Missing control " + ${JSON.stringify(selector)});
      if (element instanceof HTMLInputElement && element.type === "checkbox") element.checked = Boolean(${JSON.stringify(value)});
      else {
        const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, String(${JSON.stringify(value)}));
      }
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
  }

  async function button(selector) {
    return evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.disabled || element.hidden) throw new Error("Control is unavailable: ${selector}");
      element.click();
      return true;
    })()`);
  }

  async function cardPoint(cardId) {
    return evaluate(`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      const visual = scene.snapshot().visual.find(({ cardId: id }) => id === ${JSON.stringify(cardId)});
      if (!visual?.pose) throw new Error("Missing visual pose for ${cardId}");
      return scene.sceneToClient(visual.pose);
    })()`);
  }

  async function zonePoint(zoneId) {
    return evaluate(`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      const zone = scene.snapshot().zones.find(({ id }) => id === ${JSON.stringify(zoneId)});
      if (!zone?.geometry) throw new Error("Missing geometry for ${zoneId}");
      return scene.sceneToClient({ x: zone.geometry.x + zone.geometry.width / 2, y: zone.geometry.y + zone.geometry.height / 2, z: zone.geometry.depth ?? 0 });
    })()`);
  }

  async function focusCard(cardId) {
    return evaluate(`(() => {
      const shell = document.querySelector(".cardinal-webgl-card[data-card-id=" + ${JSON.stringify(JSON.stringify(cardId))} + "]");
      if (!shell) throw new Error("Missing card shell for ${cardId}");
      shell.focus();
      return document.activeElement === shell;
    })()`);
  }

  async function fixture({ response = "manual", touchSelection = false, touchDrag = false, presentation = "preserve" } = {}) {
    await evaluate(`(() => {
      document.body.classList.remove("stage-full-window");
      document.documentElement.classList.remove("stage-full-window");
      document.querySelector("#full-window-control")?.setAttribute("aria-pressed", "false");
      document.querySelector("#full-window-control")?.replaceChildren(document.createTextNode("Full window"));
      for (const selector of [".scene-column", "#stage", "body", "html"]) {
        const element = document.querySelector(selector) ?? (selector === "body" ? document.body : selector === "html" ? document.documentElement : null);
        if (!element) continue;
        for (const property of ["height", "width", "maxHeight", "maxWidth", "overflow", "overflowX", "overflowY", "minHeight"]) {
          element.style.removeProperty(property);
        }
      }
      document.querySelector(".scene-column")?.scrollTo?.(0, 0);
      window.scrollTo(0, 0);
      return true;
    })()`);
    await control("#drag-presentation", presentation);
    await control("#drag-response", response).catch(() => {});
    if (touchSelection) await control("#touch-selection", true);
    if (touchDrag) await control("#drag-touch", true);
    await button("#batch-fixture");
    // The fixture intentionally defaults to manual approval. Override it after
    // setup for cases whose acceptance endpoint is immediate.
    if (response !== "manual") await control("#drag-response", response);
    await waitFor("batch fixture", (current) => current.snapshot?.renderer === "webgl"
      && current.snapshot.desired.cards.length === 4
      && current.snapshot.selection.cardIds.length === 2
      && !current.snapshot.settling);
    await page(`(scene) => {
      const old = window.__cardinalBatchProbe;
      old?.unsubscribe?.();
      const probe = { drops: [], changes: [], inputEvents: [] };
      const cap = (items, value) => { items.push(structuredClone(value)); if (items.length > 500) items.shift(); };
      const offDrop = scene.on("drop", (intent) => cap(probe.drops, intent));
      const offChange = scene.on("interaction-change", (detail) => cap(probe.changes, detail));
      const stage = document.querySelector("#stage");
      probe.shellRefs = new Map([...document.querySelectorAll("#stage .cardinal-webgl-card[data-card-id]")]
        .map((shell) => [shell.dataset.cardId, shell]));
      const types = ["pointerdown", "pointermove", "pointerup", "pointercancel", "keydown"];
      const removers = types.map((type) => {
        const listener = (event) => cap(probe.inputEvents, {
          type, pointerType: event.pointerType ?? null, pointerId: event.pointerId ?? null,
          clientX: event.clientX ?? null, clientY: event.clientY ?? null,
          key: event.key ?? null, code: event.code ?? null,
        });
        stage?.addEventListener(type, listener, true);
        return () => stage?.removeEventListener(type, listener, true);
      });
      probe.unsubscribe = () => { offDrop(); offChange(); removers.forEach((remove) => remove()); };
      window.__cardinalBatchProbe = probe;
      return true;
    }`);
    await waitFor("batch probe", (current) => current.snapshot?.desired.cards.length === 4);
    return state();
  }

  async function clearSelection() {
    await button("#deselect-all");
    return waitFor("selection clear", (current) => current.snapshot.selection.cardIds.length === 0);
  }

  async function selectByPointer(cardIds) {
    await clearSelection();
    for (const [index, cardId] of cardIds.entries()) {
      await pointer.click(await cardPoint(cardId), { toggle: index > 0 });
    }
    return waitFor("pointer selection", (current) => cardIds.every((id) => current.snapshot.selection.cardIds.includes(id))
      && current.snapshot.selection.cardIds.length === cardIds.length);
  }

  async function referenceLanding(cardIds) {
    return evaluate(`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const { createCardScene } = await import("/packages/card-engine/src/index.js");
      const scene = getScene();
      const snapshot = scene.snapshot();
      const reference = createCardScene({ motion: { reducedMotion: true } });
      try {
        reference.apply({ ...snapshot.desired, zones: snapshot.zones.map(({ anchor, ...zone }) => zone) });
        const referenceState = reference.snapshot();
        return Object.fromEntries(${JSON.stringify(cardIds)}.map((id) => {
          const pose = referenceState.visual.find(({ cardId }) => cardId === id)?.pose;
          return [id, pose ? scene.sceneToClient(pose) : null];
        }));
      } finally { reference.destroy(); }
    })()`);
  }

  async function domShellIdentity(cardIds) {
    return evaluate(`(() => {
      const refs = window.__cardinalBatchProbe?.shellRefs;
      return ${JSON.stringify(cardIds)}.every((id) => {
        const shell = document.querySelector("#stage .cardinal-webgl-card[data-card-id=" + JSON.stringify(id) + "]");
        return refs?.get(id) === shell;
      });
    })()`);
  }

  async function landingErrors(cardIds, expectedCenters) {
    return evaluate(`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      return Object.fromEntries(${JSON.stringify(cardIds)}.map((id) => {
        const pose = scene.snapshot().visual.find(({ cardId }) => cardId === id)?.pose;
        const actual = pose ? scene.sceneToClient(pose) : null;
        const expected = ${JSON.stringify(expectedCenters)}[id];
        return [id, actual && expected ? Number(Math.hypot(actual.x - expected.x, actual.y - expected.y).toFixed(3)) : null];
      }));
    })()`);
  }

  async function attachmentErrors(cardIds, startCenters, pointerPoint, grabOffset) {
    return evaluate(`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      const snapshot = scene.snapshot();
      const primary = ${JSON.stringify(cardIds[0])};
      const expectedPrimary = { x: ${pointerPoint.x} - ${grabOffset.x}, y: ${pointerPoint.y} - ${grabOffset.y} };
      return Object.fromEntries(${JSON.stringify(cardIds)}.map((id) => {
        const pose = snapshot.visual.find(({ cardId }) => cardId === id)?.pose;
        const actual = pose ? scene.sceneToClient(pose) : null;
        const start = ${JSON.stringify(startCenters)}[id];
        const primaryStart = ${JSON.stringify(startCenters)}[primary];
        const expected = start && primaryStart && actual ? {
          x: expectedPrimary.x + start.x - primaryStart.x,
          y: expectedPrimary.y + start.y - primaryStart.y,
        } : null;
        return [id, actual && expected ? Number(Math.hypot(actual.x - expected.x, actual.y - expected.y).toFixed(3)) : null];
      }));
    })()`);
  }

  async function waitForAttachment(description, cardIds, startCenters, pointerPoint, grabOffset, ready = () => true) {
    const started = Date.now();
    let current;
    let errors;
    while (Date.now() - started < WAIT_MS) {
      current = await state();
      if (lastSession(current)?.phase === "dragging" && ready(current)) {
        errors = await attachmentErrors(cardIds, startCenters, pointerPoint, grabOffset);
        if (Object.values(errors).every((error) => error !== null && error <= 1)) return { current, errors };
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    throw new Error(`${description} timed out: ${JSON.stringify({ errors, diagnostics: compactDiagnostics(current) })}`);
  }

  async function resolvePending(accepted) {
    await button(accepted ? "#drag-accept" : "#drag-reject");
    return waitFor(`drop ${accepted ? "acceptance" : "rejection"}`, (current) => current.snapshot.interaction.sessions.length === 0
      && current.probe.drops.length >= 1 && !current.snapshot.settling);
  }

  async function runCase(results, caseLabel, action) {
    let details;
    let error;
    try {
      details = await action();
    } catch (caught) {
      error = caught;
    } finally {
      await pointer.cleanup?.().catch?.(() => {});
      await touch.cleanup?.().catch?.(() => {});
      await evaluate(`(async () => {
        const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
        const scene = getScene();
        for (const session of scene?.snapshot?.().interaction?.sessions ?? []) {
          if (session.phase === "pending") scene.resolveDrop(session.id, { accepted: false });
        }
        return true;
      })()`).catch(() => {});
    }
    if (error) {
      const current = await state().catch(() => null);
      results.push({ label: caseLabel, pass: false, error: errorMessage(error), diagnostic: compactDiagnostics(current) });
    } else {
      results.push({ label: caseLabel, pass: true, details });
    }
  }

  const results = [];
  let environment = null;
  const measurements = { attachmentErrors: [], landingErrors: [], cohortSizes: [] };

  if (typeof navigate === "function") {
    await navigate(labUrl);
    await waitFor("lab navigation", (current) => current.renderer.includes("Three.js WebGL"), 10000);
  }

  await runCase(results, "cross-source pointer selection freezes source order and preserves shells", async () => {
    const prepared = await fixture();
    environment = prepared.environment;
    const selected = await selectByPointer(["batch-card-1", "batch-card-2"]);
    const ids = [...selected.snapshot.selection.cardIds];
    const before = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await cardPoint(id)])));
    const primary = before[ids[0]];
    const grabOffset = { x: 11, y: -8 };
    const start = { x: primary.x + grabOffset.x, y: primary.y + grabOffset.y };
    const destination = await zonePoint("workbench");
    const expectedSources = ids.map((cardId) => {
      const zone = allZones(selected).find(({ cardIds }) => cardIds.includes(cardId));
      return { cardId, zoneId: zone.id, index: zone.cardIds.indexOf(cardId) };
    });
    await pointer.drag(start, destination, { steps: 10 });
    const carrying = await waitFor("pointer cohort pickup", (current) => lastSession(current)?.phase === "dragging"
      && lastSession(current).cardIds.length === 2 && lastSession(current).primaryCardId === ids[0]
      && lastSession(current).candidate?.toZoneId === "workbench"
      && lastSession(current).candidate.allowed === true);
    if (JSON.stringify(lastSession(carrying).cardIds) !== JSON.stringify(ids)) {
      throw new Error(`Frozen source order changed: ${JSON.stringify(lastSession(carrying))}`);
    }
    const sourceKeys = (sources) => sources.map(({ cardId, zoneId, index }) => [cardId, zoneId, index]);
    if (JSON.stringify(sourceKeys(lastSession(carrying).sources)) !== JSON.stringify(sourceKeys(expectedSources))) {
      throw new Error(`Source order/membership mismatch: ${JSON.stringify(lastSession(carrying).sources)}`);
    }
    const pickup = pointer.pickupPoint ?? start;
    const effectiveGrabOffset = { x: pickup.x - primary.x, y: pickup.y - primary.y };
    const attachment = await attachmentErrors(ids, before, destination, effectiveGrabOffset);
    measurements.attachmentErrors.push({ case: "pointer", values: attachment });
    if (Object.values(attachment).some((error) => error === null || error > 1)) {
      throw new Error(`Cohort attachment exceeded 1 CSS px: ${JSON.stringify(attachment)}`);
    }
    if (!await domShellIdentity(ids)) throw new Error("Pointer pickup remounted a cohort shell");
    const intentCount = carrying.probe.drops.length;
    await pointer.release(destination);
    const pending = await waitFor("pointer batch pending", (current) => lastSession(current)?.phase === "pending"
      && current.probe.drops.length === intentCount + 1);
    const intent = pending.probe.drops.at(-1);
    if (intent.cardIds.length !== ids.length || intent.cardIds.some((id) => !ids.includes(id))) {
      throw new Error(`Batch intent did not include every member: ${JSON.stringify(intent)}`);
    }
    const landed = await resolvePending(true);
    const expectedCenters = await referenceLanding(ids);
    const errors = await landingErrors(ids, expectedCenters);
    measurements.landingErrors.push({ case: "pointer", values: errors });
    if (Object.values(errors).some((error) => error === null || error > 1)) {
      throw new Error(`Cohort landing exceeded 1 CSS px: ${JSON.stringify(errors)}`);
    }
    if (!zoneCards(landed, "workbench").every((id) => ids.includes(id))
      || !ids.every((id) => zoneCards(landed, "workbench").includes(id))
      || !shellIdentity(landed, ids)
      || !await domShellIdentity(ids)
      || !noDuplicateMembership(landed, ids)) {
      throw new Error(`Accepted cohort membership/shell identity mismatch: ${JSON.stringify(compactDiagnostics(landed))}`);
    }
    return { ids, sources: expectedSources, intent, shells: landed.shells, pickup, attachment, landing: errors };
  });

  await runCase(results, "rejection is atomic and flip preserves selected cards in place", async () => {
    const prepared = await fixture();
    const ids = [...prepared.snapshot.selection.cardIds];
    await control("#drag-response", "manual");
    const beforeZones = allZones(prepared);
    const beforeShells = prepared.shells;
    const primary = await cardPoint(ids[0]);
    await pointer.drag(primary, await zonePoint("workbench"), { steps: 8 });
    await pointer.release(await zonePoint("workbench"));
    const pending = await waitFor("rejected batch pending", (current) => lastSession(current)?.phase === "pending"
      && lastSession(current).cardIds.length === ids.length);
    if (pending.probe.drops.length !== 1) throw new Error(`Expected one rejected intent, got ${pending.probe.drops.length}`);
    const rejected = await resolvePending(false);
    if (JSON.stringify(allZones(rejected)) !== JSON.stringify(beforeZones)
      || JSON.stringify(rejected.shells) !== JSON.stringify(beforeShells)) {
      throw new Error(`Rejected batch partially changed the scene: ${JSON.stringify(compactDiagnostics(rejected))}`);
    }
    if (!await domShellIdentity(ids)) throw new Error("Rejected batch remounted a cohort shell");
    const beforePoses = Object.fromEntries(ids.map((id) => [id,
      rejected.snapshot.visual.find(({ cardId }) => cardId === id)?.pose]));
    await button("#flip-selection");
    const flipped = await waitFor("selection flip", (current) => current.snapshot.selection.cardIds.length === ids.length
      && !current.snapshot.settling);
    for (const id of ids) {
      const before = beforePoses[id];
      const after = flipped.snapshot.visual.find(({ cardId }) => cardId === id)?.pose;
      if (!before || !after || before.x !== after.x || before.y !== after.y || before.z !== after.z
        || before.angle !== after.angle || before.scale !== after.scale || before.flipX === after.flipX && before.flipY === after.flipY) {
        throw new Error(`Flip changed position or not face for ${id}: ${JSON.stringify({ before, after })}`);
      }
    }
    return { ids, rejectedIntent: pending.probe.drops[0], zones: beforeZones, shells: flipped.shells };
  });

  await runCase(results, "same-zone pointer move uses post-removal insertion order", async () => {
    const prepared = await fixture();
    const all = prepared.snapshot.desired.cards.map(({ id }) => id);
    await page(`(scene) => {
      const desired = structuredClone(scene.snapshot().desired);
      desired.zones = desired.zones.map((zone) => ({ ...zone, cardIds: zone.id === "archive" ? [...${JSON.stringify(all)}] : [] }));
      scene.apply(desired);
      return scene.select([${JSON.stringify(all[1])}, ${JSON.stringify(all[3])}], { primaryCardId: ${JSON.stringify(all[1])}, anchorCardId: ${JSON.stringify(all[1])} });
    }`);
    const source = await waitFor("same-zone fixture", (current) => zoneCards(current, "archive").length === 4
      && current.snapshot.selection.cardIds.length === 2);
    const cohort = [...source.snapshot.selection.cardIds];
    const before = [...zoneCards(source, "archive")];
    const primary = await cardPoint(cohort[0]);
    await pointer.drag(primary, await zonePoint("archive"), { steps: 10 });
    const carrying = await waitFor("same-zone candidate", (current) => lastSession(current)?.phase === "dragging"
      && lastSession(current).candidate?.toZoneId === "archive");
    const index = lastSession(carrying).candidate.index;
    const expected = expectedOrder(before, cohort, index);
    await pointer.release(await zonePoint("archive"));
    await waitFor("same-zone pending", (current) => current.probe.drops.length === 1
      && lastSession(current)?.phase === "pending");
    const settled = await resolvePending(true);
    const actual = zoneCards(settled, "archive");
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Same-zone batch order mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
    return { before, cohort, index, expected, actual };
  });

  await runCase(results, "denied secondary member rejects the whole batch", async () => {
    const prepared = await fixture({ response: "immediate" });
    const ids = [...prepared.snapshot.selection.cardIds];
    await control("#drag-denied-card", ids[1]);
    const primary = await cardPoint(ids[0]);
    await pointer.drag(primary, await zonePoint("workbench"), { steps: 8 });
    const denied = await waitFor("denied secondary candidate", (current) => lastSession(current)?.phase === "dragging"
      && lastSession(current).candidate?.toZoneId === "workbench"
      && lastSession(current).candidate.allowed === false);
    await pointer.release(await zonePoint("workbench"));
    const settled = await waitFor("denied batch cancellation", (current) => current.snapshot.interaction.sessions.length === 0
      && !current.snapshot.settling);
    if (settled.probe.drops.length !== 0 || !ids.every((id) => allZones(settled).some(({ cardIds }) => cardIds.includes(id)))) {
      throw new Error(`Denied secondary partially committed: ${JSON.stringify(compactDiagnostics(settled))}`);
    }
    return { ids, reason: denied.snapshot.interaction.sessions.at(-1)?.candidate?.reason ?? "denied", zones: allZones(settled) };
  });

  await runCase(results, "insufficient capacity rejects the complete batch", async () => {
    const prepared = await fixture({ response: "immediate" });
    const ids = prepared.snapshot.selection.cardIds;
    const beforeZones = allZones(prepared);
    await page(`(scene) => { scene.transact([{ type: "zone", zoneId: "workbench", changes: { capacity: 1 } }]); return true; }`);
    const destination = await zonePoint("workbench");
    await pointer.drag(await cardPoint(ids[0]), destination);
    const denied = await waitFor("capacity denies cohort", (current) => lastSession(current)?.candidate?.toZoneId === "workbench"
      && lastSession(current).candidate.allowed === false);
    await pointer.release(destination);
    const settled = await waitFor("capacity cancellation", (current) => !current.snapshot.interaction.sessions.length && !current.snapshot.settling);
    if (settled.probe.drops.length || JSON.stringify(allZones(settled)) !== JSON.stringify(beforeZones)) throw new Error("Capacity denial changed membership or emitted an intent");
    return { ids, reason: lastSession(denied).candidate.reason };
  });

  await runCase(results, "compact carrying settles then lands in actual target slots", async () => {
    const prepared = await fixture({ presentation: "compact" });
    const ids = prepared.snapshot.selection.cardIds;
    const destination = await zonePoint("workbench");
    const start = await cardPoint(ids[0]);
    await pointer.drag(start, destination);
    await waitFor("compact offset animation settles", (current) => lastSession(current)?.presentation === "compact"
      && lastSession(current).phase === "dragging" && !current.snapshot.settling);
    const primary = await cardPoint(ids[0]);
    const secondary = await cardPoint(ids[1]);
    const pickup = pointer.pickupPoint ?? start;
    const attachmentError = Math.hypot(primary.x - destination.x + pickup.x - start.x,
      primary.y - destination.y + pickup.y - start.y);
    const compactError = Math.hypot(secondary.x - primary.x - 18, secondary.y - primary.y - 18);
    if (attachmentError > 1 || compactError > 1) throw new Error(`Compact attachment/offset error: ${attachmentError}/${compactError}`);
    await pointer.release(destination);
    await waitFor("compact pending slots", (current) => lastSession(current)?.phase === "pending");
    const landed = await resolvePending(true);
    const errors = await landingErrors(ids, await referenceLanding(ids));
    if (!shellIdentity(landed, ids) || Object.values(errors).some((error) => error === null || error > 1)) throw new Error(`Compact landing mismatch: ${JSON.stringify(errors)}`);
    measurements.landingErrors.push({ case: "compact", values: errors });
    return { ids, attachmentError, compactError, landing: errors };
  });

  await runCase(results, "cohort stays attached through resize, scroll and full-window transition", async () => {
    const prepared = await fixture();
    const ids = [...prepared.snapshot.selection.cardIds];
    const startCenters = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await cardPoint(id)])));
    const start = startCenters[ids[0]];
    const press = { x: start.x + 22, y: start.y - 18 };
    const nudge = { x: press.x + 12, y: press.y + 8 };
    await pointer.drag(press, nudge, { steps: 1 });
    const carrying = await waitFor("responsive cohort pickup", (current) => lastSession(current)?.phase === "dragging"
      && lastSession(current).cardIds.length === ids.length);
    const pickup = pointer.pickupPoint ?? nudge;
    const grabOffset = { x: pickup.x - start.x, y: pickup.y - start.y };

    await evaluate(`(async () => {
      const stage = document.querySelector("#stage");
      const column = document.querySelector(".scene-column");
      stage.style.width = "1100px";
      stage.style.height = "620px";
      column.style.height = "500px";
      column.style.maxHeight = "500px";
      column.style.overflow = "auto";
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { stage: stage.getBoundingClientRect().toJSON(), column: column.getBoundingClientRect().toJSON() };
    })()`);
    const resizedAttachment = await waitForAttachment("cohort stage resize attachment", ids, startCenters, nudge, grabOffset,
      (current) => current.environment.stage?.width >= 1099 && current.environment.stage?.height >= 619);
    const resizeErrors = resizedAttachment.errors;

    const ancestorScrollTarget = await evaluate(`(() => {
      const column = document.querySelector(".scene-column");
      column.scrollTop = Math.min(100, Math.max(0, column.scrollHeight - column.clientHeight));
      column.dispatchEvent(new Event("scroll", { bubbles: true }));
      return column.scrollTop;
    })()`);
    const ancestorAttachment = await waitForAttachment("cohort ancestor scroll attachment", ids, startCenters, nudge, grabOffset,
      (current) => (current.scroll?.ancestor?.top ?? 0) > 0);
    const ancestorScrolled = ancestorAttachment.current;
    const ancestorErrors = ancestorAttachment.errors;

    await evaluate(`(() => {
      const column = document.querySelector(".scene-column");
      column.style.height = "auto";
      column.style.maxHeight = "none";
      column.style.overflow = "visible";
      document.body.style.minHeight = (innerHeight + 800) + "px";
      document.documentElement.style.minHeight = (innerHeight + 800) + "px";
      window.scrollTo(0, 0);
      return true;
    })()`);
    await evaluate(`(() => {
      window.scrollTo(0, Math.min(200, Math.max(0, document.documentElement.scrollHeight - innerHeight)));
      return scrollY;
    })()`);
    const pageAttachment = await waitForAttachment("cohort page scroll attachment", ids, startCenters, nudge, grabOffset,
      (current) => (current.scroll?.page?.y ?? 0) > 0);
    const pageScrolled = pageAttachment.current;
    const pageErrors = pageAttachment.errors;

    await evaluate(`(() => {
      window.scrollTo(0, 0);
      return true;
    })()`);
    await waitForAttachment("cohort page scroll reset", ids, startCenters, nudge, grabOffset,
      (current) => (current.scroll?.page?.y ?? 0) === 0);

    await evaluate(`(async () => {
      document.querySelector("#stage").style.removeProperty("width");
      document.querySelector("#stage").style.removeProperty("height");
      document.querySelector("#full-window-control")?.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return true;
    })()`);
    const fullWindowAttachment = await waitForAttachment("cohort full-window attachment", ids, startCenters, nudge, grabOffset,
      (current) => current.environment.stage?.width >= current.environment.innerWidth - 1 && current.fullWindow === true);
    const fullWindow = fullWindowAttachment.current;
    const fullWindowErrors = fullWindowAttachment.errors;
    measurements.attachmentErrors.push({ case: "cohort-responsive", values: {
      resize: resizeErrors,
      ancestorScroll: ancestorErrors,
      pageScroll: pageErrors,
      fullWindow: fullWindowErrors,
    }});
    return {
      ids,
      sources: carrying.sources,
      attachment: { resizeErrors, ancestorErrors, pageErrors, fullWindowErrors },
      scroll: { ancestor: { target: ancestorScrollTarget, ...ancestorScrolled.scroll }, page: pageScrolled.scroll },
      viewport: fullWindow.environment,
    };
  });

  await runCase(results, "mouse Ctrl/Cmd toggle and Shift range selection", async () => {
    const prepared = await fixture();
    await clearSelection();
    await pointer.click(await cardPoint("batch-card-1"));
    await pointer.click(await cardPoint("batch-card-3"), { shift: true });
    const range = await waitFor("mouse same-zone range", (current) => JSON.stringify(current.snapshot.selection.cardIds) === JSON.stringify(["batch-card-1", "batch-card-3"]));
    await pointer.click(await cardPoint("batch-card-2"), { toggle: true });
    const toggled = await waitFor("mouse cross-source toggle", (current) => current.snapshot.selection.cardIds.length === 3
      && current.snapshot.selection.cardIds.includes("batch-card-2"));
    return { range: range.snapshot.selection, toggled: toggled.snapshot.selection, input: toggled.probe.inputEvents.filter(({ type }) => type.startsWith("pointer")) };
  });

  await runCase(results, "keyboard select-all picks up and transfers the complete cohort", async () => {
    const prepared = await fixture();
    const ids = prepared.snapshot.desired.cards.map(({ id }) => id);
    await clearSelection();
    if (!await focusCard(ids[0])) throw new Error("Keyboard focus did not reach primary shell");
    await keyboard.press("a", { toggle: true });
    const selected = await waitFor("keyboard select all", (current) => current.snapshot.selection.cardIds.length === ids.length);
    if (!ids.every((id) => selected.snapshot.selection.cardIds.includes(id))) throw new Error("Keyboard select-all omitted an eligible card");
    await keyboard.press(" ");
    const picked = await waitFor("keyboard cohort pickup", (current) => lastSession(current)?.phase === "dragging"
      && lastSession(current).cardIds.length === ids.length);
    await keyboard.press("Tab");
    await waitFor("keyboard River candidate", (current) => lastSession(current)?.candidate?.toZoneId === "reserve");
    await keyboard.press("Tab");
    await waitFor("keyboard Ocean candidate", (current) => lastSession(current)?.candidate?.toZoneId === "workbench");
    await keyboard.press("Enter");
    const pending = await waitFor("keyboard batch pending", (current) => lastSession(current)?.phase === "pending"
      && current.probe.drops.length === 1);
    const landed = await resolvePending(true);
    if (!ids.every((id) => zoneCards(landed, "workbench").includes(id)) || !shellIdentity(landed, ids)) {
      throw new Error(`Keyboard cohort did not land atomically: ${JSON.stringify(compactDiagnostics(landed))}`);
    }
    return { ids, selection: selected.snapshot.selection, session: picked.snapshot.interaction.sessions.at(-1), intent: pending.probe.drops[0] };
  });

  if (touch.supported === false) results.push({ label: "emulated touch selection and cohort drag", pass: false,
    skipped: true, error: touch.unsupportedReason });
  else await runCase(results, "emulated touch selection and cohort drag", async () => {
    const prepared = await fixture({ response: "immediate", touchSelection: true, touchDrag: true });
    const ids = ["batch-card-1", "batch-card-2"];
    await clearSelection();
    await touch.tap(await cardPoint(ids[0]));
    await touch.tap(await cardPoint(ids[1]));
    const selected = await waitFor("touch cohort selection", (current) => ids.every((id) => current.snapshot.selection.cardIds.includes(id)));
    if (!selected.probe.inputEvents.some(({ type, pointerType }) => type === "pointerdown" && pointerType === "touch")) {
      throw new Error("The touch protocol did not produce actual touch pointer events");
    }
    const primary = await cardPoint(ids[0]);
    await touch.drag(primary, await zonePoint("workbench"), { steps: 8 });
    const carrying = await waitFor("touch cohort pickup", (current) => lastSession(current)?.phase === "dragging"
      && lastSession(current).cardIds.length === ids.length);
    await touch.release(await zonePoint("workbench"));
    const landed = await waitFor("touch cohort landing", (current) => current.snapshot.interaction.sessions.length === 0
      && zoneCards(current, "workbench").length === ids.length && !current.snapshot.settling);
    measurements.cohortSizes.push({ input: "touch", count: carrying.snapshot.interaction.sessions.at(-1)?.cardIds.length ?? ids.length });
    return { ids, selection: selected.snapshot.selection, session: carrying.snapshot.interaction.sessions.at(-1), zones: allZones(landed), shells: landed.shells };
  });

  if (pen?.supported === false) results.push({ label: "emulated pen selection and cohort drag", pass: false,
    skipped: true, error: pen.unsupportedReason });
  else if (pen) await runCase(results, "emulated pen selection and cohort drag", async () => {
    const prepared = await fixture({ response: "immediate" });
    const ids = ["batch-card-1", "batch-card-2"];
    await clearSelection();
    await pen.tap(await cardPoint(ids[0]));
    await pen.click(await cardPoint(ids[1]), { toggle: true });
    const selected = await waitFor("pen cohort selection", (current) => ids.every((id) => current.snapshot.selection.cardIds.includes(id)));
    const penEvents = selected.probe.inputEvents.filter(({ pointerType }) => pointerType === "pen");
    if (!penEvents.some(({ type }) => type === "pointerdown") || !penEvents.some(({ type }) => type === "pointerup")) {
      throw new Error(`The pen protocol did not produce pen pointer events: ${JSON.stringify(penEvents)}`);
    }
    const primary = await cardPoint(ids[0]);
    await pen.drag(primary, await zonePoint("workbench"), { steps: 8 });
    const carrying = await waitFor("pen cohort pickup", (current) => lastSession(current)?.phase === "dragging"
      && lastSession(current).cardIds.length === ids.length);
    await pen.release(await zonePoint("workbench"));
    const landed = await waitFor("pen cohort landing", (current) => current.snapshot.interaction.sessions.length === 0
      && zoneCards(current, "workbench").length === ids.length && !current.snapshot.settling);
    measurements.cohortSizes.push({ input: "pen", count: carrying.snapshot.interaction.sessions.at(-1)?.cardIds.length ?? ids.length });
    return { ids, selection: selected.snapshot.selection, session: carrying.snapshot.interaction.sessions.at(-1), penEvents: penEvents.length, zones: allZones(landed), shells: landed.shells };
  });

  await runCase(results, "frozen cohort ignores late selection and late approval", async () => {
    const prepared = await fixture();
    const ids = [...prepared.snapshot.selection.cardIds];
    const primary = await cardPoint(ids[0]);
    await pointer.drag(primary, await zonePoint("workbench"), { steps: 8 });
    const carrying = await waitFor("frozen cohort carrying", (current) => lastSession(current)?.phase === "dragging"
      && lastSession(current).cardIds.length === ids.length);
    await page(`(scene) => scene.select(["batch-card-3"], { mode: "replace" })`);
    await pointer.release(await zonePoint("workbench"));
    const pending = await waitFor("frozen cohort pending", (current) => lastSession(current)?.phase === "pending");
    if (JSON.stringify(lastSession(pending).cardIds) !== JSON.stringify(ids)) throw new Error("Late selection changed frozen cohort");
    await control("#drag-denied-zone", "workbench");
    const stale = await waitFor("late approval invalidation", (current) => current.snapshot.interaction.sessions.length === 0);
    const lateReply = await page(`(scene) => scene.resolveDrop(${JSON.stringify(lastSession(pending).id)}, { accepted: true })`);
    if (lateReply.status !== "stale") throw new Error("Late approval was not rejected as stale");
    if (stale.probe.drops.length !== 1 || ids.some((id) => zoneCards(stale, "workbench").includes(id))) {
      throw new Error(`Late rule change partially committed: ${JSON.stringify(compactDiagnostics(stale))}`);
    }
    return { ids, carrying: lastSession(carrying), pending: lastSession(pending), finalSelection: stale.snapshot.selection, zones: allZones(stale) };
  });

  await runCase(results, "secondary removal cancels the frozen batch without resurrection", async () => {
    const prepared = await fixture();
    const ids = [...prepared.snapshot.selection.cardIds];
    const removed = ids[1];
    const primary = ids[0];
    await pointer.drag(await cardPoint(primary), await zonePoint("workbench"), { steps: 8 });
    await waitFor("removal cohort carrying", (current) => lastSession(current)?.phase === "dragging"
      && lastSession(current).cardIds.length === ids.length);
    await page(`(scene) => {
      const desired = structuredClone(scene.snapshot().desired);
      desired.cards = desired.cards.filter(({ id }) => id !== ${JSON.stringify(removed)});
      desired.zones = desired.zones.map((zone) => ({ ...zone, cardIds: zone.cardIds.filter((id) => id !== ${JSON.stringify(removed)}) }));
      scene.apply(desired);
      return true;
    }`);
    const cancelled = await waitFor("secondary removal cancellation", (current) => current.snapshot.interaction.sessions.length === 0
      && current.snapshot.desired.cards.every(({ id }) => id !== removed));
    await pointer.release(await zonePoint("workbench"));
    const primaryHasMembership = allZones(cancelled).some(({ cardIds }) => cardIds.includes(primary));
    if (!primaryHasMembership || allZones(cancelled).some(({ cardIds }) => cardIds.includes(removed))) {
      throw new Error(`Secondary removal resurrected or lost survivor: ${JSON.stringify(compactDiagnostics(cancelled))}`);
    }
    return { primary, removed, zones: allZones(cancelled), shells: cancelled.shells };
  });

  await evaluate(`(async () => {
    const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
    getScene()?.snapshot?.().interaction?.sessions?.forEach((session) => {
      if (session.phase === "pending") getScene().resolveDrop(session.id, { accepted: false });
    });
    window.__cardinalBatchProbe?.unsubscribe?.();
    return true;
  })()`).catch(() => {});
  const finalState = await state().catch(() => null);
  environment ??= finalState?.environment ?? null;
  return { ok: results.every(({ pass, skipped }) => pass || skipped), results, environment, measurements };
}
