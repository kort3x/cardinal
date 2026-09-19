import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { cardSideForIntersection, resolveFaceVisibility, selectCardIntersection } from "../src/renderers/webgl.js";

test("concealed cards use a safe cover while their physical flip is still facing front", () => {
  assert.deepEqual(resolveFaceVisibility({
    faceUp: false,
    frontSuppressed: true,
    backReady: true,
    poseVisible: true,
    flipY: 0,
  }), {
    front: false,
    frontBase: true,
    back: true,
    backBase: true,
    card: true,
  });

  assert.deepEqual(resolveFaceVisibility({
    faceUp: false,
    frontSuppressed: true,
    backReady: true,
    poseVisible: true,
    flipY: 180,
  }), {
    front: false,
    frontBase: false,
    back: true,
    backBase: true,
    card: true,
  });
});

test("concealment may retain a public front until the back faces the camera", () => {
  assert.equal(resolveFaceVisibility({ faceUp: false, frontReady: true, backReady: true, flipY: 0 }).front, true);
  assert.equal(resolveFaceVisibility({ faceUp: false, frontReady: true, backReady: true, flipY: 90 }).front, true);
  assert.equal(resolveFaceVisibility({ faceUp: false, frontReady: true, backReady: true, flipY: 180 }).front, false);
});

test("face visibility never exposes an unrevealed or unready front", () => {
  assert.equal(resolveFaceVisibility({ faceUp: false, frontSuppressed: true, frontReady: true, backReady: true }).front, false);
  assert.equal(resolveFaceVisibility({ faceUp: false, frontSuppressed: true, frontReady: true, backReady: true }).frontBase, true);
  assert.equal(resolveFaceVisibility({ faceUp: true, frontReady: false, backReady: true }).card, false);
  assert.equal(resolveFaceVisibility({ faceUp: true, frontReady: true, backReady: false }).card, false);
  assert.equal(resolveFaceVisibility({ faceUp: true, frontReady: true, backReady: true, poseVisible: false }).card, false);
});

function mountedCard(cardId, drawOrder) {
  const cardGroup = new THREE.Group();
  cardGroup.userData.cardId = cardId;
  cardGroup.renderOrder = drawOrder;
  return { cardGroup };
}

test("card intersection side detection uses the actual intersected mesh", () => {
  const mounted = {
    front: new THREE.Mesh(),
    back: new THREE.Mesh(),
    frontBase: new THREE.Mesh(),
    backBase: new THREE.Mesh(),
  };

  assert.equal(cardSideForIntersection(mounted.front, mounted), "front");
  assert.equal(cardSideForIntersection(mounted.frontBase, mounted), "front");
  assert.equal(cardSideForIntersection(mounted.back, mounted), "back");
  assert.equal(cardSideForIntersection(mounted.backBase, mounted), "back");
  assert.equal(cardSideForIntersection(new THREE.Mesh(), mounted), "edge");
});

test("card intersection selection follows visual draw order before ray distance", () => {
  const lower = mountedCard("lower", 2);
  const higher = mountedCard("higher", 8);
  const lowerMesh = new THREE.Mesh();
  const higherMesh = new THREE.Mesh();
  lower.cardGroup.add(lowerMesh);
  higher.cardGroup.add(higherMesh);
  const cards = new Map([
    ["lower", lower],
    ["higher", higher],
  ]);

  const hit = selectCardIntersection([
    { object: lowerMesh, distance: 1 },
    { object: higherMesh, distance: 20 },
  ], cards);

  assert.equal(hit.cardId, "higher");
  assert.equal(hit.object, higherMesh);
});

test("card intersection selection uses nearest ray depth within one card", () => {
  const mounted = mountedCard("card", 3);
  const nearMesh = new THREE.Mesh();
  const farMesh = new THREE.Mesh();
  mounted.cardGroup.add(nearMesh, farMesh);

  const hit = selectCardIntersection([
    { object: farMesh, distance: 12 },
    { object: nearMesh, distance: 4 },
  ], new Map([["card", mounted]]));

  assert.equal(hit.object, nearMesh);
  assert.equal(hit.distance, 4);
});
