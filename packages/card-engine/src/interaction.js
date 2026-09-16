import { resolveBatchMove } from './batch.js';

const copy = (value) => structuredClone(value);
const COMPACT_DURATION = 180;
const COMPACT_STEP = 18;
const authoredPosition = (card) => JSON.stringify([card.positionMode, card.pose?.x, card.pose?.y, card.pose?.z]);
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

// Gesture state and hypothetical layouts never mutate committed membership.
export function createInteraction({ state, solve, sample, refresh, takePosition, present, commit, emit, rules, toClient, fromClient,
  isSelectable = () => true, now = () => 0, reducedMotion = () => false, requestFrame = () => {}, defaultPresentation = 'preserve' }) {
  const sessions = new Map();
  let sequence = 0;
  let revision = 0;
  let disposed = false;
  let reconciling = false;
  let restingKey;
  let restingModel;
  let restingPoses;
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
    sources: copy(session.data.sources), toZoneId: session.data.candidate?.toZoneId, index: session.data.candidate?.index, revision });
  function decision(name, request) {
    try {
      const result = rules?.[name]?.(copy(request));
      return result?.allowed === true ? { allowed: true } : { allowed: false, reason: result?.reason ?? 'Move is not permitted' };
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
    const poses = solve(nextSnapshot);
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
      try { poses = hypothetical(session, hit.zone.id, slot); } catch { break; }
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
      session.ruleDecision = decision('canDrop', requestFor(session));
    }
    Object.assign(session.data.candidate, session.ruleDecision);
    if (session.data.candidate.allowed) {
      session.preview = preview;
      session.data.targetPose = copy(preview.get(session.data.primaryCardId));
      session.data.targetPoses = Object.fromEntries(session.data.cardIds.map((id) => [id, copy(preview.get(id))]));
    }
  }
  function publish() {
    const restPoses = resting();
    const positions = new Map();
    for (const session of sessions.values()) {
      if (session.preview) for (const [id, pose] of session.preview) {
        const rest = restPoses.get(id);
        if (rest && ['x', 'y', 'z'].some((key) => rest[key] !== pose[key])) positions.set(id, { pose, direct: false });
      }
      if (session.data.phase === 'dragging' && (!session.explicit || session.data.candidate?.allowed)) {
        const primaryTarget = session.explicit ? session.data.targetPose : null;
        const center = primaryTarget ? toClient(primaryTarget)
          : { x: session.client.x - session.offset.x, y: session.client.y - session.offset.y };
        const progress = compactProgress(session);
        session.compactSettled = progress === 1;
        for (const [id, member] of session.members) {
          const offset = session.data.presentation === 'compact' ? {
            x: member.offset.x + (member.compact.x - member.offset.x) * progress,
            y: member.offset.y + (member.compact.y - member.offset.y) * progress,
          } : member.offset;
          const depth = primaryTarget ? primaryTarget.z + member.depth - session.members.get(session.data.primaryCardId).depth : member.depth;
          const p = fromClient({ x: center.x + offset.x, y: center.y + offset.y }, depth);
          if (p) positions.set(id, { pose: { ...p, z: depth }, direct: !session.explicit });
        }
      } else {
        for (const id of session.data.cardIds) {
          const target = session.data.phase === 'pending' ? targetFor(session, id) : session.keyboardPoses?.get(id);
          if (target) positions.set(id, { pose: target, direct: false });
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
    return !disposed && [...sessions.values()].some((session) => session.data.phase === 'dragging'
      && (!session.explicit || session.data.candidate?.allowed) && session.data.presentation === 'compact' && !session.compactSettled);
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
          || !decision('canStart', requestFor(session)).allowed) {
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
    const current = state();
    if (cardIds.some((id) => !current.desired.cards.some((card) => card.id === id)
      || !current.visual.get(id) || current.visual.get(id).visible === false || !isSelectable(id))) throw new Error('Card is not available for dragging');
    const data = { id: `drag-${++sequence}`, phase: 'dragging', cardIds, primaryCardId: id,
      sources: cardIds.flatMap((id) => sourcesFor(id)), presentation, candidate: null, targetPose: null, targetPoses: null, revision };
    const allowed = decision('canStart', data);
    if (!allowed.allowed) throw new Error(allowed.reason);
    const startPoint = request.point === undefined ? null : point(request.point);
    sample();
    // A new gesture supersedes older gesture previews, without locking other cards.
    for (const previous of [...sessions.values()]) finish(previous, 'cancelled', 'Superseded by a newer gesture');
    for (const cardId of cardIds) takePosition(cardId);
    const pose = state().visual.get(id);
    const center = toClient(pose);
    const client = startPoint ? toClient({ ...startPoint, z: 0 }) : center;
    const members = new Map(cardIds.map((cardId, index) => {
      const memberPose = state().visual.get(cardId);
      const projected = toClient(memberPose);
      const offset = COMPACT_STEP * (index - cardIds.indexOf(id));
      return [cardId, { depth: memberPose.z, offset: { x: projected.x - center.x, y: projected.y - center.y },
        compact: { x: offset, y: offset }, authored: authoredPosition(current.desired.cards.find((card) => card.id === cardId)) }];
    }));
    const session = { data, client, members, cohort: new Set(cardIds), startedAt: now(), compactSettled: false,
      offset: { x: client.x - center.x, y: client.y - center.y }, ruleKey: null };
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
        if (change.point !== undefined) { session.client = toClient({ ...point(change.point), z: 0 }); session.explicit = null; }
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
      result = commit([{ type: 'moveBatch', cardIds: [...session.data.cardIds], to: candidate.toZoneId, index: candidate.index }]);
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
