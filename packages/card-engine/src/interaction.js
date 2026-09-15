const copy = (value) => structuredClone(value);
const terminal = (phase) => !['dragging', 'pending'].includes(phase);
function point(value) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new TypeError('Drag point requires finite x and y');
  return { x: value.x, y: value.y };
}

// Gesture state and hypothetical layouts never mutate committed membership.
export function createInteraction({ state, solve, sample, refresh, takePosition, present, commit, emit, rules, toClient, fromClient }) {
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
  const sourcesFor = (id) => state().desired.zones.flatMap((zone) => zone.cardIds.includes(id)
    ? [{ cardId: id, zoneId: zone.id, index: zone.cardIds.indexOf(id) }] : []);
  const membershipKey = (session) => JSON.stringify([
    session.data.sources[0].zoneId, session.data.candidate?.toZoneId,
  ].map((id) => [id, state().desired.zones.find((zone) => zone.id === id)?.cardIds]));
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
    const id = session.data.primaryCardId;
    // The desired snapshot is already normalized and solve() is read-only.
    // Clone only the affected card and membership arrays; deep-cloning every
    // card for every insertion slot made the first drag update scale poorly.
    const next = {
      cards: model.cards.map((card) => card.id === id ? { ...card, positionMode: undefined } : card),
      zones: model.zones.map((candidate) => ({
        ...candidate,
        cardIds: candidate.cardIds.filter((cardId) => cardId !== id),
      })),
    };
    const zone = next.zones.find((candidate) => candidate.id === zoneId);
    if (!zone) throw new Error('Destination was removed');
    zone.cardIds.splice(Math.min(index, zone.cardIds.length), 0, id);
    if (zone.cardIds.length > (zone.capacity ?? Infinity)) {
      throw new RangeError(`Zone ${zone.id} exceeds capacity`);
    }
    const poses = solve(next);
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
    const count = hit.zone.cardIds.filter((id) => id !== session.data.primaryCardId).length;
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
    if (!hit) { session.data.candidate = null; return; }
    const max = hit.zone.cardIds.filter((id) => id !== session.data.primaryCardId).length;
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
      const id = session.data.primaryCardId;
      if (session.data.phase === 'dragging' && !session.explicit) {
        const center = { x: session.client.x - session.offset.x, y: session.client.y - session.offset.y };
        const p = fromClient(center, session.depth);
        if (p) positions.set(id, { pose: { ...p, z: session.depth }, direct: true });
      } else if (session.data.targetPose || session.keyboardPose) {
        positions.set(id, { pose: session.data.targetPose ?? session.keyboardPose, direct: false });
      }
    }
    present(positions, snapshot(), restPoses);
    emit('interaction-change', snapshot());
  }
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
        const id = session.data.primaryCardId;
        const current = state();
        const card = current.desired.cards.find((card) => card.id === id);
        const source = sourcesFor(id);
        const old = session.data.sources[0];
        const previousDestination = session.data.candidate?.toZoneId;
        const destination = previousDestination && current.zones.find((zone) => zone.id === previousDestination);
        if (session.data.phase === 'pending' && session.pendingMembership !== membershipKey(session)) {
          finish(session, 'cancelled', 'Source or destination order changed'); continue;
        }
        if (!card || source[0]?.zoneId !== old.zoneId || current.visual.get(id)?.visible === false
          || (previousDestination && (!destination || destination.visible === false || destination.dropTarget === 'transparent'))
          || card.positionMode !== session.positionMode || JSON.stringify(card.pose && [card.pose.x, card.pose.y, card.pose.z]) !== session.authoredPosition
          || !decision('canStart', requestFor(session)).allowed) {
          finish(session, 'cancelled', 'Card or source changed'); continue;
        }
        session.data.sources = source;
        evaluate(session, true);
        if (session.data.phase === 'pending' && !session.data.candidate?.allowed) finish(session, 'cancelled', 'Destination is no longer permitted');
      }
      publish();
    } finally { reconciling = false; }
  }
  function beforeCommit(next, operations = []) {
    for (const session of [...sessions.values()]) {
      const id = session.data.primaryCardId;
      const source = session.data.sources[0];
      const card = next.cards.find((card) => card.id === id);
      const zone = next.zones.find((zone) => zone.cardIds.includes(id));
      if (!card || zone?.id !== source.zoneId || zone.cardIds.indexOf(id) !== source.index
        || operations.some((op) => op.type === 'move' && op.cardId === id)) {
        cancel(session, 'Superseded by an authoritative move');
      }
    }
  }
  function drag(request) {
    if (disposed) throw new Error('Scene is destroyed');
    if (!state().desired) throw new Error('Call scene.apply before scene.drag');
    if (!Array.isArray(request?.cardIds) || request.cardIds.length !== 1) throw new TypeError('This slice requires exactly one drag card');
    const id = request.cardIds[0];
    if (request.primaryCardId !== undefined && request.primaryCardId !== id) throw new TypeError('Primary card must belong to drag');
    const current = state();
    const card = current.desired.cards.find((card) => card.id === id);
    if (!card || current.visual.get(id)?.visible === false) throw new Error('Card is not available for dragging');
    const data = { id: `drag-${++sequence}`, phase: 'dragging', cardIds: [id], primaryCardId: id, sources: sourcesFor(id), candidate: null, targetPose: null, revision };
    const allowed = decision('canStart', data);
    if (!allowed.allowed) throw new Error(allowed.reason);
    const startPoint = request.point === undefined ? null : point(request.point);
    sample();
    // A new gesture supersedes older gesture previews, without locking other cards.
    for (const previous of [...sessions.values()]) finish(previous, 'cancelled', 'Superseded by a newer gesture');
    takePosition(id);
    const pose = state().visual.get(id);
    const center = toClient(pose);
    const client = startPoint ? toClient({ ...startPoint, z: 0 }) : center;
    const session = { data, client, offset: { x: client.x - center.x, y: client.y - center.y }, depth: pose.z,
      positionMode: card.positionMode, authoredPosition: JSON.stringify(card.pose && [card.pose.x, card.pose.y, card.pose.z]), ruleKey: null };
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
          session.keyboardPose = copy(data.targetPose ?? state().visual.get(id));
          session.explicit = { toZoneId: change.toZoneId, index: change.index ?? 0 };
        }
        evaluate(session); publish(); return copy(data);
      },
      release() {
        if (data.phase !== 'dragging') return null;
        refresh();
        if (data.phase !== 'dragging') return null;
        evaluate(session, true);
        if (!data.candidate?.allowed) { cancel(session, 'Invalid drop'); return null; }
        session.explicit = { toZoneId: data.candidate.toZoneId, index: data.candidate.index };
        data.phase = 'pending'; data.revision = revision;
        session.pendingMembership = membershipKey(session);
        const intent = { ...requestFor(session), id: data.id };
        publish(); emit('drop', copy(intent)); return copy(intent);
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
      result = commit([{ type: 'move', cardId: session.data.primaryCardId, to: candidate.toZoneId, index: candidate.index }]);
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
    drag, snapshot, reconcile, resolveDrop, beforeCommit,
    invalidateRules() {
      revision += 1;
      for (const session of [...sessions.values()]) if (session.data.phase === 'pending') finish(session, 'cancelled', 'Rules changed');
      reconcile();
      if (!sessions.size && !disposed && state().desired) publish();
    },
    destroy() { disposed = true; for (const session of [...sessions.values()]) finish(session, 'cancelled', 'Scene destroyed'); },
  };
}
