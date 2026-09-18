import { resolveBatchMove } from './batch.js';
import { advanceSpring } from './drag-physics.js';
import { normalizeDragMotion } from './drag-motion.js';
import { shortestAngleTarget } from './motion.js';

const copy = (value) => structuredClone(value);
const COMPACT_DURATION = 180;
const COMPACT_STEP = 18;
const DRAG_STOP_GRACE = 48;
const DRAG_UPRIGHT_GRAB_BASE = 0.7;
const DEFAULT_ZONE_ORIENTATION_SPEED = 1.5;
const authoredPosition = (card) => JSON.stringify([card.positionMode, card.pose?.x, card.pose?.y, card.pose?.z]);
const DRAG_ANCHORS = new Set(['grab', 'center']);
function normalizeDragAnchor(value, name = 'drag anchor') {
  if (!DRAG_ANCHORS.has(value)) throw new TypeError(`${name} must be grab or center`);
  return value;
}
function immutable(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}
const terminal = (phase) => !['dragging', 'pending'].includes(phase);
function point(value) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new TypeError('Drag point requires finite x and y');
  return { x: value.x, y: value.y };
}
const clamp = (value, min, max) => {
  const result = Math.min(max, Math.max(min, value));
  return result === 0 ? 0 : result;
};

// Gesture state and hypothetical layouts never mutate committed membership.
export function createInteraction({ state, solve, sample, refresh, takePosition, present, commit, emit, rules, toClient, fromClient,
  isSelectable = () => true, now = () => 0, reducedMotion = () => false, requestFrame = () => {}, defaultPresentation = 'preserve',
  defaultAnchor = 'grab', motion, captureGrab, dragHangFactor, dragUprightFactor, dragSnapDelay }) {
  const sessions = new Map();
  let sequence = 0;
  let revision = 0;
  let disposed = false;
  let reconciling = false;
  let restingKey;
  let restingModel;
  let restingPoses;
  const resolvedMotion = () => {
    const legacy = {
      ...(dragHangFactor === undefined ? {} : { dangle: dragHangFactor }),
      ...(dragUprightFactor === undefined ? {} : { upright: dragUprightFactor }),
      ...(dragSnapDelay === undefined ? {} : { landingDelay: dragSnapDelay }),
    };
    const base = normalizeDragMotion(legacy);
    return normalizeDragMotion(typeof motion === 'function' ? motion() : (motion ?? {}), base);
  };
  const geometryKey = () => JSON.stringify(state().zones.map((zone) => [zone.id, zone.geometry, zone.visible, zone.dropTarget]));
  function resting() {
    const model = state().desired;
    const key = geometryKey();
    if (model !== restingModel || key !== restingKey) {
      restingModel = model; restingKey = key; restingPoses = solve(model);
    }
    return restingPoses;
  }
  const snapshot = () => ({ sessions: [...sessions.values()].map((session) => copy(session.data)) });
  const sourcesFor = (id, model = state().desired) => model.zones.flatMap((zone) => zone.cardIds.includes(id)
    ? [{ cardId: id, zoneId: zone.id, index: zone.cardIds.indexOf(id) }] : []);
  const membershipKey = (session, model = state().desired, includeDestination = true) => JSON.stringify(
    [...new Set([...session.data.sources.map(({ zoneId }) => zoneId),
      ...(includeDestination ? [session.data.candidate?.toZoneId] : [])])]
      .map((id) => [id, model.zones.find((zone) => zone.id === id)?.cardIds]));
  const targetFor = (session, id) => session.data.targetPoses?.[id];
  const requestFor = (session) => ({ cardIds: [...session.data.cardIds], primaryCardId: session.data.primaryCardId,
    sources: copy(session.data.sources), toZoneId: session.data.candidate?.toZoneId, index: session.data.candidate?.index,
    snapshot: copy(state().desired), revision });
  function decision(name, request) {
    try {
      const legacyName = name === 'canTake' ? 'canStart' : name === 'canPut' ? 'canDrop' : null;
      const callback = rules?.[name] ?? (legacyName ? rules?.[legacyName] : undefined);
      const result = callback?.(copy(request));
      const labels = { canTake: 'Take', canPut: 'Put', canReveal: 'Reveal', canConceal: 'Conceal' };
      return result?.allowed === true ? { allowed: true } : {
        allowed: false, reason: result?.reason ?? `${labels[name] ?? 'Move'} is not permitted`,
      };
    } catch { return { allowed: false, reason: 'Project rules could not be evaluated' }; }
  }
  function hypothetical(session, zoneId, index) {
    const model = state().desired;
    const geometry = geometryKey();
    if (session.layoutModel !== model || session.layoutGeometry !== geometry) {
      session.layoutModel = model; session.layoutGeometry = geometry; session.layouts = new Map();
    }
    const key = JSON.stringify([zoneId, index]);
    if (session.layouts.has(key)) return session.layouts.get(key);
    const { nextSnapshot } = resolveBatchMove(model, { cardIds: session.data.cardIds, toZoneId: zoneId, index });
    const destination = nextSnapshot.zones.find((zone) => zone.id === zoneId);
    if (destination?.faceUp !== undefined) {
      for (const card of nextSnapshot.cards.filter(({ id }) => session.cohort.has(id))) {
        const source = session.data.sources.find(({ cardId }) => cardId === card.id);
        const sourceZone = model.zones.find(({ id }) => id === source?.zoneId);
        // A destination policy is only a preview until the drop is accepted.
        // Preserve a concealed source through a face-up destination so the
        // target cannot reveal information during hover or pending approval.
        card.faceUp = destination.faceUp === false
          ? false
          : card.faceUp !== false && sourceZone?.faceUp !== false;
        delete card.pose.flipX;
        delete card.pose.flipY;
      }
    }
    const poses = solve(nextSnapshot);
    if (destination?.faceUp !== undefined) {
      for (const cardId of session.data.cardIds) {
        const pose = poses.get(cardId);
        const card = nextSnapshot.cards.find(({ id }) => id === cardId);
        if (pose) pose.flipY = card?.faceUp === false ? 180 : 0;
      }
    }
    session.layouts.set(key, poses);
    return poses;
  }
  function candidateAt(session) {
    const { zones } = state();
    const visible = zones.filter((zone) => zone.visible !== false && zone.dropTarget !== 'transparent');
    if (session.explicit) {
      const zone = visible.find((zone) => zone.id === session.explicit.toZoneId);
      return zone ? { zone, index: session.explicit.index } : null;
    }
    const client = session.client;
    const hits = visible.map((zone, order) => ({ zone, order, point: fromClient(client, zone.geometry.depth) }))
      .filter(({ zone, point: p }) => p && p.x >= zone.geometry.x && p.y >= zone.geometry.y
        && p.x <= zone.geometry.x + zone.geometry.width && p.y <= zone.geometry.y + zone.geometry.height)
      .sort((a, b) => b.zone.geometry.depth - a.zone.geometry.depth || b.order - a.order);
    const hit = hits[0];
    if (!hit) return null;
    // Every candidate slot is solved by the same layout used for commit.
    const count = hit.zone.cardIds.filter((id) => !session.cohort.has(id)).length;
    let index = 0;
    let closest = Infinity;
    for (let slot = 0; slot <= count; slot += 1) {
      let poses;
      try { poses = hypothetical(session, hit.zone.id, slot); } catch { continue; }
      const pose = poses.get(session.data.primaryCardId);
      const target = toClient(pose);
      const distance = (target.x - client.x) ** 2 + (target.y - client.y) ** 2;
      if (distance < closest) { closest = distance; index = slot; }
    }
    return { zone: hit.zone, index };
  }
  function evaluate(session, force = false) {
    session.data.revision = revision;
    const hit = candidateAt(session);
    session.preview = null;
    session.data.targetPose = null;
    session.data.targetPoses = null;
    if (!hit) { session.data.candidate = null; return; }
    const max = hit.zone.cardIds.filter((id) => !session.cohort.has(id)).length;
    const index = Math.min(hit.index, max);
    session.data.candidate = { toZoneId: hit.zone.id, index, geometry: copy(hit.zone.geometry), allowed: false };
    let preview;
    try { preview = hypothetical(session, hit.zone.id, index); }
    catch (error) { session.data.candidate.reason = error.message; return; }
    const key = JSON.stringify([revision, hit.zone.id, index]);
    if (force || session.ruleKey !== key) {
      session.ruleKey = key;
      session.ruleDecision = decision('canPut', requestFor(session));
    }
    Object.assign(session.data.candidate, session.ruleDecision);
    if (session.data.candidate.allowed && hit.zone.faceUp !== undefined) {
      const model = state().desired;
      const changed = session.data.cardIds.filter((cardId) => {
        const card = model.cards.find(({ id }) => id === cardId);
        return card && card.faceUp !== hit.zone.faceUp;
      });
      if (changed.length) {
        const face = hit.zone.faceUp ? 'faceUp' : 'faceDown';
        const faceDecision = decision(face === 'faceUp' ? 'canReveal' : 'canConceal', {
          ...requestFor(session), cardIds: changed,
          sources: copy(session.data.sources.filter(({ cardId }) => changed.includes(cardId))),
          face, zoneId: hit.zone.id, via: 'drag',
        });
        Object.assign(session.data.candidate, faceDecision);
      }
    }
    if (session.data.candidate.allowed) {
      session.preview = preview;
      session.data.targetPose = copy(preview.get(session.data.primaryCardId));
      session.data.targetPoses = Object.fromEntries(session.data.cardIds.map((id) => [id, copy(preview.get(id))]));
    }
  }
  function springTarget(session, config) {
    const previewPose = (session.pointerOwned || session.explicit) && session.preview?.get(session.data.primaryCardId);
    const rawAngle = previewPose?.angle ?? (config.upright * session.grabResponse > 0 ? 0 : session.initialAngle);
    return {
      angle: shortestAngleTarget(session.physics.orientation, rawAngle),
      preview: Boolean(previewPose),
    };
  }
  function orientationResponse(session, config, target) {
    if (!target.preview) {
      const uprightResponse = config.upright * session.grabResponse;
      return config.responseTime / Math.max(0.25, Math.sqrt(uprightResponse || 1));
    }
    const zone = state().zones.find(({ id }) => id === session.data.candidate?.toZoneId);
    const speed = zone?.motion?.orientationSpeed ?? DEFAULT_ZONE_ORIENTATION_SPEED;
    return config.responseTime / Math.max(0.001, speed);
  }
  function tiltTarget(session) {
    const previewPose = session.pointerOwned && session.preview?.get(session.data.primaryCardId);
    const sourceZone = session.data.sources.find(({ cardId }) => cardId === session.data.primaryCardId)?.zoneId;
    const foreignPreview = previewPose && sourceZone !== session.data.candidate?.toZoneId;
    return foreignPreview
      ? { tiltX: previewPose.tiltX ?? 0, tiltY: previewPose.tiltY ?? 0 }
      : { tiltX: session.physics.input.tiltX, tiltY: session.physics.input.tiltY };
  }
  function grabPivotTarget(session, config) {
    if (config.grabPivotTilt <= 0 || config.maxGrabTilt <= 0) return { tiltX: 0, tiltY: 0 };
    const leverX = clamp(session.offset.x / session.tiltHalfSize.width, -1, 1);
    const leverY = clamp(session.offset.y / session.tiltHalfSize.height, -1, 1);
    return {
      // A point to the right of the center rolls the card around that point;
      // a point above the center pitches it in the opposite direction.
      tiltX: clamp(-leverY * config.maxGrabTilt * config.grabPivotTilt, -config.maxGrabTilt, config.maxGrabTilt),
      tiltY: clamp(leverX * config.maxGrabTilt * config.grabPivotTilt, -config.maxGrabTilt, config.maxGrabTilt),
    };
  }
  function advancePhysics(session, time = now()) {
    const physics = session.physics;
    const elapsed = Math.max(0, (time - physics.lastAt) / 1000);
    physics.lastAt = time;
    if (elapsed === 0 && !reducedMotion()) return;
    const config = resolvedMotion();
    if (config.dangle === 0 || config.maxTwist === 0) physics.input.angle = 0;
    if (config.dangle === 0 || config.maxTilt === 0) {
      physics.input.tiltX = 0;
      physics.input.tiltY = 0;
    }
    const quietFor = time - physics.lastPointerAt;
    if (!physics.stopImpulseApplied && quietFor >= DRAG_STOP_GRACE && config.dangle > 0) {
      // A stopped pointer releases directional momentum; it does not cancel
      // the dangle target immediately. Kick the spring once, then let damping
      // settle the card.
      const responseSeconds = Math.max(0.06, config.responseTime / 1000);
      const impulseScale = config.dangle / responseSeconds;
      physics.angularVelocity += physics.input.angle * impulseScale;
      physics.velocity.tiltX += physics.input.tiltX * impulseScale;
      physics.velocity.tiltY += physics.input.tiltY * impulseScale;
      physics.stopImpulseApplied = true;
    }
    const weight = 1 + config.weightInfluence * (Math.sqrt(clamp(session.cardWeight, 0.25, 16)) - 1);
    const target = springTarget(session, config);
    const targetTilt = tiltTarget(session);
    const pivotTarget = grabPivotTarget(session, config);
    const response = orientationResponse(session, config, target);
    const orientationTarget = shortestAngleTarget(physics.orientation, target.angle);
    if (reducedMotion()) {
      physics.orientation = orientationTarget;
      physics.angularVelocity = 0;
      physics.tiltX = targetTilt.tiltX;
      physics.tiltY = targetTilt.tiltY;
      physics.pivotTiltX = pivotTarget.tiltX;
      physics.pivotTiltY = pivotTarget.tiltY;
      physics.twist = physics.input.angle;
      physics.velocity.angle = 0;
      physics.velocity.tiltX = 0;
      physics.velocity.tiltY = 0;
      physics.input.angle = 0;
      physics.input.tiltX = 0;
      physics.input.tiltY = 0;
    } else if (elapsed > 0) {
      const orientation = advanceSpring(physics.orientation, physics.angularVelocity, orientationTarget,
        elapsed, response * weight, config.damping);
      physics.orientation = orientation.value;
      physics.angularVelocity = clamp(orientation.velocity, -2400, 2400);
      for (const axis of ["tiltX", "tiltY"]) {
        const result = advanceSpring(physics[axis], physics.velocity[axis], targetTilt[axis],
          elapsed, config.responseTime * weight, config.damping);
        physics[axis] = clamp(result.value, -config.maxTilt, config.maxTilt);
        physics.velocity[axis] = clamp(result.velocity, -2400, 2400);
        if (Math.abs(physics[axis] - targetTilt[axis]) < 0.05) physics[axis] = targetTilt[axis];
      }
      for (const [axis, targetAxis] of [["pivotTiltX", "tiltX"], ["pivotTiltY", "tiltY"]]) {
        const result = advanceSpring(physics[axis], physics.velocity[axis], pivotTarget[targetAxis],
          elapsed, config.grabPivotResponse * weight, config.damping);
        physics[axis] = clamp(result.value, -config.maxGrabTilt, config.maxGrabTilt);
        physics.velocity[axis] = clamp(result.velocity, -2400, 2400);
        if (Math.abs(physics[axis] - pivotTarget[targetAxis]) < 0.05) physics[axis] = pivotTarget[targetAxis];
      }
      const twist = advanceSpring(physics.twist, physics.velocity.angle, physics.input.angle,
        elapsed, config.responseTime * weight, config.damping);
      physics.twist = clamp(twist.value, -config.maxTwist, config.maxTwist);
      physics.velocity.angle = clamp(twist.velocity, -2400, 2400);
    }
    const decay = Math.exp(-elapsed / Math.max(0.015, config.responseTime / 1000));
    physics.input.angle *= decay;
    physics.input.tiltX *= decay;
    physics.input.tiltY *= decay;
    physics.angle = physics.orientation + physics.twist - session.initialAngle;
    physics.uprightAngle = physics.orientation;
  }

  function physicsNeedsFrame(session) {
    if (reducedMotion()) return false;
    const physics = session.physics;
    const config = resolvedMotion();
    const pivotTarget = grabPivotTarget(session, config);
    return Math.abs(physics.orientation - springTarget(session, config).angle) > 0.01
      || Math.abs(physics.angularVelocity) > 0.01
      || Math.abs(physics.twist) > 0.01 || Math.abs(physics.velocity.angle) > 0.01
      || Math.abs(physics.tiltX - tiltTarget(session).tiltX) > 0.01
      || Math.abs(physics.tiltY - tiltTarget(session).tiltY) > 0.01
      || Math.abs(physics.pivotTiltX - pivotTarget.tiltX) > 0.01
      || Math.abs(physics.pivotTiltY - pivotTarget.tiltY) > 0.01
      || Math.abs(physics.velocity.pivotTiltX) > 0.01
      || Math.abs(physics.velocity.pivotTiltY) > 0.01
      || ["tiltX", "tiltY"].some((axis) =>
        Math.abs(physics[axis]) > 0.01 || Math.abs(physics.velocity[axis]) > 0.01 || Math.abs(physics.input[axis]) > 0.01)
      || Math.abs(physics.input.angle) > 0.01;
  }

  function publish() {
    const time = now();
    for (const session of sessions.values()) {
      if (session.data.phase !== 'dragging') continue;
      if (session.pointerOwned) advancePhysics(session, time);
      else session.physics.lastAt = time;
    }
    const restPoses = resting();
    const positions = new Map();
    // Keep logical depth untouched while giving the active cohort a render-only
    // layer above every resting card, including cards in other arrangements.
    const activeCardIds = new Set([...sessions.values()].flatMap((session) => session.data.cardIds));
    const highestRestingDepth = Math.max(-1, ...[...state().visual.entries()]
      .filter(([id]) => !activeCardIds.has(id))
      .map(([, pose]) => pose.z ?? 0));
    const renderDepthFor = (session, member) => {
      const memberDepths = [...session.members.values()].map(({ depth }) => depth);
      const highestMemberDepth = Math.max(...memberDepths);
      const lowestMemberDepth = Math.min(...memberDepths);
      const dragLayer = highestRestingDepth + (highestMemberDepth - lowestMemberDepth) + 100;
      return dragLayer + member.depth - highestMemberDepth;
    };
    const renderProjection = (point, depth) => {
      const projected = fromClient(point, depth);
      return projected ? { ...projected, z: depth } : null;
    };
    const carryLiftDepth = (session, config) => {
      if (config.liftDepth <= 0 || reducedMotion()) return config.liftDepth;
      if (config.liftDepthTime <= 0) return config.liftDepth;
      const progress = clamp((time - session.startedAt) / config.liftDepthTime, 0, 1);
      return config.liftDepth * (progress * progress * (3 - 2 * progress));
    };
    for (const session of sessions.values()) {
      if (session.preview) for (const [id, pose] of session.preview) {
        const rest = restPoses.get(id);
        if (rest && ['x', 'y', 'z'].some((key) => rest[key] !== pose[key])) {
          positions.set(id, { pose, direct: false, zoneId: session.data.candidate?.toZoneId });
        }
      }
      if (session.data.phase === 'dragging' && (!session.explicit || session.data.candidate?.allowed)) {
        const config = resolvedMotion();
        const primaryTarget = session.explicit ? session.data.targetPose : null;
        const freeAngle = session.physics.orientation + session.physics.twist;
        const currentPrimaryPose = state().visual.get(session.data.primaryCardId);
        session.currentScaleRatio = ((currentPrimaryPose?.scale ?? 1) * (currentPrimaryPose?.layoutScale ?? 1)) / session.grabScale;
        const anchorAngle = (freeAngle - session.initialAngle) * Math.PI / 180;
        const anchorOffset = primaryTarget ? null : {
          // The renderer rotates in world coordinates while client y points down.
          // Convert that rotation back into client space so the grabbed point stays
          // under the pointer as the card changes angle.
          x: session.offset.x * session.currentScaleRatio * Math.cos(anchorAngle)
            + session.offset.y * session.currentScaleRatio * Math.sin(anchorAngle),
          y: -session.offset.x * session.currentScaleRatio * Math.sin(anchorAngle)
            + session.offset.y * session.currentScaleRatio * Math.cos(anchorAngle),
        };
        const center = primaryTarget ? toClient(primaryTarget)
          : { x: session.client.x - anchorOffset.x, y: session.client.y - anchorOffset.y };
        const progress = compactProgress(session);
        session.compactSettled = progress === 1;
        for (const [id, member] of session.members) {
          const offset = session.data.presentation === 'compact' ? {
            x: member.offset.x + (member.compact.x - member.offset.x) * progress,
            y: member.offset.y + (member.compact.y - member.offset.y) * progress,
          } : member.offset;
          const depth = primaryTarget ? primaryTarget.z + member.depth - session.members.get(session.data.primaryCardId).depth : member.depth;
          const screenPoint = { x: center.x + offset.x, y: center.y + offset.y };
          const p = fromClient(screenPoint, depth);
          const renderPose = renderProjection(screenPoint, renderDepthFor(session, member) + carryLiftDepth(session, config));
          const previewPose = session.preview?.get(id) ?? null;
          const restingPose = restPoses.get(id);
          const displayedPose = state().visual.get(id);
          const source = session.data.sources.find(({ cardId }) => cardId === id);
          const sourceZone = state().desired.zones.find(({ id: zoneId }) => zoneId === source?.zoneId);
          const sourceConcealed = state().desired.cards.find(({ id: cardId }) => cardId === id)?.faceUp === false
            || sourceZone?.faceUp === false;
          const preservedFlipX = sourceConcealed
            ? 0
            : previewPose?.flipX ?? displayedPose?.flipX ?? restingPose?.flipX;
          const preservedFlipY = sourceConcealed
            ? 180
            : previewPose?.flipY ?? displayedPose?.flipY ?? restingPose?.flipY;
          const targetScale = previewPose?.scale ?? restingPose?.scale ?? 1;
          if (renderPose && id === session.data.primaryCardId) {
            renderPose.pivotX = session.grabPivot.x;
            renderPose.pivotY = session.grabPivot.y;
          }
          const previewKeepsPickupPhysics = !previewPose || session.data.sources.some(({ cardId, zoneId }) =>
            cardId === id && zoneId === session.data.candidate?.toZoneId);
          const combinedTilt = (axis, movement) => {
            const pivot = session.physics[`pivotTilt${axis}`];
            const cap = config.maxGrabTilt + config.maxTilt;
            return clamp(pivot + movement, -cap, cap);
          };
          const targetTilt = session.pointerOwned
            ? { tiltX: combinedTilt("X", session.physics.tiltX),
              tiltY: combinedTilt("Y", session.physics.tiltY) }
            : previewPose && !previewKeepsPickupPhysics
            ? { tiltX: previewPose.tiltX ?? 0, tiltY: previewPose.tiltY ?? 0 }
            : previewPose
            ? {
              tiltX: combinedTilt("X", (previewPose.tiltX ?? 0) + session.physics.tiltX),
              tiltY: combinedTilt("Y", (previewPose.tiltY ?? 0) + session.physics.tiltY),
            }
          : { tiltX: combinedTilt("X", session.physics.tiltX),
            tiltY: combinedTilt("Y", session.physics.tiltY) };
          const freeDragAngle = session.pointerOwned || !previewPose
            ? freeAngle + member.initialAngle - session.initialAngle : undefined;
          const dragAngle = session.pointerOwned ? freeDragAngle : previewPose?.angle ?? freeDragAngle;
          if (p) positions.set(id, {
            pose: {
              ...p,
              z: depth,
              ...(dragAngle === undefined ? {} : { angle: dragAngle }),
              ...(previewPose?.scale === undefined ? {} : { scale: previewPose.scale }),
              ...(previewPose?.layoutScale === undefined ? {} : { layoutScale: previewPose.layoutScale }),
              ...(preservedFlipX === undefined ? {} : { flipX: preservedFlipX }),
              ...(preservedFlipY === undefined ? {} : { flipY: preservedFlipY }),
              ...(previewPose?.drawOrder === undefined ? {} : { drawOrder: previewPose.drawOrder }),
              scale: targetScale * config.liftScale,
              tiltX: targetTilt.tiltX,
              tiltY: targetTilt.tiltY,
            },
            renderPose,
            direct: !session.explicit,
            orientationDirect: session.pointerOwned || !previewPose,
            tiltDirect: session.pointerOwned || !previewPose || previewKeepsPickupPhysics,
            carried: true,
            liftTime: config.liftTime,
            angularVelocity: {
              angle: session.physics.angularVelocity + session.physics.velocity.angle,
              tiltX: session.physics.velocity.tiltX,
              tiltY: session.physics.velocity.tiltY,
            },
            ...(id === session.data.primaryCardId && session.grab !== undefined ? {
              grab: session.grab,
              grabClient: { ...session.client },
            } : {}),
            zoneId: session.data.candidate?.toZoneId ?? session.data.sources.find(({ cardId: sourceId }) => sourceId === id)?.zoneId,
          });
        }
      } else {
        const config = resolvedMotion();
        for (const id of session.data.cardIds) {
          const target = session.data.phase === 'pending' ? targetFor(session, id) : session.keyboardPoses?.get(id);
          if (target) {
            const member = session.members.get(id);
            const renderPose = renderProjection(toClient(target), renderDepthFor(session, member));
            positions.set(id, {
              pose: target,
              renderPose,
              direct: false,
              snap: session.data.phase === 'pending',
              carried: true,
              zoneId: session.data.phase === 'pending' ? session.data.candidate?.toZoneId
                : session.data.sources.find(({ cardId: sourceId }) => sourceId === id)?.zoneId,
              snapDelay: session.data.phase === 'pending' ? config.landingDelay : 0,
              landingTime: config.landingTime,
              landingBounce: config.landingBounce,
              liftTime: config.liftTime,
              angularVelocity: {
                angle: session.physics.angularVelocity + session.physics.velocity.angle,
                tiltX: session.physics.velocity.tiltX,
                tiltY: session.physics.velocity.tiltY,
              },
            });
          }
        }
      }
    }
    present(positions, snapshot(), restPoses);
    emit('interaction-change', snapshot());
    if (needsFrame()) requestFrame();
  }
  function compactProgress(session) {
    if (session.data.presentation !== 'compact' || !session.compactChanges || reducedMotion()) return 1;
    const progress = Math.min(1, Math.max(0, (now() - session.startedAt) / COMPACT_DURATION));
    return progress * progress * (3 - 2 * progress);
  }
  function needsFrame() {
    return !disposed && [...sessions.values()].some((session) =>
      (session.data.phase === 'dragging' && (!session.explicit || session.data.candidate?.allowed)
        && session.data.presentation === 'compact' && !session.compactSettled)
      || (session.data.phase === 'dragging' && (!session.explicit || session.data.candidate?.allowed)
        && dragLiftDepthNeedsFrame(session))
      || (session.data.phase === 'dragging' && session.pointerOwned && (!session.explicit || session.data.candidate?.allowed)
        && physicsNeedsFrame(session)));
  }
  function dragLiftDepthNeedsFrame(session) {
    if (reducedMotion() || session.data.phase !== 'dragging') return false;
    const config = resolvedMotion();
    return config.liftDepth > 0 && config.liftDepthTime > 0 && now() < session.startedAt + config.liftDepthTime;
  }
  function tick() { if (needsFrame()) publish(); }
  function finish(session, phase, reason) {
    session.data.phase = phase;
    session.data.reason = reason;
    sessions.delete(session.data.id);
    session.preview = null;
    session.resolve(copy(session.data));
  }
  function cancel(session, reason = 'cancelled') {
    if (terminal(session.data.phase)) return copy(session.data);
    finish(session, 'cancelled', reason);
    if (!disposed) publish();
    return copy(session.data);
  }
  function reconcile() {
    if (disposed || reconciling || sessions.size === 0) return;
    reconciling = true;
    try {
      for (const session of [...sessions.values()]) {
        const current = state();
        const previousDestination = session.data.candidate?.toZoneId;
        const destination = previousDestination && current.zones.find((zone) => zone.id === previousDestination);
        if (session.data.phase === 'pending' && session.pendingMembership !== membershipKey(session)) {
          finish(session, 'cancelled', 'Source or destination order changed'); continue;
        }
        if (cohortChanged(session, current.desired) || session.data.cardIds.some((id) =>
          current.visual.get(id)?.visible === false || !isSelectable(id))
          || (previousDestination && (!destination || destination.visible === false || destination.dropTarget === 'transparent'))
          || !decision('canTake', requestFor(session)).allowed) {
          finish(session, 'cancelled', 'Card or source changed'); continue;
        }
        evaluate(session, true);
        if (session.data.phase === 'pending' && !session.data.candidate?.allowed) finish(session, 'cancelled', 'Destination is no longer permitted');
      }
      publish();
    } finally { reconciling = false; }
  }
  function cohortChanged(session, model) {
    return session.sourceMembership !== membershipKey(session, model, false)
      || session.data.sources.some((source) => {
        const card = model.cards.find((card) => card.id === source.cardId);
        const current = sourcesFor(source.cardId, model);
        return !card || current.length !== 1 || current[0].zoneId !== source.zoneId || current[0].index !== source.index
          || authoredPosition(card) !== session.members.get(source.cardId).authored;
      });
  }
  function beforeCommit(next, operations = []) {
    for (const session of [...sessions.values()]) {
      if (cohortChanged(session, next)
        || (session.data.phase === 'pending' && session.pendingMembership !== membershipKey(session, next))
        || operations.some((op) => op.type === 'move' && session.cohort.has(op.cardId)
          || op.type === 'moveBatch' && op.cardIds?.some((id) => session.cohort.has(id)))) {
        cancel(session, 'Superseded by an authoritative move');
      }
    }
  }
  function drag(request) {
    if (disposed) throw new Error('Scene is destroyed');
    if (!state().desired) throw new Error('Call scene.apply before scene.drag');
    if (!Array.isArray(request?.cardIds) || request.cardIds.length === 0
      || request.cardIds.some((id) => typeof id !== 'string' || !id)
      || new Set(request.cardIds).size !== request.cardIds.length) throw new TypeError('Drag requires unique card IDs');
    const cardIds = [...request.cardIds];
    const id = request.primaryCardId ?? cardIds[0];
    if (!cardIds.includes(id)) throw new TypeError('Primary card must belong to drag');
    const presentation = request.presentation ?? defaultPresentation;
    if (!['preserve', 'compact'].includes(presentation)) throw new TypeError('Unknown drag presentation');
    const configuredAnchor = typeof defaultAnchor === 'function' ? defaultAnchor() : defaultAnchor;
    const anchor = normalizeDragAnchor(request.anchor ?? configuredAnchor);
    const current = state();
    if (cardIds.some((id) => !current.desired.cards.some((card) => card.id === id)
      || !current.visual.get(id) || current.visual.get(id).visible === false || !isSelectable(id))) throw new Error('Card is not available for dragging');
    const data = { id: `drag-${++sequence}`, phase: 'dragging', cardIds, primaryCardId: id,
      sources: cardIds.flatMap((id) => sourcesFor(id)), presentation, anchor,
      candidate: null, targetPose: null, targetPoses: null, revision };
    const allowed = decision('canTake', { ...data, snapshot: copy(current.desired) });
    if (!allowed.allowed) throw new Error(allowed.reason);
    const startPoint = request.point === undefined ? null : point(request.point);
    sample();
    // A new gesture supersedes older gesture previews, without locking other cards.
    for (const previous of [...sessions.values()]) finish(previous, 'cancelled', 'Superseded by a newer gesture');
    for (const cardId of cardIds) takePosition(cardId);
    const pose = state().visual.get(id);
    const center = toClient(pose);
    const pointerClient = startPoint ? toClient({ ...startPoint, z: 0 }) : center;
    const client = pointerClient;
    const projectedRight = toClient({ ...pose, x: pose.x + (pose.width ?? 1) * (pose.scale ?? 1) * (pose.layoutScale ?? 1) / 2 });
    const projectedBottom = toClient({ ...pose, y: pose.y + (pose.height ?? 1) * (pose.scale ?? 1) * (pose.layoutScale ?? 1) / 2 });
    const halfWidth = Math.max(1, Math.abs(projectedRight.x - center.x));
    const halfHeight = Math.max(1, Math.abs(projectedBottom.y - center.y));
    const members = new Map(cardIds.map((cardId, index) => {
      const memberPose = state().visual.get(cardId);
      const projected = toClient(memberPose);
      const offset = COMPACT_STEP * (index - cardIds.indexOf(id));
      return [cardId, { depth: memberPose.z, offset: { x: projected.x - center.x, y: projected.y - center.y },
        compact: { x: offset, y: offset }, initialAngle: memberPose.angle ?? 0,
        authored: authoredPosition(current.desired.cards.find((card) => card.id === cardId)) }];
    }));
    const weight = current.desired.cards.find((card) => card.id === id)?.weight ?? 1;
    const pointerOffset = anchor === 'center' && startPoint
      ? { x: 0, y: 0 }
      : { x: pointerClient.x - center.x, y: pointerClient.y - center.y };
    const grabDistance = clamp(Math.hypot(
      pointerOffset.x / halfWidth,
      pointerOffset.y / halfHeight,
    ), 0, 1);
    const session = { data, client, members, cohort: new Set(cardIds), pointerOwned: startPoint !== null,
      startedAt: now(), compactSettled: false,
      offset: pointerOffset,
      initialAngle: pose.angle ?? 0,
      tiltHalfSize: { width: halfWidth, height: halfHeight },
      grabPivot: {
        x: clamp(0.5 + (client.x - center.x) / (2 * halfWidth), 0, 1),
        y: clamp(0.5 + (client.y - center.y) / (2 * halfHeight), 0, 1),
      },
      grabScale: (pose.scale ?? 1) * (pose.layoutScale ?? 1),
      currentScaleRatio: 1,
      weight,
      cardWeight: weight,
      grabDistance,
      grabResponse: DRAG_UPRIGHT_GRAB_BASE + (1 - DRAG_UPRIGHT_GRAB_BASE) * grabDistance,
      grab: anchor === 'grab' && startPoint && typeof captureGrab === 'function'
        ? captureGrab(id, { ...client }) : undefined,
      physics: {
        angle: 0,
        orientation: pose.angle ?? 0,
        angularVelocity: 0,
        uprightAngle: pose.angle ?? 0,
        twist: 0,
        tiltX: 0,
        tiltY: 0,
        pivotTiltX: 0,
        pivotTiltY: 0,
        velocity: { angle: 0, uprightAngle: 0, tiltX: 0, tiltY: 0, pivotTiltX: 0, pivotTiltY: 0 },
        input: { angle: 0, tiltX: 0, tiltY: 0 },
        lastAt: now(),
        lastPointerAt: now(),
        pointerVelocity: { x: 0, y: 0 },
        stopImpulseApplied: false,
      },
      ruleKey: null };
    session.compactChanges = [...members.values()].some(({ offset, compact }) => offset.x !== compact.x || offset.y !== compact.y);
    session.sourceMembership = membershipKey(session, current.desired, false);
    const finished = new Promise((resolve) => { session.resolve = resolve; });
    sessions.set(data.id, session);
    evaluate(session);
    publish();
    return {
      finished,
      snapshot: () => copy(data),
      update(change) {
        if (data.phase !== 'dragging') return copy(data);
        if (change.point !== undefined) {
          const nextClient = toClient({ ...point(change.point), z: 0 });
          const timestamp = now();
          const elapsedSincePointer = (timestamp - session.physics.lastPointerAt) / 1000;
          const elapsed = elapsedSincePointer > 0 ? elapsedSincePointer : 1 / 60;
          const config = resolvedMotion();
          const measuredVelocity = {
            x: clamp((nextClient.x - session.client.x) / elapsed, -20000, 20000),
            y: clamp((nextClient.y - session.client.y) / elapsed, -20000, 20000),
          };
          const velocityBlend = 1 - Math.exp(-elapsed / Math.max(0.015, config.responseTime / 1000));
          const previousVelocity = session.physics.pointerVelocity;
          const nextVelocity = {
            x: previousVelocity.x + (measuredVelocity.x - previousVelocity.x) * velocityBlend,
            y: previousVelocity.y + (measuredVelocity.y - previousVelocity.y) * velocityBlend,
          };
          session.physics.stopImpulseApplied = false;
          const leverX = session.offset.x / session.tiltHalfSize.width;
          const leverY = session.offset.y / session.tiltHalfSize.height;
          session.client = nextClient;
          session.physics.lastPointerAt = timestamp;
          session.physics.pointerVelocity = nextVelocity;
          const weightFactor = 1 + config.weightInfluence * (Math.sqrt(clamp(session.cardWeight, 0.25, 16)) - 1);
          const hangResponse = config.dangle * (0.75 + 0.25 * session.grabDistance) / weightFactor;
          const excitation = reducedMotion() || config.dangle === 0 ? 0 : hangResponse;
          session.physics.input = {
            angle: clamp((nextVelocity.x * leverY - nextVelocity.y * leverX)
              * 0.00022 * config.maxTwist * excitation,
              -config.maxTwist, config.maxTwist),
            tiltX: clamp(-nextVelocity.y * 0.00022 * config.maxTilt * excitation,
              -config.maxTilt, config.maxTilt),
            tiltY: clamp(nextVelocity.x * 0.00022 * config.maxTilt * excitation,
              -config.maxTilt, config.maxTilt),
          };
          const displayed = state().visual.get(session.data.primaryCardId);
          if (Number.isFinite(displayed?.angle) && session.explicit) {
            session.physics.orientation = displayed.angle - session.physics.twist;
            session.physics.angle = displayed.angle - session.initialAngle;
          }
          session.explicit = null;
        }
        else if (change.toZoneId !== undefined) {
          if (!Number.isInteger(change.index ?? 0) || (change.index ?? 0) < 0) throw new RangeError('Drag index must be non-negative');
          session.keyboardPoses = new Map(cardIds.map((id) => [id, copy(state().visual.get(id))]));
          session.explicit = { toZoneId: change.toZoneId, index: change.index ?? 0 };
        }
        evaluate(session); publish(); return copy(data);
      },
      release() {
        if (data.phase !== 'dragging') return null;
        refresh();
        reconcile();
        if (data.phase !== 'dragging') return null;
        evaluate(session, true);
        if (!data.candidate?.allowed) { cancel(session, 'Invalid drop'); return null; }
        session.explicit = { toZoneId: data.candidate.toZoneId, index: data.candidate.index };
        data.phase = 'pending'; data.revision = revision;
        session.pendingMembership = membershipKey(session);
        const intent = { ...requestFor(session), id: data.id };
        publish();
        if (data.phase !== 'pending') return null;
        emit('drop', immutable(copy(intent))); return immutable(copy(intent));
      },
      cancel: (reason) => cancel(session, reason),
    };
  }
  function resolveDrop(id, { accepted } = {}) {
    if (!disposed) refresh();
    const session = sessions.get(id);
    if (!session || session.data.phase !== 'pending') return { status: 'stale' };
    if (typeof accepted !== 'boolean') throw new TypeError('Drop resolution requires accepted boolean');
    reconcile();
    if (!sessions.has(id)) return { status: 'stale' };
    const candidate = session.data.candidate;
    if (!accepted) { finish(session, 'rejected'); publish(); return { status: 'rejected' }; }
    // Stop preview reconciliation during the authoritative transaction, but do
    // not resolve the logical outcome as accepted until commit has succeeded.
    sessions.delete(id);
    let result;
    try {
      result = commit([{ type: 'moveBatch', cardIds: [...session.data.cardIds], to: candidate.toZoneId, index: candidate.index }], { origin: 'user' });
    } catch (error) {
      finish(session, 'cancelled', 'Drop commit failed');
      publish();
      throw error;
    }
    finish(session, 'accepted');
    publish();
    return { status: 'accepted', finished: result.finished };
  }
  return {
    drag, snapshot, reconcile, resolveDrop, beforeCommit, tick, needsFrame,
    invalidateRules() {
      revision += 1;
      for (const session of [...sessions.values()]) if (session.data.phase === 'pending') finish(session, 'cancelled', 'Rules changed');
      reconcile();
      if (!sessions.size && !disposed && state().desired) publish();
    },
    destroy() { disposed = true; for (const session of [...sessions.values()]) finish(session, 'cancelled', 'Scene destroyed'); },
  };
}
