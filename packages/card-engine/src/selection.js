const empty = () => ({ cardIds: [], primaryCardId: null, anchorCardId: null });
const copy = (value) => structuredClone(value);

// Selection is presentation state. It never grants permission to move a card.
export function createSelection({ config = {}, state, onChange = () => {} }) {
  if (typeof state !== "function") throw new TypeError("Selection requires a state reader");
  const multiple = config.multiple ?? true;
  const max = config.max ?? Infinity;
  const scope = config.scope ?? "scene";
  // Cross-zone cohorts can move or act on cards from different ownership
  // contexts, so consumers must explicitly opt into them.
  const allowCrossZone = config.allowCrossZone ?? false;
  if (typeof multiple !== "boolean") throw new TypeError("Selection multiple must be boolean");
  if (typeof allowCrossZone !== "boolean") throw new TypeError("Selection allowCrossZone must be boolean");
  if (max !== Infinity && (!Number.isInteger(max) || max < 0)) throw new RangeError("Selection max must be a non-negative integer or Infinity");
  if (!["scene", "zone"].includes(scope)) throw new TypeError("Selection scope must be scene or zone");
  if (config.canSelect !== undefined && typeof config.canSelect !== "function") throw new TypeError("Selection canSelect must be a function");
  for (const key of ["rangeOrder", "zoneOrder"]) {
    if (config[key] !== undefined && (!Array.isArray(config[key])
      || config[key].some((id) => typeof id !== "string") || new Set(config[key]).size !== config[key].length)) {
      throw new TypeError(`Selection ${key} requires unique string IDs`);
    }
  }
  let selection = empty();
  const snapshot = () => copy(selection);
  const model = () => state().desired ?? { cards: [], zones: [] };
  const zoneFor = (id) => model().zones.find((zone) => zone.cardIds.includes(id));

  function forcedGroup(zone) {
    const policy = zone?.selectionPolicy;
    if (policy?.mode !== "forced") return null;
    if (zone.cardIds.length < policy.count) {
      return { cardIds: [], reason: `Zone ${zone.id} requires selecting ${policy.count} cards but only has ${zone.cardIds.length}` };
    }
    return { cardIds: zone.cardIds.slice(-policy.count) };
  }

  function publish(next) {
    if (JSON.stringify(next) !== JSON.stringify(selection)) {
      selection = next;
      onChange(snapshot());
    }
    return snapshot();
  }

  function decision(cardId, options = {}) {
    const ignoreZoneSelectionPolicy = options.ignoreZoneSelectionPolicy === true;
    const { desired, visual } = state();
    const card = desired?.cards.find(({ id }) => id === cardId);
    const zone = desired?.zones.find(({ cardIds }) => cardIds.includes(cardId));
    const pose = visual?.get(cardId);
    if (!card || !zone || !pose || pose.visible === false || zone.visible === false) {
      return { allowed: false, reason: `Card ${cardId} is not available for selection` };
    }
    if (card.feedback?.disabled) return { allowed: false, reason: `Card ${cardId} is disabled` };
    const group = ignoreZoneSelectionPolicy ? null : forcedGroup(zone);
    if (group && !group.cardIds.includes(cardId)) {
      return { allowed: false, reason: group.reason ?? `Zone ${zone.id} requires selecting its top ${zone.selectionPolicy.count} cards` };
    }
    if (!config.canSelect) return { allowed: true };
    try {
      const result = config.canSelect({ cardId, zoneId: zone.id, snapshot: copy(desired) });
      return result?.allowed === true ? { allowed: true }
        : { allowed: false, reason: result?.reason ?? `Card ${cardId} is not selectable` };
    } catch {
      return { allowed: false, reason: "Selection policy could not be evaluated" };
    }
  }

  const isSelectable = (id) => decision(id).allowed;

  function validateOrder(ids, knownIds, name) {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !knownIds.has(id))
      || new Set(ids).size !== ids.length) throw new TypeError(`${name} requires unique known IDs`);
  }

  function orderedZones() {
    const zones = model().zones;
    const ids = config.zoneOrder ?? [];
    validateOrder(ids, new Set(zones.map(({ id }) => id)), "zoneOrder");
    return [...ids.map((id) => zones.find((zone) => zone.id === id)), ...zones.filter(({ id }) => !ids.includes(id))];
  }

  function order(cardIds, mode = "source") {
    validateOrder(cardIds, new Set(model().cards.map(({ id }) => id)), "Selection order");
    if (mode === "provided") return [...cardIds];
    if (mode !== "source") throw new TypeError(`Unknown selection order: ${mode}`);
    const requested = new Set(cardIds);
    return orderedZones().flatMap((zone) => zone.cardIds.filter((id) => requested.has(id)));
  }

  function context(focusedCardId) {
    const scopeZoneId = scope === "zone"
      ? zoneFor(focusedCardId ?? selection.primaryCardId ?? selection.anchorCardId)?.id ?? null : null;
    const eligibleCardIds = orderedZones()
      .filter((zone) => scope !== "zone" || zone.id === scopeZoneId)
      .flatMap((zone) => zone.cardIds.filter(isSelectable));
    return { navigationCardIds: [...eligibleCardIds], eligibleCardIds, scopeZoneId };
  }

  function select(cardIds, options = {}) {
    if (!state().desired) throw new Error("Call scene.apply before scene.select");
    if (!Array.isArray(cardIds) || cardIds.some((id) => typeof id !== "string")) throw new TypeError("Selection requires an array of card IDs");
    const mode = options.mode ?? "replace";
    if (options.ignoreZoneSelectionPolicy !== undefined && typeof options.ignoreZoneSelectionPolicy !== "boolean") {
      throw new TypeError("Selection ignoreZoneSelectionPolicy must be boolean");
    }
    const ignoreZoneSelectionPolicy = options.ignoreZoneSelectionPolicy === true;
    if (!["replace", "add", "toggle", "remove", "range"].includes(mode)) throw new TypeError(`Unknown selection mode: ${mode}`);
    const denied = (reason) => ({ ...snapshot(), accepted: false, reason });
    let requested = [...new Set(cardIds)];
    let rangeAnchor;
    if (mode === "range") {
      if (requested.length !== 1) throw new TypeError("Range selection requires one endpoint");
      const target = requested[0];
      rangeAnchor = options.anchorCardId ?? selection.anchorCardId ?? target;
      const sourceZone = zoneFor(rangeAnchor);
      const targetZone = zoneFor(target);
      if (!sourceZone || !targetZone) return denied("Range endpoints must be known cards");
      let logicalOrder = sourceZone.cardIds;
      if (sourceZone.id !== targetZone.id) {
        if (!config.rangeOrder) return denied("Cross-zone range requires an explicit rangeOrder");
        logicalOrder = config.rangeOrder;
      }
      if (config.rangeOrder) validateOrder(config.rangeOrder, new Set(model().cards.map(({ id }) => id)), "rangeOrder");
      const start = logicalOrder.indexOf(rangeAnchor);
      const end = logicalOrder.indexOf(target);
      if (start < 0 || end < 0) return denied("Range order must include both endpoints");
      requested = logicalOrder.slice(Math.min(start, end), Math.max(start, end) + 1);
    }
    const current = selection.cardIds;
    const forcedGroups = new Map();
    for (const id of requested) {
      const zone = zoneFor(id);
      const group = ignoreZoneSelectionPolicy ? null : forcedGroup(zone);
      if (!group) continue;
      if (!group.cardIds.includes(id)) {
        return denied(group.reason ?? `Zone ${zone.id} requires selecting its top ${zone.selectionPolicy.count} cards`);
      }
      forcedGroups.set(zone.id, group.cardIds);
    }
    if (forcedGroups.size) {
      const expanded = [];
      for (const id of requested) {
        const group = forcedGroups.get(zoneFor(id)?.id);
        for (const member of group ?? [id]) if (!expanded.includes(member)) expanded.push(member);
      }
      requested = expanded;
    }
    let next;
    if (mode === "replace" || mode === "range") next = requested;
    if (mode === "add") next = [...current, ...requested.filter((id) => !current.includes(id))];
    if (mode === "remove" || mode === "toggle") next = current.filter((id) => !requested.includes(id));
    if (mode === "toggle") next.push(...requested.filter((id) => !current.includes(id)));
    const onlyRemoving = mode === "remove" || mode === "toggle" && next.every((id) => current.includes(id));
    if (!onlyRemoving) {
      for (const id of next) {
        const result = decision(id, { ignoreZoneSelectionPolicy });
        if (!result.allowed) return denied(result.reason);
      }
      if (next.length > Math.min(max, multiple ? Infinity : 1)) return denied("Selection exceeds the maximum card count");
    }
    for (const key of ["primaryCardId", "anchorCardId"]) {
      if (options[key] !== undefined && options[key] !== null
        && !decision(options[key], { ignoreZoneSelectionPolicy }).allowed && !onlyRemoving) {
        return denied(`Selection ${key} must be an eligible card`);
      }
    }
    const preferredPrimary = options.primaryCardId ?? (mode === "range" ? cardIds[0] : undefined);
    if (preferredPrimary !== undefined && !next.includes(preferredPrimary)
      && !(onlyRemoving && current.includes(preferredPrimary))) return denied("Primary card must belong to selection");
    const added = next.filter((id) => !current.includes(id));
    const primaryCardId = next.includes(preferredPrimary) ? preferredPrimary
      : mode === "replace" || mode === "range" ? next.at(-1) ?? null
        : added.at(-1) ?? (next.includes(selection.primaryCardId) ? selection.primaryCardId : next[0] ?? null);
    let anchorCardId = options.anchorCardId ?? (mode === "range" ? rangeAnchor
      : mode === "replace" ? primaryCardId : selection.anchorCardId ?? primaryCardId);
    if (!decision(anchorCardId, { ignoreZoneSelectionPolicy }).allowed) anchorCardId = primaryCardId;
    if (scope === "zone" && next.length && !onlyRemoving) {
      const retained = (mode === "add" || mode === "toggle") && current.find((id) => next.includes(id));
      const scopeId = zoneFor(retained || preferredPrimary || rangeAnchor || anchorCardId || primaryCardId)?.id;
      if (next.some((id) => zoneFor(id)?.id !== scopeId)) return denied("Selection must stay within one zone");
      if (zoneFor(anchorCardId)?.id !== scopeId) anchorCardId = primaryCardId;
    }
    if (!allowCrossZone && next.length > 1 && !onlyRemoving) {
      const zoneIds = new Set(next.map((id) => zoneFor(id)?.id).filter(Boolean));
      if (zoneIds.size > 1) return denied("Selection cannot span multiple zones");
    }
    return { ...publish(next.length ? { cardIds: next, primaryCardId, anchorCardId } : empty()), accepted: true };
  }

  function reconcile() {
    let cardIds = selection.cardIds.filter(isSelectable);
    for (const zone of model().zones) {
      const group = forcedGroup(zone);
      if (!group || !cardIds.some((id) => zone.cardIds.includes(id))) continue;
      if (group.cardIds.length === 0 || group.cardIds.some((id) => !cardIds.includes(id))) return publish(empty());
      cardIds = [...cardIds.filter((id) => !zone.cardIds.includes(id)), ...group.cardIds];
    }
    if (scope === "zone" && cardIds.length) {
      const zoneId = zoneFor(cardIds[0])?.id;
      cardIds = cardIds.filter((id) => zoneFor(id)?.id === zoneId);
    }
    cardIds = cardIds.slice(0, Math.min(max, multiple ? Infinity : 1));
    if (!cardIds.length) return publish(empty());
    const primaryCardId = cardIds.includes(selection.primaryCardId) ? selection.primaryCardId : cardIds[0];
    const anchorCardId = isSelectable(selection.anchorCardId)
      && (scope !== "zone" || zoneFor(selection.anchorCardId)?.id === zoneFor(primaryCardId)?.id)
      ? selection.anchorCardId : primaryCardId;
    return publish({ cardIds, primaryCardId, anchorCardId });
  }

  return { select, snapshot, reconcile, context, order, isSelectable, clear: () => publish(empty()) };
}
