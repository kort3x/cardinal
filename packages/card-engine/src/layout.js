import { DEFAULT_POSE } from "./model.js";

export const DEFAULT_CARD_DIMENSIONS = Object.freeze({ width: 180, height: 250 });
export const DEFAULT_CARD_THICKNESS = 6;
export const DEFAULT_CARD_LAYER_STEP = 8;
export const CARD_LAYER_GAP = 1;
export const DEFAULT_CONTENT_MIN_HEIGHT = 120;

function contentElements(content) {
  return content?.elements ?? [];
}

function elementIncluded(element, presentation) {
  return !presentation?.elements || presentation.elements.includes(element?.id);
}

function elementVisible(element, presentation) {
  if (!elementIncluded(element, presentation)) return false;
  if (Object.hasOwn(presentation?.visibility ?? {}, element?.id)) {
    return presentation.visibility[element.id] === true;
  }
  return element?.visible !== false;
}

function elementReservesSpace(element, presentation) {
  return elementVisible(element, presentation) || element.visibilityMode === "preserve-space";
}

function flowElements(content, presentation) {
  return contentElements(content)
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => elementReservesSpace(element, presentation) && (element.layout?.mode ?? "flow") === "flow")
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

export function contentHeight(content, dimensions, sizing = {}, elementRenderers = {}, presentation) {
  const inner = 18;
  const width = Math.max(1, dimensions.width - inner * 2);
  let cursor = inner;
  for (const element of flowElements(content, presentation)) cursor += elementFlowHeight(element, width, dimensions.height, elementRenderers, dimensions) + 10;
  const requiredHeight = cursor + 8;
  const minHeight = sizing.minHeight ?? DEFAULT_CONTENT_MIN_HEIGHT;
  const maxHeight = sizing.maxHeight ?? Infinity;
  return Math.min(maxHeight, Math.max(minHeight, requiredHeight));
}

export function cardDimensions(card, templates = {}, elementRenderers = {}, presentation) {
  const template = templates[card.template] ?? {};
  const dimensions = {
    width: card.dimensions?.width ?? template.width ?? DEFAULT_CARD_DIMENSIONS.width,
    height: card.dimensions?.height ?? template.height ?? DEFAULT_CARD_DIMENSIONS.height,
  };
  const sizing = card.sizing ?? template.sizing;
  if (sizing?.mode === "content") dimensions.height = contentHeight(card.faces?.[card.activeFaceId], dimensions, sizing, elementRenderers, presentation);
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

function arrangementOf(zone) {
  return zone.arrangement ?? { type: "grid", gap: 16 };
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function centeredPosition(alignment, start, size, footprint) {
  if (alignment === "start") return start + footprint / 2;
  if (alignment === "end") return start + size - footprint / 2;
  return start + size / 2;
}

function dimensionsFor(cards, templates, elementRenderers, zone) {
  return cards.map((card) => {
    const dimensions = cardDimensions(card, templates, elementRenderers, zone.presentation);
    const scale = zone.scale ?? card.pose?.scale ?? 1;
    return { card, dimensions, width: dimensions.width * scale, height: dimensions.height * scale };
  });
}

function layoutScaleFor(arrangement, metrics, zone) {
  if (arrangement.overflow !== "fit") return 1;
  const gap = arrangement.gap ?? 16;
  const type = arrangement.type;
  const main = type === "column"
    ? metrics.reduce((sum, metric) => sum + metric.height, 0) + Math.max(0, metrics.length - 1) * gap
    : metrics.reduce((sum, metric) => sum + metric.width, 0) + Math.max(0, metrics.length - 1) * gap;
  const cross = type === "column"
    ? Math.max(0, ...metrics.map((metric) => metric.width))
    : Math.max(0, ...metrics.map((metric) => metric.height));
  const availableMain = type === "column" ? zone.geometry.height : zone.geometry.width;
  const availableCross = type === "column" ? zone.geometry.width : zone.geometry.height;
  const mainGap = Math.max(0, metrics.length - 1) * gap;
  const mainCards = Math.max(1, main - mainGap);
  const scale = Math.min(1, (availableMain - mainGap) / mainCards, availableCross / Math.max(1, cross));
  const minScale = arrangement.minScale ?? 0.25;
  if (scale < minScale - 0.000001) {
    throw new RangeError(`${type} arrangement cannot fit zone above minimum scale ${minScale}`);
  }
  return scale;
}

function assertOverflow(arrangement, metrics, zone) {
  if (arrangement.overflow !== "reject") return;
  const gap = arrangement.gap ?? 16;
  const type = arrangement.type;
  const main = type === "column"
    ? metrics.reduce((sum, metric) => sum + metric.height, 0) + Math.max(0, metrics.length - 1) * gap
    : metrics.reduce((sum, metric) => sum + metric.width, 0) + Math.max(0, metrics.length - 1) * gap;
  const cross = type === "column"
    ? Math.max(0, ...metrics.map((metric) => metric.width))
    : Math.max(0, ...metrics.map((metric) => metric.height));
  const mainSize = type === "column" ? zone.geometry.height : zone.geometry.width;
  const crossSize = type === "column" ? zone.geometry.width : zone.geometry.height;
  if (main > mainSize + 0.000001 || cross > crossSize + 0.000001) {
    throw new RangeError(`${type} arrangement exceeds zone ${type === "column" ? "height" : "width"}`);
  }
}

function linearLayout(zone, metrics, arrangement) {
  const type = arrangement.type;
  const gap = arrangement.overflow === "overlap"
    ? -(arrangement.overlap ?? arrangement.gap ?? 16)
    : arrangement.gap ?? 16;
  assertOverflow(arrangement, metrics, zone);
  const layoutScale = layoutScaleFor(arrangement, metrics, zone);
  const alignment = arrangement.alignment ?? arrangement.align ?? "center";
  const ordered = arrangement.order === "reverse" ? [...metrics].reverse() : metrics;
  const result = new Map();
  let cursor = 0;
  for (const metric of ordered) {
    const width = metric.width * layoutScale;
    const height = metric.height * layoutScale;
    if (type === "column") {
      const y = zone.geometry.y + cursor + height / 2;
      const x = centeredPosition(alignment, zone.geometry.x, zone.geometry.width, width);
      result.set(metric.card.id, { x, y, angle: 0, layoutScale });
      cursor += height + gap;
    } else {
      const x = zone.geometry.x + cursor + width / 2;
      const y = centeredPosition(alignment, zone.geometry.y, zone.geometry.height, height);
      result.set(metric.card.id, { x, y, angle: 0, layoutScale });
      cursor += width + gap;
    }
  }
  return result;
}

function splayLayout(zone, metrics, arrangement) {
  const axis = arrangement.axis ?? "x";
  const spread = arrangement.spread ?? 30;
  const gap = arrangement.gap ?? 16;
  const linearArrangement = { ...arrangement, type: axis === "y" ? "column" : "row" };
  assertOverflow(linearArrangement, metrics, zone);
  const layoutScale = layoutScaleFor(linearArrangement, metrics, zone);
  const ordered = arrangement.order === "reverse" ? [...metrics].reverse() : metrics;
  const result = new Map();
  const count = ordered.length;
  const largest = axis === "y" ? Math.max(1, ...metrics.map(({ height }) => height * layoutScale)) : Math.max(1, ...metrics.map(({ width }) => width * layoutScale));
  const available = axis === "y" ? zone.geometry.height : zone.geometry.width;
  const total = largest * count + gap * Math.max(0, count - 1);
  const start = (available - total) / 2 + largest / 2;
  ordered.forEach((metric, index) => {
    const center = count <= 1 ? 0 : (index / (count - 1) - 0.5) * spread;
    const coordinate = (axis === "y" ? zone.geometry.y : zone.geometry.x) + start + index * (largest + gap);
    result.set(metric.card.id, {
      x: axis === "y" ? zone.geometry.x + zone.geometry.width / 2 : coordinate,
      y: axis === "y" ? coordinate : zone.geometry.y + zone.geometry.height / 2,
      angle: center,
      layoutScale,
    });
  });
  return result;
}

function handLayout(zone, metrics, arrangement) {
  const maxWidth = Math.max(1, ...metrics.map(({ width }) => width));
  const maxHeight = Math.max(1, ...metrics.map(({ height }) => height));
  const desiredRadius = arrangement.radius ?? maxWidth * 2.5;
  const centerX = zone.geometry.x + zone.geometry.width / 2;
  const centerY = zone.geometry.y + zone.geometry.height * 0.58;
  const ordered = arrangement.order === "reverse" ? [...metrics].reverse() : metrics;
  const count = ordered.length;
  const configuredSpread = arrangement.spread ?? 56;
  const spread = count <= 1 ? 0 : configuredSpread * Math.min(1, (count - 1) / 5);
  const spreadRadians = Math.abs(spread * Math.PI / 180);
  const result = new Map();
  const angles = ordered.map((_, index) => (count <= 1 ? 0 : (index / (count - 1) - 0.5) * spread));
  const maxFootprint = Math.max(...angles.map((angle) => {
    const radians = Math.abs(angle * Math.PI / 180);
    return maxWidth * Math.abs(Math.cos(radians)) + maxHeight * Math.abs(Math.sin(radians));
  }));
  const sine = Math.sin(spreadRadians / 2);
  const availableRadius = sine > 0.000001
    ? Math.max(0, (zone.geometry.width - maxFootprint) / (2 * sine))
    : desiredRadius;
  if (arrangement.overflow === "reject" && desiredRadius > availableRadius + 0.000001) {
    throw new RangeError("hand arrangement exceeds zone width");
  }
  const radius = arrangement.overflow === "overlap" ? desiredRadius : Math.min(desiredRadius, availableRadius);
  const arcDirection = (arrangement.curve ?? "concave") === "concave" ? 1 : -1;
  const arcDrops = angles.map((angle) => {
    const radians = angle * Math.PI / 180;
    return arcDirection * radius * 0.35 * (1 - Math.cos(radians));
  });
  const averageArcDrop = arcDrops.reduce((sum, value) => sum + value, 0) / arcDrops.length;
  ordered.forEach((metric, index) => {
    const angle = angles[index];
    const radians = angle * Math.PI / 180;
    const arcDrop = arcDrops[index] - averageArcDrop;
    result.set(metric.card.id, {
      x: centerX + Math.sin(radians) * radius,
      y: centerY + arcDrop,
      angle: (arrangement.curve ?? "concave") === "concave" ? -angle : angle,
      layoutScale: 1,
    });
  });
  return result;
}

function pileLayout(zone, metrics, arrangement) {
  const spread = arrangement.spread ?? 24;
  const angle = arrangement.angle ?? 8;
  const result = new Map();
  for (const metric of metrics) {
    const hash = stableHash(metric.card.id);
    const xOffset = ((hash & 0xff) / 255 - 0.5) * spread;
    const yOffset = (((hash >>> 8) & 0xff) / 255 - 0.5) * spread;
    const angleOffset = (((hash >>> 16) & 0xff) / 255 - 0.5) * 2 * angle;
    result.set(metric.card.id, {
      x: zone.geometry.x + zone.geometry.width / 2 + xOffset,
      y: zone.geometry.y + zone.geometry.height / 2 + yOffset,
      angle: angleOffset,
      layoutScale: 1,
    });
  }
  return result;
}

function stackLayout(zone, metrics, arrangement) {
  const step = arrangement.step ?? arrangement.overlap ?? arrangement.gap ?? 0;
  const axis = arrangement.axis ?? "y";
  const ordered = arrangement.order === "reverse" ? [...metrics].reverse() : metrics;
  const result = new Map();
  ordered.forEach((metric, index) => {
    result.set(metric.card.id, {
      x: zone.geometry.x + zone.geometry.width / 2 + (axis === "x" ? index * step : 0),
      y: zone.geometry.y + zone.geometry.height / 2 + (axis === "y" ? index * step : 0),
      angle: 0,
      layoutScale: 1,
    });
  });
  return result;
}

function gridLayout(zone, metrics, arrangement) {
  const gap = arrangement.gap ?? 16;
  const trackWidth = Math.max(1, ...metrics.map(({ width }) => width));
  const trackHeight = Math.max(1, ...metrics.map(({ height }) => height));
  const columns = arrangement.columns ?? Math.max(1, Math.floor((zone.geometry.width + gap) / (trackWidth + gap)));
  const result = new Map();
  metrics.forEach((metric, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    result.set(metric.card.id, {
      x: zone.geometry.x + metric.width / 2 + column * (trackWidth + gap),
      y: zone.geometry.y + metric.height / 2 + row * (trackHeight + gap),
      angle: 0,
      layoutScale: 1,
    });
  });
  return result;
}

function solveZoneLayout(zone, cards, templates, elementRenderers) {
  const metrics = dimensionsFor(cards, templates, elementRenderers, zone);
  const arrangement = arrangementOf(zone);
  if (metrics.length === 0) return new Map();
  if (arrangement.type === "row" || arrangement.type === "column") return linearLayout(zone, metrics, arrangement);
  if (arrangement.type === "splay") return splayLayout(zone, metrics, arrangement);
  if (arrangement.type === "hand") return handLayout(zone, metrics, arrangement);
  if (arrangement.type === "pile") return pileLayout(zone, metrics, arrangement);
  if (arrangement.type === "stack") return stackLayout(zone, metrics, arrangement);
  return gridLayout(zone, metrics, arrangement);
}

export function depthScale(camera, depth) {
  if (camera?.projection === "orthographic") return 1;
  if (camera?.depthScale) return camera.depthScale(depth);
  return 1 / (1 + Math.max(0, depth) / 1000);
}

export function solveCardPose(card, zone, index = 0, camera, templates, layerOffset = 0, elementRenderers = {}, tracks, layout) {
  const dimensions = cardDimensions(card, templates, elementRenderers, zone.presentation);
  const scale = zone.scale ?? card.pose?.scale ?? 1;
  const renderedWidth = dimensions.width * scale;
  const renderedHeight = dimensions.height * scale;
  const gap = zone.arrangement?.gap ?? 16;
  const layoutScale = layout?.layoutScale ?? 1;
  const trackWidth = tracks?.width ?? renderedWidth;
  const trackHeight = tracks?.height ?? renderedHeight;
  const columns = Math.max(1, Math.floor((zone.geometry.width + gap) / (trackWidth + gap)));
  const column = index % columns;
  const row = Math.floor(index / columns);
  const layoutX = zone.geometry.x + renderedWidth / 2 + column * (trackWidth + gap);
  const layoutY = zone.geometry.y + renderedHeight / 2 + row * (trackHeight + gap);
  const angleDegrees = (card.pose?.angle ?? 0) + (layout?.angle ?? 0);
  const angle = Math.abs(angleDegrees * Math.PI / 180);
  const footprintWidth = Math.abs(renderedWidth * Math.cos(angle)) + Math.abs(renderedHeight * Math.sin(angle));
  const footprintHeight = Math.abs(renderedWidth * Math.sin(angle)) + Math.abs(renderedHeight * Math.cos(angle));
  const x = card.positionMode === "absolute"
    ? card.pose.x
    : layout ? layout.x : containedCenter(layoutX, zone.geometry.x, zone.geometry.width, footprintWidth);
  const y = card.positionMode === "absolute"
    ? card.pose.y
    : layout ? layout.y : containedCenter(layoutY, zone.geometry.y, zone.geometry.height, footprintHeight);

  return {
    ...DEFAULT_POSE,
    ...card.pose,
    width: dimensions.width,
    height: dimensions.height,
    thickness: cardThickness(card, templates),
    x,
    y,
    z: zone.geometry.depth + layerOffset,
    scale,
    layoutScale,
    angle: angleDegrees,
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
    const zoneCards = zone.cardIds.map((id) => cards.get(id)).filter(Boolean);
    const layout = solveZoneLayout(zone, zoneCards, templates, elementRenderers);
    const sizes = zoneCards.map((card) => {
      const dimensions = cardDimensions(card, templates, elementRenderers, zone.presentation);
      const scale = zone.scale ?? card.pose?.scale ?? 1;
      return { width: dimensions.width * scale, height: dimensions.height * scale };
    });
    const tracks = { width: Math.max(1, ...sizes.map(({ width }) => width)), height: Math.max(1, ...sizes.map(({ height }) => height)) };
    let layerOffset = 0;
    let previousDepth = null;
    zone.cardIds.forEach((cardId, index) => {
      const card = cards.get(cardId);
      const layoutEntry = arrangementOf(zone).type === "grid" ? undefined : layout.get(cardId);
      const effectiveScale = (zone.scale ?? card.pose?.scale ?? 1) * (layoutEntry?.layoutScale ?? 1);
      const currentDepth = cardThickness(card, templates) * effectiveScale * depthScale(camera, zone.geometry.depth);
      if (previousDepth !== null) {
        const configuredStep = zone.arrangement?.depthStep ?? DEFAULT_CARD_LAYER_STEP;
        const physicalStep = (previousDepth + currentDepth) / 2 + CARD_LAYER_GAP;
        layerOffset += Math.max(configuredStep, physicalStep);
      }
      const pose = { ...solveCardPose(card, zone, index, camera, templates, layerOffset, elementRenderers, tracks, layoutEntry), drawOrder };
      const dimensions = cardDimensions(card, templates, elementRenderers, zone.presentation);
      const angle = Math.abs((pose.angle * Math.PI) / 180);
      const unrotatedWidth = dimensions.width * pose.scale * pose.layoutScale;
      const unrotatedHeight = dimensions.height * pose.scale * pose.layoutScale;
      const footprint = {
        width: Math.abs(unrotatedWidth * Math.cos(angle)) + Math.abs(unrotatedHeight * Math.sin(angle)),
        height: Math.abs(unrotatedWidth * Math.sin(angle)) + Math.abs(unrotatedHeight * Math.cos(angle)),
      };
      const renderedDepth = cardThickness(card, templates) * pose.scale * pose.layoutScale * pose.depthScale;
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
    if (arrangementOf(zone).type === "hand") {
      const availableDepths = zone.cardIds
        .map((cardId) => poses.get(cardId)?.z)
        .filter((depth) => Number.isFinite(depth))
        .sort((first, second) => first - second);
      const availableOrders = zone.cardIds
        .map((cardId) => poses.get(cardId)?.drawOrder)
        .filter((order) => Number.isFinite(order))
        .sort((first, second) => first - second);
      const spatialOrder = [...zone.cardIds].sort((first, second) => (poses.get(first)?.x ?? 0) - (poses.get(second)?.x ?? 0));
      spatialOrder.forEach((cardId, index) => {
        const pose = poses.get(cardId);
        if (!pose) return;
        if (availableDepths[index] !== undefined) pose.z = availableDepths[index];
        if (availableOrders[index] !== undefined) pose.drawOrder = availableOrders[index];
      });
    }
  }
  return poses;
}
