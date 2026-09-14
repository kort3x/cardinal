import { DEFAULT_POSE } from "./model.js";

export const DEFAULT_CARD_DIMENSIONS = Object.freeze({ width: 180, height: 250 });
export const CARD_DEPTH = 6;
export const DEFAULT_CARD_LAYER_STEP = 8;
export const CARD_LAYER_GAP = 1;
export const DEFAULT_CONTENT_MIN_HEIGHT = 120;

function legacyElements(content) {
  const visibility = content?.elements && !Array.isArray(content.elements) ? content.elements : {};
  const elements = [];
  if (content?.title !== undefined) elements.push({ id: "title", type: "text", content: { text: content.title }, visible: visibility.title !== false, layout: { mode: "flow", order: 0 }, style: { variant: "title" } });
  if (content?.image !== undefined) elements.push({ id: "image", type: "image", content: { src: content.image, alt: content.imageAlt }, visible: visibility.image !== false, layout: { mode: "flow", order: 1 } });
  if (content?.flavour !== undefined) elements.push({ id: "flavour", type: "text", content: { text: content.flavour }, visible: visibility.flavour !== false, layout: { mode: "flow", order: 2 }, style: { variant: "flavour" } });
  return elements;
}

function contentElements(content) {
  return Array.isArray(content?.elements) ? content.elements : legacyElements(content);
}

function elementVisible(element) {
  return element?.visible !== false;
}

function elementReservesSpace(element) {
  return elementVisible(element) || element.visibilityMode === "preserve-space";
}

function flowElements(content) {
  return contentElements(content)
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => elementReservesSpace(element) && (element.layout?.mode ?? "flow") === "flow")
    .sort((first, second) => (first.element.layout?.order ?? first.index) - (second.element.layout?.order ?? second.index) || first.index - second.index)
    .map(({ element }) => element);
}

function textLineCount(text, width, fontSize) {
  const charactersPerLine = Math.max(1, Math.floor(width / (fontSize * 0.52)));
  return String(text ?? "").split("\n").reduce((count, paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) return count + 1;
    let lines = 1;
    let lineLength = 0;
    for (const word of words) {
      const nextLength = lineLength === 0 ? word.length : lineLength + 1 + word.length;
      if (lineLength > 0 && nextLength > charactersPerLine) {
        lines += 1;
        lineLength = word.length;
      } else {
        lineLength = nextLength;
      }
    }
    return count + lines;
  }, 0);
}

function elementFlowHeight(element, width, preferredHeight) {
  if (element.type === "image") return element.layout?.height ? preferredHeight * element.layout.height : 120;
  if (element.type === "text") {
    const style = element.style ?? {};
    const title = style.variant === "title" || element.variant === "title" || element.id === "title";
    const fontSize = title ? 18.4 : 14.4;
    const lineHeight = style.lineHeight ?? (title ? 21 : 20);
    return textLineCount(element.content?.text ?? element.content?.value ?? "", width, fontSize) * lineHeight;
  }
  return 20;
}

export function contentHeight(content, dimensions, sizing = {}) {
  const inner = 18;
  const width = Math.max(1, dimensions.width - inner * 2);
  let cursor = inner;
  for (const element of flowElements(content)) cursor += elementFlowHeight(element, width, dimensions.height) + 10;
  const requiredHeight = cursor + 8;
  const minHeight = sizing.minHeight ?? DEFAULT_CONTENT_MIN_HEIGHT;
  const maxHeight = sizing.maxHeight ?? Infinity;
  return Math.min(maxHeight, Math.max(minHeight, requiredHeight));
}

export function cardDimensions(card, templates = {}) {
  const template = templates[card.template] ?? {};
  const dimensions = {
    width: card.dimensions?.width ?? template.width ?? DEFAULT_CARD_DIMENSIONS.width,
    height: card.dimensions?.height ?? template.height ?? DEFAULT_CARD_DIMENSIONS.height,
  };
  const sizing = card.sizing ?? template.sizing;
  if (sizing?.mode === "content") dimensions.height = contentHeight(card.faces?.[card.activeFaceId], dimensions, sizing);
  return dimensions;
}

export function depthScale(camera, depth) {
  if (camera?.projection === "orthographic") return 1;
  if (camera?.depthScale) return camera.depthScale(depth);
  return 1 / (1 + Math.max(0, depth) / 1000);
}

export function solveCardPose(card, zone, index = 0, camera, templates, layerOffset = 0) {
  const dimensions = cardDimensions(card, templates);
  const gap = zone.arrangement?.gap ?? 16;
  const columns = Math.max(1, Math.floor((zone.geometry.width + gap) / (dimensions.width + gap)));
  const column = index % columns;
  const row = Math.floor(index / columns);
  const layoutX = zone.geometry.x + dimensions.width / 2 + column * (dimensions.width + gap);
  const layoutY = zone.geometry.y + dimensions.height / 2 + row * (dimensions.height + gap);
  const x = card.positionMode === "absolute" ? card.pose.x : layoutX;
  const y = card.positionMode === "absolute" ? card.pose.y : layoutY;

  return {
    ...DEFAULT_POSE,
    ...card.pose,
    width: dimensions.width,
    height: dimensions.height,
    x,
    y,
    z: zone.geometry.depth + layerOffset,
    scale: card.pose?.scale ?? 1,
    depthScale: depthScale(camera, zone.geometry.depth),
  };
}

export function solveAllPoses(snapshot, camera, templates) {
  const cards = new Map(snapshot.cards.map((card) => [card.id, card]));
  const poses = new Map();
  const placedCards = [];
  let drawOrder = 0;
  for (const zone of snapshot.zones) {
    let layerOffset = 0;
    let previousDepth = null;
    zone.cardIds.forEach((cardId, index) => {
      const card = cards.get(cardId);
      const currentDepth = CARD_DEPTH * (card.pose?.scale ?? 1) * depthScale(camera, zone.geometry.depth);
      if (previousDepth !== null) {
        const configuredStep = zone.arrangement?.depthStep ?? DEFAULT_CARD_LAYER_STEP;
        const physicalStep = (previousDepth + currentDepth) / 2 + CARD_LAYER_GAP;
        layerOffset += Math.max(configuredStep, physicalStep);
      }
      const pose = { ...solveCardPose(card, zone, index, camera, templates, layerOffset), drawOrder };
      const dimensions = cardDimensions(card, templates);
      const angle = Math.abs((pose.angle * Math.PI) / 180);
      const unrotatedWidth = dimensions.width * pose.scale;
      const unrotatedHeight = dimensions.height * pose.scale;
      const footprint = {
        width: Math.abs(unrotatedWidth * Math.cos(angle)) + Math.abs(unrotatedHeight * Math.sin(angle)),
        height: Math.abs(unrotatedWidth * Math.sin(angle)) + Math.abs(unrotatedHeight * Math.cos(angle)),
      };
      const renderedDepth = CARD_DEPTH * pose.scale * pose.depthScale;
      for (const placed of placedCards) {
        const overlaps = Math.abs(pose.x - placed.pose.x) < (footprint.width + placed.footprint.width) / 2
          && Math.abs(pose.y - placed.pose.y) < (footprint.height + placed.footprint.height) / 2;
        if (!overlaps) continue;
        const requiredZ = placed.pose.z + (placed.renderedDepth + renderedDepth) / 2 + CARD_LAYER_GAP;
        pose.z = Math.max(pose.z, requiredZ);
      }
      poses.set(cardId, pose);
      placedCards.push({ pose, footprint, renderedDepth });
      previousDepth = currentDepth;
      drawOrder += 1;
    });
  }
  return poses;
}
