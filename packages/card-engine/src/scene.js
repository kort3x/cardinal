import { cardById, normalizeElement, normalizePose, normalizeSnapshot, zoneById } from "./model.js";
import { cardDimensions, solveAllPoses } from "./layout.js";
import { createClock, interpolate, shortestAngleTarget } from "./motion.js";
import { createHeadlessRenderer, createRenderer } from "./renderer.js";
import { createWebGLRenderer } from "./renderers/webgl.js";
import { resolveZones } from "./zones.js";
import { createInteraction } from "./interaction.js";
import { createInputAdapter } from "./input.js";
import { createSelection } from "./selection.js";
import { resolveBatchMove } from "./batch.js";

const copy = (value) => structuredClone(value);
const DEFAULT_ZONE_MOTION_SPEED = 1.5;
const WEIGHTED_MOTION_CHANNELS = new Set(["x", "y", "z", "angle", "scale", "layoutScale", "flipX", "flipY"]);
const SNAP_ORIENTATION_CHANNELS = new Set(["angle", "tiltX", "tiltY"]);
const smoothStep = (progress) => progress * progress * (3 - 2 * progress);
const snapEasing = (progress, strength) => {
  const inverse = progress - 1;
  return 1 + (strength + 1) * inverse ** 3 + strength * inverse ** 2;
};

function flipAxes(axis) {
  const axes = axis === undefined ? ["y"] : Array.isArray(axis) ? axis : [axis];
  if (axes.length === 0 || axes.some((candidate) => candidate !== "x" && candidate !== "y")) {
    throw new TypeError("Flip axes must contain x or y");
  }
  return [...new Set(axes)];
}

function flipChannel(axis) {
  return `flip${axis.toUpperCase()}`;
}

function spinChannel(axis) {
  return `spin${axis.toUpperCase()}`;
}

const operationResultChannels = {
  move: () => 3,
  moveBatch: () => 3,
  zone: () => 0,
  rotate: () => 1,
  scale: () => 1,
  resize: () => 2,
  thickness: () => 1,
  face: (operation) => flipAxes(operation.axis).length,
  element: () => 1,
};

function flipValue(pose, axis) {
  return pose[flipChannel(axis)] ?? 0;
}

function setFlipValue(pose, axis, value) {
  pose[flipChannel(axis)] = value;
}

function angleForAxis(angle, axis) {
  const value = angle && typeof angle === "object" ? angle[axis] : angle;
  if (!Number.isFinite(value) || value < 0 || value > 180) {
    throw new RangeError(`Face ${axis} angle must be between 0 and 180 degrees`);
  }
  return value;
}

function stageLogicalFace(card) {
  if (!card.faceCycle) return;
  const currentIndex = card.faceCycle.indexOf(card.activeFaceId);
  card.faceCycleNextFaceId = card.faceCycle[(currentIndex + 1) % card.faceCycle.length];
}

function advanceSpinningLogicalFace(card, direction) {
  if (!card.faceCycle) return false;
  const currentIndex = card.faceCycle.indexOf(card.activeFaceId);
  const nextIndex = (currentIndex + direction + card.faceCycle.length) % card.faceCycle.length;
  card.activeFaceId = card.faceCycle[nextIndex];
  delete card.faceCycleNextFaceId;
  return true;
}

function frontRevolutionBucket(angle, direction) {
  return direction > 0 ? Math.floor((angle + 90) / 360) : Math.ceil((angle - 90) / 360);
}

function physicalSide(pose) {
  const degreesToRadians = Math.PI / 180;
  const facing = Math.cos((pose.flipX ?? 0) * degreesToRadians) * Math.cos((pose.flipY ?? 0) * degreesToRadians);
  if (Math.abs(facing) < 0.000001) return "edge";
  return facing > 0 ? "front" : "back";
}

function visualPose(card, pose) {
  const flipAxis = card.flipAxis ?? "y";
  const flipY = card.pose.flipY ?? (card.faceUp ? 0 : 180);
  const flipX = card.pose.flipX ?? 0;
  return {
    ...pose,
    flipAxis,
    flipX,
    flipY,
  };
}

function zoneForCard(zones, cardId) {
  return [...zones.values()].find((zone) => zone.cardIds.includes(cardId));
}

function zoneMotionSpeed(zone, channelName) {
  const key = channelName === "angle"
    ? "orientationSpeed"
    : channelName === "scale" || channelName === "layoutScale"
      ? "scaleSpeed"
      : channelName === "flipX" || channelName === "flipY"
        ? "faceSpeed"
        : "positionSpeed";
  return zone?.motion?.[key] ?? DEFAULT_ZONE_MOTION_SPEED;
}

function applyZoneFacePolicy(card, zone) {
  if (zone?.faceUp === undefined) return;
  card.faceUp = zone.faceUp;
  card.pose = { ...(card.pose ?? normalizePose()) };
  delete card.pose.flipX;
  delete card.pose.flipY;
}

export function createCardScene(config = {}) {
  const clock = config.motion?.clock ?? createClock();
  const reducedMotion = Boolean(config.motion?.reducedMotion);
  let duration = config.motion?.duration ?? 320;
  if (!Number.isFinite(duration) || duration <= 0) throw new RangeError("Motion duration must be positive and finite");
  const dragHangFactor = config.interaction?.dragHangFactor ?? 1;
  if (!Number.isFinite(dragHangFactor) || dragHangFactor < 0) throw new RangeError("Interaction dragHangFactor must be non-negative and finite");
  const dragSnapDelay = config.interaction?.dragSnapDelay ?? 0;
  if (!Number.isFinite(dragSnapDelay) || dragSnapDelay < 0) throw new RangeError("Interaction dragSnapDelay must be non-negative and finite");
  const camera = { projection: "orthographic", ...(config.camera ?? {}) };
  const createRendererAdapter = config.renderer ?? (
    config.renderMode === "css" ? createRenderer : config.element ? createWebGLRenderer : createHeadlessRenderer
  );
  const listeners = new Map();
  let rendererReason = null;
  const renderer = createRendererAdapter({
    element: config.element,
    templates: config.templates,
    elementRenderers: config.elementRenderers,
    camera,
    motion: config.motion,
    onStatus: (detail = {}) => {
      rendererReason = detail.reason ?? null;
      emit("renderer-status", detail);
    },
  });
  const channels = new Map();
  const transitions = new Set();
  let targetSequence = 0;
  const targetSessions = new Set();
  let desired = null;
  let visual = new Map();
  let frameId = null;
  let destroyed = false;
  let resolvedZones = new Map();
  let geometryFrame = null;
  let interaction;
  let input;
  let interactionPositions = new Map();
  const selection = createSelection({
    config: config.selection,
    state: () => ({ desired, visual }),
    onChange: () => {
      if (destroyed) return;
      renderer.updateSelection?.(selection.snapshot());
      emit("selection-change", selection.snapshot());
      emit("change", snapshot());
    },
  });

  function clientToScene(point, depth = 0) {
    return renderer.clientToScene ? renderer.clientToScene(point, depth) : { x: point.x, y: point.y };
  }

  function sceneToClient(point) {
    return renderer.sceneToClient?.(point) ?? { x: point.x, y: point.y };
  }

  function presentInteraction(positions, detail, resting) {
    const previous = interactionPositions;
    interactionPositions = positions;
    for (const id of new Set([...previous.keys(), ...positions.keys()])) {
      const current = cardPose(id);
      if (!current) continue;
      const entry = positions.get(id);
      const target = entry?.pose ?? resting.get(id);
      if (!target) continue;
      let changed = Boolean(entry?.renderPose || (previous.has(id) && !entry));
      if (target.drawOrder !== undefined && current.drawOrder !== target.drawOrder) {
        current.drawOrder = target.drawOrder;
        changed = true;
      }
      const positionChannels = ['x', 'y', 'z'];
      for (const name of ['angle', 'scale', 'layoutScale', 'flipX', 'flipY', 'tiltX', 'tiltY']) {
        if (target[name] !== undefined) positionChannels.push(name);
      }
      for (const name of positionChannels) {
        if (entry?.direct && (['x', 'y', 'z'].includes(name)
          || (entry.orientationDirect && name === 'angle')
          || (entry.tiltDirect && ['tiltX', 'tiltY'].includes(name)))) {
          cancelChannel(id, name);
          changed = changed || current[name] !== target[name];
          current[name] = target[name];
        } else {
          const active = channels.get(id)?.[name];
          if (Math.abs((active?.to ?? current[name]) - target[name]) > 0.0001
            || (entry?.snap === true && active?.snap !== true)) {
            scheduleChannel(id, name, target[name], {
              interactionOwned: true,
              snap: entry?.snap === true,
              snapDelay: entry?.snapDelay ?? 0,
              zone: entry?.zoneId ? resolvedZones.get(entry.zoneId) : zoneForCard(resolvedZones, id),
            });
            changed = true;
          }
        }
      }
      if (changed) renderCard(id, { render: false });
    }
    renderer.updateInteraction?.(detail);
    renderer.render?.();
    ensureFrame();
  }

  function solve(snapshot, zones) {
    // The actual WebGL camera owns projection, including perspective scaling.
    const layoutCamera = renderer.type === "webgl" ? { ...camera, depthScale: () => 1 } : camera;
    return solveAllPoses({ ...snapshot, zones: [...zones.values()] }, layoutCamera, config.templates, config.elementRenderers);
  }

  function trackGeometry() {
    if (destroyed || !desired?.zones.some((zone) => zone.anchor) || geometryFrame !== null) return;
    geometryFrame = clock.requestFrame(() => {
      geometryFrame = null;
      refreshGeometry();
      trackGeometry();
    });
  }

  function refreshGeometry() {
    if (destroyed || !desired) return;
    const nextZones = resolveZones(desired, renderer, resolvedZones);
    if (JSON.stringify([...nextZones]) === JSON.stringify([...resolvedZones])) return;
    const targets = solve(desired, nextZones);
    sample(clock.now());
    resolvedZones = nextZones;
    for (const [cardId, targetPose] of targets) {
      const current = cardPose(cardId);
      if (!targetPose.visible) { current.visible = false; continue; }
      current.visible = true;
      if (interactionPositions.has(cardId)) continue;
      const targetZone = zoneForCard(nextZones, cardId);
      for (const name of ["x", "y", "z", "angle", "scale", "layoutScale"]) {
    const channel = channels.get(cardId)?.[name];
        if (channel) {
          if (Math.abs(channel.to - targetPose[name]) < 0.0001) continue;
          // Keep the operation's completion ticket when its destination moves.
          channel.from = current[name];
          channel.to = targetPose[name];
          channel.startedAt = clock.now();
        } else scheduleChannel(cardId, name, targetPose[name], { zone: targetZone });
      }
    }
    interaction?.reconcile();
    selection.reconcile();
    renderAll({ render: false });
    renderer.render?.();
    ensureFrame();
    emit("change", snapshot());
  }

  function emit(event, detail) {
    for (const listener of listeners.get(event) ?? []) listener(detail);
  }

  function cardPose(cardId) {
    return visual.get(cardId);
  }

  function renderCard(cardId, options = {}) {
    const card = desired?.cards.find((candidate) => candidate.id === cardId);
    const pose = cardPose(cardId);
    if (!card || !pose) return;
    // Interaction render coordinates bypass the logical pose so snapshots keep
    // the arrangement's real depth while the carried card stays on top.
    const renderPose = interactionPositions.get(cardId)?.renderPose;
    renderer.update(card, renderPose ? { ...pose, ...renderPose } : pose, options);
  }

  function renderAll(options = {}) {
    if (!desired) return;
    for (const card of desired.cards) renderCard(card.id, options);
  }

  function validCardIds(cardIds) {
    const knownIds = new Set(desired?.cards.map((card) => card.id) ?? []);
    return cardIds.filter((cardId, index) => typeof cardId === "string"
      && knownIds.has(cardId)
      && visual.get(cardId)?.visible !== false
      && cardIds.indexOf(cardId) === index);
  }

  function select(cardIds, options = {}) {
    if (!desired) throw new Error("Call scene.apply before scene.select");
    if (destroyed) throw new Error("Scene is destroyed");
    return selection.select(cardIds, options);
  }

  function hitTest(point) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new TypeError("scene.hitTest requires finite x and y coordinates");
    }
    const hit = renderer.hitTest?.(point) ?? null;
    return hit && visual.get(hit.cardId)?.visible !== false ? hit : null;
  }

  function target(request = {}) {
    if (!desired) throw new Error("Call scene.apply before scene.target");
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw new TypeError("scene.target requires a request object");
    }
    if (request.eligibleCardIds !== undefined && !Array.isArray(request.eligibleCardIds)) {
      throw new TypeError("scene.target eligibleCardIds requires an array");
    }
    if (request.point !== undefined && (!request.point || !Number.isFinite(request.point.x) || !Number.isFinite(request.point.y))) {
      throw new TypeError("Target point requires finite x and y coordinates");
    }
    const eligibleCardIds = validCardIds(request.eligibleCardIds ?? desired.cards.map(({ id }) => id));
    const eligible = new Set(eligibleCardIds);
    const intent = {
      id: `target-${++targetSequence}`,
      status: "active",
      cardIds: Array.isArray(request.cardIds) ? validCardIds(request.cardIds).filter((cardId) => eligible.has(cardId)) : [],
      point: request.point ? copy(request.point) : null,
    };
    const publish = (event) => emit(event, copy(intent));
    const session = {
      snapshot: () => copy(intent),
      update(change = {}) {
        if (intent.status !== "active") throw new Error("Target session is no longer active");
        if (change.point !== undefined) {
          if (!change.point || !Number.isFinite(change.point.x) || !Number.isFinite(change.point.y)) {
            throw new TypeError("Target point requires finite x and y coordinates");
          }
          intent.point = copy(change.point);
          const hit = hitTest(change.point);
          intent.cardIds = hit && eligible.has(hit.cardId) ? [hit.cardId] : [];
        }
        if (change.cardIds !== undefined) {
          if (!Array.isArray(change.cardIds)) throw new TypeError("Target cardIds requires an array");
          intent.cardIds = validCardIds(change.cardIds).filter((cardId) => eligible.has(cardId));
        }
        publish("target-change");
        return copy(intent);
      },
      finish() {
        if (intent.status !== "active") return copy(intent);
        intent.cardIds = validCardIds(intent.cardIds);
        intent.status = "committed";
        targetSessions.delete(session);
        publish("target");
        return copy(intent);
      },
      cancel() {
        if (intent.status !== "active") return copy(intent);
        intent.status = "cancelled";
        targetSessions.delete(session);
        publish("target-cancel");
        return copy(intent);
      },
    };
    targetSessions.add(session);
    publish("target-start");
    return session;
  }

  function setMotion(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("scene.setMotion requires an options object");
    }
    if (options.duration !== undefined) {
      if (!Number.isFinite(options.duration) || options.duration <= 0) {
        throw new RangeError("Motion duration must be positive and finite");
      }
      duration = options.duration;
    }
    return { duration };
  }

  function settleTicket(ticket, status) {
    if (ticket.status) return;
    ticket.status = status;
    ticket.transition.pending -= 1;
    const result = ticket.transition.results[ticket.operationIndex];
    if (status === "superseded" || status === "destroyed") {
      result.status = status;
      const rollback = ticket.transition.rollbacks.get(ticket.operationIndex);
      if (rollback) {
        ticket.transition.rollbacks.delete(ticket.operationIndex);
        rollback();
      }
    }
    result.remaining -= 1;
    if (status === "settled") ticket.transition.moved.add(ticket.operationIndex);
    finishTransition(ticket.transition);
  }

  function finishTransition(transition) {
    if (transition.scheduling) return;
    transition.results.forEach((result, index) => {
      if (result.status !== "pending" || result.remaining > 0) return;
      result.status = transition.moved.has(index) ? "settled" : "skipped";
      if (result.status === "settled") {
        const commit = transition.commits.get(index);
        transition.commits.delete(index);
        commit?.();
      }
    });
    if (transition.pending === 0) {
      for (const [cardId, drawOrder] of transition.promoted) {
        const pose = cardPose(cardId);
        if (!pose) continue;
        pose.drawOrder = drawOrder;
        renderCard(cardId, { render: false });
      }
      transitions.delete(transition);
      transition.resolve(copy(transition.results.map(({ remaining, ...result }) => result)));
    }
  }

  function sample(time = clock.now()) {
    const wasSettling = channels.size > 0;
    let logicalFaceChanged = false;
    let needsRender = false;
    for (const [cardId, cardChannels] of channels) {
      const pose = cardPose(cardId);
      const card = desired.cards.find((candidate) => candidate.id === cardId);
      for (const [channelName, channel] of Object.entries(cardChannels)) {
        if (!channel) continue;
        if (channelName === "spinX" || channelName === "spinY") {
          const elapsed = Math.max(0, time - channel.sampledAt);
          const previousAngle = flipValue(pose, channel.axis);
          const nextAngle = previousAngle + channel.speed * elapsed / 1000;
          const bucketDelta = frontRevolutionBucket(nextAngle, channel.speed) - frontRevolutionBucket(previousAngle, channel.speed);
          if (card && bucketDelta !== 0) {
            for (let step = 0; step < Math.abs(bucketDelta); step += 1) {
              logicalFaceChanged = advanceSpinningLogicalFace(card, Math.sign(bucketDelta)) || logicalFaceChanged;
            }
          }
          setFlipValue(pose, channel.axis, nextAngle);
          channel.sampledAt = time;
          renderCard(cardId, { render: false });
          needsRender = true;
          continue;
        }
        const progress = reducedMotion ? 1 : Math.min(1, Math.max(0, (time - channel.startedAt) / channel.duration));
        const easedProgress = channel.overshoot
          ? snapEasing(progress, channel.overshoot)
          : channel.easing
            ? channel.easing(progress)
            : progress;
        const value = interpolate(channel.from, channel.to, easedProgress);
        if (channelName === "flipX" || channelName === "flipY") setFlipValue(pose, channel.axis, value);
        else pose[channelName] = value;
        renderCard(cardId, { render: false });
        needsRender = true;
        if (progress >= 1) {
          if (channelName === "flipX" || channelName === "flipY") setFlipValue(pose, channel.axis, channel.restingTarget ?? channel.to);
          else pose[channelName] = channel.to;
          delete cardChannels[channelName];
          if (channel.ticket) settleTicket(channel.ticket, "settled");
        }
      }
      if (Object.keys(cardChannels).length === 0) channels.delete(cardId);
    }
    if (needsRender) renderer.render?.();
    if (logicalFaceChanged && channels.size > 0) emit("change", snapshot());
    if ((channels.size > 0 || interaction?.needsFrame?.()) && frameId === null) frameId = clock.requestFrame(onFrame);
    if (channels.size === 0 && !interaction?.needsFrame?.()) {
      if (frameId !== null) clock.cancelFrame(frameId);
      frameId = null;
      if (wasSettling) emit("change", snapshot());
    }
  }

  function onFrame(time) {
    frameId = null;
    if (destroyed) return;
    sample(time);
    interaction?.tick?.();
    ensureFrame();
  }

  function ensureFrame() {
    if (!destroyed && frameId === null && (channels.size > 0 || interaction?.needsFrame?.())) frameId = clock.requestFrame(onFrame);
  }

  function cancelChannel(cardId, channelName, status = "superseded") {
    const cardChannels = channels.get(cardId);
    const channel = cardChannels?.[channelName];
    if (!channel) return;
    if (channel.ticket) settleTicket(channel.ticket, status);
    delete cardChannels[channelName];
    if (Object.keys(cardChannels).length === 0) channels.delete(cardId);
  }

  function spin(cardId, options = {}) {
    if (!desired) throw new Error("Call scene.apply before scene.spin");
    if (!desired.cards.some((card) => card.id === cardId)) throw new Error(`Unknown card: ${cardId}`);
    const axes = flipAxes(options.axis);
    const direction = options.direction ?? 1;
    if (direction !== 1 && direction !== -1) throw new RangeError("Spin direction must be 1 or -1");
    const speed = options.speed ?? 180;
    if (!Number.isFinite(speed) || speed <= 0) throw new RangeError("Spin speed must be positive and finite");

    for (const axis of axes) {
      cancelChannel(cardId, flipChannel(axis));
      cancelChannel(cardId, spinChannel(axis));
    }
    if (reducedMotion) return { active: false, stop: () => false };

    cardPose(cardId).flipAxis = axes[0];
    const cardChannels = channels.get(cardId) ?? {};
    const spinChannels = new Map();
    for (const axis of axes) {
      const channel = { axis, speed: direction * speed, sampledAt: clock.now() };
      cardChannels[spinChannel(axis)] = channel;
      spinChannels.set(axis, channel);
    }
    channels.set(cardId, cardChannels);
    ensureFrame();
    renderCard(cardId);
    emit("change", snapshot());
    return {
      active: true,
      stop: () => {
        const currentChannels = channels.get(cardId);
        if (!axes.every((axis) => currentChannels?.[spinChannel(axis)] === spinChannels.get(axis))) return false;
        return stopSpin(cardId);
      },
    };
  }

  function stopSpin(cardId) {
    const cardChannels = channels.get(cardId);
    const activeAxes = ["x", "y"].filter((axis) => cardChannels?.[spinChannel(axis)]);
    if (activeAxes.length === 0) return false;
    for (const axis of activeAxes) cancelChannel(cardId, spinChannel(axis));
    renderCard(cardId);
    emit("change", snapshot());
    return true;
  }

  function scheduleChannel(cardId, channelName, target, {
    transition, operationIndex, immediate = false, interactionOwned = false, snap = false, snapDelay = 0, zone,
  } = {}) {
    if (!interactionOwned && interactionPositions.has(cardId) && ['x', 'y', 'z'].includes(channelName)) return;
    const pose = cardPose(cardId);
    const isFlip = channelName === "flipX" || channelName === "flipY";
    const axis = isFlip ? channelName.slice(-1).toLowerCase() : null;
    const current = isFlip ? flipValue(pose, axis) : pose[channelName];
    const targetValue = channelName === "angle" || isFlip
      ? shortestAngleTarget(current, target)
      : target;
    cancelChannel(cardId, channelName);
    const ticket = transition ? { transition, operationIndex, status: null } : null;
    if (ticket) {
      transition.pending += 1;
      transition.results[operationIndex].remaining += 1;
    }
    if (Math.abs(current - targetValue) < 0.0001) {
      if (isFlip) setFlipValue(pose, axis, target);
      else pose[channelName] = targetValue;
      if (ticket) settleTicket(ticket, "skipped");
      return;
    }
    if (reducedMotion || immediate || transition?.immediate) {
      if (isFlip) setFlipValue(pose, axis, target);
      else pose[channelName] = targetValue;
      if (ticket) settleTicket(ticket, "settled");
      return;
    }
    const cardChannels = channels.get(cardId) ?? {};
    const snapOrientation = snap && SNAP_ORIENTATION_CHANNELS.has(channelName);
    const card = desired.cards.find((candidate) => candidate.id === cardId);
    const weight = WEIGHTED_MOTION_CHANNELS.has(channelName)
      || snapOrientation ? (card?.weight ?? 1) : 1;
    const overshoot = snapOrientation
      ? Math.min(2.4, 1.6 + 0.2 * Math.sqrt(weight))
      : null;
    cardChannels[channelName] = {
      from: current,
      to: targetValue,
      restingTarget: isFlip ? target : targetValue,
      startedAt: clock.now() + (snap ? snapDelay : 0),
      duration: duration * weight / zoneMotionSpeed(zone, channelName),
      overshoot,
      easing: snap && !snapOrientation ? smoothStep : null,
      snap,
      axis,
      ticket,
    };
    channels.set(cardId, cardChannels);
  }

  function schedule(cardId, channelName, target, transition, operationIndex, zone) {
    scheduleChannel(cardId, channelName, target, { transition, operationIndex, zone });
  }

  function scheduleContentResize(cardId, targetPose, transition, operationIndex) {
    const current = cardPose(cardId);
    const changedChannels = ["width", "height"].filter((channelName) => Math.abs(current[channelName] - targetPose[channelName]) > 0.0001);
    if (changedChannels.length === 0) {
      transition.results[operationIndex].status = "settled";
      return;
    }
    schedule(cardId, changedChannels[0], targetPose[changedChannels[0]], transition, operationIndex);
    for (const channelName of changedChannels.slice(1)) scheduleChannel(cardId, channelName, targetPose[channelName]);
  }

  function cancelAllChannels(status) {
    for (const [cardId, cardChannels] of channels) {
      for (const channelName of Object.keys(cardChannels)) cancelChannel(cardId, channelName, status);
    }
  }

  function apply(inputSnapshot) {
    const next = normalizeSnapshot(inputSnapshot);
    const nextZones = resolveZones(next, renderer, resolvedZones);
    const poses = solve(next, nextZones);
    const previousTargets = desired ? solve(desired, resolvedZones) : new Map();
    interaction?.beforeCommit(next);
    if (desired) sample(clock.now());
    const previousDesired = desired;
    const previousVisual = new Map(visual);
    if (previousDesired) {
      const nextIds = new Set(next.cards.map((card) => card.id));
      for (const card of previousDesired.cards) {
        if (nextIds.has(card.id)) continue;
        for (const name of Object.keys(channels.get(card.id) ?? {})) cancelChannel(card.id, name);
        renderer.remove(card.id);
      }
    }
    desired = next;
    resolvedZones = nextZones;
    visual = new Map([...poses].map(([cardId, pose]) => {
      const card = desired.cards.find((candidate) => candidate.id === cardId);
      const previousPose = previousVisual.get(cardId);
      const target = visualPose(card, pose);
      if (!previousPose) return [cardId, target];
      return [cardId, {
        ...target,
        x: previousPose.x,
        y: previousPose.y,
        z: previousPose.z,
        angle: previousPose.angle,
        scale: previousPose.scale,
        layoutScale: previousPose.layoutScale ?? 1,
        width: previousPose.width,
        height: previousPose.height,
        thickness: previousPose.thickness,
        flipX: previousPose.flipX,
        flipY: previousPose.flipY,
      }];
    }));
    if (previousDesired) {
      for (const [cardId, targetPose] of poses) {
        if (!previousVisual.has(cardId)) continue;
        const target = visualPose(desired.cards.find((card) => card.id === cardId), targetPose);
        const oldTarget = visualPose(previousDesired.cards.find((card) => card.id === cardId), previousTargets.get(cardId));
        const targetZone = zoneForCard(nextZones, cardId);
        for (const name of ["x", "y", "z", "angle", "scale", "layoutScale", "width", "height", "thickness", "flipX", "flipY"]) {
          if (oldTarget[name] === target[name]) continue;
          if (name === "flipX" || name === "flipY") cancelChannel(cardId, name === "flipX" ? "spinX" : "spinY");
          scheduleChannel(cardId, name, target[name], { zone: targetZone });
        }
        const current = cardPose(cardId);
        current.depthScale = target.depthScale;
        current.tiltX = target.tiltX;
        current.tiltY = target.tiltY;
        current.pivotX = target.pivotX;
        current.pivotY = target.pivotY;
      }
    }
    renderAll({ render: false });
    renderer.render?.();
    ensureFrame();
    trackGeometry();
    interaction?.reconcile();
    selection.reconcile();
    renderer.updateSelection?.(selection.snapshot());
    emit("change", snapshot());
  }

  function transact(operations, options = {}) {
    if (!desired) throw new Error("Call scene.apply before scene.transact");
    if (!Array.isArray(operations)) throw new TypeError("scene.transact requires an operations array");
    const next = copy(desired);
    const cards = cardById(next.cards);
    const zones = zoneById(next.zones);
    const transition = {
      pending: 0,
      scheduling: true,
      moved: new Set(),
      promoted: new Map(),
      immediate: Boolean(options.immediate),
      results: operations.map((operation) => ({ type: operation.type,
        ...(operation.type === "moveBatch" ? { cardIds: copy(operation.cardIds) } : { cardId: operation.cardId }),
        status: "pending" })),
      commits: new Map(),
      rollbacks: new Map(),
      resolve: null,
    };
    transition.results.forEach((result, index) => {
      const operation = operations[index];
      const channelCount = operationResultChannels[operation.type];
      if (!channelCount) throw new TypeError(`Unknown operation: ${operation.type}`);
      channelCount(operation); // Validate axes before modifying the cloned model.
      result.remaining = 0;
    });
    transition.finished = new Promise((resolve) => { transition.resolve = resolve; });

    const applyOperations = {
      move(operation, card) {
        const pose = card.pose ?? normalizePose();
        if (operation.position) {
          card.pose = { ...pose, ...operation.position };
          card.positionMode = "absolute";
        } else if (operation.to) {
          const destination = zones.get(operation.to);
          if (!destination) throw new Error(`Unknown zone: ${operation.to}`);
          if (operation.index !== undefined && (!Number.isInteger(operation.index) || operation.index < 0)) throw new RangeError("Move index must be a non-negative integer");
          for (const zone of next.zones) zone.cardIds = zone.cardIds.filter((id) => id !== card.id);
          const index = Math.max(0, Math.min(operation.index ?? destination.cardIds.length, destination.cardIds.length));
          destination.cardIds.splice(index, 0, card.id);
          applyZoneFacePolicy(card, destination);
          delete card.positionMode;
        } else {
          throw new TypeError("Move requires position or destination zone");
        }
      },
      rotate(operation, card) {
        if (!Number.isFinite(operation.angle)) throw new TypeError("Rotate angle must be finite");
        card.pose = { ...(card.pose ?? normalizePose()), angle: operation.angle };
      },
      scale(operation, card) {
        if (!Number.isFinite(operation.factor) || operation.factor <= 0) throw new RangeError("Scale factor must be positive and finite");
        card.pose = { ...(card.pose ?? normalizePose()), scale: operation.factor };
      },
      resize(operation, card) {
        const current = card.dimensions ?? cardDimensions(card, config.templates, config.elementRenderers);
        const dimensions = operation.dimensions ?? operation;
        const width = dimensions.width ?? current.width;
        const height = dimensions.height ?? current.height;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          throw new RangeError("Resize dimensions must be positive and finite");
        }
        card.dimensions = { width, height };
      },
      thickness(operation, card) {
        if (!Number.isFinite(operation.thickness) || operation.thickness <= 0) {
          throw new RangeError("Thickness must be positive and finite");
        }
        card.thickness = operation.thickness;
      },
      face(operation, card, operationIndex) {
        if (operation.face !== "faceUp" && operation.face !== "faceDown") throw new TypeError("Face must be faceUp or faceDown");
        const axes = flipAxes(operation.axis ?? card.flipAxis ?? "y");
        const wasFaceUp = card.faceUp;
        card.faceUp = operation.face === "faceUp";
        if (card.faceUp !== wasFaceUp && card.faceUp && card.faceCycle) {
          const previousNextFaceId = card.faceCycleNextFaceId;
          delete card.faceCycleNextFaceId;
          stageLogicalFace(card);
          transition.commits.set(operationIndex, () => {
            card.activeFaceId = card.faceCycleNextFaceId;
            delete card.faceCycleNextFaceId;
            renderCard(card.id);
          });
          transition.rollbacks.set(operationIndex, () => {
            if (previousNextFaceId === undefined) delete card.faceCycleNextFaceId;
            else card.faceCycleNextFaceId = previousNextFaceId;
          });
        }
        card.flipAxis = axes[0];
        card.flipAxes = axes;
        card.pose = { ...(card.pose ?? normalizePose()) };
        if (operation.angle !== undefined) {
          for (const axis of axes) setFlipValue(card.pose, axis, angleForAxis(operation.angle, axis));
        } else {
          for (const axis of axes) {
            delete card.pose[flipChannel(axis)];
          }
        }
      },
      element(operation, card) {
        const faceId = operation.faceId ?? card.activeFaceId;
        const face = faceId === "back" ? (card.back ?? (card.back = { elements: [] })) : card.faces[faceId];
        if (!face) throw new Error(`Unknown face ${faceId} on card ${card.id}`);
        const elements = face.elements ?? [];
        const elementIndex = elements.findIndex(({ id }) => id === operation.elementId);
        if (operation.action === "add") {
          if (elementIndex !== -1) throw new Error(`Element ${operation.elementId} already exists on face ${faceId}`);
          elements.push(normalizeElement({ ...operation.element, id: operation.elementId }, elements.length));
          return;
        }
        if (elementIndex === -1) throw new Error(`Unknown element ${operation.elementId} on face ${faceId}`);
        if (operation.action === "remove") {
          elements.splice(elementIndex, 1);
          return;
        }
        if (operation.action === "show" || operation.action === "hide") {
          elements[elementIndex] = { ...elements[elementIndex], visible: operation.action === "show" };
          return;
        }
        if (operation.action === "update") {
          elements[elementIndex] = normalizeElement({ ...elements[elementIndex], ...operation.element, id: operation.elementId }, elementIndex);
          return;
        }
        if (operation.action === "reorder") {
          if (!Number.isInteger(operation.index) || operation.index < 0 || operation.index >= elements.length) {
            throw new RangeError(`Element ${operation.elementId} reorder index must be within the face`);
          }
          const [element] = elements.splice(elementIndex, 1);
          elements.splice(operation.index, 0, element);
          face.elements = elements.map((item, index) => ({ ...item, layout: { ...item.layout, order: index } }));
          return;
        }
        throw new TypeError(`Unknown element action: ${operation.action}`);
      },
    };

    for (const [operationIndex, operation] of operations.entries()) {
      if (operation.type === "moveBatch") {
        const destination = zones.get(operation.to);
        if (!destination) throw new Error(`Unknown zone: ${operation.to}`);
        const { nextSnapshot } = resolveBatchMove(next, {
          cardIds: operation.cardIds, toZoneId: operation.to, index: operation.index, validate: false,
        });
        for (const updated of nextSnapshot.zones) zones.get(updated.id).cardIds = [...updated.cardIds];
        for (const id of operation.cardIds) {
          delete cards.get(id).positionMode;
          applyZoneFacePolicy(cards.get(id), destination);
        }
        continue;
      }
      if (operation.type === "zone") {
        const zone = zones.get(operation.zoneId);
        if (!zone) throw new Error(`Unknown zone: ${operation.zoneId}`);
        if (!operation.changes || typeof operation.changes !== "object") throw new TypeError("Zone operation requires changes");
        for (const key of Object.keys(operation.changes)) {
          if (!["geometry", "depth", "visible", "capacity", "arrangement", "dropTarget", "scale", "faceUp", "motion"].includes(key)) throw new TypeError(`Unsupported zone change: ${key}`);
        }
        Object.assign(zone, copy(operation.changes));
        if (operation.changes.faceUp !== undefined) {
          for (const cardId of zone.cardIds) applyZoneFacePolicy(cards.get(cardId), zone);
        }
        transition.moved.add(operationIndex);
        continue;
      }
      const card = cards.get(operation.cardId);
      if (!card) throw new Error(`Unknown card: ${operation.cardId}`);
      const handler = applyOperations[operation.type];
      if (!handler) throw new TypeError(`Unknown operation: ${operation.type}`);
      handler(operation, card, operationIndex);
    }

    normalizeSnapshot(next); // Validate the complete batch before any state or motion mutation.
    const nextZones = resolveZones(next, renderer, resolvedZones);
    const targets = solve(next, nextZones);
    interaction?.beforeCommit(next, operations);
    sample(clock.now());
    transitions.add(transition);
    const previous = desired;
    desired = next;
    resolvedZones = nextZones;
    const affected = new Set(operations.flatMap((operation) => operation.cardIds ?? [operation.cardId]).filter(Boolean));
    if (operations.some((operation) => ["move", "moveBatch", "zone", "resize", "thickness", "element"].includes(operation.type))) {
      for (const [cardId, targetPose] of targets) {
        const current = cardPose(cardId);
        if (current) affected.add(cardId);
      }
    }
    for (const cardId of affected) {
      const card = cards.get(cardId);
      const targetPose = targets.get(cardId);
      if (!targetPose) throw new Error(`Card ${cardId} has no layout target`);
      const current = cardPose(cardId);
      const oldCard = previous.cards.find((candidate) => candidate.id === cardId);
      const operationIndexes = operations.flatMap((operation, index) => (operation.cardId === cardId || operation.cardIds?.includes(cardId)) ? [index] : []);
      const hasExplicitRotation = operations.some((operation) => operation.type === "rotate" && operation.cardId === cardId);
      const hasExplicitScale = operations.some((operation) => operation.type === "scale" && operation.cardId === cardId);
      const targetZone = zoneForCard(nextZones, cardId);
      const scheduleTarget = (channelName, target, operationIndex) => schedule(cardId, channelName, target, transition, operationIndex, targetZone);
      const scheduleOperations = {
        move: (operationIndex) => {
          scheduleTarget("x", targetPose.x, operationIndex);
          scheduleTarget("y", targetPose.y, operationIndex);
          scheduleTarget("z", targetPose.z, operationIndex);
          if (!hasExplicitScale) scheduleTarget("scale", targetPose.scale, operationIndex);
          scheduleTarget("layoutScale", targetPose.layoutScale ?? 1, operationIndex);
          if (!hasExplicitRotation) scheduleTarget("angle", targetPose.angle, operationIndex);
        },
        moveBatch: (operationIndex) => {
          scheduleTarget("x", targetPose.x, operationIndex);
          scheduleTarget("y", targetPose.y, operationIndex);
          scheduleTarget("z", targetPose.z, operationIndex);
          if (!hasExplicitScale) scheduleTarget("scale", targetPose.scale, operationIndex);
          scheduleTarget("layoutScale", targetPose.layoutScale ?? 1, operationIndex);
          if (!hasExplicitRotation) scheduleTarget("angle", targetPose.angle, operationIndex);
        },
        rotate: (operationIndex) => scheduleTarget("angle", targetPose.angle, operationIndex),
        scale: (operationIndex) => scheduleTarget("scale", targetPose.scale, operationIndex),
        resize: (operationIndex) => {
          scheduleTarget("width", targetPose.width, operationIndex);
          scheduleTarget("height", targetPose.height, operationIndex);
        },
        thickness: (operationIndex) => scheduleTarget("thickness", targetPose.thickness, operationIndex),
        face: (operationIndex) => {
          const operation = operations[operationIndex];
          const axes = flipAxes(operation.axis ?? card.flipAxis ?? "y");
          current.flipAxis = axes[0];
          for (const axis of axes) {
            cancelChannel(cardId, spinChannel(axis));
            const targetAngle = operation.angle === undefined
              ? (card.faceUp ? 0 : 180)
              : angleForAxis(operation.angle, axis);
            scheduleTarget(flipChannel(axis), targetAngle, operationIndex);
          }
        },
        element: (operationIndex) => {
          scheduleContentResize(cardId, targetPose, transition, operationIndex);
        },
      };
      for (const operationIndex of operationIndexes) {
        const operation = operations[operationIndex];
        scheduleOperations[operation.type](operationIndex);
      }
      if (!operationIndexes.some((index) => ["move", "moveBatch"].includes(operations[index].type)) && operations.some((op) => ["move", "moveBatch", "zone", "resize", "element", "thickness"].includes(op.type))) {
        const layoutChannels = ["x", "y", "z", ...(hasExplicitScale ? [] : ["scale"]), "layoutScale", ...(hasExplicitRotation ? [] : ["angle"])];
        for (const name of layoutChannels) {
          const active = channels.get(cardId)?.[name];
          if (active && Math.abs(active.to - targetPose[name]) < 0.0001) continue;
          const owner = operationIndexes[0] ?? operations.findIndex((op) => ["move", "moveBatch", "zone", "resize", "element", "thickness"].includes(op.type));
          scheduleTarget(name, targetPose[name], owner);
        }
      }
      if (oldCard && oldCard.faceUp !== card.faceUp && !operations.some((operation) => operation.cardId === cardId && operation.type === "face")) {
        scheduleTarget("flipY", card.faceUp ? 0 : 180, operationIndexes[0] ?? 0);
      }
      current.visible = targetPose.visible;
      if (operationIndexes.length === 0) current.thickness = targetPose.thickness;
      current.depthScale = targetPose.depthScale;
      current.drawOrder = targetPose.drawOrder;
      current.tiltX = targetPose.tiltX;
      current.tiltY = targetPose.tiltY;
      current.pivotX = targetPose.pivotX;
      current.pivotY = targetPose.pivotY;
    }
    const movedCardIds = operations.flatMap((operation) => operation.type === "moveBatch"
      ? operation.cardIds
      : operation.type === "move" ? [operation.cardId] : []);
    let promotionOrder = Math.max(-1, ...[...visual.values()].map((pose) => pose.drawOrder ?? 0)) + 1;
    for (const cardId of movedCardIds) {
      const pose = cardPose(cardId);
      if (!pose || transition.promoted.has(cardId)) continue;
      transition.promoted.set(cardId, targets.get(cardId)?.drawOrder ?? pose.drawOrder);
      pose.drawOrder = promotionOrder;
      promotionOrder += 1;
    }
    transition.scheduling = false;
    trackGeometry();
    finishTransition(transition);
    if (transition.pending > 0) ensureFrame();
    renderAll({ render: false });
    renderer.render?.();
    interaction?.reconcile();
    selection.reconcile();
    renderer.updateSelection?.(selection.snapshot());
    emit("change", snapshot());
    return { finished: transition.finished };
  }

  function snapshot() {
    const spinning = [...channels.values()].some((cardChannels) => Object.keys(cardChannels)
      .some((channelName) => channelName === "spinX" || channelName === "spinY"));
    return {
      desired: copy(desired ?? { cards: [], zones: [] }),
      zones: copy([...resolvedZones.values()]),
      visual: [...visual.entries()].map(([cardId, pose]) => ({ cardId, pose: copy(pose), physicalSide: physicalSide(pose) })),
      selection: selection.snapshot(),
      settling: channels.size > 0 || Boolean(interaction?.needsFrame?.()),
      spinning,
      renderer: renderer.type ?? "custom",
      rendererReason: rendererReason ?? renderer.reason ?? null,
      projection: renderer.projection ?? null,
      interaction: interaction?.snapshot() ?? { sessions: [] },
    };
  }

  function viewport() {
    return renderer.viewport ? copy(renderer.viewport) : null;
  }

  function on(event, listener) {
    const eventListeners = listeners.get(event) ?? new Set();
    eventListeners.add(listener);
    listeners.set(event, eventListeners);
    return () => eventListeners.delete(listener);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    input?.destroy();
    interaction?.destroy();
    if (geometryFrame !== null) clock.cancelFrame(geometryFrame);
    if (frameId) clock.cancelFrame(frameId);
    frameId = null;
    cancelAllChannels("destroyed");
    for (const transition of transitions) {
      for (const result of transition.results) if (result.status === "pending") result.status = "destroyed";
      transition.pending = 0;
      transition.resolve(copy(transition.results.map(({ remaining, ...result }) => result)));
    }
    transitions.clear();
    for (const session of targetSessions) session.cancel();
    targetSessions.clear();
    selection.clear();
    renderer.destroy();
    listeners.clear();
  }

  interaction = createInteraction({
    state: () => ({ desired, visual, zones: [...resolvedZones.values()] }),
    solve: (next) => solve(next, new Map([...resolvedZones].map(([id, zone]) => [id, { ...zone, ...next.zones.find((candidate) => candidate.id === id), geometry: zone.geometry, visible: zone.visible }]))),
    sample: () => sample(clock.now()),
    refresh: refreshGeometry,
    takePosition: (id) => { for (const name of ['x', 'y', 'z']) cancelChannel(id, name); },
    present: presentInteraction,
    commit: (operations) => {
      const previousPositions = interactionPositions;
      interactionPositions = new Map();
      try {
        return transact(operations);
      } catch (error) {
        interactionPositions = previousPositions;
        throw error;
      }
    },
    emit,
    rules: config.interaction?.rules,
    toClient: sceneToClient,
    fromClient: clientToScene,
    isSelectable: selection.isSelectable,
    now: () => clock.now(),
    reducedMotion: () => reducedMotion,
    requestFrame: ensureFrame,
    defaultPresentation: config.interaction?.dragPresentation,
    dragHangFactor,
    dragSnapDelay,
  });
  function drag(request) {
    if (!desired) throw new Error("Call scene.apply before scene.drag");
    return interaction.drag({ ...request, cardIds: selection.order(request?.cardIds, request?.order ?? "source") });
  }
  function invalidateRules() {
    // Cancel an ineligible frozen cohort before exposing its pruned selection.
    interaction.invalidateRules();
    selection.reconcile();
  }
  const api = { apply, transact, spin, stopSpin, select, hitTest, target, setMotion, snapshot, viewport, refreshGeometry, on, destroy,
    clientToScene, sceneToClient, drag, resolveDrop: interaction.resolveDrop, invalidateRules };
  if (config.element && config.interaction) input = createInputAdapter({ element: config.element, scene: api, options: config.interaction,
    selectionContext: (focusedCardId) => selection.context(focusedCardId) });
  return api;
}
