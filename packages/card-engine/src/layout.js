import { DEFAULT_POSE } from "./model.js";

export const DEFAULT_CARD_DIMENSIONS = Object.freeze({ width: 180, height: 250 });

export function cardDimensions(card, templates = {}) {
  const template = templates[card.template] ?? {};
  return {
    width: card.dimensions?.width ?? template.width ?? DEFAULT_CARD_DIMENSIONS.width,
    height: card.dimensions?.height ?? template.height ?? DEFAULT_CARD_DIMENSIONS.height,
  };
}

export function depthScale(camera, depth) {
  if (camera?.depthScale) return camera.depthScale(depth);
  return 1 / (1 + Math.max(0, depth) / 1000);
}

export function solveCardPose(card, zone, index = 0, camera, templates) {
  const dimensions = cardDimensions(card, templates);
  const gap = zone.arrangement?.gap ?? 16;
  const depthStep = zone.arrangement?.depthStep ?? 0.5;
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
    z: zone.geometry.depth + index * depthStep,
    scale: card.pose?.scale ?? 1,
    depthScale: depthScale(camera, zone.geometry.depth),
  };
}

export function solveAllPoses(snapshot, camera, templates) {
  const cards = new Map(snapshot.cards.map((card) => [card.id, card]));
  const poses = new Map();
  let drawOrder = 0;
  for (const zone of snapshot.zones) {
    zone.cardIds.forEach((cardId, index) => {
      const card = cards.get(cardId);
      poses.set(cardId, { ...solveCardPose(card, zone, index, camera, templates), drawOrder });
      drawOrder += 1;
    });
  }
  return poses;
}
