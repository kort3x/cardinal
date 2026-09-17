import test from "node:test";
import assert from "node:assert/strict";
import { advanceSpring } from "../src/drag-physics.js";

function integrate(stepSeconds) {
  let value = -18;
  let velocity = 240;
  for (let elapsed = 0; elapsed < 1; elapsed += stepSeconds) {
    const step = Math.min(stepSeconds, 1 - elapsed);
    ({ value, velocity } = advanceSpring(value, velocity, 37, step, 160, 0.8));
  }
  return { value, velocity };
}

test("analytic spring gives the same state at 30, 60, and 120 Hz", () => {
  const reference = advanceSpring(-18, 240, 37, 1, 160, 0.8);
  for (const rate of [30, 60, 120]) {
    const actual = integrate(1 / rate);
    assert.ok(Math.abs(actual.value - reference.value) < 1e-9, `${rate}Hz value drift`);
    assert.ok(Math.abs(actual.velocity - reference.velocity) < 1e-9, `${rate}Hz velocity drift`);
  }
});

test("long idle gaps settle in one bounded finite evaluation", () => {
  const result = advanceSpring(720, -180, 0, 86_400, 160, 0.8);
  assert.equal(Number.isFinite(result.value), true);
  assert.equal(Number.isFinite(result.velocity), true);
  assert.ok(Math.abs(result.value) < 0.001);
  assert.ok(Math.abs(result.velocity) < 0.001);
});

test("spring remains finite for zero and extreme damping inputs", () => {
  for (const damping of [0, 0.01, 1, 20, 1e6, Number.MAX_VALUE]) {
    const result = advanceSpring(-90, 3000, 90, 0.25, 1, damping);
    assert.equal(Number.isFinite(result.value), true);
    assert.equal(Number.isFinite(result.velocity), true);
  }
});
