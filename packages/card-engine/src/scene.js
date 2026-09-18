import { cardById, normalizeElement, normalizePose, normalizeSnapshot, normalizeZonePolicies, normalizeZonePresentation, validateReorderPolicy, validateZonePolicies, zoneById } from "./model.js";
import { cardDimensions, solveAllPoses } from "./layout.js";
import { createClock, interpolate, shortestAngleTarget } from "./motion.js";
import { createHeadlessRenderer, createRenderer } from "./renderer.js";
import { createWebGLRenderer } from "./renderers/webgl.js";
import { resolveZones } from "./zones.js";
import { createInteraction } from "./interaction.js";
import { createInputAdapter } from "./input.js";
import { createSelection } from "./selection.js";
import { createInspection } from "./inspection.js";
import { attachInspectionInput } from "./inspection-input.js";
import { createFeedback } from "./feedback.js";
import { resolveBatchMove } from "./batch.js";
import { normalizeSortPolicy, sortCardIds } from "./sort.js";
import { normalizeDragMotion } from "./drag-motion.js";
import { advanceSpring } from "./drag-physics.js";

const copy = (value) => structuredClone(value);
const DEFAULT_ZONE_MOTION_SPEED = 1.5;
const WEIGHTED_MOTION_CHANNELS = new Set(["x", "y", "z", "angle", "scale", "layoutScale", "flipX", "flipY"]);
const SNAP_ORIENTATION_CHANNELS = new Set(["angle", "tiltX", "tiltY"]);
const smoothStep = (progress) => progress * progress * (3 - 2 * progress);
const bounceDamping = (bounce) => bounce <= 0 ? 1
  : -Math.log(Math.min(0.8, bounce)) / Math.hypot(Math.PI, Math.log(Math.min(0.8, bounce)));

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
  reorder: () => 3,
  zone: () => 0,
  rotate: () => 1,
  scale: () => 1,
  resize: () => 2,
  thickness: () => 1,
  face: (operation) => flipAxes(operation.axis).length,
  contentFace: () => 1,
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

function invalidateFaceSelection(card, explicitWhileConcealed = false) {
  card.faceSelectionRevision = (card.faceSelectionRevision ?? 0) + 1;
  delete card.faceCycleNextFaceId;
  if (explicitWhileConcealed) card.faceSelectionLocked = true;
  else delete card.faceSelectionLocked;
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
  const key = SNAP_ORIENTATION_CHANNELS.has(channelName)
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
  const legacyDragMotion = {};
  for (const [legacy, name] of [["dragHangFactor", "dangle"], ["dragUprightFactor", "upright"], ["dragSnapDelay", "landingDelay"]]) {
    const value = config.interaction?.[legacy];
    if (value !== undefined) legacyDragMotion[name] = value;
  }
  if (config.interaction?.motion !== undefined) normalizeDragMotion(config.interaction.motion);
  let dragMotion = normalizeDragMotion({ ...legacyDragMotion, ...config.interaction?.motion });
  const normalizeDragAnchor = (value) => {
    if (value !== "grab" && value !== "center") throw new TypeError("dragAnchor must be grab or center");
    return value;
  };
  let dragAnchor = normalizeDragAnchor(config.interaction?.dragAnchor ?? "grab");
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
  let inspection;
  let inspectionInput;
  let feedback;
  const inspectionHandles = new Map();
  let interactionPositions = new Map();
  let committingDrag = null;
  let batchingRender = false;
  const dirtyCards = new Set();
  let pendingInteractionDetail = null;
  let carriedGroups = [];
  let renderPending = false;
  const permissionRules = config.interaction?.rules ?? {};
  const origins = new Set(["system", "user"]);
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

  function authorizeUserRule(name, legacyName, request) {
    const callback = permissionRules[name] ?? (legacyName ? permissionRules[legacyName] : undefined);
    let result;
    try {
      result = typeof callback === "function" ? callback(copy(request)) : undefined;
    } catch {
      result = undefined;
    }
    if (result?.allowed !== true) {
      const labels = { canTake: "Take", canPut: "Put", canReveal: "Reveal", canConceal: "Conceal", canSpin: "Spin", canChangeFace: "Change face" };
      throw new Error(result?.reason ?? `${labels[name] ?? "User action"} is not permitted`);
    }
  }

  function userSources(cardIds, snapshot = desired) {
    return cardIds.flatMap((cardId) => snapshot.zones.flatMap((zone) => zone.cardIds.includes(cardId)
      ? [{ cardId, zoneId: zone.id, index: zone.cardIds.indexOf(cardId) }] : []));
  }

  function authorizeUserOperations(operations) {
    const snapshot = copy(desired);
    const zoneMap = new Map(snapshot.zones.map((zone) => [zone.id, zone]));
    const cardMap = new Map(snapshot.cards.map((card) => [card.id, card]));
    const facePermission = (cardIds, face, zoneId, extra = {}) => {
      authorizeUserRule(face === "faceUp" ? "canReveal" : "canConceal", null, {
        cardIds: [...cardIds], face, zoneId, sources: userSources(cardIds, snapshot), snapshot, ...extra,
      });
    };
    for (const operation of operations) {
      const cardIds = operation.type === "reorder" ? [...operation.cardIds] : operation.cardIds ?? [operation.cardId];
      for (const cardId of cardIds) {
        if (cardMap.get(cardId)?.feedback?.disabled === true) {
          throw new Error(`Card ${cardId} is disabled`);
        }
      }
      if (["move", "moveBatch", "reorder"].includes(operation.type)) {
        const toZoneId = operation.type === "reorder" ? operation.zoneId : operation.to;
        const sources = userSources(cardIds, snapshot);
        authorizeUserRule("canTake", "canStart", {
          cardIds, primaryCardId: cardIds[0], sources,
          toZoneId, index: operation.index, snapshot,
        });
        const destinationZoneIds = toZoneId === undefined
          ? [...new Set(sources.map(({ zoneId }) => zoneId))]
          : [toZoneId];
        for (const destinationZoneId of destinationZoneIds) {
          const destination = zoneMap.get(destinationZoneId);
          authorizeUserRule("canPut", "canDrop", {
            cardIds, primaryCardId: cardIds[0], sources,
            toZoneId: destinationZoneId, index: operation.index, position: operation.position, snapshot,
          });
          if (destination?.faceUp !== undefined) {
            const changed = cardIds.filter((cardId) => cardMap.get(cardId)?.faceUp !== destination.faceUp);
            if (changed.length) facePermission(changed, destination.faceUp ? "faceUp" : "faceDown", destinationZoneId, { via: "move" });
          }
        }
      } else if (operation.type === "face") {
        const zone = snapshot.zones.find((candidate) => candidate.cardIds.includes(operation.cardId));
        facePermission(cardIds, operation.face, zone?.id, { axis: operation.axis, via: "face" });
      } else if (operation.type === "contentFace") {
        const zone = snapshot.zones.find((candidate) => candidate.cardIds.includes(operation.cardId));
        authorizeUserRule("canChangeFace", null, {
          cardIds, cardId: operation.cardId, faceId: operation.faceId, zoneId: zone?.id,
          sources: userSources(cardIds, snapshot), snapshot, via: "contentFace",
        });
      }
    }
  }

  function logicalRestingPose(cardId, pose) {
    const card = desired?.cards.find((candidate) => candidate.id === cardId);
    const faceUp = card?.faceUp !== false;
    return {
      ...pose,
      flipX: card?.pose?.flipX ?? 0,
      flipY: card?.pose?.flipY ?? (faceUp ? 0 : 180),
    };
  }

  function presentInteraction(positions, detail, resting) {
    const previous = interactionPositions;
    interactionPositions = positions;
    carriedGroups = detail.sessions.filter((session) => session.phase === "dragging");
    for (const id of new Set([...previous.keys(), ...positions.keys()])) {
      const current = cardPose(id);
      if (!current) continue;
      const entry = positions.get(id);
      const target = entry?.pose ?? (previous.has(id) ? logicalRestingPose(id, resting.get(id)) : resting.get(id));
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
              snap: entry?.snap === true || (!entry && previous.get(id)?.carried === true),
              returning: !entry,
              snapDelay: entry?.snapDelay ?? 0,
              velocity: (entry ?? previous.get(id))?.angularVelocity?.[name],
              durationOverride: entry?.carried && entry?.direct && name === 'scale' ? (entry.liftTime ?? dragMotion.liftTime) : undefined,
              zone: entry?.zoneId ? resolvedZones.get(entry.zoneId) : zoneForCard(resolvedZones, id),
            });
            changed = true;
          }
        }
      }
      if (changed) dirtyCards.add(id);
    }
    pendingInteractionDetail = detail;
    renderPending = true;
    if (reducedMotion && !batchingRender) flushRender();
    ensureFrame();
  }

  function solve(snapshot, zones) {
    // The actual WebGL camera owns projection, including perspective scaling.
    const layoutCamera = renderer.type === "webgl" ? { ...camera, depthScale: () => 1 } : camera;
    return solveAllPoses({ ...snapshot, zones: [...zones.values()] }, layoutCamera, config.templates, config.elementRenderers);
  }

  function applyAutoSort(snapshot) {
    for (const zone of snapshot.zones) {
      if (!zone.autoSort) continue;
      zone.cardIds = sortCardIds(snapshot, {
        zoneId: zone.id,
        by: zone.autoSort.by,
        direction: zone.autoSort.direction,
        missing: zone.autoSort.missing,
      });
      validateZonePolicies(zone, zone.cardIds, "automatic sort");
    }
    return snapshot;
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
    if (event === "change") {
      inspection?.reconcile();
      detail = { ...detail, inspection: inspection?.snapshot() ?? { sessions: [] } };
    }
    for (const listener of listeners.get(event) ?? []) listener(detail);
  }

  function cardPose(cardId) {
    return visual.get(cardId);
  }

  function renderCard(cardId, options = {}) {
    if (batchingRender) { dirtyCards.add(cardId); return; }
    const card = desired?.cards.find((candidate) => candidate.id === cardId);
    const pose = cardPose(cardId);
    if (!card || !pose) return;
    const entry = interactionPositions.get(cardId);
    let rendered = pose;
    if (entry?.renderPose) {
      const elevated = clientToScene(sceneToClient(pose), entry.renderPose.z);
      rendered = {
        ...pose,
        ...(elevated ?? entry.renderPose),
        z: entry.renderPose.z,
        ...(entry.renderPose.pivotX === undefined ? {} : { pivotX: entry.renderPose.pivotX }),
        ...(entry.renderPose.pivotY === undefined ? {} : { pivotY: entry.renderPose.pivotY }),
      };
    }
    if (entry?.grab && entry?.grabClient) {
      const anchored = renderer.resolveGrabPose?.(rendered, entry.grab, entry.grabClient);
      if (anchored) {
        rendered = { ...rendered, ...anchored };
        const logical = clientToScene(sceneToClient(rendered), pose.z);
        if (logical) { pose.x = logical.x; pose.y = logical.y; }
      }
    }
    const inspected = inspection?.decorate(card, rendered) ?? { card, pose: rendered };
    const zone = zoneForCard(resolvedZones, cardId);
    const renderOptions = Object.hasOwn(options, "presentation")
      ? options
      : { ...options, presentation: inspected.card !== card ? null : zone?.presentation };
    renderer.update(inspected.card, inspected.pose, renderOptions);
    feedback?.updateCard(inspected.card, inspected.pose);
  }

  function anchorCarriedGroups() {
    for (const group of carriedGroups) {
      const entry = interactionPositions.get(group.primaryCardId);
      const primary = cardPose(group.primaryCardId);
      if (!entry?.grab || !entry.grabClient || !primary) continue;
      const center = sceneToClient(primary);
      const depth = entry.renderPose?.z ?? primary.z;
      const rendered = { ...primary, ...clientToScene(center, depth), z: depth };
      const anchored = renderer.resolveGrabPose?.(rendered, entry.grab, entry.grabClient);
      if (!anchored) continue;
      const corrected = sceneToClient({ ...rendered, ...anchored });
      const dx = corrected.x - center.x;
      const dy = corrected.y - center.y;
      // A physical grab moves the whole carried group. Apply the same screen
      // translation at each member's depth to retain preserve/compact offsets.
      for (const id of group.cardIds) {
        const pose = cardPose(id);
        if (!pose) continue;
        const projected = sceneToClient(pose);
        const logical = clientToScene({ x: projected.x + dx, y: projected.y + dy }, pose.z);
        if (!logical) continue;
        pose.x = logical.x;
        pose.y = logical.y;
        dirtyCards.add(id);
      }
    }
  }

  function flushRender() {
    if (!dirtyCards.size && !renderPending) return;
    anchorCarriedGroups();
    const pending = [...dirtyCards];
    dirtyCards.clear();
    for (const id of pending) renderCard(id, { render: false });
    if (pendingInteractionDetail) renderer.updateInteraction?.(pendingInteractionDetail);
    pendingInteractionDetail = null;
    renderPending = false;
    renderer.render?.();
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

  function settleChannelTickets(channel, status) {
    const tickets = channel?.tickets ?? (channel?.ticket ? [channel.ticket] : []);
    for (const ticket of tickets) settleTicket(ticket, status);
    if (channel) {
      channel.tickets = [];
      delete channel.ticket;
    }
  }

  function attachChannelTicket(channel, transition, operationIndex) {
    const ticket = { transition, operationIndex, status: null };
    transition.pending += 1;
    transition.results[operationIndex].remaining += 1;
    channel.tickets ??= channel.ticket ? [channel.ticket] : [];
    delete channel.ticket;
    channel.tickets.push(ticket);
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
          needsRender = true;
          continue;
        }
        const elapsed = Math.max(0, time - channel.startedAt);
        const progress = reducedMotion ? 1 : Math.min(1, elapsed / channel.duration);
        const easedProgress = channel.easing
            ? channel.easing(progress)
            : progress;
        const spring = channel.spring && !reducedMotion
          ? advanceSpring(channel.from, channel.velocity, channel.to, elapsed / 1000, channel.duration, channel.damping)
          : null;
        const value = spring?.value ?? interpolate(channel.from, channel.to, easedProgress);
        if (spring) channel.currentVelocity = spring.velocity;
        if (channelName === "flipX" || channelName === "flipY") setFlipValue(pose, channel.axis, value);
        else pose[channelName] = value;
        needsRender = true;
        const settled = spring
          ? elapsed >= channel.duration && ((Math.abs(value - channel.to) < 0.02 && Math.abs(spring.velocity) < 0.2)
            || elapsed >= channel.duration * 3)
          : progress >= 1;
        if (settled) {
          if (channelName === "flipX" || channelName === "flipY") setFlipValue(pose, channel.axis, channel.restingTarget ?? channel.to);
          else pose[channelName] = channel.to;
          delete cardChannels[channelName];
          settleChannelTickets(channel, "settled");
        }
      }
      renderCard(cardId, { render: false });
      if (Object.keys(cardChannels).length === 0) channels.delete(cardId);
    }
    if (needsRender) {
      if (batchingRender) renderPending = true;
      else renderer.render?.();
    }
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
    batchingRender = true;
    try {
      sample(time);
      interaction?.tick?.();
    } finally {
      batchingRender = false;
      flushRender();
      inspection?.reconcile();
    }
    ensureFrame();
  }

  function ensureFrame() {
    if (!destroyed && frameId === null && (renderPending || dirtyCards.size > 0 || channels.size > 0 || interaction?.needsFrame?.())) frameId = clock.requestFrame(onFrame);
  }

  function cancelChannel(cardId, channelName, status = "superseded") {
    const cardChannels = channels.get(cardId);
    const channel = cardChannels?.[channelName];
    if (!channel) return;
    settleChannelTickets(channel, status);
    delete cardChannels[channelName];
    if (Object.keys(cardChannels).length === 0) channels.delete(cardId);
  }

  function spin(cardId, options = {}) {
    if (!desired) throw new Error("Call scene.apply before scene.spin");
    if (!desired.cards.some((card) => card.id === cardId)) throw new Error(`Unknown card: ${cardId}`);
    if (options.origin !== undefined && !origins.has(options.origin)) throw new TypeError("Spin origin must be system or user");
    if (options.origin === "user") {
      if (desired.cards.find((card) => card.id === cardId)?.feedback?.disabled === true) {
        throw new Error(`Card ${cardId} is disabled`);
      }
      const zone = desired.zones.find((candidate) => candidate.cardIds.includes(cardId));
      authorizeUserRule("canSpin", null, {
        cardIds: [cardId], cardId, zoneId: zone?.id, axis: options.axis, direction: options.direction ?? 1,
        speed: options.speed ?? 180, snapshot: copy(desired),
      });
    }
    const axes = flipAxes(options.axis);
    const direction = options.direction ?? 1;
    if (direction !== 1 && direction !== -1) throw new RangeError("Spin direction must be 1 or -1");
    const speed = options.speed ?? 180;
    if (!Number.isFinite(speed) || speed <= 0) throw new RangeError("Spin speed must be positive and finite");
    if (options.zoneFacePolicy !== undefined && !["enforce", "override"].includes(options.zoneFacePolicy)) {
      throw new TypeError("zoneFacePolicy must be enforce or override");
    }
    if (options.zoneFacePolicy !== "override" && zoneForCard(resolvedZones, cardId)?.faceUp !== undefined) {
      cancelChannel(cardId, spinChannel("x"));
      cancelChannel(cardId, spinChannel("y"));
      return { active: false, stop: () => false };
    }

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
    durationOverride, velocity, returning = false,
  } = {}) {
    if (!interactionOwned && interactionPositions.has(cardId) && ['x', 'y', 'z'].includes(channelName)) return;
    const pose = cardPose(cardId);
    const isFlip = channelName === "flipX" || channelName === "flipY";
    const axis = isFlip ? channelName.slice(-1).toLowerCase() : null;
    const current = isFlip ? flipValue(pose, axis) : pose[channelName];
    const targetValue = channelName === "angle" || isFlip
      ? shortestAngleTarget(current, target)
      : target;
    const existing = channels.get(cardId)?.[channelName];
    const committedEntry = committingDrag?.get(cardId);
    const continueLanding = committedEntry?.carried && existing?.snap
      && Math.abs(existing.to - targetValue) < 0.0001;
    if (!continueLanding) cancelChannel(cardId, channelName);
    const ticket = transition ? { transition, operationIndex, status: null } : null;
    if (ticket) {
      transition.pending += 1;
      transition.results[operationIndex].remaining += 1;
    }
    if (continueLanding) {
      settleChannelTickets(existing, "superseded");
      existing.tickets = ticket ? [ticket] : [];
      return;
    }
    snap ||= committedEntry?.carried === true;
    const initialVelocity = snap ? velocity ?? committedEntry?.angularVelocity?.[channelName]
      ?? existing?.currentVelocity ?? 0 : 0;
    const movingOrientation = snap && SNAP_ORIENTATION_CHANNELS.has(channelName) && Math.abs(initialVelocity) > 0.2;
    if (Math.abs(current - targetValue) < 0.0001 && !movingOrientation) {
      if (isFlip) setFlipValue(pose, axis, target);
      else pose[channelName] = targetValue;
      if (ticket) settleTicket(ticket, "skipped");
      return;
    }
    if (reducedMotion || immediate || transition?.immediate || durationOverride === 0) {
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
    const dragWeight = Math.min(2, Math.max(0.65, Math.pow(weight, dragMotion.weightInfluence * 0.5)));
    const bounce = dragMotion.landingBounce * (returning ? 0.5 : 1);
    const channelDuration = durationOverride !== undefined ? durationOverride
      : snap ? dragMotion.landingTime * dragWeight / zoneMotionSpeed(zone, channelName)
      : duration * weight / zoneMotionSpeed(zone, channelName);
    cardChannels[channelName] = {
      from: current,
      to: targetValue,
      restingTarget: isFlip ? target : targetValue,
      startedAt: clock.now() + (snap ? snapDelay : 0),
      duration: channelDuration,
      velocity: initialVelocity,
      spring: snapOrientation,
      damping: bounceDamping(bounce),
      easing: snap || durationOverride !== undefined ? smoothStep : null,
      snap,
      axis,
      tickets: ticket ? [ticket] : [],
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
    const primaryChannel = changedChannels[0];
    const existing = channels.get(cardId)?.[primaryChannel];
    if (existing?.resizeTransition === transition
      && Math.abs(existing.to - targetPose[primaryChannel]) < 0.0001) {
      attachChannelTicket(existing, transition, operationIndex);
    } else {
      schedule(cardId, primaryChannel, targetPose[primaryChannel], transition, operationIndex);
      const scheduled = channels.get(cardId)?.[primaryChannel];
      if (scheduled) scheduled.resizeTransition = transition;
    }
    for (const channelName of changedChannels.slice(1)) scheduleChannel(cardId, channelName, targetPose[channelName]);
  }

  function cancelAllChannels(status) {
    for (const [cardId, cardChannels] of channels) {
      for (const channelName of Object.keys(cardChannels)) cancelChannel(cardId, channelName, status);
    }
  }

  function apply(inputSnapshot) {
    const next = normalizeSnapshot(inputSnapshot);
    applyAutoSort(next);
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
        feedback?.remove(card.id);
      }
    }
    desired = next;
    resolvedZones = nextZones;
    for (const zone of nextZones.values()) {
      if (zone.faceUp === undefined) continue;
      for (const cardId of zone.cardIds) {
        cancelChannel(cardId, spinChannel("x"));
        cancelChannel(cardId, spinChannel("y"));
      }
    }
    visual = new Map([...poses].map(([cardId, pose]) => {
      const card = desired.cards.find((candidate) => candidate.id === cardId);
      const previousPose = previousVisual.get(cardId);
      const target = visualPose(card, pose);
      if (!previousPose) return [cardId, target];
      const targetZone = zoneForCard(nextZones, cardId);
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
        flipX: targetZone?.faceUp === false ? 0 : previousPose.flipX,
        flipY: targetZone?.faceUp === false ? 180 : previousPose.flipY,
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
    if (options.origin !== undefined && !origins.has(options.origin)) throw new TypeError("Transaction origin must be system or user");
    if (options.zoneFacePolicy !== undefined && !["enforce", "override"].includes(options.zoneFacePolicy)) {
      throw new TypeError("zoneFacePolicy must be enforce or override");
    }
    if (options.origin === "user") authorizeUserOperations(operations);
    const enforceZoneFace = options.zoneFacePolicy !== "override";
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
        ...(operation.type === "moveBatch" || operation.type === "reorder" ? { cardIds: copy(operation.cardIds) } : { cardId: operation.cardId }),
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
        const zone = next.zones.find((candidate) => candidate.cardIds.includes(card.id));
        const enforcedFace = enforceZoneFace ? zone?.faceUp : undefined;
        const axes = enforcedFace === undefined ? flipAxes(operation.axis ?? card.flipAxis ?? "y") : ["x", "y"];
        const wasFaceUp = card.faceUp;
        card.faceUp = enforcedFace ?? (operation.face === "faceUp");
        const previousNextFaceId = card.faceCycleNextFaceId;
        const previousRevision = card.faceSelectionRevision ?? 0;
        const explicitSelection = card.faceSelectionLocked === true;
        invalidateFaceSelection(card);
        if (card.faceUp !== wasFaceUp && card.faceUp && card.faceCycle && !explicitSelection) {
          stageLogicalFace(card);
          const stagedFaceId = card.faceCycleNextFaceId;
          const stagedRevision = card.faceSelectionRevision ?? 0;
          transition.commits.set(operationIndex, () => {
            if (card.faceSelectionRevision !== stagedRevision || card.faceCycleNextFaceId !== stagedFaceId) return;
            card.activeFaceId = stagedFaceId;
            delete card.faceCycleNextFaceId;
            renderCard(card.id, { render: false });
          });
          transition.rollbacks.set(operationIndex, () => {
            if (card.faceSelectionRevision !== stagedRevision) return;
            card.faceSelectionRevision = previousRevision;
            if (previousNextFaceId === undefined) delete card.faceCycleNextFaceId;
            else card.faceCycleNextFaceId = previousNextFaceId;
          });
        }
        delete card.faceSelectionLocked;
        card.flipAxis = axes[0];
        card.flipAxes = axes;
        card.pose = { ...(card.pose ?? normalizePose()) };
        if (enforcedFace !== undefined) {
          delete card.pose.flipX;
          delete card.pose.flipY;
        } else if (operation.angle !== undefined) {
          for (const axis of axes) setFlipValue(card.pose, axis, angleForAxis(operation.angle, axis));
        } else {
          for (const axis of axes) {
            delete card.pose[flipChannel(axis)];
          }
        }
      },
      contentFace(operation, card, operationIndex) {
        if (typeof operation.faceId !== "string" || operation.faceId.length === 0) {
          throw new TypeError("contentFace requires a non-empty faceId");
        }
        if (!card.faces?.[operation.faceId]) {
          throw new Error(`Unknown face ${operation.faceId} on card ${card.id}`);
        }
        invalidateFaceSelection(card, card.faceUp === false);
        card.activeFaceId = operation.faceId;
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
      reorder(operation, _card, operationIndex) {
        const zone = zones.get(operation.zoneId);
        if (!zone) throw new Error(`Unknown zone: ${operation.zoneId}`);
        if (!Array.isArray(operation.cardIds) || operation.cardIds.length !== zone.cardIds.length
          || operation.cardIds.some((id) => typeof id !== "string")
          || new Set(operation.cardIds).size !== operation.cardIds.length
          || operation.cardIds.some((id) => !zone.cardIds.includes(id))) {
          throw new TypeError(`Reorder cardIds must be the complete membership of zone ${operation.zoneId}`);
        }
        zone.cardIds = [...operation.cardIds];
        transition.moved.add(operationIndex);
      },
    };

    for (const [operationIndex, operation] of operations.entries()) {
      if (operation.type === "moveBatch") {
        const destination = zones.get(operation.to);
        if (!destination) throw new Error(`Unknown zone: ${operation.to}`);
        const { nextSnapshot } = resolveBatchMove(next, {
          cardIds: operation.cardIds, toZoneId: operation.to, index: operation.index, validate: false, validateReorder: false,
        });
        for (const updated of nextSnapshot.zones) zones.get(updated.id).cardIds = [...updated.cardIds];
        for (const id of operation.cardIds) {
          delete cards.get(id).positionMode;
          applyZoneFacePolicy(cards.get(id), destination);
        }
        continue;
      }
      if (operation.type === "reorder") {
        applyOperations.reorder(operation, null, operationIndex);
        continue;
      }
      if (operation.type === "zone") {
        const zone = zones.get(operation.zoneId);
        if (!zone) throw new Error(`Unknown zone: ${operation.zoneId}`);
        if (!operation.changes || typeof operation.changes !== "object") throw new TypeError("Zone operation requires changes");
        for (const key of Object.keys(operation.changes)) {
          if (!["geometry", "depth", "visible", "capacity", "arrangement", "dropTarget", "scale", "faceUp", "motion", "autoSort", "orderPolicy", "slotPolicy", "reorderPolicy", "presentation"].includes(key)) throw new TypeError(`Unsupported zone change: ${key}`);
        }
        const changes = copy(operation.changes);
        const hasAutoSort = Object.hasOwn(changes, "autoSort");
        const disableAutoSort = hasAutoSort && (changes.autoSort === undefined || changes.autoSort === null || changes.autoSort === false);
        if (disableAutoSort) {
          delete changes.autoSort;
          delete zone.autoSort;
        }
        else if (hasAutoSort) changes.autoSort = normalizeSortPolicy(changes.autoSort);
        if (Object.hasOwn(changes, "presentation")) changes.presentation = normalizeZonePresentation(changes.presentation, zone.id);
        Object.assign(zone, changes);
        if (Object.hasOwn(changes, "orderPolicy") || Object.hasOwn(changes, "slotPolicy") || Object.hasOwn(changes, "reorderPolicy")) {
          const policies = normalizeZonePolicies({ zoneId: zone.id, orderPolicy: zone.orderPolicy, slotPolicy: zone.slotPolicy,
            reorderPolicy: zone.reorderPolicy,
            cardIds: zone.cardIds, knownCardIds: new Set(next.cards.map(({ id }) => id)) });
          if (policies.orderPolicy === undefined) delete zone.orderPolicy;
          else zone.orderPolicy = policies.orderPolicy;
          if (policies.slotPolicy === undefined) delete zone.slotPolicy;
          else zone.slotPolicy = policies.slotPolicy;
          if (policies.reorderPolicy === undefined) delete zone.reorderPolicy;
          else zone.reorderPolicy = policies.reorderPolicy;
        }
        if (changes.faceUp !== undefined) {
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

    applyAutoSort(next);
    for (const previousZone of desired.zones) {
      const nextZone = next.zones.find(({ id }) => id === previousZone.id);
      validateReorderPolicy(previousZone, nextZone, next.cards, "transaction");
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
    if (operations.some((operation) => ["move", "moveBatch", "zone", "resize", "thickness", "contentFace", "element"].includes(operation.type))) {
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
      if (enforceZoneFace && targetZone?.faceUp === false) {
        cancelChannel(cardId, "flipX");
        cancelChannel(cardId, "flipY");
        cancelChannel(cardId, spinChannel("x"));
        cancelChannel(cardId, spinChannel("y"));
        current.flipX = 0;
        current.flipY = 180;
      }
      const scheduleTarget = (channelName, target, operationIndex) => schedule(cardId, channelName, target, transition, operationIndex, targetZone);
      const scheduleOperations = {
        move: (operationIndex) => {
          scheduleTarget("x", targetPose.x, operationIndex);
          scheduleTarget("y", targetPose.y, operationIndex);
          scheduleTarget("z", targetPose.z, operationIndex);
          if (!hasExplicitScale) scheduleTarget("scale", targetPose.scale, operationIndex);
          scheduleTarget("layoutScale", targetPose.layoutScale ?? 1, operationIndex);
          scheduleTarget("width", targetPose.width, operationIndex);
          scheduleTarget("height", targetPose.height, operationIndex);
          if (!hasExplicitRotation) scheduleTarget("angle", targetPose.angle, operationIndex);
        },
        moveBatch: (operationIndex) => {
          scheduleTarget("x", targetPose.x, operationIndex);
          scheduleTarget("y", targetPose.y, operationIndex);
          scheduleTarget("z", targetPose.z, operationIndex);
          if (!hasExplicitScale) scheduleTarget("scale", targetPose.scale, operationIndex);
          scheduleTarget("layoutScale", targetPose.layoutScale ?? 1, operationIndex);
          scheduleTarget("width", targetPose.width, operationIndex);
          scheduleTarget("height", targetPose.height, operationIndex);
          if (!hasExplicitRotation) scheduleTarget("angle", targetPose.angle, operationIndex);
        },
        reorder: (operationIndex) => {
          scheduleTarget("x", targetPose.x, operationIndex);
          scheduleTarget("y", targetPose.y, operationIndex);
          scheduleTarget("z", targetPose.z, operationIndex);
          if (!hasExplicitScale) scheduleTarget("scale", targetPose.scale, operationIndex);
          scheduleTarget("layoutScale", targetPose.layoutScale ?? 1, operationIndex);
          scheduleTarget("width", targetPose.width, operationIndex);
          scheduleTarget("height", targetPose.height, operationIndex);
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
          const enforcedFace = enforceZoneFace ? targetZone?.faceUp : undefined;
          const axes = enforcedFace === undefined ? flipAxes(operation.axis ?? card.flipAxis ?? "y") : ["x", "y"];
          current.flipAxis = axes[0];
          if (enforcedFace !== undefined) return;
          for (const axis of axes) {
            cancelChannel(cardId, spinChannel(axis));
            const targetAngle = operation.angle === undefined
              ? (card.faceUp ? 0 : 180)
              : angleForAxis(operation.angle, axis);
            scheduleTarget(flipChannel(axis), targetAngle, operationIndex);
          }
        },
        contentFace: (operationIndex) => {
          for (const axis of ["x", "y"]) cancelChannel(cardId, spinChannel(axis));
          scheduleContentResize(cardId, targetPose, transition, operationIndex);
        },
        element: (operationIndex) => {
          scheduleContentResize(cardId, targetPose, transition, operationIndex);
        },
      };
      for (const operationIndex of operationIndexes) {
        const operation = operations[operationIndex];
        scheduleOperations[operation.type](operationIndex);
      }
      if (!operationIndexes.some((index) => ["move", "moveBatch", "reorder"].includes(operations[index].type)) && operations.some((op) => ["move", "moveBatch", "reorder", "zone", "resize", "contentFace", "element", "thickness"].includes(op.type))) {
        const layoutChannels = ["x", "y", "z", ...(hasExplicitScale ? [] : ["scale"]), "layoutScale", ...(hasExplicitRotation ? [] : ["angle"])];
        for (const name of layoutChannels) {
          const active = channels.get(cardId)?.[name];
          if (active && Math.abs(active.to - targetPose[name]) < 0.0001) continue;
          const owner = operationIndexes[0] ?? operations.findIndex((op) => ["move", "moveBatch", "zone", "resize", "contentFace", "element", "thickness"].includes(op.type));
          scheduleTarget(name, targetPose[name], owner);
        }
      }
      if (enforceZoneFace && targetZone?.faceUp !== undefined) {
        for (const axis of ["x", "y"]) cancelChannel(cardId, spinChannel(axis));
        scheduleTarget("flipX", 0, operationIndexes[0] ?? 0);
        scheduleTarget("flipY", targetZone.faceUp ? 0 : 180, operationIndexes[0] ?? 0);
      } else if (oldCard && oldCard.faceUp !== card.faceUp
        && !operations.some((operation) => operation.cardId === cardId && operation.type === "face")) {
        scheduleTarget("flipY", card.faceUp ? 0 : 180, operationIndexes[0] ?? 0);
      }
      current.visible = targetPose.visible;
      if (operationIndexes.length === 0) current.thickness = targetPose.thickness;
      current.depthScale = targetPose.depthScale;
      current.drawOrder = targetPose.drawOrder;
      if (committingDrag?.get(cardId)?.carried) {
        scheduleTarget("tiltX", targetPose.tiltX ?? 0, operationIndexes[0] ?? 0);
        scheduleTarget("tiltY", targetPose.tiltY ?? 0, operationIndexes[0] ?? 0);
      } else {
        current.tiltX = targetPose.tiltX;
        current.tiltY = targetPose.tiltY;
      }
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

  function sortBy(request = {}, options = {}) {
    if (!desired) throw new Error("Call scene.apply before scene.sortBy");
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw new TypeError("scene.sortBy requires a request object");
    }
    const cardIds = sortCardIds(desired, request);
    return transact([{ type: "reorder", zoneId: request.zoneId, cardIds }], options);
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
      inspection: inspection?.snapshot() ?? { sessions: [] },
      dragMotion: copy(dragMotion),
      dragAnchor,
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
    inspectionInput?.destroy();
    inspection?.destroy();
    inspectionHandles.clear();
    feedback?.destroy();
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
    commit: (operations, options) => {
      const previousPositions = interactionPositions;
      committingDrag = previousPositions;
      interactionPositions = new Map();
      try {
        return transact(operations, options);
      } catch (error) {
        interactionPositions = previousPositions;
        throw error;
      } finally {
        committingDrag = null;
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
    defaultAnchor: () => dragAnchor,
    motion: () => dragMotion,
    captureGrab: (cardId, point) => {
      flushRender();
      return renderer.captureGrab?.(cardId, point) ?? null;
    },
  });
  function drag(request) {
    if (!desired) throw new Error("Call scene.apply before scene.drag");
    for (const id of request?.cardIds ?? []) closeInspection(id);
    return interaction.drag({ ...request, cardIds: selection.order(request?.cardIds, request?.order ?? "source") });
  }
  function setDragMotion(patch) {
    if (destroyed) throw new Error("Scene is destroyed");
    const next = normalizeDragMotion(patch, dragMotion);
    sample(clock.now());
    dragMotion = next;
    interaction?.reconcile();
    return copy(dragMotion);
  }
  function setDragAnchor(value) {
    if (destroyed) throw new Error("Scene is destroyed");
    dragAnchor = normalizeDragAnchor(value);
    return dragAnchor;
  }
  function setSelectionHighlightVisible(visible) {
    if (destroyed) throw new Error("Scene is destroyed");
    if (typeof visible !== "boolean") throw new TypeError("Selection highlight visibility must be boolean");
    renderer.setSelectionHighlightVisible?.(visible);
    return visible;
  }
  function invalidateRules() {
    // Cancel an ineligible frozen cohort before exposing its pruned selection.
    interaction.invalidateRules();
    selection.reconcile();
    inspection?.reconcile();
  }
  function inspect(cardId, options = {}) {
    if (destroyed) throw new Error("Scene is destroyed");
    if (!desired) throw new Error("Call scene.apply before scene.inspect");
    closeInspection(cardId);
    const handle = inspection.open(cardId, options);
    inspectionHandles.set(handle.id, handle);
    return handle;
  }
  function closeInspection(id) {
    for (const [viewId, handle] of inspectionHandles) {
      if (id === undefined || id === viewId || handle.snapshot().cardId === id) handle.close();
    }
  }
  inspection = createInspection({
    element: config.element, state: () => ({ desired, visual }), toClient: sceneToClient,
    options: config.inspection, rules: config.inspection?.rules,
    onChange: (detail) => {
      if (destroyed) return;
      const active = new Set(detail.sessions.map((session) => session.id));
      for (const id of inspectionHandles.keys()) if (!active.has(id)) inspectionHandles.delete(id);
      renderAll({ render: false });
      renderer.render?.();
      emit("inspection-change", detail);
    },
  });
  const api = { apply, transact, sortBy, spin, stopSpin, select, hitTest, target, setMotion, setDragMotion, setSelectionHighlightVisible, snapshot, viewport, refreshGeometry, rendererDiagnostics: () => renderer.diagnostics?.() ?? null, on, destroy,
    clientToScene, sceneToClient, drag, setDragAnchor, isSelectable: selection.isSelectable,
    resolveDrop: interaction.resolveDrop, invalidateRules, inspect, closeInspection };
  feedback = createFeedback({ element: config.element, scene: api });
  if (config.element && config.inspection?.input) inspectionInput = attachInspectionInput({
    element: config.element, scene: api, options: config.inspection.input,
  });
  if (config.element && config.interaction) input = createInputAdapter({ element: config.element, scene: api, options: config.interaction,
    selectionContext: (focusedCardId) => selection.context(focusedCardId) });
  return api;
}
