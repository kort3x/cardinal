import { setTimeout as delay } from "node:timers/promises";
import { createPageEvaluator } from "./chrome-runtime.mjs";

const LAB_MODULE = "/examples/card-engine-lab/main.js";
const CARD_COUNTS = [1, 10, 50];
const SAMPLE_DURATION_MS = 1000;
const DRAG_STEPS = 24;
const DRAG_STEP_MS = 20;
const WAIT_MS = 10000;
const POLL_MS = 50;

const round = (value) => Number(value.toFixed(3));

function distribution(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = (fraction) => finite.length
    ? finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * fraction))]
    : null;
  return {
    count: finite.length,
    minMs: finite.length ? round(finite[0]) : null,
    medianMs: percentile(0.5) === null ? null : round(percentile(0.5)),
    p95Ms: percentile(0.95) === null ? null : round(percentile(0.95)),
    maxMs: finite.length ? round(finite.at(-1)) : null,
  };
}

function commandFunction(command) {
  if (typeof command !== "function") {
    throw new TypeError("Drag performance scenario requires a CDP command function");
  }
  return command;
}

export async function runDragPerformanceScenario({ command }) {
  const cdp = commandFunction(command);

  const evaluate = createPageEvaluator(cdp);

  async function sceneState() {
    return evaluate(String.raw`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      const snapshot = scene?.snapshot?.();
      return {
        snapshot,
        shells: document.querySelectorAll("#stage .cardinal-webgl-card").length,
        renderer: document.querySelector("#renderer-status")?.textContent ?? "",
        status: document.querySelector("#status")?.textContent ?? "",
        diagnostics: (() => {
          try { return JSON.parse(document.querySelector("#diagnostics-report")?.textContent ?? "null"); }
          catch { return null; }
        })(),
        controls: {
          dragEnabled: document.querySelector("#drag-enabled")?.checked ?? null,
          touchDrag: document.querySelector("#drag-touch")?.checked ?? null,
          response: document.querySelector("#drag-response")?.value ?? null,
        },
      };
    })()`);
  }

  async function waitFor(label, predicate, timeout = WAIT_MS) {
    const started = Date.now();
    let current;
    while (Date.now() - started < timeout) {
      current = await sceneState();
      try {
        if (predicate(current)) return current;
      } catch {
        // Keep polling while the lab is reconciling the fixture.
      }
      await delay(POLL_MS);
    }
    current ??= await sceneState();
    throw new Error(`${label} timed out: ${JSON.stringify({
      renderer: current.renderer,
      status: current.status,
      cards: current.snapshot?.desired?.cards?.length ?? null,
      shells: current.shells,
      settling: current.snapshot?.settling ?? null,
      interaction: current.snapshot?.interaction ?? null,
    })}`);
  }

  async function environment() {
    return evaluate(`(() => {
      const stage = document.querySelector("#stage")?.getBoundingClientRect();
      return {
        userAgent: navigator.userAgent,
        platform: navigator.platform ?? null,
        language: navigator.language ?? null,
        innerWidth,
        innerHeight,
        outerWidth,
        outerHeight,
        screenX,
        screenY,
        devicePixelRatio,
        stage: stage ? {
          left: Number(stage.left.toFixed(2)),
          top: Number(stage.top.toFixed(2)),
          width: Number(stage.width.toFixed(2)),
          height: Number(stage.height.toFixed(2)),
        } : null,
      };
    })()`);
  }

  async function setLabControls() {
    await evaluate(`(() => {
      const enabled = document.querySelector("#drag-enabled");
      if (enabled && !enabled.checked) {
        enabled.checked = true;
        enabled.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const response = document.querySelector("#drag-response");
      if (response) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        setter.call(response, "immediate");
        response.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    })()`);
  }

  async function configureFixture(count) {
    const result = await evaluate(String.raw`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      if (!scene) throw new Error("Cardinal lab scene is not ready");
      if (!window.__cardinalDragPerformanceOriginalState) {
        const snapshot = scene.snapshot();
        window.__cardinalDragPerformanceOriginalState = {
          desired: structuredClone(snapshot.desired),
          selection: structuredClone(snapshot.selection),
          controls: {
            dragEnabled: document.querySelector("#drag-enabled")?.checked ?? true,
            touchDrag: document.querySelector("#drag-touch")?.checked ?? false,
            response: document.querySelector("#drag-response")?.value ?? "immediate",
          },
        };
      }
      const original = window.__cardinalDragPerformanceOriginalState;
      const template = original.desired.cards[0];
      if (!template) throw new Error("Performance fixture has no template card");
      for (const card of scene.snapshot().desired.cards) scene.stopSpin(card.id);
      const cardIds = Array.from({ length: ${count} }, (_, index) =>
        ${count} === 1 ? template.id : "drag-performance-" + ${count} + "-" + (index + 1));
      const cards = cardIds.map((id) => ({ ...structuredClone(template), id }));
      const zones = original.desired.zones.map((zone) => ({
        ...structuredClone(zone),
        visible: true,
        cardIds: zone.id === "reserve" ? cardIds : [],
      }));
      scene.apply({ cards, zones });
      scene.select([cardIds[0]], { primaryCardId: cardIds[0] });
      return { cardIds, primaryCardId: cardIds[0] };
    })()`);
    await waitFor(`fixture with ${count} mounted cards`, (current) =>
      current.snapshot?.renderer === "webgl"
      && current.snapshot?.desired?.cards?.length === count
      && current.shells === count
      && !current.snapshot.settling
      && current.snapshot?.desired?.zones?.find((zone) => zone.id === "reserve")?.cardIds?.length === count);
    return result;
  }

  async function restoreFixture() {
    await evaluate(String.raw`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      const original = window.__cardinalDragPerformanceOriginalState;
      if (!scene || !original) return false;
      for (const card of scene.snapshot().desired.cards) scene.stopSpin(card.id);
      scene.apply(structuredClone(original.desired));
      const touchDrag = document.querySelector("#drag-touch");
      if (touchDrag && touchDrag.checked !== original.controls.touchDrag) {
        touchDrag.checked = original.controls.touchDrag;
        touchDrag.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const currentScene = (await import(${JSON.stringify(LAB_MODULE)})).getScene();
      const enabled = document.querySelector("#drag-enabled");
      if (enabled && enabled.checked !== original.controls.dragEnabled) {
        enabled.checked = original.controls.dragEnabled;
        enabled.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const response = document.querySelector("#drag-response");
      if (response) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        setter.call(response, original.controls.response);
        response.dispatchEvent(new Event("change", { bubbles: true }));
      }
      currentScene.select(original.selection.cardIds, {
        primaryCardId: original.selection.primaryCardId,
        anchorCardId: original.selection.anchorCardId,
      });
      return true;
    })()`);
    const expectedCards = await evaluate(`(() => window.__cardinalDragPerformanceOriginalState?.desired?.cards?.length ?? 1)()`);
    const expectedSelection = await evaluate(`(() => window.__cardinalDragPerformanceOriginalState?.selection ?? null)()`);
    const expectedControls = await evaluate(`(() => window.__cardinalDragPerformanceOriginalState?.controls ?? null)()`);
    await waitFor("performance fixture cleanup", (current) =>
      current.snapshot?.renderer === "webgl"
      && current.snapshot?.desired?.cards?.length === expectedCards
      && current.shells === expectedCards
      && !current.snapshot.settling
      && !current.snapshot.spinning
      && JSON.stringify(current.snapshot.selection) === JSON.stringify(expectedSelection)
      && JSON.stringify(current.controls) === JSON.stringify(expectedControls));
  }

  async function installProbe(cardId) {
    await evaluate(String.raw`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      const stage = document.querySelector("#stage");
      if (!scene || !stage) throw new Error("Performance probe requires the Cardinal stage");
      window.__cardinalDragPerformanceProbe?.cleanup?.();
      const probe = {
        cardId: ${JSON.stringify(cardId)},
        sampling: false,
        frameHandle: null,
        frameTimes: [],
        motionFrames: [],
        inputEvents: [],
        previousPosition: null,
      };
      const inputListener = (event) => {
        if (!probe.sampling) return;
        probe.inputEvents.push({
          type: event.type,
          at: performance.now(),
          pointerType: event.pointerType ?? null,
          pointerId: event.pointerId ?? null,
          button: event.button ?? null,
          buttons: event.buttons ?? null,
          clientX: event.clientX ?? null,
          clientY: event.clientY ?? null,
        });
      };
      for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
        stage.addEventListener(type, inputListener, true);
      }
      const sample = (now) => {
        if (!probe.sampling) return;
        const observedAt = performance.now();
        probe.frameTimes.push(now);
        const visual = scene.snapshot().visual.find(({ cardId: id }) => id === probe.cardId);
        const pose = visual?.pose;
        if (pose) {
          const position = { x: pose.x, y: pose.y, z: pose.z ?? 0 };
          const previous = probe.previousPosition;
          if (previous && (position.x !== previous.x || position.y !== previous.y || position.z !== previous.z)) {
            probe.motionFrames.push({ rAFAt: now, observedAt, position });
          }
          probe.previousPosition = position;
        }
        probe.frameHandle = requestAnimationFrame(sample);
      };
      probe.begin = () => {
        probe.frameTimes = [];
        probe.motionFrames = [];
        probe.inputEvents = [];
        probe.previousPosition = null;
        probe.sampling = true;
        probe.frameHandle = requestAnimationFrame(sample);
      };
      probe.end = () => {
        probe.sampling = false;
        if (probe.frameHandle !== null) cancelAnimationFrame(probe.frameHandle);
        probe.frameHandle = null;
        return {
          frameTimes: [...probe.frameTimes],
          motionFrames: [...probe.motionFrames],
          inputEvents: [...probe.inputEvents],
        };
      };
      probe.cleanup = () => {
        probe.end?.();
        for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
          stage.removeEventListener(type, inputListener, true);
        }
      };
      window.__cardinalDragPerformanceProbe = probe;
      return true;
    })()`);
  }

  async function beginProbe() {
    await evaluate("(() => { window.__cardinalDragPerformanceProbe?.begin(); return true; })()");
  }

  async function endProbe() {
    return evaluate("(() => window.__cardinalDragPerformanceProbe?.end?.() ?? null)()");
  }

  async function startExistingMotion(cardIds) {
    await evaluate(`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      for (const cardId of ${JSON.stringify(cardIds)}) {
        scene.spin(cardId, { axis: "y", direction: 1, speed: 180 });
      }
      return true;
    })()`);
    await waitFor("existing motion to start", (current) => current.snapshot?.spinning === true);
  }

  async function stopExistingMotion(cardIds) {
    await evaluate(`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      for (const cardId of ${JSON.stringify(cardIds)}) scene.stopSpin(cardId);
      return true;
    })()`);
    await waitFor("existing motion to stop", (current) =>
      current.snapshot?.spinning === false && !current.snapshot?.settling);
  }

  async function coordinates(cardId) {
    return evaluate(`(async () => {
      const { getScene } = await import(${JSON.stringify(LAB_MODULE)});
      const scene = getScene();
      const visual = scene.snapshot().visual.find(({ cardId: id }) => id === ${JSON.stringify(cardId)});
      const destination = document.querySelector("#zone-workbench")?.getBoundingClientRect();
      if (!visual?.pose || !destination || destination.width <= 0 || destination.height <= 0) {
        throw new Error("Missing drag card or destination geometry");
      }
      const start = scene.sceneToClient(visual.pose);
      return {
        start,
        destination: {
          x: destination.left + destination.width / 2,
          y: destination.top + destination.height / 2,
        },
      };
    })()`);
  }

  let mouseDown = false;
  let lastMousePoint = null;

  async function mouseMove(point, buttons = mouseDown ? 1 : 0) {
    lastMousePoint = point;
    await cdp("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button: buttons ? "left" : "none",
      buttons,
    });
  }

  async function mousePress(point) {
    await mouseMove(point, 0);
    await cdp("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    mouseDown = true;
  }

  async function mouseRelease(point = lastMousePoint) {
    if (!mouseDown) return;
    try {
      await cdp("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: point?.x ?? 0,
        y: point?.y ?? 0,
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
    } finally {
      mouseDown = false;
    }
  }

  async function dragThrough(start, destination) {
    await mousePress(start);
    try {
      for (let index = 1; index <= DRAG_STEPS; index += 1) {
        const fraction = index / DRAG_STEPS;
        await mouseMove({
          x: start.x + (destination.x - start.x) * fraction,
          y: start.y + (destination.y - start.y) * fraction,
        });
        if (index === 1) {
          await waitFor("pointer drag pickup", (current) =>
            current.snapshot?.interaction?.sessions?.some((session) => session.phase === "dragging"));
        }
        await delay(DRAG_STEP_MS);
      }
      await mouseRelease(destination);
    } catch (error) {
      await mouseRelease().catch(() => {});
      throw error;
    }
  }

  function measurement(count, condition, sample) {
    const frameTimes = sample?.frameTimes ?? [];
    const frameIntervalsMs = frameTimes.slice(1).map((time, index) => time - frameTimes[index]);
    const inputEvents = sample?.inputEvents ?? [];
    const motionFrames = sample?.motionFrames ?? [];
    const pointerMoves = inputEvents.filter((event) => event.type === "pointermove" && event.buttons === 1);
    const responseSamplesMs = pointerMoves.map((event) => {
      const motionFrame = motionFrames.find(({ observedAt }) => observedAt >= event.at);
      return motionFrame ? motionFrame.observedAt - event.at : null;
    });
    const matchedResponses = responseSamplesMs.filter(Number.isFinite);
    return {
      cards: count,
      condition,
      frames: frameTimes.length,
      frameIntervalsMs: frameIntervalsMs.map(round),
      frameIntervalSummary: distribution(frameIntervalsMs),
      pointerEvents: inputEvents.length,
      pointerMoves: pointerMoves.length,
      eventToNextObservedMotionFrameMs: matchedResponses.map(round),
      eventToNextObservedMotionFrameSummary: distribution(matchedResponses),
      unmatchedPointerMoves: responseSamplesMs.length - matchedResponses.length,
      observedMotionFrames: motionFrames.length,
    };
  }

  async function measureRest(count) {
    const fixture = await configureFixture(count);
    await installProbe(fixture.primaryCardId);
    await beginProbe();
    await delay(SAMPLE_DURATION_MS);
    return measurement(count, "rest", await endProbe());
  }

  async function measureMotion(count) {
    const fixture = await configureFixture(count);
    await startExistingMotion(fixture.cardIds);
    await installProbe(fixture.primaryCardId);
    await beginProbe();
    await delay(SAMPLE_DURATION_MS);
    const sample = await endProbe();
    await stopExistingMotion(fixture.cardIds);
    return measurement(count, "existing-motion", sample);
  }

  async function measureDrag(count) {
    const fixture = await configureFixture(count);
    const points = await coordinates(fixture.primaryCardId);
    await installProbe(fixture.primaryCardId);
    await evaluate(`(() => {
      const button = document.querySelector("#record-drag");
      if (!button) throw new Error("Lab drag diagnostics control is unavailable");
      button.click();
      return button.getAttribute("aria-pressed") === "true";
    })()`);
    await beginProbe();
    try {
      await dragThrough(points.start, points.destination);
    } finally {
      await mouseRelease().catch(() => {});
    }
    const sample = await endProbe();
    const landed = await waitFor("pointer drag to finish in Workbench", (current) =>
      current.snapshot?.interaction?.sessions?.length === 0
      && !current.snapshot?.settling
      && current.snapshot?.desired?.zones?.find((zone) => zone.id === "workbench")?.cardIds?.includes(fixture.primaryCardId));
    const sampled = await waitFor("lab drag diagnostic sample", (current) =>
      current.diagnostics?.lab?.dragCapture?.lastSample?.cardId === fixture.primaryCardId
      && current.diagnostics?.lab?.dragCapture?.lastSample?.pointerType === "mouse");
    return {
      ...measurement(count, "pointer-drag", sample),
      transfer: {
        cardId: fixture.primaryCardId,
        toZoneId: landed.snapshot.desired.zones.find((zone) => zone.id === "workbench")?.id ?? null,
      },
      labDragSample: sampled.diagnostics.lab.dragCapture.lastSample,
    };
  }

  const results = [];
  const measurements = [];
  async function record(label, action) {
    try {
      const details = await action();
      measurements.push(details);
      const inputObserved = details.condition !== "pointer-drag"
        || details.pointerMoves > 0 && details.observedMotionFrames > 0
          && details.transfer?.toZoneId === "workbench"
          && details.labDragSample?.pointerMoves > 0
          && details.labDragSample?.observedMotionFrames > 0;
      results.push({ label, pass: details.frames > 0 && inputObserved, status: "sampled", details });
    } catch (error) {
      results.push({
        label,
        pass: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const initialEnvironment = await environment();
  await setLabControls();
  let cleanupError = null;
  try {
    for (const count of CARD_COUNTS) {
      await record(`${count}-card rest frame sample`, () => measureRest(count));
      await record(`${count}-card existing-motion frame sample`, () => measureMotion(count));
      await record(`${count}-card real pointer-drag sample`, () => measureDrag(count));
    }
  } finally {
    try {
      await mouseRelease();
    } catch (error) {
      cleanupError ??= error;
    }
    try {
      await evaluate("(() => { window.__cardinalDragPerformanceProbe?.cleanup?.(); return true; })()");
    } catch (error) {
      cleanupError ??= error;
    }
    try {
      await restoreFixture();
    } catch (error) {
      cleanupError ??= error;
    }
  }
  results.push(cleanupError
    ? {
      label: "performance fixture cleanup",
      pass: false,
      error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
    }
    : {
      label: "performance fixture cleanup",
      pass: true,
      status: "restored",
      details: "Prior scene, selection, and drag controls were restored after sampling.",
    });
  return {
    ok: results.every((result) => result.pass),
    results,
    environment: initialEnvironment,
    measurementNotes: {
      frameIntervals: "Intervals use requestAnimationFrame timestamps supplied to the callback.",
      motionObservation: "Motion frames are observed at performance.now() at callback entry; they are not paint-completion timestamps.",
      responseMetric: "eventToNextObservedMotionFrameMs measures pointermove to the next rAF callback that observes a changed primary-card position; it is not presentation or paint latency.",
      probeOverhead: "Each sampled rAF reads scene.snapshot().visual for the primary card. Snapshot and frame-sampling work are included in the measured workload.",
      thresholds: "No performance thresholds or pass/fail hardware claims are applied.",
    },
    measurements,
  };
}
