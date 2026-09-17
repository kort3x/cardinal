import { setTimeout as delay } from "node:timers/promises";
import { createPageEvaluator } from "./chrome-runtime.mjs";

const LAB_MODULE = "/examples/card-engine-lab/main.js";
const POLL_MS = 20;
const WAIT_MS = 5000;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function zoneCards(state, zoneId) {
  return state.snapshot?.desired?.zones?.find((zone) => zone.id === zoneId)?.cardIds ?? [];
}

function session(state) {
  return state.snapshot?.interaction?.sessions?.at(-1) ?? null;
}

function compactDiagnostics(state) {
  return {
    renderer: state?.rendererText,
    viewport: state?.viewport,
    cardId: state?.cardId,
    shells: state?.shells,
    zones: state?.snapshot?.desired?.zones?.map(({ id, cardIds }) => ({ id, cardIds })),
    interaction: state?.snapshot?.interaction,
    probe: {
      drops: state?.probe?.drops?.length ?? 0,
      interactions: state?.probe?.interactions?.length ?? 0,
      inputEvents: state?.probe?.inputEvents,
    },
    pendingControls: state?.pendingControls,
    focus: state?.focus,
    interactionStatus: state?.interactionStatus,
    inputAnnouncement: state?.inputAnnouncement,
    grabbedCard: state?.grabbedCard,
  };
}

export async function runDragScenario({ command }) {
  if (typeof command !== "function") throw new TypeError("Drag scenario requires a CDP command function");

  const evaluate = createPageEvaluator(command);

  async function state() {
    return evaluate(String.raw`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      const snapshot = scene?.snapshot?.() ?? null;
      const probe = window.__cardinalDragProbe ?? { drops: [], interactions: [] };
      return {
        rendererText: document.querySelector("#renderer-status")?.textContent ?? "",
        statusText: document.querySelector("#status")?.textContent ?? "",
        interactionStatus: document.querySelector("#interaction-status")?.textContent ?? "",
        inputAnnouncement: document.querySelector(".cardinal-interaction-announcement")?.textContent ?? "",
        grabbedCard: document.querySelector("[data-card-id][aria-grabbed='true']")?.dataset.cardId ?? null,
        focus: (() => {
          const active = document.activeElement;
          return {
            documentHasFocus: document.hasFocus(),
            tagName: active?.tagName ?? null,
            id: active?.id ?? null,
            cardId: active?.dataset?.cardId ?? null,
            className: typeof active?.className === "string" ? active.className : null,
            isCardShell: Boolean(active?.matches?.(".cardinal-webgl-card[data-card-id]")),
            tabIndex: active?.tabIndex ?? null,
          };
        })(),
        cardId: snapshot?.desired?.cards?.[0]?.id ?? null,
        shells: [...document.querySelectorAll("#stage .cardinal-webgl-card")].map((shell) => shell.dataset.cardId),
        snapshot,
        probe: {
          drops: structuredClone(probe.drops ?? []),
          interactions: structuredClone(probe.interactions ?? []),
          inputEvents: structuredClone(probe.inputEvents ?? []),
        },
        viewport: {
          innerWidth,
          innerHeight,
          outerWidth,
          outerHeight,
          screenX,
          screenY,
          userAgent: navigator.userAgent,
          devicePixelRatio,
          stage: (() => {
            const rect = document.querySelector("#stage")?.getBoundingClientRect();
            return rect ? {
              left: Number(rect.left.toFixed(2)),
              top: Number(rect.top.toFixed(2)),
              width: Number(rect.width.toFixed(2)),
              height: Number(rect.height.toFixed(2)),
            } : null;
          })(),
        },
        scroll: {
          ancestor: (() => {
            const node = document.querySelector(".scene-column");
            return node ? { top: node.scrollTop, left: node.scrollLeft } : null;
          })(),
          page: { x: scrollX, y: scrollY },
        },
        fullWindow: document.body.classList.contains("stage-full-window"),
        pendingControls: {
          acceptHidden: document.querySelector("#drag-accept")?.hidden ?? true,
          rejectHidden: document.querySelector("#drag-reject")?.hidden ?? true,
          rejectDisabled: document.querySelector("#drag-reject")?.disabled ?? true,
        },
        controls: {
          dragEnabled: document.querySelector("#drag-enabled")?.checked ?? false,
          touchDrag: document.querySelector("#drag-touch")?.checked ?? false,
          deniedZone: document.querySelector("#drag-denied-zone")?.value ?? "",
          response: document.querySelector("#drag-response")?.value ?? "",
        },
      };
    })()`);
  }

  async function waitFor(label, predicate, timeout = WAIT_MS) {
    const started = Date.now();
    let current;
    while (Date.now() - started < timeout) {
      current = await state();
      try {
        if (predicate(current)) return current;
      } catch {
        // Keep polling until the scene has reached the observable state.
      }
      await delay(POLL_MS);
    }
    current ??= await state();
    throw new Error(`${label} timed out: ${JSON.stringify(compactDiagnostics(current))}`);
  }

  async function setControl(selector, value) {
    await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error("Missing control ${selector}");
      if (element instanceof HTMLInputElement && element.type === "checkbox") {
        element.checked = ${JSON.stringify(Boolean(value))};
      } else {
        const prototype = element instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : HTMLSelectElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, ${JSON.stringify(String(value))});
      }
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
  }

  async function controlPoint(selector) {
    return evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      const rect = element?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0 || element.disabled || element.hidden) {
        throw new Error("Control is not clickable: ${selector}");
      }
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
  }

  async function clickControl(selector) {
    const point = await controlPoint(selector);
    await command("Input.dispatchMouseEvent", {
      type: "mouseMoved", x: point.x, y: point.y, button: "none", buttons: 0,
    });
    await command("Input.dispatchMouseEvent", {
      type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1,
    });
    mouseDown = true;
    lastMousePoint = point;
    await command("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1,
    });
    mouseDown = false;
  }

  async function fixture() {
    const result = await evaluate(String.raw`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      if (!scene) throw new Error("Cardinal lab scene is not ready");
      document.body.classList.remove("stage-full-window");
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
      const current = scene.snapshot();
      const card = current.desired.cards[0];
      if (!card) throw new Error("Drag fixture has no card");
      scene.stopSpin(card.id);
      const desired = structuredClone(current.desired);
      desired.cards = [desired.cards[0]];
      desired.zones = desired.zones.map((zone) => ({
        ...zone,
        visible: true,
        cardIds: zone.id === "river" ? [card.id] : [],
      }));
      scene.apply(desired);
      scene.select([card.id]);
      if (window.__cardinalDragProbe?.unsubscribe) window.__cardinalDragProbe.unsubscribe();
      const probe = { drops: [], interactions: [], inputEvents: [], scene };
      const cap = (items, value) => {
        items.push(structuredClone(value));
        if (items.length > 300) items.shift();
      };
      const offDrop = scene.on("drop", (intent) => cap(probe.drops, intent));
      const offInteraction = scene.on("interaction-change", (detail) => cap(probe.interactions, detail));
      const stage = document.querySelector("#stage");
      const inputEventTypes = ["pointerdown", "pointermove", "pointerup", "pointercancel", "gotpointercapture", "lostpointercapture", "keydown"];
      const inputListeners = inputEventTypes.map((type) => {
        const listener = (event) => cap(probe.inputEvents, {
          type,
          pointerType: event.pointerType,
          pointerId: event.pointerId,
          button: event.button,
          buttons: event.buttons,
          clientX: event.clientX,
          clientY: event.clientY,
          key: event.key,
          code: event.code,
          target: event.target?.className ?? event.target?.nodeName,
        });
        stage?.addEventListener(type, listener, true);
        return () => stage?.removeEventListener(type, listener, true);
      });
      probe.unsubscribe = () => { offDrop(); offInteraction(); inputListeners.forEach((remove) => remove()); };
      window.__cardinalDragProbe = probe;
      return { cardId: card.id };
    })()`);
    await waitFor("fixture to settle", (current) => current.snapshot?.renderer === "webgl"
      && current.snapshot?.desired?.cards?.length === 1
      && !current.snapshot.settling
      && zoneCards(current, "river").length === 1);
    return result.cardId;
  }

  async function reorderFixture() {
    const result = await evaluate(String.raw`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      if (!scene) throw new Error("Cardinal lab scene is not ready");
      const current = scene.snapshot().desired;
      const source = current.cards[0];
      if (!source) throw new Error("Reorder fixture has no source card");
      const cards = [source, 2, 3].map((item, index) => index === 0
        ? structuredClone(source)
        : { ...structuredClone(source), id: "drag-reorder-" + item, pose: { ...structuredClone(source.pose ?? {}), x: 450 + index * 20 } });
      const desired = {
        cards,
        zones: current.zones.map((zone) => ({
          ...zone,
          visible: true,
          cardIds: zone.id === "river" ? cards.map(({ id }) => id) : [],
        })),
      };
      scene.apply(desired);
      scene.select([source.id]);
      if (window.__cardinalDragProbe) {
        window.__cardinalDragProbe.drops = [];
        window.__cardinalDragProbe.interactions = [];
        window.__cardinalDragProbe.inputEvents = [];
      }
      return { sourceId: source.id, cardIds: cards.map(({ id }) => id) };
    })()`);
    await waitFor("reorder fixture to settle", (current) => current.snapshot?.renderer === "webgl"
      && current.snapshot?.desired?.cards?.length === 3
      && !current.snapshot.settling
      && zoneCards(current, "river").length === 3);
    return result;
  }

  async function coordinates(cardId, zoneId, offset = { x: 0, y: 0 }) {
    lastCoordinates = await evaluate(`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      const visual = scene.snapshot().visual.find(({ cardId: id }) => id === ${JSON.stringify(cardId)});
      const anchor = document.querySelector(${JSON.stringify(`#zone-${zoneId}`)});
      const rect = anchor?.getBoundingClientRect();
      if (!visual?.pose || !rect) throw new Error("Missing drag card or destination geometry");
      const start = scene.sceneToClient(visual.pose);
      const scenePoint = scene.clientToScene(start, 0);
      return {
        cardId: ${JSON.stringify(cardId)},
        center: start,
        start: { x: start.x + ${Number(offset.x)}, y: start.y + ${Number(offset.y)} },
        grabOffset: { x: ${Number(offset.x)}, y: ${Number(offset.y)} },
        destination: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        hit: scene.hitTest(scenePoint),
        scenePoint,
      };
    })()`);
    return lastCoordinates;
  }

  async function focusCard(cardId) {
    return evaluate(`(() => {
      const shell = document.querySelector(${JSON.stringify(`.cardinal-webgl-card[data-card-id="${cardId}"]`)});
      if (!shell) throw new Error("Missing accessible card shell");
      shell.focus();
      const active = document.activeElement;
      return {
        focused: active === shell,
        tagName: active?.tagName ?? null,
        cardId: active?.dataset?.cardId ?? null,
        id: active?.id ?? null,
        className: typeof active?.className === "string" ? active.className : null,
      };
    })()`);
  }

  let mouseDown = false;
  let lastMousePoint;
  let lastCoordinates;
  let activeMetric;

  async function metricProjection(cardId) {
    return evaluate(`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      const visual = scene.snapshot().visual.find(({ cardId: id }) => id === ${JSON.stringify(cardId)});
      if (!visual?.pose) return null;
      return {
        pose: visual.pose,
        center: scene.sceneToClient(visual.pose),
        dragging: scene.snapshot().interaction?.sessions?.at(-1)?.phase === "dragging",
      };
    })()`);
  }

  async function recordMetric(point) {
    if (!activeMetric || !point) return null;
    const projection = await metricProjection(activeMetric.cardId);
    if (!projection) return null;
    if (!activeMetric.grabOffset && projection.dragging) {
      activeMetric.grabOffset = {
        x: point.x - projection.center.x,
        y: point.y - projection.center.y,
      };
    }
    if (!activeMetric.grabOffset) return null;
    const errorPx = Math.hypot(
      point.x - activeMetric.grabOffset.x - projection.center.x,
      point.y - activeMetric.grabOffset.y - projection.center.y,
    );
    const sample = {
      pointer: { ...point },
      center: projection.center,
      errorPx: Number(errorPx.toFixed(3)),
    };
    activeMetric.samples.push(sample);
    return sample;
  }

  async function assertStationaryAttachment(label) {
    const sample = await recordMetric(lastMousePoint);
    if (!sample) throw new Error(`${label} did not produce a card projection sample`);
    if (sample.errorPx > 1) throw new Error(`${label} attachment error exceeded 1 CSS px: ${JSON.stringify(sample)}`);
    return sample;
  }

  async function finishMetric() {
    if (!activeMetric) return null;
    const metric = activeMetric;
    activeMetric = null;
    const projection = await metricProjection(metric.cardId).catch(() => null);
    const attachmentErrors = metric.samples.map(({ errorPx }) => errorPx);
    const sorted = [...attachmentErrors].sort((a, b) => a - b);
    const percentile = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : null;
    let landing = null;
    // Acceptance and rejection have different endpoints. Solve the current
    // committed snapshot independently of the animated visual being measured.
    const expectedPose = await evaluate(`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const { createCardScene } = await import("/packages/card-engine/src/index.js");
      const snapshot = getScene().snapshot();
      const reference = createCardScene({ motion: { reducedMotion: true } });
      try {
        reference.apply({ ...snapshot.desired, zones: snapshot.zones.map(({ anchor, ...zone }) => zone) });
        return reference.snapshot().visual.find(({ cardId }) => cardId === ${JSON.stringify(metric.cardId)})?.pose ?? null;
      } finally { reference.destroy(); }
    })()`);
    if (projection && expectedPose) {
      const expectedCenter = await evaluate(`(async () => {
        const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
        return getScene().sceneToClient(${JSON.stringify(expectedPose)});
      })()`);
      landing = {
        expectedCenter,
        actualCenter: projection.center,
        errorPx: Number(Math.hypot(
          expectedCenter.x - projection.center.x,
          expectedCenter.y - projection.center.y,
        ).toFixed(3)),
      };
    }
    return {
      cardId: metric.cardId,
      grabOffset: metric.grabOffset,
      attachment: {
        samples: metric.samples.length,
        maxErrorPx: attachmentErrors.length ? Math.max(...attachmentErrors) : null,
        p95ErrorPx: percentile,
      },
      landing,
    };
  }

  function validateMetrics(label, metrics) {
    if (!metrics) return;
    const attachmentError = metrics.attachment?.maxErrorPx;
    if (attachmentError !== null && attachmentError !== undefined && attachmentError > 1) {
      throw new Error(`${label} attachment error exceeded 1 CSS px: ${JSON.stringify(metrics.attachment)}`);
    }
    const landingError = metrics.landing?.errorPx;
    if (landingError !== null && landingError !== undefined && landingError > 1) {
      throw new Error(`${label} landing error exceeded 1 CSS px: ${JSON.stringify(metrics.landing)}`);
    }
  }

  async function mouseMove(point, buttons = mouseDown ? 1 : 0) {
    lastMousePoint = point;
    await command("Input.dispatchMouseEvent", {
      type: "mouseMoved", x: point.x, y: point.y, button: buttons ? "left" : "none", buttons,
    });
    await recordMetric(point);
  }
  async function mousePress(point) {
    await mouseMove(point, 0);
    await command("Input.dispatchMouseEvent", {
      type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1,
    });
    mouseDown = true;
    if (lastCoordinates?.cardId && Math.hypot(point.x - lastCoordinates.start.x, point.y - lastCoordinates.start.y) < 1) {
      const projection = await metricProjection(lastCoordinates.cardId);
      if (projection) {
        activeMetric = {
          cardId: lastCoordinates.cardId,
          grabOffset: null,
          samples: [],
        };
        await recordMetric(point);
      }
    }
  }
  async function mouseMovePath(start, destination) {
    const steps = 8;
    for (let index = 1; index <= steps; index += 1) {
      const fraction = index / steps;
      await mouseMove({
        x: start.x + (destination.x - start.x) * fraction,
        y: start.y + (destination.y - start.y) * fraction,
      });
    }
  }
  async function mouseRelease(point = lastMousePoint, { force = false } = {}) {
    if (!mouseDown && !force) return;
    try {
      await command("Input.dispatchMouseEvent", {
        type: "mouseReleased", x: point?.x ?? 0, y: point?.y ?? 0, button: "left", buttons: 0, clickCount: 1,
      });
    } finally {
      mouseDown = false;
    }
  }

  const keyCodes = {
    " ": ["Space", 32],
    Tab: ["Tab", 9],
    Enter: ["Enter", 13],
    Escape: ["Escape", 27],
  };
  async function key(key) {
    const [code, virtualKeyCode] = keyCodes[key] ?? [key, 0];
    const base = { key, code, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode };
    await command("Input.dispatchKeyEvent", {
      type: "keyDown", ...base, ...(key === " " ? { text: " " } : {}),
    });
    await command("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  let touchEnabled = false;
  let touchActive = false;
  let lastTouchPoint;
  async function touch(point, type = "touchStart", touchPoints = undefined) {
    touchActive = type !== "touchEnd";
    lastTouchPoint = point;
    await command("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : touchPoints ?? [{ x: point.x, y: point.y, id: 1 }],
      modifiers: 0,
    });
    if (type === "touchStart" && lastCoordinates?.cardId && Math.hypot(point.x - lastCoordinates.start.x, point.y - lastCoordinates.start.y) < 1) {
      const projection = await metricProjection(lastCoordinates.cardId);
      if (projection) {
        activeMetric = {
          cardId: lastCoordinates.cardId,
          grabOffset: null,
          samples: [],
        };
        await recordMetric(point);
      }
    } else if (type === "touchMove") {
      // CDP can acknowledge touch dispatch before the page receives pointermove.
      // Wait for input delivery, not for the card to reach the expected position.
      await waitFor("touch pointermove delivery", (current) => {
        const received = current.probe.inputEvents.findLast((event) =>
          event.type === "pointermove" && event.pointerType === "touch");
        return received && Math.abs(received.clientX - point.x) < 0.1
          && Math.abs(received.clientY - point.y) < 0.1;
      });
      await recordMetric(point);
    }
  }
  async function touchPath(start, destination) {
    const steps = 8;
    for (let index = 1; index <= steps; index += 1) {
      const fraction = index / steps;
      await touch({
        x: start.x + (destination.x - start.x) * fraction,
        y: start.y + (destination.y - start.y) * fraction,
      }, "touchMove");
    }
  }

  const results = [];
  async function runCase(label, action) {
    let details;
    let error;
    try {
      details = await action();
    } catch (caught) {
      error = caught;
    } finally {
      await mouseRelease(undefined, { force: true }).catch(() => {});
      if (touchActive) await touch(lastTouchPoint ?? { x: 0, y: 0 }, "touchEnd").catch(() => {});
      if (activeMetric) {
        try {
          if (!error) await waitFor("visual settlement before landing measurement", (current) =>
            !current.snapshot.settling && current.snapshot.interaction.sessions.length === 0);
          details = { ...(details ?? {}), metrics: await finishMetric() };
        } catch (caught) { error ??= caught; activeMetric = null; }
      }
      await evaluate(`(async () => {
        const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
        const scene = getScene();
        for (const item of scene?.snapshot?.().interaction?.sessions ?? []) {
          if (item.phase === "pending") scene.resolveDrop(item.id, { accepted: false });
        }
        return true;
      })()`).catch(() => {});
      await restoreResponsiveFixture().catch(() => {});
      await evaluate(`(() => {
        const listener = window.__outsideTouchProbe?.listener;
        if (listener) document.removeEventListener("pointerdown", listener);
        window.__outsideTouchProbe = null;
      })()`).catch(() => {});
    }
    if (!error) {
      try { validateMetrics(label, details?.metrics); }
      catch (caught) { error = caught; }
    }
    if (error) {
      const current = await state().catch(() => null);
      results.push({ label, pass: false, error: errorMessage(error), details: { ...compactDiagnostics(current), coordinates: lastCoordinates, metrics: details?.metrics ?? null } });
    } else {
      const resultDetails = { ...(details ?? {}), metrics: details?.metrics ?? null };
      const skipped = details?.skipped === true;
      results.push({
        label,
        pass: !skipped,
        skipped,
        status: skipped ? `skipped=${details.reason ?? "unspecified"}` : `metrics=${JSON.stringify(resultDetails.metrics)}`,
        details: resultDetails,
      });
    }
  }

  async function restoreResponsiveFixture() {
    await evaluate(`(() => {
      document.body.classList.remove("stage-full-window");
      const fullWindow = document.querySelector("#full-window-control");
      fullWindow?.setAttribute("aria-pressed", "false");
      if (fullWindow) fullWindow.textContent = "Full window";
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
  }

  await runCase("baseline WebGL drag fixture", async () => {
    await setControl("#drag-enabled", true);
    await setControl("#drag-denied-zone", "");
    await setControl("#drag-response", "immediate");
    const cardId = await fixture();
    const current = await waitFor("WebGL drag baseline", (candidate) => candidate.snapshot?.renderer === "webgl"
      && candidate.rendererText.includes("Three.js WebGL") && candidate.snapshot?.interaction?.sessions?.length === 0);
    return { cardId, viewport: current.viewport };
  });

  await runCase("mouse accepted transfer preserves identity and membership", async () => {
    const cardId = await fixture();
    await evaluate(`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      getScene().select([]);
      return true;
    })()`);
    const points = await coordinates(cardId, "lake");
    await mousePress(points.start);
    await mouseMovePath(points.start, points.destination);
    const carrying = await waitFor("mouse drag preview", (current) => {
      const active = session(current);
      return active?.phase === "dragging" && active.cardIds?.length === 1
        && active.primaryCardId === cardId && active.candidate?.toZoneId === "lake"
        && active.candidate.allowed === true
        && current.snapshot.selection?.cardIds?.length === 1
        && current.snapshot.selection.cardIds[0] === cardId;
    });
    await mouseRelease(points.destination);
    const landed = await waitFor("mouse drop acceptance", (current) => current.probe.drops.length === 1
      && zoneCards(current, "lake").includes(cardId)
      && !zoneCards(current, "river").includes(cardId)
      && !current.snapshot.settling);
    const intent = landed.probe.drops[0];
    if (intent.cardIds?.length !== 1 || intent.cardIds[0] !== cardId || intent.primaryCardId !== cardId) {
      throw new Error(`Drop intent identity mismatch: ${JSON.stringify(intent)}`);
    }
    if (landed.shells.length !== 1 || landed.shells[0] !== cardId) {
      throw new Error(`Rendered shell identity mismatch: ${JSON.stringify(landed.shells)}`);
    }
    return { cardId, candidate: carrying.snapshot.interaction.sessions.at(-1)?.candidate, intent, shells: landed.shells, viewport: landed.viewport };
  });

  await runCase("mouse denied destination reserves no slot", async () => {
    await setControl("#drag-denied-zone", "lake");
    const cardId = await fixture();
    const points = await coordinates(cardId, "lake");
    await mousePress(points.start);
    await mouseMovePath(points.start, points.destination);
    const denied = await waitFor("denied mouse candidate", (current) => {
      const active = session(current);
      return active?.phase === "dragging" && active.candidate?.toZoneId === "lake"
        && active.candidate.allowed === false;
    });
    await mouseRelease(points.destination);
    const settled = await waitFor("denied mouse release", (current) => current.probe.drops.length === 0
      && current.snapshot.interaction.sessions.length === 0
      && zoneCards(current, "river").includes(cardId));
    return { cardId, candidate: session(denied)?.candidate ?? denied.probe.interactions.at(-1)?.sessions?.at(-1)?.candidate, viewport: settled.viewport };
  });

  await runCase("manual pending drop rejects through the lab control", async () => {
    await setControl("#drag-denied-zone", "");
    await setControl("#drag-response", "manual");
    const cardId = await fixture();
    const points = await coordinates(cardId, "ocean");
    await mousePress(points.start);
    await mouseMovePath(points.start, points.destination);
    await waitFor("manual drop candidate", (current) => session(current)?.candidate?.toZoneId === "ocean"
      && session(current)?.candidate?.allowed === true);
    await mouseRelease(points.destination);
    const pending = await waitFor("pending drop approval", (current) => session(current)?.phase === "pending"
      && current.pendingControls.rejectDisabled === false && current.pendingControls.rejectHidden === false);
    // Approval is a project control, not the browser gesture under test. Use
    // DOM activation after the real pointer release so capture cleanup cannot
    // race the button click.
    await evaluate(`document.querySelector("#drag-reject")?.click(); true`);
    const rejected = await waitFor("manual drop rejection", (current) => current.probe.drops.length === 1
      && current.snapshot.interaction.sessions.length === 0
      && zoneCards(current, "river").includes(cardId)
      && !current.snapshot.settling);
    return { cardId, pending: session(pending), drops: rejected.probe.drops, viewport: rejected.viewport };
  });

  await runCase("Escape cancels an active mouse drag", async () => {
    await setControl("#drag-response", "immediate");
    const cardId = await fixture();
    const points = await coordinates(cardId, "ocean");
    await mousePress(points.start);
    await mouseMovePath(points.start, points.destination);
    await waitFor("active drag before Escape", (current) => session(current)?.phase === "dragging");
    await key("Escape");
    const cancelled = await waitFor("Escape cancellation", (current) => current.probe.drops.length === 0
      && current.snapshot.interaction.sessions.length === 0
      && zoneCards(current, "river").includes(cardId));
    return { cardId, status: cancelled.interactionStatus, viewport: cancelled.viewport };
  });

  await runCase("mouse pickup while the card is spinning keeps the card live", async () => {
    const cardId = await fixture();
    await evaluate(`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      scene.spin(${JSON.stringify(cardId)}, { axis: "y", direction: 1, speed: 180 });
      return true;
    })()`);
    const spinning = await waitFor("spin to start", (current) => current.snapshot?.spinning === true);
    const points = await coordinates(cardId, "ocean");
    await mousePress(points.start);
    const thresholdPoint = { x: points.start.x + 10, y: points.start.y };
    await mouseMove(thresholdPoint);
    const carrying = await waitFor("midspin pickup", (current) => session(current)?.phase === "dragging"
      && current.snapshot.spinning === true);
    await mouseMovePath(thresholdPoint, points.destination);
    await waitFor("midspin drop candidate", (current) => session(current)?.candidate?.toZoneId === "ocean"
      && session(current)?.candidate?.allowed === true);
    await mouseRelease(points.destination);
    const transferred = await waitFor("midspin transfer", (current) => current.probe.drops.length === 1
      && zoneCards(current, "ocean").includes(cardId));
    await evaluate(`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      getScene().stopSpin(${JSON.stringify(cardId)});
      return true;
    })()`);
    const landed = await waitFor("midspin settle", (current) => current.probe.drops.length === 1
      && zoneCards(current, "ocean").includes(cardId) && !current.snapshot.settling);
    return { cardId, spinningAtPickup: spinning.snapshot.spinning && carrying.snapshot.spinning, shells: landed.shells, viewport: transferred.viewport };
  });

  await runCase("keyboard permitted destination uses the same drop intent", async () => {
    await mouseRelease();
    const cardId = await fixture();
    const focus = await focusCard(cardId);
    if (!focus.focused) throw new Error(`Keyboard fixture focus mismatch: ${JSON.stringify(focus)}`);
    await key(" ");
    await waitFor("keyboard pickup", (current) => session(current)?.phase === "dragging"
      && session(current)?.primaryCardId === cardId);
    let candidate;
    for (let index = 0; index < 4; index += 1) {
      await key("Tab");
      const current = await waitFor("keyboard destination candidate", (candidateState) => session(candidateState)?.candidate?.toZoneId != null);
      candidate = session(current)?.candidate;
      if (candidate?.toZoneId === "lake") break;
    }
    if (candidate?.toZoneId !== "lake" || candidate.allowed !== true) {
      throw new Error(`Keyboard did not reach permitted Lake candidate: ${JSON.stringify(candidate)}`);
    }
    await key("Enter");
    const landed = await waitFor("keyboard accepted drop", (current) => current.probe.drops.length === 1
      && zoneCards(current, "lake").includes(cardId) && !current.snapshot.interaction.sessions.length);
    return { cardId, candidate, intent: landed.probe.drops[0], viewport: landed.viewport };
  });

  await runCase("keyboard denied destination reports denial and cancels", async () => {
    await mouseRelease();
    await setControl("#drag-denied-zone", "lake");
    const cardId = await fixture();
    const focus = await focusCard(cardId);
    if (!focus.focused) throw new Error(`Keyboard fixture focus mismatch: ${JSON.stringify(focus)}`);
    await key(" ");
    await waitFor("keyboard denied pickup", (current) => session(current)?.phase === "dragging");
    let candidate;
    for (let index = 0; index < 4; index += 1) {
      await key("Tab");
      const current = await waitFor("keyboard denied candidate", (candidateState) => session(candidateState)?.candidate?.toZoneId != null);
      candidate = session(current)?.candidate;
      if (candidate?.toZoneId === "lake") break;
    }
    if (candidate?.toZoneId !== "lake" || candidate.allowed !== false) {
      throw new Error(`Keyboard did not reach denied Lake candidate: ${JSON.stringify(candidate)}`);
    }
    await key("Escape");
    const cancelled = await waitFor("keyboard denied cancellation", (current) => current.probe.drops.length === 0
      && current.snapshot.interaction.sessions.length === 0 && zoneCards(current, "river").includes(cardId));
    return { cardId, candidate, status: cancelled.interactionStatus, viewport: cancelled.viewport };
  });

  await runCase("touch input transfers when touch drag is enabled", async () => {
    try {
      await command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1, configuration: "desktop" });
      touchEnabled = true;
    } catch (error) {
      return { skipped: true, reason: `Touch emulation unavailable: ${errorMessage(error)}` };
    }
    await setControl("#drag-denied-zone", "");
    await setControl("#drag-response", "immediate");
    await setControl("#drag-touch", true);
    await waitFor("touch drag control", (current) => current.controls.touchDrag === true
      && current.snapshot?.renderer === "webgl");
    const cardId = await fixture();
    const points = await coordinates(cardId, "lake");
    try {
      await touch(points.start);
      await touchPath(points.start, points.destination);
    } catch (error) {
      if (/not found|unsupported|unknown/i.test(errorMessage(error))) {
        return { skipped: true, reason: `Touch dispatch unavailable: ${errorMessage(error)}` };
      }
      throw error;
    }
    await waitFor("touch drag candidate", (current) => session(current)?.phase === "dragging"
      && session(current)?.candidate?.toZoneId === "lake" && session(current)?.candidate?.allowed === true);
    await touch(points.destination, "touchEnd");
    const landed = await waitFor("touch drop acceptance", (current) => current.probe.drops.length === 1
      && zoneCards(current, "lake").includes(cardId) && !current.snapshot.interaction.sessions.length);
    return { cardId, intent: landed.probe.drops[0], viewport: landed.viewport };
  });

  await runCase("actual drag stays attached through resize, ancestor/page scroll and full-window transition", async () => {
    await setControl("#drag-denied-zone", "");
    await setControl("#drag-response", "immediate");
    const cardId = await fixture();
    const points = await coordinates(cardId, "lake", { x: 22, y: -18 });
    await mousePress(points.start);
    await mouseMove({ x: points.start.x + 12, y: points.start.y + 8 });
    await waitFor("responsive drag pickup", (current) => session(current)?.phase === "dragging");

    const resized = await evaluate(`(async () => {
      const stage = document.querySelector("#stage");
      const column = document.querySelector(".scene-column");
      stage.style.width = "1100px";
      stage.style.height = "620px";
      column.style.height = "500px";
      column.style.overflow = "auto";
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { stage: stage.getBoundingClientRect().toJSON(), column: column.getBoundingClientRect().toJSON() };
    })()`);
    await waitFor("stage resize reconciliation", (current) => current.snapshot?.interaction?.sessions?.length === 1
      && current.viewport.stage?.width >= 1099 && current.viewport.stage?.height >= 619);
    // Sample while the pointer remains at the previous point. Any later edge
    // move is a separate input step and must not repair a resize attachment.
    const afterResize = await assertStationaryAttachment("stage resize");
    const resizePoint = { x: resized.column.left + resized.column.width / 2, y: resized.column.bottom - 4 };
    await mouseMove(resizePoint);
    await waitFor("scrollable ancestor auto-scroll", (current) => (current.scroll?.ancestor?.top ?? 0) > 0
      && session(current)?.phase === "dragging");
    const afterAncestorScroll = await assertStationaryAttachment("ancestor scroll");
    const ancestorScrolled = await state();

    await evaluate(`(() => {
      const column = document.querySelector(".scene-column");
      column.style.height = "auto";
      column.style.overflow = "visible";
      document.body.style.minHeight = (innerHeight + 800) + "px";
      document.documentElement.style.minHeight = (innerHeight + 800) + "px";
      window.scrollTo(0, 0);
      return true;
    })()`);
    const pageViewport = await state();
    await mouseMove({ x: resizePoint.x, y: pageViewport.viewport.innerHeight - 4 });
    await waitFor("page auto-scroll", (current) => (current.scroll?.page?.y ?? 0) > 0
      && session(current)?.phase === "dragging");
    const afterPageScroll = await assertStationaryAttachment("page scroll");
    const pageScrolled = await state();

    await evaluate(`(async () => {
      document.querySelector("#stage").style.removeProperty("width");
      document.querySelector("#stage").style.removeProperty("height");
      document.querySelector("#full-window-control")?.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return true;
    })()`);
    await waitFor("full-window transition", (current) => current.snapshot?.interaction?.sessions?.length === 1
      && current.viewport.stage?.width >= current.viewport.innerWidth - 1
      && current.fullWindow === true);
    const afterFullWindow = await assertStationaryAttachment("full-window transition");
    const destination = await evaluate(`(() => {
      const rect = document.querySelector("#zone-lake").getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await mouseMove(destination);
    const carrying = await waitFor("responsive destination candidate", (current) => session(current)?.phase === "dragging"
      && session(current)?.candidate?.toZoneId === "lake" && session(current)?.candidate?.allowed === true);
    await mouseRelease(destination);
    const landed = await waitFor("responsive drag landing", (current) => current.probe.drops.length === 1
      && zoneCards(current, "lake").includes(cardId) && !current.snapshot.interaction.sessions.length
      && !current.snapshot.settling);
    return {
      cardId,
      grabOffset: points.grabOffset,
      attachmentStages: {
        resized: resized.stage,
        ancestorScrolled: ancestorScrolled.scroll,
        pageScrolled: pageScrolled.scroll,
        stationaryErrors: {
          resizePx: afterResize.errorPx,
          ancestorScrollPx: afterAncestorScroll.errorPx,
          pageScrollPx: afterPageScroll.errorPx,
          fullWindowPx: afterFullWindow.errorPx,
        },
      },
      candidate: carrying.snapshot.interaction.sessions.at(-1)?.candidate,
      viewport: landed.viewport,
    };
  });

  await runCase("same-zone drag reorders committed membership without duplicate shells", async () => {
    await setControl("#drag-denied-zone", "");
    await setControl("#drag-response", "immediate");
    const fixtureState = await reorderFixture();
    const sourceId = fixtureState.sourceId;
    const before = await state();
    const points = await coordinates(sourceId, "river", { x: 18, y: -16 });
    const destination = await evaluate(`(() => {
      const rect = document.querySelector("#zone-river").getBoundingClientRect();
      return { x: rect.right - 24, y: rect.top + rect.height / 2 };
    })()`);
    await mousePress(points.start);
    await mouseMovePath(points.start, destination);
    const carrying = await waitFor("same-zone reorder candidate", (current) => session(current)?.phase === "dragging"
      && session(current)?.candidate?.toZoneId === "river" && session(current)?.candidate?.allowed === true
      && session(current)?.candidate?.index > 0);
    await mouseRelease(destination);
    const landed = await waitFor("same-zone reorder landing", (current) => current.probe.drops.length === 1
      && !current.snapshot.interaction.sessions.length && !current.snapshot.settling
      && zoneCards(current, "river").length === 3);
    const order = zoneCards(landed, "river");
    if (order[0] === sourceId || new Set(order).size !== 3 || landed.shells.length !== 3) {
      throw new Error(`Same-zone reorder did not move one stable shell: ${JSON.stringify({ before: zoneCards(before, "river"), order, shells: landed.shells })}`);
    }
    return { sourceId, before: zoneCards(before, "river"), order, candidate: carrying.snapshot.interaction.sessions.at(-1)?.candidate, shells: landed.shells };
  });

  await runCase("live element and dimension changes retain the active drag", async () => {
    await setControl("#drag-denied-zone", "");
    await setControl("#drag-response", "immediate");
    const cardId = await fixture();
    const points = await coordinates(cardId, "ocean", { x: 20, y: -16 });
    await mousePress(points.start);
    await mouseMovePath(points.start, points.destination);
    await waitFor("live-change drag candidate", (current) => session(current)?.phase === "dragging"
      && session(current)?.candidate?.toZoneId === "ocean" && session(current)?.candidate?.allowed === true);
    const live = await evaluate(`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      const id = scene.snapshot().desired.cards[0].id;
      await scene.transact([
        { type: "element", cardId: id, action: "add", elementId: "drag-live-element", element: { type: "text", content: { text: "Live drag element" }, layout: { mode: "flow" } } },
        { type: "resize", cardId: id, dimensions: { width: 210, height: 310 } },
      ]).finished;
      return { id };
    })()`);
    await waitFor("live element and resize update", (current) => session(current)?.phase === "dragging"
      && current.snapshot?.desired?.cards?.[0]?.dimensions?.width === 210
      && current.snapshot.desired.cards[0].faces?.[current.snapshot.desired.cards[0].activeFaceId]?.elements?.some(({ id }) => id === "drag-live-element"));
    const afterLiveResize = await assertStationaryAttachment("live element and dimension change");
    const removed = await evaluate(`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      await scene.transact([
        { type: "element", cardId: ${JSON.stringify(cardId)}, action: "remove", elementId: "drag-live-element" },
        { type: "resize", cardId: ${JSON.stringify(cardId)}, dimensions: { width: 180, height: 250 } },
      ]).finished;
      return true;
    })()`);
    if (!removed) throw new Error("Live element removal did not complete");
    await waitFor("live element removal during drag", (current) => session(current)?.phase === "dragging"
      && current.snapshot?.desired?.cards?.[0]?.dimensions?.width === 180
      && !current.snapshot.desired.cards[0].faces?.[current.snapshot.desired.cards[0].activeFaceId]?.elements?.some(({ id }) => id === "drag-live-element"));
    const afterLiveRemoval = await assertStationaryAttachment("live element removal");
    await mouseRelease(points.destination);
    const landed = await waitFor("live-change drag landing", (current) => current.probe.drops.length === 1
      && zoneCards(current, "ocean").includes(cardId) && !current.snapshot.interaction.sessions.length
      && !current.snapshot.settling);
    return {
      cardId,
      elementId: "drag-live-element",
      changed: live,
      removed,
      stationaryErrors: { addResizePx: afterLiveResize.errorPx, removeResizePx: afterLiveRemoval.errorPx },
      viewport: landed.viewport,
    };
  });

  await runCase("touch denial creates no drop or reserved slot", async () => {
    if (!touchEnabled) {
      try {
        await command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2, configuration: "desktop" });
        touchEnabled = true;
      } catch (error) {
        return { skipped: true, reason: `Touch emulation unavailable: ${errorMessage(error)}` };
      }
      await setControl("#drag-touch", true);
    }
    await waitFor("touch dragging enabled", (current) => current.controls.touchDrag === true);
    await setControl("#drag-denied-zone", "lake");
    await setControl("#drag-response", "immediate");
    const cardId = await fixture();
    const points = await coordinates(cardId, "lake");
    await touch(points.start);
    await touchPath(points.start, points.destination);
    const denied = await waitFor("touch denied candidate", (current) => session(current)?.phase === "dragging"
      && session(current)?.candidate?.toZoneId === "lake" && session(current)?.candidate?.allowed === false);
    await touch(points.destination, "touchEnd");
    const settled = await waitFor("touch denied release", (current) => current.probe.drops.length === 0
      && !current.snapshot.interaction.sessions.length && zoneCards(current, "river").includes(cardId));
    return { cardId, candidate: denied.snapshot.interaction.sessions.at(-1)?.candidate, viewport: settled.viewport };
  });

  await runCase("second touch contact cancels the active gesture", async () => {
    await setControl("#drag-denied-zone", "");
    await setControl("#drag-response", "immediate");
    const cardId = await fixture();
    const points = await coordinates(cardId, "ocean");
    await touch(points.start);
    await touch({ x: points.start.x + 12, y: points.start.y }, "touchMove");
    await waitFor("touch gesture before second contact", (current) => session(current)?.phase === "dragging");
    await touch({ x: points.start.x + 12, y: points.start.y }, "touchStart", [
      { x: points.start.x + 12, y: points.start.y, id: 1 },
      { x: points.start.x + 40, y: points.start.y + 20, id: 2 },
    ]);
    const cancelled = await waitFor("second-contact cancellation", (current) => current.probe.drops.length === 0
      && !current.snapshot.interaction.sessions.length && zoneCards(current, "river").includes(cardId)
      && current.inputAnnouncement.includes("Second touch contact"));
    return { cardId, cancelled: cancelled.inputAnnouncement, viewport: cancelled.viewport };
  });

  await runCase("outside-stage second touch cancels locally and does not claim the outside point", async () => {
    try {
      await command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2, configuration: "desktop" });
      touchEnabled = true;
    } catch (error) {
      return { skipped: true, reason: `Touch emulation unavailable: ${errorMessage(error)}` };
    }
    await setControl("#drag-touch", true);
    await setControl("#drag-denied-zone", "");
    await setControl("#drag-response", "immediate");
    const cardId = await fixture();
    const points = await coordinates(cardId, "ocean");
    const outside = await evaluate(`(() => {
      const stage = document.querySelector("#stage").getBoundingClientRect();
      const x = Math.min(innerWidth - 8, stage.right + 80);
      const y = Math.min(innerHeight - 8, stage.bottom + 80);
      return { x, y, insideStage: x >= stage.left && x <= stage.right && y >= stage.top && y <= stage.bottom };
    })()`);
    if (outside.insideStage) return { skipped: true, reason: "No visible point outside the stage at this viewport" };
    await evaluate(`(() => {
      const point = ${JSON.stringify(outside)};
      const probe = { count: 0, prevented: false, insideStage: false, target: null };
      const listener = (event) => {
        if (event.pointerType !== "touch" || event.isPrimary !== false) return;
        if (Math.abs(event.clientX - point.x) > 2 || Math.abs(event.clientY - point.y) > 2) return;
        probe.count += 1;
        probe.prevented ||= event.defaultPrevented;
        probe.insideStage ||= Boolean(event.target?.closest?.("#stage"));
        probe.target = event.target?.id || event.target?.className || event.target?.nodeName || null;
      };
      window.__outsideTouchProbe = { probe, listener };
      document.addEventListener("pointerdown", listener);
      return true;
    })()`);
    await touch(points.start);
    await touch({ x: points.start.x + 12, y: points.start.y }, "touchMove");
    await waitFor("outside-touch gesture before second contact", (current) => session(current)?.phase === "dragging");
    await touch(outside, "touchStart", [
      { x: points.start.x + 12, y: points.start.y, id: 1 },
      { x: outside.x, y: outside.y, id: 2 },
    ]);
    const cancelled = await waitFor("outside-stage second-contact cancellation", (current) => current.probe.drops.length === 0
      && !current.snapshot.interaction.sessions.length && zoneCards(current, "river").includes(cardId)
      && current.inputAnnouncement.includes("Second touch contact"));
    const outsideProbe = await evaluate(`(() => {
      const current = window.__outsideTouchProbe?.probe ?? null;
      const listener = window.__outsideTouchProbe?.listener;
      if (listener) document.removeEventListener("pointerdown", listener);
      window.__outsideTouchProbe = null;
      return current;
    })()`);
    if (!outsideProbe || outsideProbe.count < 1 || outsideProbe.prevented || outsideProbe.insideStage) {
      throw new Error(`Outside second contact was claimed or not observed: ${JSON.stringify(outsideProbe)}`);
    }
    return { cardId, outside, cancelled: cancelled.inputAnnouncement, outsideProbe, viewport: cancelled.viewport };
  });

  await runCase("rule invalidation makes a pending approval stale", async () => {
    await setControl("#drag-denied-zone", "");
    await setControl("#drag-response", "manual");
    const cardId = await fixture();
    const points = await coordinates(cardId, "lake");
    await mousePress(points.start);
    await mouseMovePath(points.start, points.destination);
    await waitFor("rule-race candidate", (current) => session(current)?.candidate?.toZoneId === "lake"
      && session(current)?.candidate?.allowed === true);
    await mouseRelease(points.destination);
    const pending = await waitFor("rule-race pending approval", (current) => session(current)?.phase === "pending");
    const intentId = session(pending).id;
    await setControl("#drag-denied-zone", "lake");
    const cancelled = await waitFor("rule-race cancellation", (current) => current.probe.drops.length === 1
      && !current.snapshot.interaction.sessions.length && zoneCards(current, "river").includes(cardId));
    const stale = await evaluate(`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      return getScene().resolveDrop(${JSON.stringify(intentId)}, { accepted: true });
    })()`);
    if (stale.status !== "stale") throw new Error(`Expected stale rule-race response: ${JSON.stringify(stale)}`);
    return { cardId, intentId, pending: pending.snapshot.interaction.sessions.at(-1), stale, viewport: cancelled.viewport };
  });

  await runCase("card removal makes a pending approval stale without resurrection", async () => {
    await setControl("#drag-denied-zone", "");
    await setControl("#drag-response", "manual");
    const cardId = await fixture();
    const points = await coordinates(cardId, "lake");
    await mousePress(points.start);
    await mouseMovePath(points.start, points.destination);
    await waitFor("removal-race candidate", (current) => session(current)?.candidate?.toZoneId === "lake"
      && session(current)?.candidate?.allowed === true);
    await mouseRelease(points.destination);
    const pending = await waitFor("removal-race pending approval", (current) => session(current)?.phase === "pending");
    const intentId = session(pending).id;
    await evaluate(`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      window.__dragRemovalRestore = structuredClone(scene.snapshot().desired);
      const desired = structuredClone(scene.snapshot().desired);
      desired.cards = [];
      desired.zones = desired.zones.map((zone) => ({ ...zone, cardIds: [] }));
      scene.apply(desired);
      return true;
    })()`);
    const removed = await waitFor("card removal cancellation", (current) => current.probe.drops.length === 1
      && !current.snapshot.interaction.sessions.length && current.shells.length === 0);
    const stale = await evaluate(`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      const result = scene.resolveDrop(${JSON.stringify(intentId)}, { accepted: true });
      if (scene.snapshot().desired.cards.length || document.querySelectorAll("#stage .cardinal-webgl-card").length) {
        throw new Error("Late approval resurrected the removed card");
      }
      scene.apply(window.__dragRemovalRestore);
      return result;
    })()`);
    if (stale.status !== "stale") throw new Error(`Expected stale removal response: ${JSON.stringify(stale)}`);
    const restored = await waitFor("removed card restoration", (current) => current.shells.length === 1
      && current.snapshot?.desired?.cards?.some(({ id }) => id === cardId));
    return { cardId, intentId, stale, removedShells: removed.shells, restoredShells: restored.shells, viewport: restored.viewport };
  });

  if (touchEnabled) await command("Emulation.setTouchEmulationEnabled", { enabled: false }).catch(() => {});
  const finalState = await state();
  return {
    ok: results.every((result) => result.pass && !result.skipped),
    results,
    environment: finalState.viewport,
    renderer: finalState.rendererText,
  };
}
