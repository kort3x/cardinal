import { measureFlowElement } from "../layout.js";

const DEFAULT_LAYOUT = Object.freeze({
  mode: "overlay",
  anchor: "card",
  missingAnchor: "hide",
  x: 0,
  y: 0,
  width: 0.5,
  height: 0.2,
  offsetX: 0,
  offsetY: 0,
  clip: true,
  zIndex: 0,
});

function entries(content) {
  return (content?.elements ?? []).map((element, index) => ({ element, index }));
}

function visible(element) {
  return element?.visible !== false;
}

export function attachmentEntries(content) {
  return (content?.elements ?? [])
    .filter((element) => element?.source === "attachment" && element.visible !== false)
    .map((element) => ({ attachment: element, element }));
}

export function normalizeAttachmentLayout(layout = {}) {
  const result = { ...DEFAULT_LAYOUT, ...(layout ?? {}) };
  if (result.mode !== "overlay" && result.mode !== "flow") throw new TypeError("Attachment layout mode must be overlay or flow");
  if (result.missingAnchor !== "hide" && result.missingAnchor !== "card") throw new TypeError("Attachment missingAnchor must be hide or card");
  for (const name of ["x", "y", "width", "height", "offsetX", "offsetY", "zIndex"]) {
    if (!Number.isFinite(result[name])) throw new TypeError(`Attachment layout ${name} must be finite`);
  }
  if (result.width < 0 || result.height < 0) throw new RangeError("Attachment layout width and height must be non-negative");
  return result;
}

function measurement(element, dimensions, elementRenderers = {}, measure = null) {
  const width = Math.max(1, dimensions.width - 36);
  return measureFlowElement(element, width, dimensions, elementRenderers, measure);
}

/**
 * Resolve element boxes in card-local top-left coordinates. The renderer and
 * accessibility layer use this result so anchors never fall back to an old
 * screen rectangle.
 */
export function resolveAttachmentGeometry(content, dimensions, elementRenderers = {}, measure = null, presentation = null,
  { preserveBottom = false, deferFlowIds = [], gapIndex = null } = {}) {
  const inner = 18;
  const innerWidth = Math.max(1, dimensions.width - inner * 2);
  const boxes = new Map();
  let cursor = inner;
  const ordered = entries(content)
    .filter(({ element }) => (!presentation?.elements || presentation.elements.includes(element.id))
      && (visible(element) || element.visibilityMode === "preserve-space"))
    .sort((a, b) => (a.element.layout?.order ?? a.index) - (b.element.layout?.order ?? b.index) || a.index - b.index);
  const flow = ordered.filter(({ element }) => (element.layout?.mode ?? "flow") === "flow" && !deferFlowIds.includes(element.id));
  const heights = flow.map(({ element }) => measurement(element, dimensions, elementRenderers, measure));
  const requiredHeight = inner + heights.reduce((sum, height) => sum + height + 10, 0) + 8;
  const gap = preserveBottom && Number.isInteger(gapIndex) && gapIndex >= 0 && gapIndex <= flow.length
    ? Math.max(0, dimensions.height - requiredHeight) : 0;
  for (const [index, { element }] of flow.entries()) {
    const height = heights[index];
    if (index === gapIndex) cursor += gap;
    boxes.set(element.id, { x: inner, y: cursor, width: innerWidth, height, mode: "flow", element });
    cursor += height + 10;
  }
  const elementById = new Map(ordered.map(({ element }) => [element.id, element]));
  const resolving = new Set();
  const resolveOverlay = (element) => {
    if (!element) return null;
    if (boxes.has(element.id)) return boxes.get(element.id);
    if (resolving.has(element.id)) return null;
    const layout = normalizeAttachmentLayout(element.layout);
    const mode = element.source === "attachment" ? layout.mode : element.layout?.mode;
    if (mode !== "overlay" || !visible(element)) return null;
    resolving.add(element.id);
    const anchor = layout.anchor === "card" ? null
      : boxes.get(layout.anchor) ?? resolveOverlay(elementById.get(layout.anchor));
    resolving.delete(element.id);
    if (layout.anchor !== "card" && !anchor && layout.missingAnchor === "hide") return null;
    const base = anchor ?? { x: 0, y: 0, width: dimensions.width, height: dimensions.height };
    const box = {
      x: base.x + layout.x * base.width + layout.offsetX,
      y: base.y + layout.y * base.height + layout.offsetY,
      width: layout.width * base.width,
      height: layout.height * base.height,
      mode: "overlay",
      clip: layout.clip !== false,
      zIndex: layout.zIndex,
      element,
    };
    boxes.set(element.id, box);
    return box;
  };
  for (const { element } of ordered) resolveOverlay(element);
  return boxes;
}

export function attachmentControlKey(cardId, attachmentId, controlId) {
  return JSON.stringify([cardId, attachmentId, controlId]);
}

export function reconcileAttachmentControls({ shell, layer, card, content, accessibleLabel, onAction, canActivate, focusFallback = shell, visible = true, positionFor } = {}) {
  if (!shell) return;
  const host = layer ?? shell;
  const escapedCardId = globalThis.CSS?.escape?.(card.id) ?? String(card.id).replaceAll('"', '\\"');
  let container = host.querySelector?.(`.cardinal-webgl-attachment-controls[data-card-id="${escapedCardId}"]`);
  const attachmentElements = (content?.elements ?? []).filter((element) => element?.source === "attachment");
  if (attachmentElements.length === 0) {
    if (container) {
      if (typeof document !== "undefined" && container.contains?.(document.activeElement)) focusFallback?.focus?.();
      container.remove();
    }
    return;
  }
  if (!container && typeof document !== "undefined") {
    container = document.createElement("div");
    container.className = "cardinal-webgl-attachment-controls";
    container.dataset.cardId = card.id;
    host.append(container);
  }
  if (!container) return;
  const wanted = new Map();
  for (const { attachment } of attachmentEntries(content)) {
    for (const [controlIndex, control] of (attachment.controls ?? []).entries()) {
      if (!control || typeof control.id !== "string" || typeof control.label !== "string") continue;
      wanted.set(attachmentControlKey(card.id, attachment.id, control.id), { attachment, control, controlIndex });
    }
  }
  const existing = new Map([...container.children].map((node) => [node.dataset.attachmentControlKey, node]));
  for (const [key, { attachment, control, controlIndex }] of wanted) {
    let button = existing.get(key);
    if (!button && typeof document !== "undefined") {
      button = document.createElement("button");
      button.type = "button";
      button.dataset.attachmentControlKey = key;
      button.addEventListener("click", (event) => {
        const action = button.__cardinalAttachmentAction;
        if (!action || action.disabled || button.hidden || container.hidden || (action.canActivate && !action.canActivate(event, action.attachment))) return;
        action.onAction?.({ cardId: action.cardId, attachmentId: action.attachment.id, controlId: action.control.id });
      });
      container.append(button);
    }
    if (!button) continue;
    button.textContent = control.label;
    button.disabled = control.disabled === true;
    button.dataset.attachmentId = attachment.id;
    button.dataset.controlId = control.id;
    button.__cardinalAttachmentAction = { cardId: card.id, attachment, control, disabled: control.disabled === true, canActivate, onAction };
    button.setAttribute("aria-label", control.label);
    const description = accessibleLabel?.({ element: attachment });
    if (description) button.setAttribute("aria-description", description);
    else button.removeAttribute?.("aria-description");
    const position = positionFor?.(attachment);
    button.hidden = Boolean(positionFor && !position);
    if (button.hidden && document.activeElement === button) focusFallback?.focus?.();
    button.style.position = position ? "absolute" : "";
    button.style.left = position ? `${position.x}px` : "";
    button.style.top = position ? `${position.y + controlIndex * 28}px` : "";
    existing.delete(key);
  }
  for (const [key, node] of existing) {
    const wasFocused = typeof document !== "undefined" && document.activeElement === node;
    node.remove();
    if (wasFocused) focusFallback?.focus?.();
  }
  const concealed = !visible || shell.hidden || shell.getAttribute?.("aria-hidden") === "true";
  if (concealed && typeof document !== "undefined" && container.contains?.(document.activeElement)) focusFallback?.focus?.();
  container.hidden = wanted.size === 0 || concealed;
  container.style.transform = "none";
}
