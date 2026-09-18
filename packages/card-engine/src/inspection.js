const DEFAULT_READABLE_SCALE = 1.25;
const DEFAULT_LIFT = 24;
const VIEWPORT_GUTTER = 12;
let nextManagerId = 0;

const concealedFallback = Object.freeze({
  elements: [{ id: "concealed", type: "text", content: { text: "Concealed card" } }],
});

function copy(value, seen = new WeakMap()) {
  if (value === null || typeof value !== "object") return typeof value === "function" ? undefined : value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof Map) {
    const result = {};
    seen.set(value, result);
    for (const [key, entry] of value) result[String(key)] = copy(entry, seen);
    return result;
  }
  if (value instanceof Set) return [...value].map((entry) => copy(entry, seen));
  if (Array.isArray(value)) {
    const result = [];
    seen.set(value, result);
    for (const entry of value) result.push(copy(entry, seen));
    return result;
  }
  const result = {};
  seen.set(value, result);
  for (const [key, entry] of Object.entries(value)) {
    const next = copy(entry, seen);
    if (next !== undefined) result[key] = next;
  }
  return result;
}

function finite(value) {
  return Number.isFinite(value);
}

function allowed(result, fallback = true) {
  if (result === undefined) return fallback;
  return result === true || result?.allowed === true;
}

function ownerDocument(element) {
  return element?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
}

function ownerWindow(element, doc) {
  return doc?.defaultView ?? element?.ownerDocument?.defaultView
    ?? (typeof window !== "undefined" ? window : null);
}

function visualEntries(visual) {
  if (visual instanceof Map) return [...visual.entries()];
  if (Array.isArray(visual)) {
    return visual.map((entry) => [entry?.cardId ?? entry?.id, entry?.pose ?? entry]).filter(([id]) => id);
  }
  if (visual && typeof visual === "object") return Object.entries(visual);
  return [];
}

function stateParts(state) {
  const current = state?.() ?? {};
  const desired = current.desired ?? current;
  const cards = Array.isArray(desired?.cards) ? desired.cards : [];
  const zones = Array.isArray(desired?.zones) ? desired.zones : [];
  return {
    desired,
    cards,
    cardMap: new Map(cards.map((card) => [card?.id, card])),
    zones,
    visual: new Map(visualEntries(current.visual)),
  };
}

function cardZone(parts, cardId) {
  return parts.zones.find((zone) => Array.isArray(zone?.cardIds) && zone.cardIds.includes(cardId)) ?? null;
}

function cardVisible(parts, cardId, card) {
  const pose = parts.visual.get(cardId);
  const zone = cardZone(parts, cardId);
  return card?.visible !== false && card?.hidden !== true
    && zone?.visible !== false && pose?.visible !== false;
}

function contentFace(card, faceId) {
  return card?.faces?.[faceId] ?? null;
}

function faceCopy(face) {
  return copy(face ?? concealedFallback);
}

function callbackResult(callback, request, fallback = true) {
  if (typeof callback !== "function") return fallback;
  try {
    return allowed(callback(copy(request)), false);
  } catch {
    return false;
  }
}

function viewport(element, view) {
  const width = Number.isFinite(view?.innerWidth) && view.innerWidth > 0
    ? view.innerWidth : Number(element?.clientWidth) || 0;
  const height = Number.isFinite(view?.innerHeight) && view.innerHeight > 0
    ? view.innerHeight : Number(element?.clientHeight) || 0;
  return { width, height };
}

function pointFrom(origin, pose) {
  const source = origin?.point ?? origin;
  if (source && finite(source.x) && finite(source.y)) {
    return { x: source.x, y: source.y, z: finite(source.z) ? source.z : 0 };
  }
  if (pose && finite(pose.x) && finite(pose.y)) {
    return { x: pose.x, y: pose.y, z: finite(pose.z) ? pose.z : 0 };
  }
  return null;
}

function clientPoint(toClient, point) {
  if (!point) return null;
  try {
    const client = typeof toClient === "function" ? toClient(point) : point;
    return client && finite(client.x) && finite(client.y) ? { x: client.x, y: client.y } : null;
  } catch {
    return null;
  }
}

function elementNode(doc, tag, className) {
  if (!doc?.createElement) return null;
  const node = doc.createElement(tag);
  if (className) node.className = className;
  return node;
}

function addListener(target, type, listener, options, removers) {
  if (!target?.addEventListener) return;
  target.addEventListener(type, listener, options);
  removers.push(() => target.removeEventListener?.(type, listener, options));
}

function focusable(panel) {
  if (!panel?.querySelectorAll) return [];
  return [...panel.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")]
    .filter((node) => !node.disabled && node.hidden !== true);
}

function setText(node, value) {
  if (node) node.textContent = value == null ? "" : String(value);
}

function elementText(element) {
  const content = element?.content;
  if (typeof content === "string") return content;
  return content?.text ?? content?.value ?? content?.label ?? element?.label ?? "";
}

function renderFace(body, face) {
  if (!body) return;
  const doc = body.ownerDocument;
  body.replaceChildren?.();
  const background = face?.backgroundImage;
  if (background?.src && body.style) {
    body.style.backgroundImage = `url(${JSON.stringify(background.src)})`;
    body.style.backgroundSize = background.fit === "contain" ? "contain" : background.fit === "stretch" ? "100% 100%" : "cover";
  } else if (body.style) {
    body.style.backgroundImage = "";
  }
  const elements = Array.isArray(face?.elements) ? [...face.elements]
    .sort((first, second) => (first.layout?.order ?? 0) - (second.layout?.order ?? 0)) : [];
  for (const item of elements) {
    if (item?.visible === false) continue;
    let node;
    if (item.type === "image") {
      node = elementNode(doc, "img", "cardinal-inspection__image");
      if (node) {
        node.alt = item.content?.alt ?? "";
        if (item.content?.src) node.src = item.content.src;
      }
    } else if (item.type === "spacer") {
      node = elementNode(doc, "div", "cardinal-inspection__spacer");
      if (node?.style) node.style.height = `${Number(item.content?.height) || 20}px`;
      node?.setAttribute?.("aria-hidden", "true");
    } else {
      node = elementNode(doc, "p", "cardinal-inspection__text");
      setText(node, elementText(item) || (item.type ? `[${item.type}]` : ""));
    }
    if (!node) continue;
    if (item.style?.variant) node.dataset.variant = item.style.variant;
    body.append?.(node);
  }
}

function faceSignature(face) {
  return JSON.stringify(copy(face ?? concealedFallback));
}

function poseWithSize(pose, card) {
  return {
    ...(pose ?? {}),
    width: pose?.width ?? card?.dimensions?.width ?? 180,
    height: pose?.height ?? card?.dimensions?.height ?? 250,
  };
}

function clampInClientPose(pose, card, scale, lift, toClient, view) {
  const current = poseWithSize(pose, card);
  const next = { ...current, scale: (current.scale ?? 1) * scale, z: (current.z ?? 0) + lift };
  const client = clientPoint(toClient, next);
  const bounds = viewport(null, view);
  if (!client || !bounds.width || !bounds.height) return next;
  // Measure the lifted plane in client pixels: scene units and viewport pixels
  // differ with stage scaling and perspective depth.
  const xStep = clientPoint(toClient, { ...next, x: next.x + 1 });
  const yStep = clientPoint(toClient, { ...next, y: next.y + 1 });
  const a = (xStep?.x ?? client.x + 1) - client.x;
  const b = (yStep?.x ?? client.x) - client.x;
  const c = (xStep?.y ?? client.y) - client.y;
  const d = (yStep?.y ?? client.y + 1) - client.y;
  const angle = (next.angle ?? 0) * Math.PI / 180;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  const sizeScale = next.scale * (next.layoutScale ?? 1) * (next.depthScale ?? 1);
  let width = sizeScale * (Math.abs(a * cosine + b * sine) * current.width + Math.abs(b * cosine - a * sine) * current.height);
  let height = sizeScale * (Math.abs(c * cosine + d * sine) * current.width + Math.abs(d * cosine - c * sine) * current.height);
  const fit = Math.min(1, Math.max(1, bounds.width - 2 * VIEWPORT_GUTTER) / Math.max(1, width), Math.max(1, bounds.height - 2 * VIEWPORT_GUTTER) / Math.max(1, height));
  next.scale *= fit;
  width *= fit; height *= fit;
  const target = {
    x: Math.min(bounds.width - VIEWPORT_GUTTER - width / 2, Math.max(VIEWPORT_GUTTER + width / 2, client.x)),
    y: Math.min(bounds.height - VIEWPORT_GUTTER - height / 2, Math.max(VIEWPORT_GUTTER + height / 2, client.y)),
  };
  const deltaX = target.x - client.x, deltaY = target.y - client.y;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) > 0.0001) {
    next.x += (deltaX * d - b * deltaY) / determinant;
    next.y += (a * deltaY - deltaX * c) / determinant;
  }
  return next;
}

export function createInspection({ element, state, onChange, toClient, rules = {}, options = {} } = {}) {
  if (typeof state !== "function") throw new TypeError("createInspection requires a state function");
  if (typeof onChange !== "undefined" && typeof onChange !== "function") throw new TypeError("Inspection onChange must be a function");

  const doc = ownerDocument(element);
  const view = ownerWindow(element, doc);
  const sessions = new Map();
  const inPlace = new Map();
  const removers = [];
  let sequence = 0;
  const managerId = ++nextManagerId;
  let destroyed = false;
  let lastModal = null;

  const readableScale = Number.isFinite(options.readableScale)
    ? Math.max(0.1, options.readableScale) : DEFAULT_READABLE_SCALE;
  const defaultModal = options.modal === true;
  const defaultLift = Number.isFinite(options.lift) ? options.lift : DEFAULT_LIFT;

  function emit(type, session, reason) {
    if (typeof onChange !== "function") return;
    try {
      onChange(snapshot(), { type, reason, session: session?.snapshot?.() ?? null });
    } catch {
      // An observer cannot break state reconciliation or dismissal.
    }
  }

  function cardRequest(session, card, mode = session.mode) {
    return {
      cardId: card.id,
      faceUp: card.faceUp !== false,
      card: copy(card),
      mode,
      modal: session.modal,
      origin: copy(session.origin),
    };
  }

  function allowedToInspect(session, card, mode = session.mode) {
    return callbackResult(rules.canInspect, cardRequest(session, card, mode), true);
  }

  function allowedToInspectConcealed(session, card, mode = session.mode) {
    return callbackResult(rules.canInspectConcealed, cardRequest(session, card, mode), false);
  }

  function descriptorFor(session, card, parts) {
    const faceUp = card.faceUp !== false;
    const canShowContent = faceUp || allowedToInspectConcealed(session, card);
    const contentFaceId = canShowContent ? card.activeFaceId : "back";
    const content = canShowContent ? contentFace(card, card.activeFaceId) : card.back ?? concealedFallback;
    const relatedCardIds = session.relatedCardIds.filter((cardId) => {
      const related = parts.cardMap.get(cardId);
      return Boolean(related && cardVisible(parts, cardId, related) && allowedToInspect(session, related));
    });
    return {
      id: session.id,
      cardId: card.id,
      mode: session.mode,
      modal: session.modal,
      faceUp,
      ...(canShowContent ? { activeFaceId: card.activeFaceId } : {}),
      contentFaceId,
      concealedContentAllowed: canShowContent && !faceUp,
      content: faceCopy(content),
      relatedCardIds,
      origin: copy(session.origin),
      visible: cardVisible(parts, card.id, card),
      closed: session.closed,
    };
  }

  function permissionState(session, card, parts) {
    if (!card || !cardVisible(parts, card.id, card)) return { ok: false, reason: "removed-or-hidden" };
    if (!allowedToInspect(session, card)) return { ok: false, reason: "permission-revoked" };
    const previous = session.descriptor?.concealedContentAllowed === true;
    const current = card.faceUp !== false || allowedToInspectConcealed(session, card);
    if (previous && !current) return { ok: false, reason: "permission-revoked" };
    return { ok: true, canShowContent: current };
  }

  function panelFor(session) {
    if (!session.view) return null;
    return session.view.panel;
  }

  function renderRelated(session) {
    const related = session.view?.related;
    if (!related) return;
    related.replaceChildren?.();
    const parts = stateParts(state);
    const cardIds = session.relatedCardIds.filter((cardId) => {
      const card = parts.cardMap.get(cardId);
      return Boolean(card && cardVisible(parts, cardId, card) && allowedToInspect(session, card));
    });
    for (const cardId of cardIds) {
      if (cardId === session.cardId) continue;
      const button = elementNode(doc, "button", "cardinal-inspection__related");
      if (!button) continue;
      button.type = "button";
      button.dataset.relatedCardId = cardId;
      button.setAttribute?.("aria-label", `Inspect related card ${cardId}`);
      setText(button, `Related card ${cardId}`);
      button.addEventListener?.("click", (event) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        session.navigate(cardId);
      });
      related.append?.(button);
    }
  }

  function renderPanel(session) {
    const panel = panelFor(session);
    if (!panel) return;
    const descriptor = session.descriptor;
    panel.dataset.sourceCardId = descriptor.cardId;
    const heading = session.view.heading;
    setText(heading, `Card ${descriptor.cardId}`);
    session.view.body.setAttribute?.("aria-label", `Content for card ${descriptor.cardId}`);
    renderFace(session.view.body, descriptor.content);
    renderRelated(session);
    session.contentKey = JSON.stringify([descriptor.contentFaceId, descriptor.content]);
  }

  function buildView(session) {
    if (!doc?.createElement || !element?.append) return;
    const root = elementNode(doc, "section", "cardinal-inspection");
    const panel = elementNode(doc, "article", "cardinal-inspection__panel");
    if (!root || !panel) return;
    root.dataset.viewId = session.id;
    root.dataset.sourceCardId = session.cardId;
    root.setAttribute("aria-readonly", "true");
    root.classList?.toggle?.("cardinal-inspection--modal", session.modal);
    panel.setAttribute("role", session.modal ? "dialog" : "complementary");
    if (session.modal) panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-readonly", "true");
    panel.tabIndex = -1;
    const heading = elementNode(doc, "h2", "cardinal-inspection__heading");
    const close = elementNode(doc, "button", "cardinal-inspection__close");
    const body = elementNode(doc, "div", "cardinal-inspection__body");
    const related = elementNode(doc, "nav", "cardinal-inspection__related-list");
    if (!heading || !close || !body || !related) return;
    close.type = "button";
    close.setAttribute("aria-label", "Close inspection");
    setText(close, "Close");
    related.setAttribute("aria-label", "Related cards");
    panel.append(heading, close, body, related);
    root.append(panel);
    (doc.body ?? element).append(root);
    session.view = { root, panel, heading, close, body, related };
    close.addEventListener?.("click", (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      session.close("dismissed");
    });
    root.addEventListener?.("click", (event) => {
      if (session.modal && event.target === root) session.close("dismissed");
      else event.stopPropagation?.();
    });
  }

  function position(session, parts) {
    const root = session.view?.root;
    const panel = session.view?.panel;
    if (!root || !panel) return;
    if (session.modal) {
      root.style.left = "";
      root.style.top = "";
      return;
    }
    const pose = parts.visual.get(session.cardId);
    const source = pointFrom(session.origin, pose);
    const client = clientPoint(toClient, source);
    const bounds = viewport(element, view);
    const measured = panel.getBoundingClientRect?.();
    const width = Math.max(1, measured?.width || 420);
    const height = Math.max(1, measured?.height || 320);
    const x = client?.x ?? bounds.width / 2;
    const y = client?.y ?? bounds.height / 2;
    const left = Math.min(Math.max(VIEWPORT_GUTTER, x + 16), Math.max(VIEWPORT_GUTTER, bounds.width - width - VIEWPORT_GUTTER));
    const top = Math.min(Math.max(VIEWPORT_GUTTER, y + 16), Math.max(VIEWPORT_GUTTER, bounds.height - height - VIEWPORT_GUTTER));
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.setProperty?.("--inspection-scale", String(session.scale));
    root.style.maxWidth = `calc(100vw - ${VIEWPORT_GUTTER * 2}px)`;
    root.style.maxHeight = `calc(100vh - ${VIEWPORT_GUTTER * 2}px)`;
  }

  function validFocus(target) {
    return Boolean(target && target !== doc?.body && target.isConnected !== false
      && (!doc?.contains || doc.contains(target)));
  }

  function restoreFocus(session) {
    if (!session.modal || !validFocus(session.previousFocus)) return;
    try { session.previousFocus.focus?.({ preventScroll: true }); } catch { session.previousFocus.focus?.(); }
  }

  function closeSession(session, reason = "dismissed", notify = true) {
    if (!session || session.closed) return false;
    session.closed = true;
    sessions.delete(session.id);
    if (inPlace.get(session.cardId) === session) inPlace.delete(session.cardId);
    if (lastModal === session) lastModal = [...sessions.values()].reverse().find((entry) => entry.modal) ?? null;
    session.view?.root?.remove?.();
    session.descriptor = { ...(session.descriptor ?? {}), closed: true };
    restoreFocus(session);
    if (notify) emit("close", session, reason);
    return true;
  }

  function navigateSession(session, nextCardId) {
    if (session.closed) throw new Error("Inspection is closed");
    const current = stateParts(state);
    const nextCard = assertTarget(session, nextCardId, current);
    const previousCardId = session.cardId;
    session.cardId = nextCard.id;
    if (inPlace.get(previousCardId) === session) inPlace.delete(previousCardId);
    if (session.mode === "inPlace") inPlace.set(session.cardId, session);
    refresh(session, current);
    if (session.view) {
      session.view.root.dataset.sourceCardId = session.cardId;
      session.view.panel.dataset.sourceCardId = session.cardId;
      if (session.modal) session.view.panel.focus?.({ preventScroll: true });
    }
    emit("navigate", session);
    return copy(session.descriptor);
  }

  function refresh(session, parts, { notify = true } = {}) {
    if (session.closed) return false;
    const card = parts.cardMap.get(session.cardId);
    const permission = permissionState(session, card, parts);
    if (!permission.ok) {
      closeSession(session, permission.reason, notify);
      return false;
    }
    const next = descriptorFor(session, card, parts);
    const changed = JSON.stringify(next) !== JSON.stringify(session.descriptor);
    const contentChanged = !session.descriptor || faceSignature(next.content) !== faceSignature(session.descriptor.content)
      || next.contentFaceId !== session.descriptor.contentFaceId;
    const relatedChanged = JSON.stringify(next.relatedCardIds) !== JSON.stringify(session.descriptor?.relatedCardIds);
    session.descriptor = next;
    if (session.view && (contentChanged || !session.contentKey)) renderPanel(session);
    else if (session.view && relatedChanged) renderRelated(session);
    if (session.view) position(session, parts);
    if (changed && notify) emit("update", session);
    return changed;
  }

  function assertTarget(session, cardId, parts) {
    if (!session.relatedCardIds.includes(cardId)) throw new Error(`Card ${cardId} is not a related inspection target`);
    const card = parts.cardMap.get(cardId);
    if (!card) throw new Error(`Unknown card: ${cardId}`);
    if (!cardVisible(parts, cardId, card)) throw new Error(`Cannot inspect hidden card: ${cardId}`);
    if (!allowedToInspect(session, card)) throw new Error(`Inspection is not permitted for card: ${cardId}`);
    return card;
  }

  function open(cardId, request = {}) {
    if (destroyed) throw new Error("Inspection is destroyed");
    if (typeof cardId !== "string" || !cardId) throw new TypeError("Inspection cardId must be a non-empty string");
    if (request.mode !== undefined && request.mode !== "preview" && request.mode !== "inPlace") {
      throw new TypeError(`Unknown inspection mode: ${request.mode}`);
    }
    const parts = stateParts(state);
    const card = parts.cardMap.get(cardId);
    if (!card) throw new Error(`Unknown card: ${cardId}`);
    if (!cardVisible(parts, cardId, card)) throw new Error(`Cannot inspect hidden card: ${cardId}`);
    const mode = request.mode ?? options.mode ?? "preview";
    const modal = request.modal ?? defaultModal;
    const relatedCardIds = [...new Set((request.relatedCardIds ?? []).filter((id) => typeof id === "string"))];
    const session = {
      id: `inspection-${managerId}-${++sequence}`,
      cardId,
      mode,
      modal: Boolean(modal),
      relatedCardIds,
      origin: copy(request.origin ?? options.origin ?? null),
      scale: Number.isFinite(request.scale) ? Math.max(0.1, request.scale)
        : (request.scale === "readable" || options.scale === "readable"
          ? readableScale : Number.isFinite(options.scale) ? Math.max(0.1, options.scale) : readableScale),
      lift: Number.isFinite(request.lift) ? request.lift : defaultLift,
      previousFocus: modal ? doc?.activeElement : null,
      descriptor: null,
      contentKey: null,
      view: null,
      closed: false,
    };
    session.close = (reason) => closeSession(session, reason);
    session.navigate = (nextCardId) => navigateSession(session, nextCardId);
    if (!allowedToInspect(session, card)) throw new Error(`Inspection is not permitted for card: ${cardId}`);
    sessions.set(session.id, session);
    if (mode === "inPlace") inPlace.set(cardId, session);
    else buildView(session);
    refresh(session, parts, { notify: false });
    if (session.modal) {
      lastModal = session;
      session.view?.panel?.focus?.({ preventScroll: true });
    }
    emit("open", session);
    const handle = {
      id: session.id,
      close: (reason) => closeSession(session, reason),
      snapshot: () => copy(session.descriptor ?? { id: session.id, closed: session.closed }),
      navigate: (nextCardId) => session.navigate(nextCardId),
    };
    return handle;
  }

  function snapshot() {
    return { sessions: [...sessions.values()].filter((session) => !session.closed).map((session) => copy(session.descriptor)) };
  }

  function reconcile() {
    if (destroyed || !sessions.size) return snapshot();
    const parts = stateParts(state);
    for (const session of [...sessions.values()]) refresh(session, parts);
    return snapshot();
  }

  function decorate(card, pose) {
    if (!card || typeof card.id !== "string") return { card, pose };
    const session = inPlace.get(card.id);
    if (!session || session.closed) return { card, pose };
    const parts = stateParts(state);
    if (!refresh(session, parts, { notify: false })) {
      if (session.closed) return { card, pose };
    }
    const source = parts.cardMap.get(card.id) ?? card;
    const decoratedCard = copy(source);
    if (session.descriptor?.concealedContentAllowed) decoratedCard.faceUp = true;
    let decoratedPose = clampInClientPose(pose, decoratedCard, session.scale, session.lift, toClient, view);
    if (session.descriptor?.concealedContentAllowed) {
      decoratedPose = { ...decoratedPose, flipX: 0, flipY: 0, spinX: 0, spinY: 0 };
    }
    const drawOrder = Math.max(-1, ...[...parts.visual.values()]
      .map((entry) => Number(entry?.drawOrder)).filter(Number.isFinite)) + 1;
    decoratedPose = { ...decoratedPose, drawOrder };
    return { card: decoratedCard, pose: decoratedPose };
  }

  function onKeyDown(event) {
    const latest = [...sessions.values()].reverse().find((session) => !session.closed);
    const current = event.key === "Tab"
      ? [...sessions.values()].reverse().find((session) => !session.closed && session.modal)
      : latest;
    if (!current) return;
    if (event.key === "Tab" && current.view?.panel) {
      const items = focusable(current.view.panel);
      if (items.length === 0) {
        event.preventDefault?.();
        current.view.panel.focus?.({ preventScroll: true });
        return;
      }
      const active = doc?.activeElement;
      const first = items[0];
      const last = items.at(-1);
      const leavingForward = !event.shiftKey && (active === last || !current.view.panel.contains?.(active));
      const leavingBackward = event.shiftKey && (active === first || !current.view.panel.contains?.(active));
      if (leavingForward || leavingBackward) {
        event.preventDefault?.();
        (event.shiftKey ? last : first).focus?.({ preventScroll: true });
      }
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault?.();
    event.stopPropagation?.();
    closeSession(current, "Escape");
  }

  function onFocusIn(event) {
    const current = lastModal;
    if (!current?.view?.panel || current.closed) return;
    if (current.view.panel.contains?.(event.target)) return;
    current.view.panel.focus?.({ preventScroll: true });
  }

  function onResize() {
    const parts = stateParts(state);
    for (const session of sessions.values()) if (session.view) position(session, parts);
  }

  addListener(doc, "keydown", onKeyDown, true, removers);
  addListener(doc, "focusin", onFocusIn, true, removers);
  addListener(view, "resize", onResize, false, removers);
  addListener(view, "scroll", onResize, true, removers);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const remove of removers.splice(0)) remove();
    for (const session of [...sessions.values()]) closeSession(session, "destroyed", false);
    sessions.clear();
    inPlace.clear();
    lastModal = null;
  }

  return { open, snapshot, reconcile, destroy, decorate };
}
