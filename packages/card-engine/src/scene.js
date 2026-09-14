import { cardById, normalizePose, normalizeSnapshot, zoneById } from "./model.js";
import { solveAllPoses } from "./layout.js";
import { createClock, interpolate, shortestAngleTarget } from "./motion.js";
import { createRenderer } from "./renderer.js";
import { createWebGLRenderer } from "./renderers/webgl.js";

const copy = (value) => structuredClone(value);

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

function flipValue(pose, axis) {
  return pose[flipChannel(axis)] ?? (axis === "y" ? pose.flipAngle : 0);
}

function setFlipValue(pose, axis, value) {
  pose[flipChannel(axis)] = value;
  if (axis === "y" || pose.flipAxis === axis) pose.flipAngle = value;
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
  const facing = Math.cos((pose.flipX ?? 0) * degreesToRadians) * Math.cos((pose.flipY ?? pose.flipAngle ?? 0) * degreesToRadians);
  if (Math.abs(facing) < 0.000001) return "edge";
  return facing > 0 ? "front" : "back";
}

export function createCardScene(config = {}) {
  const clock = config.motion?.clock ?? createClock();
  const reducedMotion = Boolean(config.motion?.reducedMotion);
  const duration = config.motion?.duration ?? 320;
  const createRendererAdapter = config.renderer ?? (config.renderMode === "css" ? createRenderer : createWebGLRenderer);
  const renderer = createRendererAdapter({
    element: config.element,
    templates: config.templates,
    camera: config.camera,
    motion: config.motion,
  });
  const listeners = new Map();
  const channels = new Map();
  const transitions = new Set();
  let desired = null;
  let visual = new Map();
  let frameId = null;
  let destroyed = false;

  function emit(event, detail) {
    for (const listener of listeners.get(event) ?? []) listener(detail);
  }

  function cardPose(cardId) {
    return visual.get(cardId);
  }

  function renderCard(cardId) {
    const card = desired?.cards.find((candidate) => candidate.id === cardId);
    if (card) renderer.update(card, cardPose(cardId));
  }

  function renderAll() {
    if (!desired) return;
    for (const card of desired.cards) renderCard(card.id);
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
    } else if (result.status === "pending") {
      result.remaining -= 1;
      if (result.remaining === 0) {
        result.status = status === "settled" ? "settled" : "skipped";
        if (result.status === "settled") {
          const commit = ticket.transition.commits.get(ticket.operationIndex);
          ticket.transition.commits.delete(ticket.operationIndex);
          commit?.();
        }
      }
    }
    if (ticket.transition.pending === 0) {
      transitions.delete(ticket.transition);
      ticket.transition.resolve(copy(ticket.transition.results.map(({ remaining, ...result }) => result)));
    }
  }

  function sample(time = clock.now()) {
    const wasSettling = channels.size > 0;
    let logicalFaceChanged = false;
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
          renderCard(cardId);
          continue;
        }
        const progress = reducedMotion ? 1 : Math.min(1, Math.max(0, (time - channel.startedAt) / channel.duration));
        const value = interpolate(channel.from, channel.to, progress);
        if (channelName === "flipX" || channelName === "flipY") setFlipValue(pose, channel.axis, value);
        else pose[channelName] = value;
        renderCard(cardId);
        if (progress >= 1) {
          if (channelName === "flipX" || channelName === "flipY") setFlipValue(pose, channel.axis, channel.to);
          else pose[channelName] = channel.to;
          delete cardChannels[channelName];
          settleTicket(channel.ticket, "settled");
        }
      }
      if (Object.keys(cardChannels).length === 0) channels.delete(cardId);
    }
    if (logicalFaceChanged && channels.size > 0) emit("change", snapshot());
    if (channels.size > 0 && !frameId) frameId = clock.requestFrame(onFrame);
    if (channels.size === 0) {
      frameId = null;
      if (wasSettling) emit("change", snapshot());
    }
  }

  function onFrame(time) {
    frameId = null;
    if (destroyed) return;
    sample(time);
  }

  function ensureFrame() {
    if (!frameId && channels.size > 0) frameId = clock.requestFrame(onFrame);
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

  function schedule(cardId, channelName, target, transition, operationIndex) {
    const pose = cardPose(cardId);
    const isFlip = channelName === "flipX" || channelName === "flipY";
    const axis = isFlip ? channelName.slice(-1).toLowerCase() : null;
    const current = isFlip ? flipValue(pose, axis) : pose[channelName];
    const targetValue = channelName === "angle" || isFlip
      ? shortestAngleTarget(current, target)
      : target;
    const ticket = { transition, operationIndex, status: null };
    transition.pending += 1;
    if (Math.abs(current - targetValue) < 0.0001) {
      if (isFlip) setFlipValue(pose, axis, targetValue);
      else pose[channelName] = targetValue;
      settleTicket(ticket, "skipped");
      return;
    }
    cancelChannel(cardId, channelName);
    if (reducedMotion || transition.immediate) {
      if (isFlip) setFlipValue(pose, axis, targetValue);
      else pose[channelName] = targetValue;
      settleTicket(ticket, "settled");
      return;
    }
    const cardChannels = channels.get(cardId) ?? {};
    cardChannels[channelName] = {
      from: current,
      to: targetValue,
      startedAt: clock.now(),
      duration,
      axis,
      ticket,
    };
    channels.set(cardId, cardChannels);
  }

  function cancelAllChannels(status) {
    for (const [cardId, cardChannels] of channels) {
      for (const channelName of Object.keys(cardChannels)) cancelChannel(cardId, channelName, status);
    }
  }

  function apply(inputSnapshot) {
    const next = normalizeSnapshot(inputSnapshot);
    cancelAllChannels("superseded");
    if (desired) {
      const nextIds = new Set(next.cards.map((card) => card.id));
      for (const card of desired.cards) if (!nextIds.has(card.id)) renderer.remove(card.id);
    }
    desired = next;
    const poses = solveAllPoses(desired, config.camera, config.templates);
    visual = new Map([...poses].map(([cardId, pose]) => {
      const card = desired.cards.find((candidate) => candidate.id === cardId);
      const flipAxis = card.flipAxis ?? "y";
      const flipY = card.pose.flipY ?? card.pose.flipAngle ?? (card.faceUp ? 0 : 180);
      const flipX = card.pose.flipX ?? 0;
      return [cardId, {
        ...pose,
        flipAxis,
        flipX,
        flipY,
        flipAngle: flipAxis === "x" ? flipX : flipY,
      }];
    }));
    renderAll();
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
      immediate: Boolean(options.immediate),
      results: operations.map((operation) => ({ type: operation.type, cardId: operation.cardId, status: "pending" })),
      commits: new Map(),
      rollbacks: new Map(),
      resolve: null,
    };
    transition.results.forEach((result, index) => {
      const operation = operations[index];
      result.remaining = operation.type === "move"
        ? 2
        : operation.type === "face" ? flipAxes(operation.axis).length : 1;
    });
    transition.finished = new Promise((resolve) => { transition.resolve = resolve; });
    transitions.add(transition);

    for (const [operationIndex, operation] of operations.entries()) {
      const card = cards.get(operation.cardId);
      if (!card) throw new Error(`Unknown card: ${operation.cardId}`);
      const pose = card.pose ?? normalizePose();
      if (operation.type === "move") {
        if (operation.position) {
          card.pose = { ...pose, ...operation.position };
          card.positionMode = "absolute";
        } else if (operation.to) {
          const destination = zones.get(operation.to);
          if (!destination) throw new Error(`Unknown zone: ${operation.to}`);
          for (const zone of next.zones) zone.cardIds = zone.cardIds.filter((id) => id !== card.id);
          const index = Math.max(0, Math.min(operation.index ?? destination.cardIds.length, destination.cardIds.length));
          destination.cardIds.splice(index, 0, card.id);
          delete card.positionMode;
        } else {
          throw new TypeError("Move requires position or destination zone");
        }
      } else if (operation.type === "rotate") {
        if (!Number.isFinite(operation.angle)) throw new TypeError("Rotate angle must be finite");
        card.pose = { ...pose, angle: operation.angle };
      } else if (operation.type === "scale") {
        if (!Number.isFinite(operation.factor) || operation.factor <= 0) throw new RangeError("Scale factor must be positive and finite");
        card.pose = { ...pose, scale: operation.factor };
      } else if (operation.type === "face") {
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
        card.pose = { ...pose };
        if (operation.angle !== undefined) {
          for (const axis of axes) setFlipValue(card.pose, axis, angleForAxis(operation.angle, axis));
        } else {
          for (const axis of axes) {
            delete card.pose[flipChannel(axis)];
            if (axis === "y") delete card.pose.flipAngle;
          }
        }
      } else {
        throw new TypeError(`Unknown operation: ${operation.type}`);
      }
    }

    const previous = desired;
    desired = next;
    const targets = solveAllPoses(next, config.camera, config.templates);
    const affected = new Set(operations.map((operation) => operation.cardId));
    for (const cardId of affected) {
      const card = cards.get(cardId);
      const targetPose = targets.get(cardId);
      if (!targetPose) throw new Error(`Card ${cardId} has no layout target`);
      const current = cardPose(cardId);
      const oldCard = previous.cards.find((candidate) => candidate.id === cardId);
      const operationIndexes = operations.flatMap((operation, index) => operation.cardId === cardId ? [index] : []);
      for (const operationIndex of operationIndexes) {
        const operation = operations[operationIndex];
        if (operation.type === "move") schedule(cardId, "x", targetPose.x, transition, operationIndex), schedule(cardId, "y", targetPose.y, transition, operationIndex);
        if (operation.type === "rotate") schedule(cardId, "angle", targetPose.angle, transition, operationIndex);
        if (operation.type === "scale") schedule(cardId, "scale", targetPose.scale, transition, operationIndex);
        if (operation.type === "face") {
          const axes = flipAxes(operation.axis ?? card.flipAxis ?? "y");
          current.flipAxis = axes[0];
          for (const axis of axes) {
            cancelChannel(cardId, spinChannel(axis));
            const targetAngle = operation.angle === undefined
              ? (card.faceUp ? 0 : 180)
              : angleForAxis(operation.angle, axis);
            schedule(cardId, flipChannel(axis), targetAngle, transition, operationIndex);
          }
        }
      }
      if (oldCard && oldCard.faceUp !== card.faceUp && !operations.some((operation) => operation.cardId === cardId && operation.type === "face")) {
        schedule(cardId, "flipY", card.faceUp ? 0 : 180, transition, operationIndexes[0] ?? 0);
      }
      current.z = targetPose.z;
      current.depthScale = targetPose.depthScale;
      current.tiltX = targetPose.tiltX;
      current.tiltY = targetPose.tiltY;
      current.pivotX = targetPose.pivotX;
      current.pivotY = targetPose.pivotY;
    }
    if (transition.pending === 0) {
      transitions.delete(transition);
      for (const result of transition.results) if (result.status === "pending") result.status = "skipped";
      transition.resolve(copy(transition.results.map(({ remaining, ...result }) => result)));
    } else {
      ensureFrame();
    }
    renderAll();
    emit("change", snapshot());
    return { finished: transition.finished };
  }

  function snapshot() {
    return {
      desired: copy(desired ?? { cards: [], zones: [] }),
      visual: [...visual.entries()].map(([cardId, pose]) => ({ cardId, pose: copy(pose), physicalSide: physicalSide(pose) })),
      settling: channels.size > 0,
      renderer: renderer.type ?? "custom",
      rendererReason: renderer.reason ?? null,
    };
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
    if (frameId) clock.cancelFrame(frameId);
    frameId = null;
    cancelAllChannels("destroyed");
    for (const transition of transitions) {
      for (const result of transition.results) if (result.status === "pending") result.status = "destroyed";
      transition.pending = 0;
      transition.resolve(copy(transition.results.map(({ remaining, ...result }) => result)));
    }
    transitions.clear();
    renderer.destroy();
    listeners.clear();
  }

  return { apply, transact, spin, stopSpin, snapshot, on, destroy };
}
