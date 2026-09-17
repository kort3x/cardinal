const DEFAULT_PICKUP_DISTANCE = 6;
const DEFAULT_SCROLL_EDGE = 48;
const DEFAULT_SCROLL_SPEED = 640;

const terminalPhases = new Set(["accepted", "rejected", "cancelled"]);
const navigationKeys = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Enter", " ", "Spacebar", "Space"]);

function finitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
    ? { x: point.x, y: point.y }
    : null;
}

function cardShellFrom(target) {
  if (!target) return null;
  if (typeof target.closest === "function") return target.closest("[data-card-id]");
  let node = target;
  while (node) {
    if (node.dataset?.cardId !== undefined) return node;
    node = node.parentElement;
  }
  return null;
}

function cardIdFrom(shell) {
  const id = shell?.dataset?.cardId;
  return typeof id === "string" && id ? id : null;
}

function shellForCard(element, cardId) {
  if (!element || !cardId) return null;
  try {
    const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(cardId) : cardId.replace(/([\\"'])/g, "\\$1");
    return element.querySelector?.(`[data-card-id="${escaped}"]`) ?? [...(element.querySelectorAll?.("[data-card-id]") ?? [])]
      .find((shell) => shell.dataset?.cardId === cardId) ?? null;
  } catch {
    return [...(element.querySelectorAll?.("[data-card-id]") ?? [])].find((shell) => shell.dataset?.cardId === cardId) ?? null;
  }
}

function isInteractiveTarget(target, shell) {
  if (!target || target === shell || typeof target.closest !== "function") return false;
  return Boolean(target.closest("button, a, input, textarea, select, option, [contenteditable='true'], [data-interaction-ignore]"));
}

function samePoint(a, b) {
  return Boolean(a && b && a.x === b.x && a.y === b.y);
}

function eventPoint(event) {
  return { x: event.clientX, y: event.clientY };
}

function ownerDocument(element) {
  if (element?.ownerDocument) return element.ownerDocument;
  if (typeof document !== "undefined") return document;
  return null;
}

function viewportWindow(element, doc) {
  return doc?.defaultView ?? element?.ownerDocument?.defaultView
    ?? (typeof window !== "undefined" ? window : null);
}

function styleValue(style, property) {
  return style?.[property] ?? "";
}

function computedStyle(node, view) {
  try {
    return view?.getComputedStyle?.(node) ?? (typeof getComputedStyle === "function" ? getComputedStyle(node) : null);
  } catch {
    return null;
  }
}

function hasScrollableRange(node, axis) {
  if (!node) return false;
  if (axis === "x") return Number(node.scrollWidth) > Number(node.clientWidth) + 1;
  return Number(node.scrollHeight) > Number(node.clientHeight) + 1;
}

function allowsScroll(style, axis) {
  const value = style?.[axis === "x" ? "overflowX" : "overflowY"] ?? style?.overflow;
  return value === "auto" || value === "scroll" || value === "overlay";
}

function scrollableAncestors(element, view) {
  const targets = [];
  let node = element;
  while (node) {
    const style = computedStyle(node, view) ?? node.style;
    if ((hasScrollableRange(node, "x") && allowsScroll(style, "x"))
      || (hasScrollableRange(node, "y") && allowsScroll(style, "y"))) targets.push({ type: "element", node });
    node = node.parentElement;
  }
  if (view) targets.push({ type: "page", view });
  return targets;
}

function elementRect(node) {
  try {
    const rect = node?.getBoundingClientRect?.();
    if (!rect) return null;
    return {
      ...rect,
      right: Number.isFinite(rect.right) ? rect.right : rect.left + rect.width,
      bottom: Number.isFinite(rect.bottom) ? rect.bottom : rect.top + rect.height,
    };
  } catch {
    return null;
  }
}

function pageRect(view) {
  return {
    left: 0,
    top: 0,
    right: Number.isFinite(view?.innerWidth) ? view.innerWidth : 0,
    bottom: Number.isFinite(view?.innerHeight) ? view.innerHeight : 0,
  };
}

function scrollDelta(point, rect, edge, speed, elapsed) {
  if (!rect || elapsed <= 0) return { x: 0, y: 0 };
  const x = point.x < rect.left + edge
    ? -speed * Math.min(1, (rect.left + edge - point.x) / edge)
    : point.x > rect.right - edge
      ? speed * Math.min(1, (point.x - (rect.right - edge)) / edge)
      : 0;
  const y = point.y < rect.top + edge
    ? -speed * Math.min(1, (rect.top + edge - point.y) / edge)
    : point.y > rect.bottom - edge
      ? speed * Math.min(1, (point.y - (rect.bottom - edge)) / edge)
      : 0;
  return { x: x * elapsed / 1000, y: y * elapsed / 1000 };
}

function scrollElement(node, delta) {
  const changed = { x: false, y: false };
  if (delta.x) {
    const maximum = Math.max(0, Number(node.scrollWidth) - Number(node.clientWidth));
    const next = Math.max(0, Math.min(maximum, Number(node.scrollLeft || 0) + delta.x));
    changed.x = next !== Number(node.scrollLeft || 0);
    node.scrollLeft = next;
  }
  if (delta.y) {
    const maximum = Math.max(0, Number(node.scrollHeight) - Number(node.clientHeight));
    const next = Math.max(0, Math.min(maximum, Number(node.scrollTop || 0) + delta.y));
    changed.y = next !== Number(node.scrollTop || 0);
    node.scrollTop = next;
  }
  return changed;
}

function scrollPage(view, delta) {
  const doc = view?.document;
  const root = doc?.scrollingElement ?? doc?.documentElement;
  const before = { x: Number(view?.scrollX ?? root?.scrollLeft ?? 0), y: Number(view?.scrollY ?? root?.scrollTop ?? 0) };
  const maxX = Math.max(0, Number(root?.scrollWidth ?? before.x) - Number(view?.innerWidth ?? root?.clientWidth ?? 0));
  const maxY = Math.max(0, Number(root?.scrollHeight ?? before.y) - Number(view?.innerHeight ?? root?.clientHeight ?? 0));
  const next = {
    x: Math.max(0, Math.min(maxX, before.x + delta.x)),
    y: Math.max(0, Math.min(maxY, before.y + delta.y)),
  };
  if (next.x === before.x && next.y === before.y) return { x: false, y: false };
  if (typeof view?.scrollTo === "function") view.scrollTo(next.x, next.y);
  else if (root) { root.scrollLeft = next.x; root.scrollTop = next.y; }
  return { x: next.x !== before.x, y: next.y !== before.y };
}

function zoneList(scene) {
  try {
    const snapshot = scene.snapshot?.() ?? {};
    const zones = snapshot.zones ?? snapshot.desired?.zones ?? [];
    return zones.filter((zone) => zone?.id && zone.visible !== false && zone.dropTarget !== "transparent"
      && zone.geometry?.width !== 0 && zone.geometry?.height !== 0);
  } catch {
    return [];
  }
}

function sourceDestination(scene, cardId, cardIds = [cardId]) {
  const zone = zoneList(scene).find((candidate) => candidate.cardIds?.includes(cardId));
  return zone ? { toZoneId: zone.id, index: zone.cardIds.slice(0, zone.cardIds.indexOf(cardId))
    .filter((id) => !cardIds.includes(id)).length } : null;
}

function sessionSnapshot(session, result) {
  try {
    const snapshot = session?.snapshot?.();
    if (snapshot) return snapshot;
  } catch {
    // The scene may have disposed the session between an event and this read.
  }
  return result ?? null;
}

export function createInputAdapter({ element, scene, options = {}, selectionContext } = {}) {
  if (!element || !scene) throw new TypeError("createInputAdapter requires an element and scene");

  const doc = ownerDocument(element);
  const view = viewportWindow(element, doc);
  const touchDrag = options.touchDrag === true;
  const touchSelection = options.touchSelection === true;
  const pickupDistance = Number.isFinite(options.pickupDistance) ? Math.max(0, options.pickupDistance) : DEFAULT_PICKUP_DISTANCE;
  const scrollEdge = Number.isFinite(options.autoScrollEdge) ? Math.max(1, options.autoScrollEdge) : DEFAULT_SCROLL_EDGE;
  const scrollSpeed = Number.isFinite(options.autoScrollSpeed) ? Math.max(0, options.autoScrollSpeed) : DEFAULT_SCROLL_SPEED;
  const listeners = [];
  const pointerIds = new Set();
  const originalTouchAction = styleValue(element.style, "touchAction");
  let press = null;
  let active = null;
  let frame = null;
  let frameTime = null;
  let destroyed = false;
  let lastAnnouncement = "";
  let liveRegion = null;
  let suppressNextClick = false;

  if (touchDrag && element.style) element.style.touchAction = "none";

  function listen(target, type, handler, listenerOptions) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler, listenerOptions);
    listeners.push(() => target.removeEventListener?.(type, handler, listenerOptions));
  }

  function announce(message) {
    if (!message || message === lastAnnouncement) return;
    lastAnnouncement = message;
    if (!liveRegion && doc?.createElement) {
      liveRegion = doc.createElement("div");
      liveRegion.className = "cardinal-interaction-announcement";
      liveRegion.setAttribute("role", "status");
      liveRegion.setAttribute("aria-live", "polite");
      liveRegion.setAttribute("aria-atomic", "true");
      liveRegion.style.position = "absolute";
      liveRegion.style.width = "1px";
      liveRegion.style.height = "1px";
      liveRegion.style.overflow = "hidden";
      liveRegion.style.clipPath = "inset(50%)";
      liveRegion.style.whiteSpace = "nowrap";
      element.append?.(liveRegion);
    }
    if (liveRegion) liveRegion.textContent = message;
  }

  function focusShell(shell) {
    try { shell?.focus?.({ preventScroll: true }); } catch { shell?.focus?.(); }
  }

  function setDragging(shell, value) {
    if (!shell) return;
    if (value) shell.setAttribute?.("aria-grabbed", "true");
    else shell.removeAttribute?.("aria-grabbed");
  }

  function releaseCapture(state) {
    if (!state?.captureTarget || state.pointerId === null || state.pointerId === undefined) return;
    state.releasingCapture = true;
    try { state.captureTarget.releasePointerCapture?.(state.pointerId); } catch { /* capture may already be gone */ }
    state.releasingCapture = false;
  }

  function cleanup(state, { restoreFocus = true } = {}) {
    if (!state) return;
    releaseCapture(state);
    setDragging(state.shell, false);
    if (restoreFocus && state.shell?.isConnected !== false) focusShell(state.shell);
    if (active === state) active = null;
  }

  function cancelFrame() {
    if (frame === null) return;
    if (view?.cancelAnimationFrame) view.cancelAnimationFrame(frame);
    else if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    else clearTimeout(frame);
    frame = null;
    frameTime = null;
  }

  function scheduleFrame() {
    if (destroyed || frame !== null || !active?.lastClientPoint || active.released) return;
    const callback = (time) => {
      frame = null;
      if (!active || active.released || destroyed || readActiveSnapshot(active)?.phase !== "dragging") return;
      const now = Number.isFinite(time) ? time : Date.now();
      const elapsed = frameTime === null ? 0 : Math.max(0, now - frameTime);
      frameTime = now;
      const moved = { x: false, y: false };
      for (const target of scrollableAncestors(element, view)) {
        const rect = target.type === "element" ? elementRect(target.node) : pageRect(target.view);
        const delta = scrollDelta(active.lastClientPoint, rect, scrollEdge, scrollSpeed, elapsed);
        const result = target.type === "element" ? scrollElement(target.node, {
          x: moved.x ? 0 : delta.x,
          y: moved.y ? 0 : delta.y,
        }) : scrollPage(target.view, {
          x: moved.x ? 0 : delta.x,
          y: moved.y ? 0 : delta.y,
        });
        moved.x ||= result.x;
        moved.y ||= result.y;
        if ((!delta.x || moved.x) && (!delta.y || moved.y)) break;
      }
      // Camera/anchor changes can move the scene without changing the client point.
      // Reprojection itself is guarded so an unchanged point causes no scene update.
      reproject(active);
      scheduleFrame();
    };
    if (view?.requestAnimationFrame) frame = view.requestAnimationFrame(callback);
    else if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(callback);
    else frame = setTimeout(() => callback(Date.now()), 16);
  }

  function toScenePoint(clientPoint) {
    try {
      return finitePoint(scene.clientToScene?.(clientPoint, 0));
    } catch {
      return null;
    }
  }

  function projectionProbe(clientPoint) {
    // A resize can change projection scale while the camera-center point stays
    // unchanged. A neighboring pixel detects that change without polling layouts.
    return toScenePoint({ x: clientPoint.x + 1, y: clientPoint.y + 1 });
  }

  function readActiveSnapshot(state = active) {
    return state ? sessionSnapshot(state.session) : null;
  }

  function announceSession(state, snapshot) {
    if (!snapshot) return;
    const count = snapshot.cardIds?.length ?? 1;
    if (snapshot.phase === "pending") { announce("Drop pending."); return; }
    if (snapshot.phase === "accepted") { announce("Drop accepted."); return; }
    if (snapshot.phase === "rejected") { announce("Drop rejected."); return; }
    if (snapshot.phase === "cancelled") { announce(`Drag cancelled${snapshot.reason ? `: ${snapshot.reason}` : "."}`); return; }
    if (snapshot.candidate) {
      const place = `${count} ${count === 1 ? "card" : "cards"}. Destination ${snapshot.candidate.toZoneId}, position ${snapshot.candidate.index + 1}`;
      announce(snapshot.candidate.allowed
        ? `${place}. Press Enter to release.`
        : `${place} unavailable${snapshot.candidate.reason ? `: ${snapshot.candidate.reason}` : "."}`);
      return;
    }
    if (state?.mode === "keyboard") announce(`${count} ${count === 1 ? "card" : "cards"} picked up. Use arrow keys or Tab to choose a destination.`);
  }

  function selectedState() {
    try {
      return scene.snapshot?.().selection ?? { cardIds: [] };
    } catch {
      return { cardIds: [] };
    }
  }

  function selectCards(cardIds, selectionOptions) {
    try {
      const result = scene.select?.(cardIds, selectionOptions) ?? selectedState();
      if (result.accepted === false) {
        announce(`Selection unavailable: ${result.reason ?? "Request denied"}`);
        return null;
      }
      return result;
    } catch (error) {
      announce(`Selection unavailable: ${error.message}`);
      return null;
    }
  }

  function prepareSelection(cardId, modifiers = {}) {
    const selected = selectedState();
    if (selected.cardIds.includes(cardId)) {
      if (selected.primaryCardId && selected.primaryCardId !== cardId) {
        return selectCards([], { mode: "add", primaryCardId: cardId, anchorCardId: selected.anchorCardId });
      }
      return selected;
    }
    return selectCards([cardId], {
      mode: modifiers.shiftKey ? "range" : modifiers.ctrlKey || modifiers.metaKey ? "add" : "replace",
      primaryCardId: cardId,
    });
  }

  function startSession(shell, cardId, point, mode, pointerId = null, pointerType = null, modifiers = {}) {
    if (destroyed || active) return false;
    const selected = prepareSelection(cardId, modifiers);
    if (!selected?.cardIds.includes(cardId)) return false;
    let session;
    try {
      session = scene.drag({ cardIds: [...selected.cardIds], primaryCardId: cardId, ...(point ? { point } : {}) });
    } catch (error) {
      announce(`Card cannot be dragged${error?.message ? `: ${error.message}` : "."}`);
      return false;
    }
    if (!session || typeof session.snapshot !== "function") {
      announce("Card cannot be dragged.");
      return false;
    }
    active = {
      session,
      shell,
      cardId,
      mode,
      pointerId,
      pointerType,
      captureTarget: pointerId === null ? null : element,
      lastClientPoint: null,
      lastScenePoint: point,
      released: false,
      releasingCapture: false,
    };
    setDragging(shell, true);
    focusShell(shell);
    announceSession(active, readActiveSnapshot());
    scheduleFrame();
    return true;
  }

  function updatePoint(state, clientPoint) {
    if (!state || state.released) return false;
    const point = toScenePoint(clientPoint);
    if (!point) return false;
    const probe = projectionProbe(clientPoint);
    state.lastClientPoint = { ...clientPoint };
    if (samePoint(state.lastScenePoint, point) && samePoint(state.lastSceneProbe, probe)) {
      scheduleFrame();
      return true;
    }
    try {
      const result = state.session.update({ point });
      state.lastScenePoint = point;
      state.lastSceneProbe = probe;
      announceSession(state, sessionSnapshot(state.session, result));
      scheduleFrame();
      return true;
    } catch (error) {
      announce(`Drag update unavailable${error?.message ? `: ${error.message}` : "."}`);
      cancelSession("Drag update failed");
      return false;
    }
  }

  function reproject(state) {
    if (!state?.lastClientPoint || state.released) return;
    updatePoint(state, state.lastClientPoint);
  }

  function finishIfTerminal(state, result) {
    const snapshot = sessionSnapshot(state?.session, result);
    announceSession(state, snapshot);
    if (snapshot && terminalPhases.has(snapshot.phase)) {
      cancelFrame();
      cleanup(state);
      return true;
    }
    return false;
  }

  function releaseSession(state) {
    if (!state || state.released) return;
    state.released = true;
    cancelFrame();
    let result;
    try {
      if (state.lastClientPoint) {
        updatePoint({ ...state, released: false }, state.lastClientPoint);
        if (active !== state) return;
      }
      result = state.session.release();
    } catch (error) {
      try { state.session.cancel?.("Release failed"); } catch { /* already terminal */ }
      announce(`Drop unavailable${error?.message ? `: ${error.message}` : "."}`);
      cleanup(state);
      return;
    }
    releaseCapture(state);
    state.pointerId = null;
    if (!finishIfTerminal(state, result)) announceSession(state, readActiveSnapshot(state));
  }

  function cancelSession(reason = "cancelled") {
    const state = active;
    press = null;
    cancelFrame();
    if (!state) return;
    state.released = true;
    try { state.session.cancel?.(reason); } catch { /* a terminal scene session is already safe */ }
    cleanup(state);
  }

  function pointerDown(event) {
    if (destroyed) return;
    suppressNextClick = false;
    const pointerType = event.pointerType ?? "mouse";
    if (pointerType === "touch" && !touchDrag && !touchSelection) return;
    if (pointerType === "touch" && (event.isPrimary === false || pointerIds.size > 0)) {
      pointerIds.add(event.pointerId);
      cancelSession("Second touch contact");
      pointerIds.clear();
      if (touchDrag) event.preventDefault?.();
      return;
    }
    if (event.isPrimary === false || (pointerType !== "touch" && event.button !== undefined && event.button !== 0)) return;
    if (active) {
      const wasPending = active.released;
      cancelSession("Superseded by another pointer");
      if (!wasPending) return;
    }
    let shell = cardShellFrom(event.target);
    if (!shell) {
      const point = toScenePoint(eventPoint(event));
      try {
        const hit = point && scene.hitTest?.(point);
        shell = shellForCard(element, hit?.cardId);
      } catch {
        shell = null;
      }
    }
    const cardId = cardIdFrom(shell);
    if (!shell || !cardId || isInteractiveTarget(event.target, shell)) return;
    suppressNextClick = true;
    pointerIds.add(event.pointerId);
    press = { shell, cardId, pointerId: event.pointerId, pointerType, start: eventPoint(event), latest: eventPoint(event),
      shiftKey: Boolean(event.shiftKey), ctrlKey: Boolean(event.ctrlKey), metaKey: Boolean(event.metaKey) };
    focusShell(shell);
  }

  function outsidePointerDown(event) {
    const pointer = press ?? active;
    if (event.pointerType !== "touch" || pointer?.pointerType !== "touch"
      || pointer.released || event.pointerId === pointer.pointerId || element.contains?.(event.target)) return;
    // Capture belongs to the first pointer; a second contact can start elsewhere
    // on the page. Observe it without taking over that outside interaction.
    cancelSession("Second touch contact");
    pointerIds.clear();
  }

  function pointerMove(event) {
    if (destroyed || !press && !active) return;
    if (active) {
      if (active.pointerId !== null && active.pointerId !== event.pointerId) return;
      if (active.released) return;
      event.preventDefault?.();
      updatePoint(active, eventPoint(event));
      return;
    }
    if (!press || press.pointerId !== event.pointerId) return;
    press.latest = eventPoint(event);
    const dx = press.latest.x - press.start.x;
    const dy = press.latest.y - press.start.y;
    if (dx * dx + dy * dy < pickupDistance * pickupDistance) return;
    if (press.pointerType === "touch" && !touchDrag) {
      pointerIds.delete(press.pointerId);
      press = null;
      return;
    }
    // The pointer-down position is the physical pickup point. The first
    // threshold-crossing move is only what turns the press into a drag.
    const point = toScenePoint(press.start);
    if (!point || !startSession(press.shell, press.cardId, point, "pointer", press.pointerId, press.pointerType, press)) {
      pointerIds.delete(press.pointerId);
      press = null;
      return;
    }
    event.preventDefault?.();
    try { active.captureTarget.setPointerCapture?.(press.pointerId); } catch { /* capture is optional in test doubles */ }
    active.lastClientPoint = press.latest;
    active.lastScenePoint = point;
    active.lastSceneProbe = projectionProbe(press.latest);
    press = null;
    scheduleFrame();
  }

  function pointerUp(event) {
    pointerIds.delete(event.pointerId);
    if (active && active.pointerId === event.pointerId) {
      event.preventDefault?.();
      active.lastClientPoint = eventPoint(event);
      releaseSession(active);
      return;
    }
    if (!press || press.pointerId !== event.pointerId) return;
    const pendingPress = press;
    press = null;
    pointerIds.delete(event.pointerId);
    const mode = pendingPress.pointerType === "touch" && touchSelection ? "toggle"
      : pendingPress.shiftKey ? "range" : pendingPress.ctrlKey || pendingPress.metaKey ? "toggle" : "replace";
    // Toggling out a member must allow the selection policy to choose a survivor.
    selectCards([pendingPress.cardId], { mode,
      ...((mode !== "toggle" || !selectedState().cardIds.includes(pendingPress.cardId))
        ? { primaryCardId: pendingPress.cardId } : {}) });
  }

  function click(event) {
    if (!suppressNextClick || event.detail === 0) return;
    suppressNextClick = false;
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
  }

  function pointerCancel(event) {
    pointerIds.delete(event.pointerId);
    if (active && active.pointerId === event.pointerId) cancelSession("Pointer cancelled");
    else if (press?.pointerId === event.pointerId) press = null;
  }

  function lostPointerCapture(event) {
    if (active && event.target === active.captureTarget && active.pointerId === event.pointerId
      && !active.released && !active.releasingCapture) {
      cancelSession("Pointer capture lost");
    }
  }

  function currentKeyboardDestination(state) {
    const snapshot = readActiveSnapshot(state);
    if (snapshot?.candidate?.toZoneId) return { toZoneId: snapshot.candidate.toZoneId, index: snapshot.candidate.index };
    return sourceDestination(scene, state.cardId, snapshot?.cardIds);
  }

  function updateKeyboardDestination(state, destination) {
    if (!destination) return;
    const current = currentKeyboardDestination(state);
    if (current?.toZoneId === destination.toZoneId && current?.index === destination.index
      && readActiveSnapshot(state)?.candidate) return;
    try {
      const result = state.session.update(destination);
      announceSession(state, sessionSnapshot(state.session, result));
    } catch (error) {
      announce(`Destination unavailable${error?.message ? `: ${error.message}` : "."}`);
    }
  }

  function keyboardMove(key) {
    if (!active || active.mode !== "keyboard" || active.released) return;
    const current = currentKeyboardDestination(active);
    if (!current) return;
    const zones = zoneList(scene);
    const zone = zones.find((candidate) => candidate.id === current.toZoneId);
    if (!zone) return;
    if (key === "ArrowLeft" || key === "ArrowUp" || key === "ArrowRight" || key === "ArrowDown") {
      const delta = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
      const cohort = readActiveSnapshot(active)?.cardIds ?? [active.cardId];
      const count = zone.cardIds?.filter((id) => !cohort.includes(id)).length ?? 0;
      updateKeyboardDestination(active, { toZoneId: zone.id, index: Math.max(0, Math.min(count, current.index + delta)) });
      return;
    }
    if (key !== "Tab") return;
    const index = zones.findIndex((candidate) => candidate.id === current.toZoneId);
    if (index < 0 || zones.length < 2) return;
    const nextIndex = (index + (eventShiftKey ? -1 : 1) + zones.length) % zones.length;
    const next = zones[nextIndex];
    updateKeyboardDestination(active, { toZoneId: next.id, index: 0 });
  }

  let eventShiftKey = false;

  function keyDown(event) {
    if (destroyed) return;
    const shell = cardShellFrom(event.target);
    const cardId = cardIdFrom(shell);
    if (shell && isInteractiveTarget(event.target, shell)) return;
    if (!shell && event.target !== element) return;
    if (event.key === "Escape") {
      if (press) { press = null; pointerIds.clear(); event.preventDefault?.(); return; }
      if (active) { event.preventDefault?.(); cancelSession("Escape"); }
      else { event.preventDefault?.(); selectCards([], { mode: "replace" }); }
      return;
    }
    if (active?.mode === "keyboard" && !active.released) {
      if (!navigationKeys.has(event.key)) return;
      event.preventDefault?.();
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar" || event.key === "Space") releaseSession(active);
      else {
        eventShiftKey = Boolean(event.shiftKey);
        keyboardMove(event.key);
        eventShiftKey = false;
      }
      return;
    }
    if (active && !active.released) return;
    const modifier = event.ctrlKey || event.metaKey;
    const space = [" ", "Spacebar", "Space"].includes(event.key);
    // Card shells are buttons, so Space and Enter belong to activation/pickup.
    // A plain S key has no platform shortcut conflict and is reserved here for
    // toggling the focused card's selection.
    if (!modifier && !event.shiftKey && event.key.toLowerCase() === "s" && cardId) {
      event.preventDefault?.();
      if (!event.repeat) selectCards([cardId], { mode: "toggle" });
      return;
    }
    if (selectionContext && modifier && event.key.toLowerCase() === "a") {
      event.preventDefault?.();
      selectCards(selectionContext(cardId).eligibleCardIds, { mode: "replace" });
      return;
    }
    if (selectionContext && cardId && ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) {
      const ids = selectionContext(cardId).navigationCardIds;
      const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      const index = ids.indexOf(cardId);
      const target = ids[index < 0 ? (delta > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, index + delta))];
      if (!target) return;
      event.preventDefault?.();
      if (event.shiftKey) {
        const anchorCardId = selectedState().anchorCardId ?? cardId;
        selectCards([target], { mode: "range", primaryCardId: target, anchorCardId });
      }
      focusShell(shellForCard(element, target));
      return;
    }
    if (event.key !== " " && event.key !== "Spacebar" && event.key !== "Space" || event.repeat) return;
    if (!shell || !cardId || isInteractiveTarget(event.target, shell)) return;
    event.preventDefault?.();
    if (active?.released) cancelSession("Superseded by another keyboard pickup");
    if (!startSession(shell, cardId, null, "keyboard")) return;
    updateKeyboardDestination(active, sourceDestination(scene, cardId, readActiveSnapshot(active)?.cardIds));
  }

  function onViewportChange() {
    if (!active || active.released) return;
    reproject(active);
    scheduleFrame();
  }

  function onInteractionChange(detail) {
    if (!active) return;
    const sessions = detail?.sessions ?? detail?.interaction?.sessions ?? scene.snapshot?.().interaction?.sessions ?? [];
    const current = sessions.find((session) => session.id === active.session.snapshot?.().id);
    if (current) announceSession(active, current);
    const snapshot = readActiveSnapshot(active);
    if (!current && snapshot && terminalPhases.has(snapshot.phase)) finishIfTerminal(active, snapshot);
  }

  listen(element, "pointerdown", pointerDown);
  listen(element, "pointermove", pointerMove, { passive: false });
  listen(element, "pointerup", pointerUp, { passive: false });
  listen(element, "pointercancel", pointerCancel);
  listen(element, "lostpointercapture", lostPointerCapture);
  listen(element, "keydown", keyDown);
  listen(element, "click", click, true);
  listen(view ?? doc, "pointerdown", outsidePointerDown, true);
  listen(element, "scroll", onViewportChange, true);
  listen(view, "scroll", onViewportChange, true);
  listen(view, "resize", onViewportChange);
  const unsubscribe = scene.on?.("interaction-change", onInteractionChange);
  const unsubscribeSelection = scene.on?.("selection-change", (selection) => {
    const count = selection.cardIds.length;
    announce(`${count} ${count === 1 ? "card" : "cards"} selected${selection.primaryCardId ? `. Primary ${selection.primaryCardId}` : ""}.`);
  });

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelFrame();
      if (active) {
        try { active.session.cancel?.("Input adapter destroyed"); } catch { /* scene may already be destroyed */ }
        cleanup(active, { restoreFocus: false });
      }
      press = null;
      pointerIds.clear();
      unsubscribe?.();
      unsubscribeSelection?.();
      for (const remove of listeners.splice(0)) remove();
      if (element.style) {
        if (originalTouchAction) element.style.touchAction = originalTouchAction;
        else if (element.style.removeProperty) element.style.removeProperty("touch-action");
        else delete element.style.touchAction;
      }
      liveRegion?.remove?.();
      liveRegion = null;
    },
  };
}
