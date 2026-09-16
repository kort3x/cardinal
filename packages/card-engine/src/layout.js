import { DEFAULT_POSE } from "./model.js";

export const DEFAULT_CARD_DIMENSIONS = Object.freeze({ width: 180, height: 250 });
export const DEFAULT_CARD_THICKNESS = 6;
export const DEFAULT_CARD_LAYER_STEP = 8;
export const CARD_LAYER_GAP = 1;
export const DEFAULT_CONTENT_MIN_HEIGHT = 120;

function contentElements(content) {
  return content?.elements ?? [];
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

export function spacerHeight(element) {
  const height = element?.content?.height ?? 20;
  return Number.isFinite(height) && height >= 0 ? height : 20;
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

function elementFlowHeight(element, width, preferredHeight, elementRenderers = {}, dimensions = { width, height: preferredHeight }) {
  const renderer = elementRenderers[element.type];
  if (renderer && typeof renderer.measure === "function") {
    const measured = renderer.measure({ element, width, dimensions });
    if (!Number.isFinite(measured) || measured < 0) throw new RangeError(`Element renderer ${element.type} returned an invalid height`);
    return measured;
  }
  if (element.type === "spacer") return spacerHeight(element);
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

export function contentHeight(content, dimensions, sizing = {}, elementRenderers = {}) {
  const inner = 18;
  const width = Math.max(1, dimensions.width - inner * 2);
  let cursor = inner;
  for (const element of flowElements(content)) cursor += elementFlowHeight(element, width, dimensions.height, elementRenderers, dimensions) + 10;
  const requiredHeight = cursor + 8;
  const minHeight = sizing.minHeight ?? DEFAULT_CONTENT_MIN_HEIGHT;
  const maxHeight = sizing.maxHeight ?? Infinity;
  return Math.min(maxHeight, Math.max(minHeight, requiredHeight));
}

export function cardDimensions(card, templates = {}, elementRenderers = {}) {
  const template = templates[card.template] ?? {};
  const dimensions = {
    width: card.dimensions?.width ?? template.width ?? DEFAULT_CARD_DIMENSIONS.width,
    height: card.dimensions?.height ?? template.height ?? DEFAULT_CARD_DIMENSIONS.height,
  };
  const sizing = card.sizing ?? template.sizing;
  if (sizing?.mode === "content") dimensions.height = contentHeight(card.faces?.[card.activeFaceId], dimensions, sizing, elementRenderers);
  return dimensions;
}

export function cardThickness(card, templates = {}) {
  const template = templates[card.template] ?? {};
  return card.thickness ?? template.thickness ?? DEFAULT_CARD_THICKNESS;
}

function containedCenter(center, start, size, footprint) {
  if (footprint >= size) return start + size / 2;
  return Math.min(start + size - footprint / 2, Math.max(start + footprint / 2, center));
}

export function depthScale(camera, depth) {
  if (camera?.projection === "orthographic") return 1;
  if (camera?.depthScale) return camera.depthScale(depth);
  return 1 / (1 + Math.max(0, depth) / 1000);
}

export function solveCardPose(card, zone, index = 0, camera, templates, layerOffset = 0, elementRenderers = {}, tracks) {
  const dimensions = cardDimensions(card, templates, elementRenderers);
  const scale = card.pose?.scale ?? 1;
  const renderedWidth = dimensions.width * scale;
  const renderedHeight = dimensions.height * scale;
  const gap = zone.arrangement?.gap ?? 16;
  const trackWidth = tracks?.width ?? renderedWidth;
  const trackHeight = tracks?.height ?? renderedHeight;
  const columns = Math.max(1, Math.floor((zone.geometry.width + gap) / (trackWidth + gap)));
  const column = index % columns;
  const row = Math.floor(index / columns);
  const layoutX = zone.geometry.x + renderedWidth / 2 + column * (trackWidth + gap);
  const layoutY = zone.geometry.y + renderedHeight / 2 + row * (trackHeight + gap);
  const angle = Math.abs((card.pose?.angle ?? 0) * Math.PI / 180);
  const footprintWidth = Math.abs(renderedWidth * Math.cos(angle)) + Math.abs(renderedHeight * Math.sin(angle));
  const footprintHeight = Math.abs(renderedWidth * Math.sin(angle)) + Math.abs(renderedHeight * Math.cos(angle));
  const x = card.positionMode === "absolute"
    ? card.pose.x
    : containedCenter(layoutX, zone.geometry.x, zone.geometry.width, footprintWidth);
  const y = card.positionMode === "absolute"
    ? card.pose.y
    : containedCenter(layoutY, zone.geometry.y, zone.geometry.height, footprintHeight);

  return {
    ...DEFAULT_POSE,
    ...card.pose,
    width: dimensions.width,
    height: dimensions.height,
    thickness: cardThickness(card, templates),
    x,
    y,
    z: zone.geometry.depth + layerOffset,
    scale: card.pose?.scale ?? 1,
    visible: zone.visible !== false,
    depthScale: depthScale(camera, zone.geometry.depth),
  };
}

export function solveAllPoses(snapshot, camera, templates, elementRenderers = {}) {
  const cards = new Map(snapshot.cards.map((card) => [card.id, card]));
  const poses = new Map();
  const placedCards = [];
  let drawOrder = 0;
  for (const zone of snapshot.zones) {
    const sizes = zone.cardIds.map((id) => {
      const card = cards.get(id);
      const dimensions = cardDimensions(card, templates, elementRenderers);
      const scale = card.pose?.scale ?? 1;
      return { width: dimensions.width * scale, height: dimensions.height * scale };
    });
    const tracks = { width: Math.max(1, ...sizes.map(({ width }) => width)), height: Math.max(1, ...sizes.map(({ height }) => height)) };
    let layerOffset = 0;
    let previousDepth = null;
    zone.cardIds.forEach((cardId, index) => {
      const card = cards.get(cardId);
      const currentDepth = cardThickness(card, templates) * (card.pose?.scale ?? 1) * depthScale(camera, zone.geometry.depth);
      if (previousDepth !== null) {
        const configuredStep = zone.arrangement?.depthStep ?? DEFAULT_CARD_LAYER_STEP;
        const physicalStep = (previousDepth + currentDepth) / 2 + CARD_LAYER_GAP;
        layerOffset += Math.max(configuredStep, physicalStep);
      }
      const pose = { ...solveCardPose(card, zone, index, camera, templates, layerOffset, elementRenderers, tracks), drawOrder };
      const dimensions = cardDimensions(card, templates, elementRenderers);
      const angle = Math.abs((pose.angle * Math.PI) / 180);
      const unrotatedWidth = dimensions.width * pose.scale;
      const unrotatedHeight = dimensions.height * pose.scale;
      const footprint = {
        width: Math.abs(unrotatedWidth * Math.cos(angle)) + Math.abs(unrotatedHeight * Math.sin(angle)),
        height: Math.abs(unrotatedWidth * Math.sin(angle)) + Math.abs(unrotatedHeight * Math.cos(angle)),
      };
      const renderedDepth = cardThickness(card, templates) * pose.scale * pose.depthScale;
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
