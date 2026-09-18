const DEFAULT_DWELL = 650;
const DEFAULT_DISMISS_DELAY = 180;
const DEFAULT_TOUCH_HOLD = 550;
const DEFAULT_MOVEMENT = 8;

function addListener(target, type, listener, options, removers) {
  if (!target?.addEventListener) return;
  target.addEventListener(type, listener, options);
  removers.push(() => target.removeEventListener?.(type, listener, options));
}

function cardShell(target) {
  if (!target) return null;
  if (typeof target.closest === "function") return target.closest("[data-card-id]");
  let node = target;
  while (node) {
    if (node.dataset?.cardId) return node;
    node = node.parentElement;
  }
  return null;
}

function cardId(target) {
  const shell = cardShell(target);
  return typeof shell?.dataset?.cardId === "string" && shell.dataset.cardId ? shell.dataset.cardId : null;
}

function nestedControl(target) {
  if (!target || typeof target.closest !== "function") return false;
  return Boolean(target.closest("button, a, input, textarea, select, option, [contenteditable='true'], [data-interaction-ignore], .cardinal-inspection"));
}

function inspectionTarget(target) {
  return typeof target?.closest === "function" ? target.closest(".cardinal-inspection") : null;
}

function distance(first, second) {
  return Math.hypot((first?.x ?? 0) - (second?.x ?? 0), (first?.y ?? 0) - (second?.y ?? 0));
}

function eventPoint(event) {
  return { x: event.clientX, y: event.clientY };
}

export function attachInspectionInput({ element, scene, options = {} } = {}) {
  if (!element || !scene || typeof scene.inspect !== "function") {
    throw new TypeError("attachInspectionInput requires an element, scene, and scene.inspect");
  }
  const dwell = Number.isFinite(options.dwell) ? Math.max(0, options.dwell) : DEFAULT_DWELL;
  const dismissDelay = Number.isFinite(options.dismissDelay) ? Math.max(0, options.dismissDelay) : DEFAULT_DISMISS_DELAY;
  const touchHold = Number.isFinite(options.touchHold) ? Math.max(0, options.touchHold) : DEFAULT_TOUCH_HOLD;
  const movement = Number.isFinite(options.movementThreshold) ? Math.max(0, options.movementThreshold) : DEFAULT_MOVEMENT;
  const mode = options.mode ?? "preview";
  const modal = options.modal === true;
  const relatedCardIds = Array.isArray(options.relatedCardIds) ? options.relatedCardIds : undefined;
  const doc = element.ownerDocument ?? (typeof document !== "undefined" ? document : null);
  const timers = new Set();
  const removers = [];
  let destroyed = false;
  let hoverId = null;
  let hoverHandle = null;
  let focusId = null;
  let focusHandle = null;
  let hoverTimer = null;
  let dismissTimer = null;
  let focusTimer = null;
  let touch = null;
  let dragging = false;
  let focusDismissTimer = null;

  function timeout(callback, delay) {
    const id = setTimeout(() => {
      timers.delete(id);
      callback();
    }, delay);
    timers.add(id);
    return id;
  }

  function cancelTimer(id) {
    if (id === null || id === undefined) return;
    clearTimeout(id);
    timers.delete(id);
  }

  function cancelHover() {
    cancelTimer(hoverTimer);
    cancelTimer(dismissTimer);
    hoverTimer = null;
    dismissTimer = null;
    hoverId = null;
    hoverHandle?.close?.("hover-dismissed");
    hoverHandle = null;
  }

  function cancelFocus() {
    cancelTimer(focusDismissTimer);
    focusDismissTimer = null;
    cancelTimer(focusTimer);
    focusTimer = null;
    focusId = null;
    focusHandle?.close?.("focus-dismissed");
    focusHandle = null;
  }

  function inspect(id, extra = {}) {
    if (destroyed || !id) return null;
    try {
      return scene.inspect(id, {
        mode,
        modal,
        ...(relatedCardIds ? { relatedCardIds } : {}),
        ...extra,
      });
    } catch {
      return null;
    }
  }

  function cancelUnderlyingPointer(state) {
    const doc = element.ownerDocument;
    try {
      const PointerEventConstructor = doc?.defaultView?.PointerEvent ?? globalThis.PointerEvent;
      if (PointerEventConstructor) {
        element.dispatchEvent(new PointerEventConstructor("pointercancel", {
          bubbles: true,
          cancelable: true,
          pointerId: state.pointerId,
          pointerType: "touch",
        }));
        return;
      }
      if (doc?.createEvent) {
        const cancel = doc.createEvent("Event");
        cancel.initEvent("pointercancel", true, true);
        Object.defineProperty(cancel, "pointerId", { value: state.pointerId });
        element.dispatchEvent(cancel);
      }
    } catch {
      // Pointer cancellation is an integration convenience; the timer still closes safely.
    }
  }

  function hit(event) {
    if (nestedControl(event.target)) return null;
    const point = eventPoint(event);
    const scenePoint = typeof scene.clientToScene === "function" ? scene.clientToScene(point) : point;
    try {
      const result = typeof scene.hitTest === "function" ? scene.hitTest(scenePoint) : null;
      return result?.cardId ?? result?.id ?? null;
    } catch {
      return null;
    }
  }

  function scheduleHover(id) {
    cancelTimer(dismissTimer);
    dismissTimer = null;
    if (id === hoverId && (hoverTimer !== null || hoverHandle)) return;
    if (hoverId !== id) cancelHover();
    hoverId = id;
    hoverTimer = timeout(() => {
      hoverTimer = null;
      if (hoverId !== id || destroyed) return;
      hoverHandle = inspect(id);
    }, dwell);
  }

  function pointerMove(event) {
    if (nestedControl(event.target)) return;
    if (touch && distance(touch.start, eventPoint(event)) > movement) {
      cancelTimer(touch.timer);
      touch.timer = null;
      touch.cancelled = true;
      return;
    }
    if (event.pointerType === "touch") return;
    if (event.buttons || dragging) { cancelHover(); return; }
    const id = hit(event);
    if (id) scheduleHover(id);
    else if (hoverHandle && dismissTimer === null) {
      dismissTimer = timeout(() => {
        dismissTimer = null;
        cancelHover();
      }, dismissDelay);
    } else if (!id) { cancelTimer(hoverTimer); hoverTimer = null; }
  }

  function pointerLeave(event) {
    if (event.relatedTarget && (element.contains?.(event.relatedTarget) || inspectionTarget(event.relatedTarget))) return;
    if (hoverHandle && dismissTimer === null) {
      dismissTimer = timeout(() => {
        dismissTimer = null;
        cancelHover();
      }, dismissDelay);
    } else if (!hoverHandle) { cancelTimer(hoverTimer); hoverTimer = null; }
  }

  function pointerDown(event) {
    if (nestedControl(event.target)) return;
    cancelHover();
    if (event.pointerType !== "touch") return;
    const id = hit(event);
    if (!id) return;
    const start = eventPoint(event);
    const state = { id, pointerId: event.pointerId, start, timer: null, cancelled: false, opened: false };
    state.timer = timeout(() => {
      state.timer = null;
      if (state.cancelled || destroyed) return;
      state.opened = true;
      cancelUnderlyingPointer(state);
      touch = state;
      state.handle = inspect(id);
      event.preventDefault?.();
    }, touchHold);
    touch = state;
  }

  function pointerUp(event) {
    if (!touch || touch.pointerId !== event.pointerId) return;
    const state = touch;
    cancelTimer(state.timer);
    touch = null;
    if (state.opened) {
      event.preventDefault?.();
      event.stopPropagation?.();
    }
  }

  function pointerCancel(event) {
    if (!touch || touch.pointerId !== event.pointerId) return;
    cancelTimer(touch.timer);
    touch = null;
  }

  function focusIn(event) {
    if (nestedControl(event.target)) return;
    const id = cardId(event.target);
    if (!id) return;
    cancelFocus();
    focusId = id;
    focusTimer = timeout(() => {
      focusTimer = null;
      if (focusId === id) focusHandle = inspect(id);
    }, dwell);
  }

  function focusOut(event) {
    if (ownsPreview(event.relatedTarget) || (event.relatedTarget && cardShell(event.relatedTarget) === cardShell(event.target))) return;
    cancelTimer(focusTimer);
    focusTimer = null;
    if (focusHandle && focusDismissTimer === null) {
      focusDismissTimer = timeout(() => cancelFocus(), dismissDelay);
    } else if (!focusHandle) focusId = null;
  }

  function keyDown(event) {
    if (nestedControl(event.target)) return;
    const id = cardId(event.target);
    if (event.key !== "i" && event.key !== "I") {
      if (event.key === "Escape" && (hoverHandle || focusHandle)) {
        event.preventDefault?.();
        hoverHandle?.close?.("Escape");
        focusHandle?.close?.("Escape");
        hoverHandle = null;
        focusHandle = null;
      }
      return;
    }
    if (!id) return;
    event.preventDefault?.();
    cancelHover();
    cancelFocus();
    focusId = id;
    focusHandle = inspect(id, { modal: options.keyboardModal === true });
  }

  function sceneChange() {
    try {
      const sessions = scene.snapshot?.().interaction?.sessions ?? [];
      dragging = sessions.some((session) => session.phase === "dragging");
      if (dragging) { cancelHover(); cancelFocus(); }
      const inspection = scene.snapshot?.().inspection;
      if (inspection) {
        if (hoverHandle && !inspection.sessions.some(({ id }) => id === hoverHandle.id)) cancelHover();
        if (focusHandle && !inspection.sessions.some(({ id }) => id === focusHandle.id)) cancelFocus();
      }
    } catch {
      // Scene snapshots are optional for the input seam.
    }
  }

  function ownsPreview(target) {
    const id = inspectionTarget(target)?.dataset.viewId;
    return Boolean(id && [hoverHandle, focusHandle, touch?.handle].some((handle) => handle?.id === id));
  }

  function documentFocus(event) {
    if (ownsPreview(event.target)) {
      cancelTimer(focusDismissTimer); focusDismissTimer = null;
      cancelTimer(dismissTimer); dismissTimer = null;
    } else if (focusHandle && !element.contains?.(event.target)) {
      cancelTimer(focusDismissTimer);
      focusDismissTimer = timeout(() => cancelFocus(), dismissDelay);
    }
  }

  function documentPointerMove(event) {
    if (!hoverHandle || event.pointerType === "touch") return;
    if (ownsPreview(event.target)) { cancelTimer(dismissTimer); dismissTimer = null; return; }
    if (element.contains?.(event.target)) return;
    if (dismissTimer === null) {
      dismissTimer = timeout(() => {
        dismissTimer = null;
        cancelHover();
      }, dismissDelay);
    }
  }

  addListener(element, "pointermove", pointerMove, { capture: true, passive: true }, removers);
  addListener(element, "pointerleave", pointerLeave, { capture: true, passive: true }, removers);
  addListener(element, "pointerdown", pointerDown, { capture: true, passive: false }, removers);
  addListener(element, "pointerup", pointerUp, { capture: true, passive: false }, removers);
  addListener(element, "pointercancel", pointerCancel, { capture: true, passive: false }, removers);
  addListener(element, "lostpointercapture", pointerCancel, { capture: true, passive: false }, removers);
  addListener(element, "focusin", focusIn, true, removers);
  addListener(element, "focusout", focusOut, true, removers);
  addListener(element, "keydown", keyDown, true, removers);
  addListener(doc, "pointermove", documentPointerMove, { capture: true, passive: true }, removers);
  addListener(doc, "focusin", documentFocus, true, removers);
  for (const eventName of ["change", "interaction-change", "inspection-change"]) {
    const unsubscribe = scene.on?.(eventName, sceneChange);
    if (typeof unsubscribe === "function") removers.push(unsubscribe);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    const activeTouch = touch;
    activeTouch && cancelTimer(activeTouch.timer);
    activeTouch?.handle?.close?.("destroyed");
    touch = null;
    cancelHover();
    cancelFocus();
    for (const remove of removers.splice(0)) remove();
  }

  return { destroy };
}
