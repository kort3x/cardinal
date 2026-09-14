import { DEFAULT_POSE } from "./model.js";

export const DEFAULT_CARD_DIMENSIONS = Object.freeze({ width: 180, height: 250 });
export const CARD_DEPTH = 6;
export const DEFAULT_CARD_LAYER_STEP = 8;
export const CARD_LAYER_GAP = 1;

export function cardDimensions(card, templates = {}) {
  const template = templates[card.template] ?? {};
  return {
    width: card.dimensions?.width ?? template.width ?? DEFAULT_CARD_DIMENSIONS.width,
    height: card.dimensions?.height ?? template.height ?? DEFAULT_CARD_DIMENSIONS.height,
  };
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
