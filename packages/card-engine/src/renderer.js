import { DEFAULT_CARD_THICKNESS, cardDimensions, spacerHeight } from "./layout.js";

const noop = () => {};

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

  function renderContent(target, content = {}, dimensions) {
    let nodes = contentNodes.get(target);
    if (!nodes) {
      nodes = new Map();
      contentNodes.set(target, nodes);
    }
    const elements = Array.isArray(content.elements) ? content.elements : [];
    const contentKey = JSON.stringify([elements, dimensions.width, dimensions.height]);
    if (nodes.contentKey === contentKey) return;
    const contentWidth = Math.max(1, dimensions.width - 36);
    const orderedNodes = elements.map((element) => {
      let node = nodes.get(element.id);
      if (!node) {
        node = document.createElement(element.type === "image" ? "img" : element.type === "text" ? "p" : "span");
        node.style.whiteSpace = "pre";
        nodes.set(element.id, node);
      }
      node.hidden = element.visible === false;
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

  function update(card, pose) {
    const mounted = mount(card);
    const dimensions = cardDimensions(card, templates, elementRenderers);
    const face = card.faces[card.activeFaceId] ?? {};
    const renderedScale = pose.scale * (pose.depthScale ?? 1);
    const renderedWidth = dimensions.width * renderedScale;
    const renderedHeight = dimensions.height * renderedScale;
    mounted.shell.style.width = `${renderedWidth}px`;
    mounted.shell.style.height = `${renderedHeight}px`;
    mounted.shell.style.setProperty("--card-scale", String(renderedScale));
    mounted.shell.style.setProperty("--card-depth", `${DEFAULT_CARD_THICKNESS * renderedScale}px`);
    mounted.shell.dataset.faceUp = String(card.faceUp);
    mounted.travel.style.transform = `translate3d(${pose.x - renderedWidth / 2}px, ${pose.y - renderedHeight / 2}px, ${pose.z}px)`;
    mounted.body.style.transformOrigin = `${pose.pivotX * 100}% ${pose.pivotY * 100}%`;
    mounted.body.style.transform = `rotate(${pose.angle}deg) rotateX(${pose.tiltX}deg) rotateY(${pose.tiltY}deg)`;
    const flipX = pose.flipX ?? 0;
    const flipY = pose.flipY ?? 0;
    mounted.faces.style.transform = `rotateX(${flipX}deg) rotateY(${flipY}deg)`;
    mounted.front.style.transform = "translateZ(calc(var(--card-depth) / 2))";
    mounted.back.style.transform = "rotateY(180deg) translateZ(calc(var(--card-depth) / 2))";
    mounted.front.hidden = false;
    mounted.back.hidden = false;
    mounted.front.setAttribute("aria-hidden", String(!card.faceUp));
    mounted.back.setAttribute("aria-hidden", String(card.faceUp));
    updateExtrusionLayers(mounted.edgeLayers, renderedScale);
    renderContent(mounted.front, face, dimensions);
    renderContent(mounted.back, card.back ?? { elements: [{ id: "concealed", type: "text", content: { text: "Concealed card" } }] }, dimensions);
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
