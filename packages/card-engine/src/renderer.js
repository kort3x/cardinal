import { DEFAULT_CARD_THICKNESS, cardDimensions, spacerHeight } from "./layout.js";
import { attachmentContent } from "./attachments.js";

const noop = () => {};

export function filterContentElements(content = {}, presentation) {
  if (!presentation?.elements && !presentation?.visibility) return content;
  const allowed = presentation.elements ? new Set(presentation.elements) : null;
  const visibility = presentation.visibility ?? {};
  return {
    ...content,
    elements: (content.elements ?? [])
      .filter((element) => !allowed || allowed.has(element.id))
      .map((element) => element.attachmentVisibilityResolved ? element : Object.hasOwn(visibility, element.id)
        ? { ...element, visible: visibility[element.id] }
        : element),
  };
}

export function createHeadlessRenderer({ reason = "no-element" } = {}) {
  return { type: "headless", reason, mount: noop, update: noop, remove: noop, destroy: noop };
}

export function createRenderer({ element, templates = {}, elementRenderers = {}, reason = "css" } = {}) {
  if (!element || typeof document === "undefined") {
    return { type: "css", reason, mount: noop, update: noop, remove: noop, destroy: noop };
  }

  const shells = new Map();
  const contentNodes = new WeakMap();
  const measureCanvas = document.createElement("canvas");
  const measureContext = measureCanvas.getContext?.("2d") ?? null;
  element.classList.add("cardinal-stage");

  function mount(card) {
    if (shells.has(card.id)) return shells.get(card.id);
    const shell = document.createElement("article");
    shell.className = "cardinal-card";
    shell.dataset.cardId = card.id;
    shell.setAttribute("tabindex", "0");
    shell.setAttribute("role", "button");

    const travel = document.createElement("div");
    travel.className = "cardinal-card__travel";
    const body = document.createElement("div");
    body.className = "cardinal-card__body";
    const faces = document.createElement("div");
    faces.className = "cardinal-card__faces";
    const front = document.createElement("div");
    front.className = "cardinal-card__surface cardinal-card__surface--front";
    const back = document.createElement("div");
    back.className = "cardinal-card__surface cardinal-card__surface--back";
    const edge = document.createElement("div");
    edge.className = "cardinal-card__edge";
    edge.setAttribute("aria-hidden", "true");
    const edgeLayers = [];
    for (let layer = 0; layer < 9; layer += 1) {
      const edgeLayer = document.createElement("div");
      edgeLayer.className = "cardinal-card__edge-layer";
      edgeLayer.dataset.layer = String(layer);
      edge.append(edgeLayer);
      edgeLayers.push(edgeLayer);
    }
    faces.append(front, back, edge);
    body.append(faces);
    travel.append(body);
    shell.append(travel);
    element.append(shell);
    shells.set(card.id, { shell, travel, body, faces, front, back, edge, edgeLayers });
    return shells.get(card.id);
  }

  function wrapText(text, width, font) {
    if (!measureContext || !text) return text ?? "";
    measureContext.font = font;
    return String(text).split("\n").map((paragraph) => {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (words.length === 0) return "";
      const lines = [];
      let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && measureContext.measureText(candidate).width > width) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      lines.push(line);
      return lines.join("\n");
    }).join("\n");
  }

  function renderContent(target, content = {}, dimensions, presentation) {
    let nodes = contentNodes.get(target);
    if (!nodes) {
      nodes = new Map();
      contentNodes.set(target, nodes);
    }
    const filteredContent = filterContentElements(content, presentation);
    const elements = Array.isArray(filteredContent.elements) ? filteredContent.elements : [];
    const contentKey = JSON.stringify([filteredContent, dimensions.width, dimensions.height]);
    if (nodes.contentKey === contentKey) return;
    for (const [id, node] of nodes) {
      if (!elements.some((element) => element.id === id)) {
        node.removeAttribute?.("src");
        node.textContent = "";
        nodes.delete(id);
      }
    }
    const contentWidth = Math.max(1, dimensions.width - 36);
    const orderedNodes = elements.map((element) => {
      let node = nodes.get(element.id);
      if (!node) {
        node = document.createElement(element.type === "image" ? "img" : element.type === "text" ? "p" : "span");
        node.style.whiteSpace = "pre";
        nodes.set(element.id, node);
      }
      const hidden = element.visible === false;
      const preservesSpace = element.visibilityMode === "preserve-space";
      node.hidden = hidden && !preservesSpace;
      node.style.visibility = hidden ? "hidden" : "visible";
      node.style.opacity = hidden ? "0" : "1";
      node.style.transition = "opacity 160ms ease";
      node.setAttribute("aria-hidden", String(hidden));
      if (element.type === "image") {
        node.alt = element.content?.alt ?? "";
        if (element.content?.src) node.src = element.content.src;
        else node.removeAttribute("src");
      } else if (element.type === "spacer") {
        node.textContent = "";
        node.setAttribute("aria-hidden", "true");
        node.style.display = "block";
        node.style.height = `${spacerHeight(element)}px`;
      } else {
        const text = element.type === "text" ? element.content?.text ?? element.content?.value ?? "" : `Unsupported element: ${element.type}`;
        node.textContent = wrapText(text, contentWidth, element.style?.font ?? "14.4px system-ui, sans-serif");
      }
      return node;
    });
    target.replaceChildren(...orderedNodes);
    nodes.contentKey = contentKey;
  }

  function update(card, pose, options = {}) {
    const mounted = mount(card);
    const presentation = options.presentation;
    const dimensions = cardDimensions(card, templates, elementRenderers, presentation);
    const face = attachmentContent(card, card.activeFaceId, presentation) ?? {};
    const renderedScale = pose.scale * (pose.layoutScale ?? 1) * (pose.depthScale ?? 1);
    const renderedWidth = dimensions.width * renderedScale;
    const renderedHeight = dimensions.height * renderedScale;
    mounted.shell.style.width = `${renderedWidth}px`;
    mounted.shell.style.height = `${renderedHeight}px`;
    mounted.shell.style.setProperty("--card-scale", String(renderedScale));
    mounted.shell.style.setProperty("--card-depth", `${DEFAULT_CARD_THICKNESS * renderedScale}px`);
    mounted.shell.dataset.faceUp = String(card.faceUp);
    const feedback = card.feedback ?? {};
    mounted.shell.dataset.disabled = String(feedback.disabled === true);
    mounted.shell.dataset.actionable = String(feedback.actionable === true);
    mounted.shell.dataset.pending = String(feedback.pending === true);
    mounted.shell.setAttribute("aria-disabled", String(feedback.disabled === true));
    mounted.shell.setAttribute("aria-busy", String(feedback.pending === true));
    mounted.travel.style.transform = `translate3d(${pose.x - renderedWidth / 2}px, ${pose.y - renderedHeight / 2}px, ${pose.z}px)`;
    mounted.body.style.transformOrigin = `${pose.pivotX * 100}% ${pose.pivotY * 100}%`;
    mounted.body.style.transform = `rotate(${pose.angle}deg) rotateX(${pose.tiltX}deg) rotateY(${pose.tiltY}deg)`;
    const flipX = pose.flipX ?? 0;
    const flipY = pose.flipY ?? 0;
    mounted.faces.style.transform = `rotateX(${flipX}deg) rotateY(${flipY}deg)`;
    mounted.front.style.transform = "translateZ(calc(var(--card-depth) / 2))";
    mounted.back.style.transform = "rotateY(180deg) translateZ(calc(var(--card-depth) / 2))";
    mounted.front.hidden = card.faceUp === false;
    mounted.back.hidden = false;
    mounted.front.setAttribute("aria-hidden", String(card.faceUp === false));
    mounted.back.setAttribute("aria-hidden", String(card.faceUp !== false));
    updateExtrusionLayers(mounted.edgeLayers, renderedScale);
    renderContent(mounted.front, card.faceUp !== false ? face : { elements: [] }, dimensions, presentation);
    renderContent(mounted.back, attachmentContent(card, "back", presentation)
      ?? { elements: [{ id: "concealed", type: "text", content: { text: "Concealed card" } }] }, dimensions, presentation);
  }

  function updateExtrusionLayers(edgeLayers, renderedScale) {
    const depth = 6 * renderedScale;
    const spacing = depth / (edgeLayers.length + 1);
    for (const [index, element] of edgeLayers.entries()) {
      element.style.transform = `translateZ(${depth / 2 - (index + 1) * spacing}px)`;
    }
  }

  function remove(cardId) {
    const mounted = shells.get(cardId);
    if (!mounted) return;
    mounted.shell.remove();
    shells.delete(cardId);
  }

  return {
    type: "css",
    reason,
    mount,
    update,
    remove,
    destroy() {
      for (const { shell } of shells.values()) shell.remove();
      shells.clear();
      element.classList.remove("cardinal-stage");
    },
  };
}
