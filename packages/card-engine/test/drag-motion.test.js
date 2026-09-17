import test from "node:test";
import assert from "node:assert/strict";
import { DRAG_MOTION_PRESETS, normalizeDragMotion } from "../src/drag-motion.js";
import { advanceSpring } from "../src/drag-physics.js";

test("natural drag motion has the agreed normalized defaults", () => {
  assert.deepEqual(normalizeDragMotion(), {
    preset: "natural",
    liftScale: 1.12,
    liftTime: 90,
    liftDepth: 0,
    liftDepthTime: 80,
    responseTime: 160,
    damping: 0.8,
    dangle: 1,
    maxTilt: 14,
    maxTwist: 10,
    grabPivotTilt: 0,
    maxGrabTilt: 0,
    grabPivotResponse: 100,
    upright: 1,
    landingTime: 180,
    landingBounce: 0.12,
    landingDelay: 0,
    weightInfluence: 0.5,
  });
});

test("presets are complete, frozen, and do not leak references", () => {
  for (const name of ["crisp", "wizzard", "natural", "floaty", "dramatic"]) {
    assert.equal(DRAG_MOTION_PRESETS[name].preset, name);
    assert.equal(Object.isFrozen(DRAG_MOTION_PRESETS[name]), true);
    assert.notStrictEqual(normalizeDragMotion({ preset: name }), DRAG_MOTION_PRESETS[name]);
  }
  assert.equal(Object.isFrozen(DRAG_MOTION_PRESETS), true);
});

test("wizzard preset is responsive and restrained", () => {
  assert.deepEqual(normalizeDragMotion({ preset: "wizzard" }), {
    preset: "wizzard",
    liftScale: 1,
    liftTime: 80,
    liftDepth: 40,
    liftDepthTime: 80,
    responseTime: 80,
    damping: 0.55,
    dangle: 1.75,
    maxTilt: 28,
    maxTwist: 18,
    grabPivotTilt: 2,
    maxGrabTilt: 25,
    grabPivotResponse: 55,
    upright: 0.9,
    landingTime: 120,
    landingBounce: 0,
    landingDelay: 0,
    weightInfluence: 0.2,
  });
});

test("dramatic preset makes dangling deliberately conspicuous", () => {
  const motion = normalizeDragMotion({ preset: "dramatic" });

  assert.equal(motion.dangle, 3);
  assert.equal(motion.maxTilt, 44);
  assert.equal(motion.maxTwist, 18);
  assert.ok(motion.dangle > DRAG_MOTION_PRESETS.floaty.dangle * 2);
  assert.ok(motion.damping < 0.5);

  const overshoot = advanceSpring(0, 0, 1, 0.15, motion.responseTime, motion.damping);
  assert.ok(overshoot.value > 1, "dramatic spring should overshoot its target");
});

test("partial updates merge into the base configuration", () => {
  const base = normalizeDragMotion({ preset: "floaty", dangle: 2 });
  const result = normalizeDragMotion({ landingDelay: 80, maxTilt: 18 }, base);

  assert.equal(result.preset, "floaty");
  assert.equal(result.dangle, 2);
  assert.equal(result.landingDelay, 80);
  assert.equal(result.maxTilt, 18);
  assert.equal(result.responseTime, 260);
  assert.equal(base.landingDelay, 0);
});

test("changing preset resets defaults before applying explicit overrides", () => {
  const result = normalizeDragMotion({ preset: "crisp", landingTime: 240 }, {
    preset: "floaty",
    liftScale: 1.8,
    responseTime: 500,
  });

  assert.equal(result.preset, "crisp");
  assert.equal(result.liftScale, DRAG_MOTION_PRESETS.crisp.liftScale);
  assert.equal(result.responseTime, DRAG_MOTION_PRESETS.crisp.responseTime);
  assert.equal(result.landingTime, 240);
});

test("validation rejects invalid presets, times, limits, and strengths", () => {
  const invalid = [
    [{ preset: "heavy" }, /preset/],
    [{ liftScale: -1 }, /liftScale/],
    [{ liftTime: -1 }, /liftTime/],
    [{ liftDepth: -1 }, /liftDepth/],
    [{ liftDepthTime: -1 }, /liftDepthTime/],
    [{ responseTime: 0 }, /responseTime/],
    [{ responseTime: Infinity }, /responseTime/],
    [{ damping: 0 }, /damping/],
    [{ maxTilt: 91 }, /maxTilt/],
    [{ maxTwist: 181 }, /maxTwist/],
    [{ maxGrabTilt: 91 }, /maxGrabTilt/],
    [{ grabPivotResponse: 0 }, /grabPivotResponse/],
    [{ landingBounce: 1.01 }, /landingBounce/],
    [{ landingDelay: 10_001 }, /landingDelay/],
    [{ weightInfluence: -0.01 }, /weightInfluence/],
  ];
  for (const [input, message] of invalid) assert.throws(() => normalizeDragMotion(input), message);
});

test("a malformed base cannot bypass normalization", () => {
  assert.throws(() => normalizeDragMotion({}, { responseTime: 0 }), /responseTime/);
  assert.throws(() => normalizeDragMotion({}, null), /base/);
});
