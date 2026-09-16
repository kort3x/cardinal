import { setTimeout as delay } from "node:timers/promises";
import { createPageEvaluator } from "./chrome-runtime.mjs";

const ENGINE_MODULE = "/packages/card-engine/src/index.js";
const POLL_MS = 20;
const WAIT_MS = 5000;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function runDragGeometryScenario({ command }) {
  if (typeof command !== "function") throw new TypeError("Drag geometry scenario requires a CDP command function");

  const evaluate = createPageEvaluator(command);

  async function waitFor(label, predicate, timeout = WAIT_MS) {
    const started = Date.now();
    let current;
    while (Date.now() - started < timeout) {
      current = await evaluate(`(async () => {
        const fixture = window.__cardinalDragGeometryFixture;
        const scene = fixture?.scene;
        return scene ? {
          interaction: scene.snapshot().interaction,
          desired: scene.snapshot().desired,
          visual: scene.snapshot().visual,
          drops: structuredClone(fixture.drops ?? []),
        } : null;
      })()`);
      try {
        if (predicate(current)) return current;
      } catch {
        // Keep polling while the browser finishes a real input transition.
      }
      await delay(POLL_MS);
    }
    throw new Error(`${label} timed out: ${JSON.stringify(current)}`);
  }

  function expressionForProjection(projection) {
    return `(async () => {
      const { createCardScene } = await import(${JSON.stringify(ENGINE_MODULE)});
      window.__cardinalDragGeometryFixture?.dispose?.();
      const stage = document.createElement("div");
      stage.id = "cardinal-drag-geometry-stage";
      stage.style.cssText = [
        "position:fixed", "left:24px", "top:24px", "width:1200px", "height:800px",
        "z-index:2147483000", "overflow:visible", "background:transparent", "isolation:isolate",
      ].join(";");
      document.body.append(stage);
      const face = (text) => ({ elements: [{ id: "label", type: "text", content: { text } }] });
      const card = (id, template, x, y, faceUp = true) => ({
        id,
        template,
        activeFaceId: "front",
        faces: { front: face(id), alternate: face(id + " alternate") },
        back: face(id + " concealed"),
        faceCycle: ["front", "alternate"],
        faceUp,
        pose: { x, y, angle: 0, flipX: 0, flipY: faceUp ? 0 : 180, scale: 1 },
        positionMode: "absolute",
      });
      const zone = (id, x, y, depth, cardIds, extra = {}) => ({
        id,
        geometry: { x, y, width: 240, height: 340, depth },
        cardIds,
        ...extra,
      });
      const scene = createCardScene({
        element: stage,
        templates: {
          rounded: { width: 180, height: 250, thickness: 14, shape: "rounded-rectangle" },
          shield: { width: 180, height: 250, thickness: 14, shape: "shield" },
        },
        camera: { projection: ${JSON.stringify(projection)}, scaleMode: "stage", center: { x: 0, y: 0 }, distance: 1200, fov: 55 },
        motion: { reducedMotion: true },
      });
      scene.apply({
        cards: [
          card("rounded", "rounded", -350, 0),
          card("shield", "shield", 350, 0),
          card("sided", "rounded", 0, -250),
          card("overlap-lower", "rounded", 0, 235),
          card("overlap-upper", "rounded", 0, 235),
        ],
        zones: [
          zone("rounded-zone", -470, -350, 80, ["rounded"]),
          zone("shield-zone", 230, -350, 120, ["shield"]),
          zone("sided-zone", -120, -390, 220, ["sided"]),
          zone("overlap-lower-zone", -120, 60, 40, ["overlap-lower"]),
          zone("overlap-upper-zone", -120, 60, 40, ["overlap-upper"]),
        ],
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const fixture = {
        scene,
        stage,
        environment() {
          const rect = stage.getBoundingClientRect();
          return {
            userAgent: navigator.userAgent,
            innerWidth,
            innerHeight,
            outerWidth,
            outerHeight,
            screenX,
            screenY,
            devicePixelRatio,
            stage: {
              left: Number(rect.left.toFixed(2)),
              top: Number(rect.top.toFixed(2)),
              width: Number(rect.width.toFixed(2)),
              height: Number(rect.height.toFixed(2)),
            },
          };
        },
        dispose() {
          scene.destroy();
          stage.remove();
        },
      };
      window.__cardinalDragGeometryFixture = fixture;
      return {
        renderer: scene.snapshot().renderer,
        projection: scene.snapshot().projection,
        environment: fixture.environment(),
      };
    })()`;
  }

  async function installProjection(projection) {
    return evaluate(expressionForProjection(projection));
  }

  async function geometryReport(projection) {
    return evaluate(`(async () => {
      const fixture = window.__cardinalDragGeometryFixture;
      const scene = fixture?.scene;
      if (!scene) throw new Error("Geometry fixture is not installed");
      await scene.transact([{ type: "face", cardId: "sided", face: "faceUp", axis: "y", angle: 0 }]).finished;
      const state = scene.snapshot();
      const visual = (id) => state.visual.find((entry) => entry.cardId === id)?.pose;
      const projectedHit = (world) => {
        const client = scene.sceneToClient(world);
        const scenePoint = scene.clientToScene(client, 0);
        return { client, scenePoint, hit: scene.hitTest(scenePoint) };
      };
      const roundedPose = visual("rounded");
      const shieldPose = visual("shield");
      const sidedPose = visual("sided");
      const roundedCorner = projectedHit({
        x: roundedPose.x + roundedPose.width / 2 - 2,
        y: roundedPose.y - roundedPose.height / 2 + 2,
        z: roundedPose.z,
      });
      const shieldCorner = projectedHit({
        x: shieldPose.x + shieldPose.width / 2 - 1,
        y: shieldPose.y - shieldPose.height / 2 + 1,
        z: shieldPose.z,
      });
      const front = projectedHit({ x: sidedPose.x, y: sidedPose.y, z: sidedPose.z });
      await scene.transact([{ type: "face", cardId: "sided", face: "faceDown" }]).finished;
      const backPose = scene.snapshot().visual.find((entry) => entry.cardId === "sided").pose;
      const back = projectedHit({ x: backPose.x, y: backPose.y, z: backPose.z });
      await scene.transact([{ type: "face", cardId: "sided", face: "faceUp", axis: "y", angle: 90 }]).finished;
      const edgePose = scene.snapshot().visual.find((entry) => entry.cardId === "sided").pose;
      const edge = projectedHit({ x: edgePose.x, y: edgePose.y, z: edgePose.z });
      const lowerPose = visual("overlap-lower");
      const upperPose = visual("overlap-upper");
      const overlap = projectedHit({ x: upperPose.x, y: upperPose.y, z: upperPose.z });
      return {
        renderer: state.renderer,
        projection: state.projection,
        roundedCornerHit: roundedCorner.hit,
        shieldCornerHit: shieldCorner.hit,
        frontHit: front.hit,
        backHit: back.hit,
        edgeHit: edge.hit,
        overlapHit: overlap.hit,
        overlapDrawOrders: [lowerPose.drawOrder, upperPose.drawOrder],
        environment: fixture.environment(),
      };
    })()`);
  }

  async function installZoneFixture(dropTarget) {
    return evaluate(`(async () => {
      const { createCardScene } = await import(${JSON.stringify(ENGINE_MODULE)});
      window.__cardinalDragGeometryFixture?.dispose?.();
      const stage = document.createElement("div");
      stage.id = "cardinal-drag-zone-stage";
      stage.style.cssText = "position:fixed;left:24px;top:24px;width:1200px;height:800px;z-index:2147483000;overflow:visible;background:transparent;isolation:isolate";
      document.body.append(stage);
      const face = (text) => ({ elements: [{ id: "label", type: "text", content: { text } }] });
      const scene = createCardScene({
        element: stage,
        templates: { rounded: { width: 180, height: 250, thickness: 14, shape: "rounded-rectangle" } },
        camera: { projection: "perspective", scaleMode: "stage", center: { x: 0, y: 0 }, distance: 1200, fov: 55 },
        motion: { reducedMotion: true },
        interaction: {
          rules: {
            canStart: () => ({ allowed: true }),
            canDrop: ({ toZoneId }) => toZoneId === "lower" ? { allowed: true } : { allowed: false, reason: "Foreground zone denied" },
          },
        },
      });
      scene.apply({
        cards: [{
          id: "zone-drag-card",
          template: "rounded",
          activeFaceId: "front",
          faces: { front: face("zone drag") },
          back: face("concealed"),
          faceUp: true,
          pose: { x: -390, y: 0, flipX: 0, flipY: 0, scale: 1 },
          positionMode: "absolute",
        }],
        zones: [
          { id: "source", geometry: { x: -540, y: -220, width: 260, height: 440, depth: 180 }, cardIds: ["zone-drag-card"] },
          { id: "foreground", geometry: { x: -120, y: -220, width: 440, height: 440, depth: 300 }, cardIds: [], dropTarget: ${JSON.stringify(dropTarget)} },
          { id: "lower", geometry: { x: -120, y: -220, width: 440, height: 440, depth: 100 }, cardIds: [] },
        ],
      });
      const drops = [];
      scene.on("drop", (intent) => { drops.push(intent); scene.resolveDrop(intent.id, { accepted: true }); });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const fixture = {
        scene,
        stage,
        drops,
        environment() {
          const rect = stage.getBoundingClientRect();
          return {
            userAgent: navigator.userAgent,
            innerWidth,
            innerHeight,
            outerWidth,
            outerHeight,
            screenX,
            screenY,
            devicePixelRatio,
            stage: { left: Number(rect.left.toFixed(2)), top: Number(rect.top.toFixed(2)), width: Number(rect.width.toFixed(2)), height: Number(rect.height.toFixed(2)) },
          };
        },
        dispose() { scene.destroy(); stage.remove(); },
      };
      window.__cardinalDragGeometryFixture = fixture;
      const state = scene.snapshot();
      const pose = state.visual.find(({ cardId }) => cardId === "zone-drag-card").pose;
      const destination = state.zones.find(({ id }) => id === "foreground").geometry;
      return {
        renderer: state.renderer,
        projection: state.projection,
        start: scene.sceneToClient(pose),
        destination: scene.sceneToClient({ x: destination.x + destination.width / 2, y: destination.y + destination.height / 2, z: destination.depth }),
        startHit: scene.hitTest(scene.clientToScene(scene.sceneToClient(pose), 0)),
        depth: pose.z,
        environment: fixture.environment(),
      };
    })()`);
  }

  async function installDragFixture() {
    return evaluate(`(async () => {
      const { createCardScene } = await import(${JSON.stringify(ENGINE_MODULE)});
      window.__cardinalDragGeometryFixture?.dispose?.();
      const stage = document.createElement("div");
      stage.id = "cardinal-drag-perspective-stage";
      stage.style.cssText = "position:fixed;left:24px;top:24px;width:1200px;height:800px;z-index:2147483000;overflow:visible;background:transparent;isolation:isolate";
      document.body.append(stage);
      const face = (text) => ({ elements: [{ id: "label", type: "text", content: { text } }] });
      const scene = createCardScene({
        element: stage,
        templates: { rounded: { width: 180, height: 250, thickness: 14, shape: "rounded-rectangle" } },
        camera: { projection: "perspective", scaleMode: "stage", center: { x: 0, y: 0 }, distance: 1200, fov: 55 },
        motion: { reducedMotion: true },
        interaction: { rules: { canStart: () => ({ allowed: true }), canDrop: () => ({ allowed: true }) } },
      });
      scene.apply({
        cards: [{
          id: "perspective-drag-card",
          template: "rounded",
          activeFaceId: "front",
          faces: { front: face("perspective drag") },
          back: face("concealed"),
          faceUp: true,
          pose: { x: -390, y: 0, flipX: 0, flipY: 0, scale: 1 },
          positionMode: "absolute",
        }],
        zones: [
          { id: "source", geometry: { x: -540, y: -220, width: 260, height: 440, depth: 240 }, cardIds: ["perspective-drag-card"] },
          { id: "destination", geometry: { x: 80, y: -220, width: 440, height: 440, depth: 80 }, cardIds: [] },
        ],
      });
      const drops = [];
      scene.on("drop", (intent) => { drops.push(intent); scene.resolveDrop(intent.id, { accepted: true }); });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const fixture = {
        scene,
        stage,
        drops,
        environment() {
          const rect = stage.getBoundingClientRect();
          return {
            userAgent: navigator.userAgent,
            innerWidth,
            innerHeight,
            outerWidth,
            outerHeight,
            screenX,
            screenY,
            devicePixelRatio,
            stage: { left: Number(rect.left.toFixed(2)), top: Number(rect.top.toFixed(2)), width: Number(rect.width.toFixed(2)), height: Number(rect.height.toFixed(2)) },
          };
        },
        dispose() { scene.destroy(); stage.remove(); },
      };
      window.__cardinalDragGeometryFixture = fixture;
      const state = scene.snapshot();
      const pose = state.visual.find(({ cardId }) => cardId === "perspective-drag-card").pose;
      const destination = state.zones.find(({ id }) => id === "destination").geometry;
      const grab = scene.sceneToClient({ x: pose.x + 34, y: pose.y + 26, z: pose.z });
      const stageBounds = stage.getBoundingClientRect();
      return {
        renderer: state.renderer,
        projection: state.projection,
        start: scene.sceneToClient(pose),
        grab,
        cameraCenter: { x: stageBounds.left + stageBounds.width / 2, y: stageBounds.top + stageBounds.height / 2 },
        destination: scene.sceneToClient({ x: destination.x + destination.width / 2, y: destination.y + destination.height / 2, z: destination.depth }),
        startHit: scene.hitTest(scene.clientToScene(scene.sceneToClient(pose), 0)),
        depth: pose.z,
        environment: fixture.environment(),
      };
    })()`);
  }

  async function installCohortDragFixture() {
    return evaluate(`(async () => {
      const { createCardScene } = await import(${JSON.stringify(ENGINE_MODULE)});
      window.__cardinalDragGeometryFixture?.dispose?.();
      const stage = document.createElement("div");
      stage.id = "cardinal-drag-perspective-cohort-stage";
      stage.style.cssText = "position:fixed;left:24px;top:24px;width:1200px;height:800px;z-index:2147483000;overflow:visible;background:transparent;isolation:isolate";
      document.body.append(stage);
      const face = (text) => ({ elements: [{ id: "label", type: "text", content: { text } }] });
      const card = (id, x, y) => ({
        id,
        template: "rounded",
        activeFaceId: "front",
        faces: { front: face(id), alternate: face(id + " alternate") },
        back: face(id + " concealed"),
        faceCycle: ["front", "alternate"],
        faceUp: true,
        pose: { x, y, flipX: 0, flipY: 0, scale: 1 },
        positionMode: "absolute",
      });
      const scene = createCardScene({
        element: stage,
        templates: { rounded: { width: 180, height: 250, thickness: 14, shape: "rounded-rectangle" } },
        camera: { projection: "perspective", scaleMode: "stage", center: { x: 0, y: 0 }, distance: 1200, fov: 55 },
        motion: { reducedMotion: true },
        selection: { multiple: true },
        interaction: { rules: { canStart: () => ({ allowed: true }), canDrop: () => ({ allowed: true }) } },
      });
      const ids = ["perspective-cohort-primary", "perspective-cohort-secondary"];
      scene.apply({
        cards: [card(ids[0], -390, -20), card(ids[1], -180, 40)],
        zones: [
          { id: "source", geometry: { x: -540, y: -260, width: 500, height: 520, depth: 240 }, cardIds: ids },
          { id: "destination", geometry: { x: 80, y: -260, width: 440, height: 520, depth: 80 }, cardIds: [] },
        ],
      });
      scene.select(ids, { primaryCardId: ids[0], anchorCardId: ids[0] });
      const drops = [];
      scene.on("drop", (intent) => { drops.push(intent); scene.resolveDrop(intent.id, { accepted: true }); });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const fixture = {
        scene,
        stage,
        drops,
        ids,
        environment() {
          const rect = stage.getBoundingClientRect();
          return {
            userAgent: navigator.userAgent,
            innerWidth,
            innerHeight,
            outerWidth,
            outerHeight,
            screenX,
            screenY,
            devicePixelRatio,
            stage: { left: Number(rect.left.toFixed(2)), top: Number(rect.top.toFixed(2)), width: Number(rect.width.toFixed(2)), height: Number(rect.height.toFixed(2)) },
          };
        },
        dispose() { scene.destroy(); stage.remove(); },
      };
      window.__cardinalDragGeometryFixture = fixture;
      const state = scene.snapshot();
      const pose = (id) => state.visual.find(({ cardId }) => cardId === id)?.pose;
      const destination = state.zones.find(({ id }) => id === "destination").geometry;
      return {
        renderer: state.renderer,
        projection: state.projection,
        ids,
        start: scene.sceneToClient(pose(ids[0])),
        destination: scene.sceneToClient({ x: destination.x + destination.width / 2, y: destination.y + destination.height / 2, z: destination.depth }),
        centers: Object.fromEntries(ids.map((id) => [id, scene.sceneToClient(pose(id))])),
        depths: Object.fromEntries(ids.map((id) => [id, pose(id).z])),
        environment: fixture.environment(),
      };
    })()`);
  }

  async function fixtureState() {
    return evaluate(`(async () => {
      const fixture = window.__cardinalDragGeometryFixture;
      const scene = fixture?.scene;
      if (!scene) return null;
      const snapshot = scene.snapshot();
      return { snapshot, drops: structuredClone(fixture.drops ?? []) };
    })()`);
  }

  let mouseDown = false;
  let lastMousePoint = null;
  async function mouseMove(point) {
    lastMousePoint = point;
    await command("Input.dispatchMouseEvent", {
      type: "mouseMoved", x: point.x, y: point.y, button: mouseDown ? "left" : "none", buttons: mouseDown ? 1 : 0,
    });
  }
  async function mousePress(point) {
    await mouseMove(point);
    await command("Input.dispatchMouseEvent", {
      type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1,
    });
    mouseDown = true;
  }
  async function mouseRelease(point = lastMousePoint) {
    if (!mouseDown) return;
    try {
      await command("Input.dispatchMouseEvent", {
        type: "mouseReleased", x: point?.x ?? 0, y: point?.y ?? 0, button: "left", buttons: 0, clickCount: 1,
      });
    } finally {
      mouseDown = false;
    }
  }
  async function pressKey(key, code = key, virtualKeyCode = 0) {
    const base = { key, code, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode };
    await command("Input.dispatchKeyEvent", { type: "keyDown", ...base });
    await command("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }
  async function dragPath(start, destination, onSample) {
    await mousePress(start);
    const steps = 10;
    for (let index = 1; index <= steps; index += 1) {
      const fraction = index / steps;
      const point = {
        x: start.x + (destination.x - start.x) * fraction,
        y: start.y + (destination.y - start.y) * fraction,
      };
      await mouseMove(point);
      await onSample?.(point, index);
    }
  }

  const results = [];
  async function runCase(label, action) {
    try {
      const status = await action();
      results.push({ label, pass: true, status: status ?? "passed" });
    } catch (error) {
      results.push({ label, pass: false, error: errorMessage(error) });
    } finally {
      await mouseRelease().catch(() => {});
    }
  }

  await runCase("orthographic WebGL rounded and shield corner misses", async () => {
    const installed = await installProjection("orthographic");
    const report = await geometryReport("orthographic");
    if (installed.renderer !== "webgl" || installed.projection !== "orthographic" || report.renderer !== "webgl") {
      throw new Error(`Expected orthographic WebGL, got ${JSON.stringify({ installed, report })}`);
    }
    if (report.roundedCornerHit !== null || report.shieldCornerHit !== null) {
      throw new Error(`Transparent corner unexpectedly hit: ${JSON.stringify({ rounded: report.roundedCornerHit, shield: report.shieldCornerHit })}`);
    }
    return "orthographic mesh corners miss";
  });

  await runCase("orthographic WebGL front back and edge mesh hits", async () => {
    const report = await geometryReport("orthographic");
    const sides = [report.frontHit?.side, report.backHit?.side, report.edgeHit?.side];
    if (sides.join(",") !== "front,back,edge") throw new Error(`Expected front,back,edge hits, got ${JSON.stringify(sides)}`);
    if (![report.frontHit, report.backHit, report.edgeHit].every((hit) => hit?.cardId === "sided")) {
      throw new Error(`Side hit identity mismatch: ${JSON.stringify({ front: report.frontHit, back: report.backHit, edge: report.edgeHit })}`);
    }
    return "front/back/edge sides agree with the closed mesh";
  });

  await runCase("orthographic overlapping cards pick the higher resolved drawOrder", async () => {
    const report = await geometryReport("orthographic");
    if (report.overlapHit?.cardId !== "overlap-upper" || !(report.overlapDrawOrders[1] > report.overlapDrawOrders[0])) {
      throw new Error(`Overlap pick did not follow drawOrder: ${JSON.stringify({ hit: report.overlapHit, drawOrders: report.overlapDrawOrders })}`);
    }
    return "higher resolved drawOrder wins overlap picking";
  });

  await runCase("perspective WebGL rounded and shield corner misses", async () => {
    const installed = await installProjection("perspective");
    const report = await geometryReport("perspective");
    if (installed.renderer !== "webgl" || installed.projection !== "perspective" || report.renderer !== "webgl") {
      throw new Error(`Expected perspective WebGL, got ${JSON.stringify({ installed, report })}`);
    }
    if (report.roundedCornerHit !== null || report.shieldCornerHit !== null) {
      throw new Error(`Transparent perspective corner unexpectedly hit: ${JSON.stringify({ rounded: report.roundedCornerHit, shield: report.shieldCornerHit })}`);
    }
    return "perspective mesh corners miss";
  });

  await runCase("perspective WebGL front back and edge mesh hits", async () => {
    const report = await geometryReport("perspective");
    const sides = [report.frontHit?.side, report.backHit?.side, report.edgeHit?.side];
    if (sides.join(",") !== "front,back,edge") throw new Error(`Expected perspective front,back,edge hits, got ${JSON.stringify(sides)}`);
    return "perspective front/back/edge sides agree with the closed mesh";
  });

  await runCase("ineligible foreground surface blocks a lower zone", async () => {
    const installed = await installZoneFixture("surface");
    if (installed.renderer !== "webgl" || installed.startHit?.cardId !== "zone-drag-card") {
      throw new Error(`Zone fixture did not expose a WebGL card hit: ${JSON.stringify(installed)}`);
    }
    await dragPath(installed.start, installed.destination);
    const carrying = await waitFor("foreground blocked candidate", (state) => {
      const session = state?.interaction?.sessions?.at(-1);
      return session?.phase === "dragging" && session.candidate?.toZoneId === "foreground" && session.candidate.allowed === false;
    });
    await mouseRelease(installed.destination);
    const settled = await waitFor("blocked zone cancellation", (state) => state?.interaction?.sessions?.length === 0
      && state.desired.zones.find(({ id }) => id === "source")?.cardIds.includes("zone-drag-card"));
    const candidate = carrying.interaction.sessions.at(-1)?.candidate;
    if (settled.drops?.length || candidate.allowed !== false) throw new Error(`Blocked zone released incorrectly: ${JSON.stringify({ candidate, drops: settled.drops })}`);
    return "denied surface remains the foreground target";
  });

  await runCase("explicit transparent foreground allows lower-zone pass-through", async () => {
    const installed = await installZoneFixture("transparent");
    await dragPath(installed.start, installed.destination);
    const carrying = await waitFor("transparent pass-through candidate", (state) => {
      const session = state?.interaction?.sessions?.at(-1);
      return session?.phase === "dragging" && session.candidate?.toZoneId === "lower" && session.candidate.allowed === true;
    });
    await mouseRelease(installed.destination);
    const landed = await waitFor("transparent lower-zone drop", (state) => state?.interaction?.sessions?.length === 0
      && state.drops?.length === 1 && state.drops[0].toZoneId === "lower"
      && state.desired.zones.find(({ id }) => id === "lower")?.cardIds.includes("zone-drag-card"));
    if (carrying.interaction.sessions.at(-1)?.candidate?.toZoneId !== "lower") {
      throw new Error(`Transparent foreground did not pass through: ${JSON.stringify(carrying.interaction.sessions.at(-1))}`);
    }
    return "transparent foreground passes to the eligible lower surface";
  });

  let attachmentErrorPx = 0;
  let dragDepth = null;
  await runCase("perspective pointer drag stays attached at nonzero depth and drops", async () => {
    const installed = await installDragFixture();
    dragDepth = installed.depth;
    if (installed.renderer !== "webgl" || installed.projection !== "perspective" || !(installed.depth > 0)
      || installed.startHit?.cardId !== "perspective-drag-card") {
      throw new Error(`Perspective drag fixture failed setup: ${JSON.stringify(installed)}`);
    }
    let baselineOffset = null;
    await dragPath(installed.start, installed.destination, async (point) => {
      const sample = await evaluate(`(async () => {
        const fixture = window.__cardinalDragGeometryFixture;
        const snapshot = fixture.scene.snapshot();
        const session = snapshot.interaction.sessions.at(-1);
        const visual = snapshot.visual.find(({ cardId }) => cardId === "perspective-drag-card");
        const center = visual ? fixture.scene.sceneToClient(visual.pose) : null;
        return { phase: session?.phase ?? null, center, pose: visual?.pose ?? null };
      })()`);
      if (sample.phase !== "dragging" || !sample.center) return;
      baselineOffset ??= { x: point.x - sample.center.x, y: point.y - sample.center.y };
      attachmentErrorPx = Math.max(attachmentErrorPx, Math.hypot(
        point.x - sample.center.x - baselineOffset.x,
        point.y - sample.center.y - baselineOffset.y,
      ));
    });
    await waitFor("perspective drag candidate", (state) => state?.interaction?.sessions?.at(-1)?.phase === "dragging"
      && state.interaction.sessions.at(-1).candidate?.toZoneId === "destination"
      && state.interaction.sessions.at(-1).candidate.allowed === true);
    await mouseRelease(installed.destination);
    const landed = await waitFor("perspective expected drop", (state) => state?.interaction?.sessions?.length === 0
      && state.drops?.length === 1 && state.drops[0].toZoneId === "destination"
      && state.desired.zones.find(({ id }) => id === "destination")?.cardIds.includes("perspective-drag-card")
      && state.desired.zones.find(({ id }) => id === "source")?.cardIds.length === 0);
    if (attachmentErrorPx > 1) throw new Error(`Pointer attachment error ${attachmentErrorPx.toFixed(3)} CSS px exceeds 1 CSS px`);
    if (landed.drops[0].primaryCardId !== "perspective-drag-card") throw new Error(`Unexpected drop intent: ${JSON.stringify(landed.drops[0])}`);
    return `max attachment error ${attachmentErrorPx.toFixed(3)} CSS px at depth ${dragDepth}`;
  });

  let resizeAttachmentErrorPx = 0;
  await runCase("perspective center resize preserves a nonzero grab offset", async () => {
    const installed = await installDragFixture();
    if (installed.renderer !== "webgl" || installed.projection !== "perspective" || !(installed.depth > 0)) {
      throw new Error(`Perspective resize fixture failed setup: ${JSON.stringify(installed)}`);
    }
    await mousePress(installed.grab);
    const threshold = { x: installed.grab.x + 7, y: installed.grab.y };
    await mouseMove(threshold);
    let baseline;
    const carrying = await waitFor("nonzero-offset drag pickup", (state) => {
      const session = state?.interaction?.sessions?.at(-1);
      return session?.phase === "dragging";
    });
    const beforeMove = await evaluate(`(async () => {
      const fixture = window.__cardinalDragGeometryFixture;
      const snapshot = fixture.scene.snapshot();
      const pose = snapshot.visual.find(({ cardId }) => cardId === "perspective-drag-card").pose;
      return { center: fixture.scene.sceneToClient(pose), pose };
    })()`);
    baseline = { x: threshold.x - beforeMove.center.x, y: threshold.y - beforeMove.center.y };
    await mouseMove(installed.cameraCenter);
    await waitFor("camera-center drag", (state) => state?.interaction?.sessions?.at(-1)?.phase === "dragging");
    await evaluate(`(async () => {
      const fixture = window.__cardinalDragGeometryFixture;
      const stage = fixture.stage;
      const before = stage.getBoundingClientRect();
      const center = { x: before.left + before.width / 2, y: before.top + before.height / 2 };
      const width = 1000;
      const height = 600;
      stage.style.left = (center.x - width / 2) + "px";
      stage.style.top = (center.y - height / 2) + "px";
      stage.style.width = width + "px";
      stage.style.height = height + "px";
      window.dispatchEvent(new Event("resize"));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return true;
    })()`);
    const afterResize = await evaluate(`(async () => {
      const fixture = window.__cardinalDragGeometryFixture;
      const snapshot = fixture.scene.snapshot();
      const pose = snapshot.visual.find(({ cardId }) => cardId === "perspective-drag-card").pose;
      const center = fixture.scene.sceneToClient(pose);
      return { center, pose, environment: fixture.environment() };
    })()`);
    resizeAttachmentErrorPx = Math.hypot(
      installed.cameraCenter.x - afterResize.center.x - baseline.x,
      installed.cameraCenter.y - afterResize.center.y - baseline.y,
    );
    await pressKey("Escape", "Escape", 27);
    await waitFor("resize probe cancellation", (state) => state?.interaction?.sessions?.length === 0);
    if (resizeAttachmentErrorPx > 1) {
      throw new Error(`Perspective center resize attachment error ${resizeAttachmentErrorPx.toFixed(3)} CSS px exceeds 1 CSS px`);
    }
    if (carrying.interaction.sessions.at(-1)?.cardIds?.[0] !== "perspective-drag-card") {
      throw new Error(`Resize probe picked an unexpected card: ${JSON.stringify(carrying.interaction.sessions.at(-1))}`);
    }
    return `resize attachment error ${resizeAttachmentErrorPx.toFixed(3)} CSS px with a nonzero grab offset`;
  });

  let cohortAttachmentErrorPx = 0;
  let cohortRelativeErrorPx = 0;
  let cohortDepths = null;
  await runCase("perspective cohort stays attached through center resize", async () => {
    const installed = await installCohortDragFixture();
    cohortDepths = installed.depths;
    if (installed.renderer !== "webgl" || installed.projection !== "perspective"
      || !Object.values(installed.depths).every((depth) => depth > 0)) {
      throw new Error(`Perspective cohort fixture failed setup: ${JSON.stringify(installed)}`);
    }
    const [primaryId, secondaryId] = installed.ids;
    const initialDelta = {
      x: installed.centers[secondaryId].x - installed.centers[primaryId].x,
      y: installed.centers[secondaryId].y - installed.centers[primaryId].y,
    };
    let baselineOffset = null;
    let resized = false;
    await dragPath(installed.start, installed.destination, async (point, index) => {
      const sample = await evaluate(`(async () => {
        const fixture = window.__cardinalDragGeometryFixture;
        const snapshot = fixture.scene.snapshot();
        const session = snapshot.interaction.sessions.at(-1);
        const centers = Object.fromEntries(fixture.ids.map((id) => {
          const pose = snapshot.visual.find(({ cardId }) => cardId === id)?.pose;
          return [id, pose ? fixture.scene.sceneToClient(pose) : null];
        }));
        return { phase: session?.phase ?? null, centers };
      })()`);
      const primary = sample.centers[primaryId];
      const secondary = sample.centers[secondaryId];
      if (sample.phase !== "dragging" || !primary || !secondary) return;
      baselineOffset ??= { x: point.x - primary.x, y: point.y - primary.y };
      cohortAttachmentErrorPx = Math.max(cohortAttachmentErrorPx, Math.hypot(
        point.x - primary.x - baselineOffset.x,
        point.y - primary.y - baselineOffset.y,
      ));
      cohortRelativeErrorPx = Math.max(cohortRelativeErrorPx, Math.hypot(
        secondary.x - primary.x - initialDelta.x,
        secondary.y - primary.y - initialDelta.y,
      ));
      if (index === 5 && !resized) {
        resized = true;
        await evaluate(`(async () => {
          const fixture = window.__cardinalDragGeometryFixture;
          const before = fixture.stage.getBoundingClientRect();
          const center = { x: before.left + before.width / 2, y: before.top + before.height / 2 };
          const width = 1000;
          const height = 600;
          fixture.stage.style.left = (center.x - width / 2) + "px";
          fixture.stage.style.top = (center.y - height / 2) + "px";
          fixture.stage.style.width = width + "px";
          fixture.stage.style.height = height + "px";
          window.dispatchEvent(new Event("resize"));
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return true;
        })()`);
      }
    });
    await waitFor("perspective cohort candidate", (state) => {
      const session = state?.interaction?.sessions?.at(-1);
      return session?.phase === "dragging"
        && session.cardIds?.length === 2
        && session.candidate?.toZoneId === "destination"
        && session.candidate.allowed === true;
    });
    await mouseRelease(installed.destination);
    const landed = await waitFor("perspective cohort drop", (state) => {
      const destination = state?.desired?.zones?.find(({ id }) => id === "destination");
      return state?.interaction?.sessions?.length === 0
        && state.drops?.length === 1
        && state.drops[0].toZoneId === "destination"
        && installed.ids.every((id) => destination?.cardIds.includes(id));
    });
    if (cohortAttachmentErrorPx > 1 || cohortRelativeErrorPx > 1) {
      throw new Error(`Perspective cohort attachment errors exceed 1 CSS px: ${JSON.stringify({
        cohortAttachmentErrorPx,
        cohortRelativeErrorPx,
      })}`);
    }
    const intent = landed.drops[0];
    if (intent.cardIds?.length !== 2 || !installed.ids.every((id) => intent.cardIds.includes(id))) {
      throw new Error(`Unexpected cohort drop intent: ${JSON.stringify(intent)}`);
    }
    return `max attachment error ${cohortAttachmentErrorPx.toFixed(3)} CSS px; relative error ${cohortRelativeErrorPx.toFixed(3)} CSS px at depths ${JSON.stringify(cohortDepths)}`;
  });

  await runCase("late image completion is inert after scene disposal", async () => {
    const outcomes = await evaluate(`(async () => {
      const { createCardScene } = await import(${JSON.stringify(ENGINE_MODULE)});
      const { createWebGLRenderer } = await import("/packages/card-engine/src/renderers/webgl.js");
      const NativeImage = window.Image;
      const outcomes = [];
      for (const outcome of ["load", "error"]) {
        const pendingImage = new NativeImage();
        pendingImage.src = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>');
        await pendingImage.decode();
        Object.defineProperty(pendingImage, "src", { configurable: true, set() {} });
        Object.defineProperty(pendingImage, "complete", { configurable: true, get: () => false });
        const stage = document.createElement("div");
        stage.style.cssText = "position:fixed;left:24px;top:24px;width:400px;height:400px";
        document.body.append(stage);
        let scene;
        let disposed = false;
        let lateDraws = 0;
        let lateStatuses = 0;
        try {
          // Hold the real drawable image at the loader seam until after teardown.
          window.Image = function () { return pendingImage; };
          scene = createCardScene({
            element: stage,
            motion: { reducedMotion: true },
            elementRenderers: { probe: {
              draw() { if (disposed) lateDraws += 1; },
              measure() { return 20; },
            } },
            renderer: (options) => createWebGLRenderer({
              ...options,
              onStatus(detail) {
                if (disposed) lateStatuses += 1;
                options.onStatus(detail);
              },
            }),
          });
          scene.apply({
            cards: [{ id: "late-image", activeFaceId: "front", faces: { front: { elements: [
              { id: "image", type: "image", content: { src: "deferred-lifecycle.svg" } },
              { id: "probe", type: "probe" },
            ] } } }],
            zones: [{ id: "home", cardIds: ["late-image"], geometry: { x: 0, y: 0, width: 400, height: 400, depth: 0 } }],
          });
          const complete = outcome === "load" ? pendingImage.onload : pendingImage.onerror;
          if (typeof complete !== "function") throw new Error("Deferred image callback was not installed");
          disposed = true;
          scene.destroy();
          complete(new Event(outcome));
          await Promise.resolve();
          outcomes.push({ outcome, lateDraws, lateStatuses, canvases: stage.querySelectorAll("canvas").length });
        } finally {
          scene?.destroy();
          window.Image = NativeImage;
          stage.remove();
        }
      }
      return outcomes;
    })()`);
    if (outcomes.some(({ lateDraws, lateStatuses, canvases }) => lateDraws || lateStatuses || canvases)) {
      throw new Error(`Disposed image callbacks still act: ${JSON.stringify(outcomes)}`);
    }
    return "late image load/error causes no draw, status callback or retained canvas";
  });

  let environment;
  try {
    environment = await evaluate("window.__cardinalDragGeometryFixture?.environment?.() ?? { userAgent, innerWidth, innerHeight, outerWidth, outerHeight, screenX, screenY, devicePixelRatio, stage: null }");
  } finally {
    await evaluate("window.__cardinalDragGeometryFixture?.dispose?.(); window.__cardinalDragGeometryFixture = null; true").catch(() => {});
  }
  return {
    ok: results.every((result) => result.pass),
    results,
    environment,
    measurements: {
      pointerAttachmentErrorPx: Number(attachmentErrorPx.toFixed(3)),
      perspectiveCenterResizeAttachmentErrorPx: Number(resizeAttachmentErrorPx.toFixed(3)),
      perspectiveCohortAttachmentErrorPx: Number(cohortAttachmentErrorPx.toFixed(3)),
      perspectiveCohortRelativeErrorPx: Number(cohortRelativeErrorPx.toFixed(3)),
      perspectiveDragDepth: dragDepth,
      perspectiveCohortDepths: cohortDepths,
    },
  };
}
