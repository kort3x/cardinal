import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  captureGrabToken,
  createCardCamera,
  projectGrabPoint,
  resolveGrabCorrection,
} from "../src/renderers/webgl.js";

const bounds = { left: 40, top: 30, width: 1000, height: 700 };
const center = { x: 20, y: 30 };

function clientPoint(camera, worldPoint) {
  const projected = worldPoint.clone().project(camera);
  return {
    x: bounds.left + (projected.x + 1) / 2 * bounds.width,
    y: bounds.top + (1 - projected.y) / 2 * bounds.height,
  };
}

function cardWorldPoint(localPoint, pose) {
  return projectGrabPoint(localPoint, pose, center);
}

function assertAnchored(camera, token, finalPose, pointer) {
  const correction = resolveGrabCorrection({
    camera,
    bounds,
    center,
    pose: finalPose,
    grabToken: token,
    clientPoint: pointer,
  });
  assert.ok(correction);
  assert.equal(correction.z, undefined);
  const correctedPose = { ...finalPose, x: finalPose.x + correction.x, y: finalPose.y + correction.y };
  const correctedClient = clientPoint(camera, cardWorldPoint(token.localPoint, correctedPose));
  assert.ok(Math.abs(correctedClient.x - pointer.x) < 0.000001, `x drift: ${correctedClient.x} vs ${pointer.x}`);
  assert.ok(Math.abs(correctedClient.y - pointer.y) < 0.000001, `y drift: ${correctedClient.y} vs ${pointer.y}`);
  assert.equal(correctedPose.z, finalPose.z);
}

test("grab resolution keeps an off-center tilted, flipped, scaled point anchored in orthographic space", () => {
  const camera = createCardCamera({ projection: "orthographic", width: bounds.width, height: bounds.height });
  const pose = {
    x: 260,
    y: 190,
    z: 42,
    scale: 1.35,
    layoutScale: 0.92,
    depthScale: 1.08,
    tiltX: 18,
    tiltY: -24,
    angle: 13,
    flipX: 32,
    flipY: 148,
  };
  const token = { version: 1, cardId: "card", source: "surface", localPoint: { x: 34, y: -51, z: -3 } };
  const pointer = clientPoint(camera, cardWorldPoint(token.localPoint, pose));

  assertAnchored(camera, token, { ...pose, x: pose.x + 85, y: pose.y - 57 }, pointer);
});

test("grab resolution uses the final depth plane for perspective cards and preserves render depth", () => {
  const camera = createCardCamera({ projection: "perspective", width: bounds.width, height: bounds.height, distance: 900, fov: 38 });
  const pose = {
    x: -140,
    y: 120,
    z: 180,
    scale: 0.86,
    layoutScale: 1.2,
    depthScale: 1.04,
    tiltX: -16,
    tiltY: 21,
    angle: -9,
    flipX: -27,
    flipY: 196,
  };
  const token = { version: 1, cardId: "card", source: "reference-plane", localPoint: { x: -47, y: 28, z: 0 } };
  const pointer = clientPoint(camera, cardWorldPoint(token.localPoint, pose));

  assertAnchored(camera, token, { ...pose, x: pose.x + 72, y: pose.y + 44, z: pose.z }, pointer);
});

test("capture token raycasts mounted 3D surface and stores plain local coordinates", () => {
  const camera = createCardCamera({ projection: "perspective", width: bounds.width, height: bounds.height, distance: 900, fov: 38 });
  const pose = {
    x: 110,
    y: 75,
    z: 80,
    scale: 1.1,
    layoutScale: 1,
    depthScale: 1,
    tiltX: 12,
    tiltY: -15,
    angle: 7,
    flipX: 0,
    flipY: 180,
  };
  const localPoint = { x: 18, y: -22, z: -3 };
  const cardGroup = new THREE.Group();
  const bodyGroup = new THREE.Group();
  const faceGroup = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(120, 160, 6), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  cardGroup.position.set(pose.x - center.x, center.y - pose.y, pose.z);
  cardGroup.scale.setScalar(pose.scale);
  bodyGroup.rotation.order = "ZXY";
  bodyGroup.rotation.set(THREE.MathUtils.degToRad(pose.tiltX), THREE.MathUtils.degToRad(pose.tiltY), THREE.MathUtils.degToRad(pose.angle));
  faceGroup.rotation.order = "YXZ";
  faceGroup.rotation.set(THREE.MathUtils.degToRad(pose.flipX), THREE.MathUtils.degToRad(pose.flipY), 0);
  mesh.position.z = 0;
  cardGroup.add(bodyGroup);
  bodyGroup.add(faceGroup);
  faceGroup.add(mesh);
  cardGroup.updateMatrixWorld(true);
  const worldPoint = mesh.localToWorld(new THREE.Vector3(localPoint.x, localPoint.y, localPoint.z));
  const token = captureGrabToken({
    camera,
    bounds,
    cardId: "card",
    cardGroup,
    faceGroup,
    pose,
    clientPoint: clientPoint(camera, worldPoint),
    sideForObject: () => "back",
  });

  assert.deepEqual(JSON.parse(JSON.stringify(token)), token);
  assert.equal(token.source, "surface");
  assert.equal(token.side, "back");
  assert.equal(token.physicalSide, "back");
  assert.ok(Math.abs(token.localPoint.x - localPoint.x) < 0.000001);
  assert.ok(Math.abs(token.localPoint.y - localPoint.y) < 0.000001);
  assert.ok(Math.abs(token.localPoint.z - localPoint.z) < 0.000001);
  mesh.geometry.dispose();
  mesh.material.dispose();
});

test("capture token falls back to the transformed reference plane when geometry misses", () => {
  const camera = createCardCamera({ projection: "orthographic", width: bounds.width, height: bounds.height });
  const pose = { x: 0, y: 0, z: 20, scale: 1, tiltX: 0, tiltY: 0, angle: 0, flipX: 0, flipY: 0 };
  const cardGroup = new THREE.Group();
  const faceGroup = new THREE.Group();
  cardGroup.position.set(pose.x - center.x, center.y - pose.y, pose.z);
  cardGroup.add(faceGroup);
  cardGroup.updateMatrixWorld(true);
  const localPoint = { x: 310, y: -240, z: 0 };
  const token = captureGrabToken({
    camera,
    bounds,
    cardId: "card",
    cardGroup,
    faceGroup,
    pose,
    clientPoint: clientPoint(camera, cardWorldPoint(localPoint, pose)),
  });

  assert.equal(token.source, "reference-plane");
  assert.ok(Math.abs(token.localPoint.x - localPoint.x) < 0.000001);
  assert.ok(Math.abs(token.localPoint.y - localPoint.y) < 0.000001);
  assert.ok(Math.abs(token.localPoint.z - localPoint.z) < 0.000001);
});

test("grab capability helpers return null for invalid or unavailable inputs", () => {
  assert.equal(resolveGrabCorrection({}), null);
  assert.equal(captureGrabToken({ cardId: "missing", clientPoint: { x: 1, y: 1 } }), null);
});
