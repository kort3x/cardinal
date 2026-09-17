/**
 * Normalized motion settings used by a drag interaction.
 *
 * Presets are deliberately plain data so callers can serialize them, while
 * the exported preset tree is frozen to prevent one consumer from changing
 * another consumer's defaults.
 */

const FIELD_NAMES = Object.freeze([
  "liftScale",
  "liftTime",
  "liftDepth",
  "liftDepthTime",
  "responseTime",
  "damping",
  "dangle",
  "maxTilt",
  "maxTwist",
  "grabPivotTilt",
  "maxGrabTilt",
  "grabPivotResponse",
  "upright",
  "landingTime",
  "landingBounce",
  "landingDelay",
  "weightInfluence",
]);

const MAX_TIME = 10_000;
const MAX_TILT = 90;
const MAX_TWIST = 180;

const presetValues = {
  crisp: {
    preset: "crisp",
    liftScale: 1.08,
    liftTime: 55,
    liftDepth: 0,
    liftDepthTime: 80,
    responseTime: 95,
    damping: 0.95,
    dangle: 0.65,
    maxTilt: 8,
    maxTwist: 6,
    grabPivotTilt: 0,
    maxGrabTilt: 0,
    grabPivotResponse: 100,
    upright: 1.35,
    landingTime: 120,
    landingBounce: 0.04,
    landingDelay: 0,
    weightInfluence: 0.35,
  },
  wizzard: {
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
  },
  natural: {
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
  },
  floaty: {
    preset: "floaty",
    liftScale: 1.16,
    liftTime: 130,
    liftDepth: 0,
    liftDepthTime: 80,
    responseTime: 260,
    damping: 0.65,
    dangle: 1.35,
    maxTilt: 22,
    maxTwist: 16,
    grabPivotTilt: 0,
    maxGrabTilt: 0,
    grabPivotResponse: 100,
    upright: 0.7,
    landingTime: 280,
    landingBounce: 0.28,
    landingDelay: 0,
    weightInfluence: 0.65,
  },
  dramatic: {
    preset: "dramatic",
    liftScale: 1.24,
    liftTime: 140,
    liftDepth: 0,
    liftDepthTime: 80,
    responseTime: 360,
    damping: 0.2,
    dangle: 3,
    maxTilt: 44,
    maxTwist: 18,
    grabPivotTilt: 0,
    maxGrabTilt: 0,
    grabPivotResponse: 100,
    upright: 0.3,
    landingTime: 420,
    landingBounce: 0.6,
    landingDelay: 0,
    weightInfluence: 0.85,
  },
};

function freezePreset(value) {
  return Object.freeze(value);
}

export const DRAG_MOTION_PRESETS = Object.freeze(Object.fromEntries(
  Object.entries(presetValues).map(([name, value]) => [name, freezePreset({ ...value })]),
));

const presetNames = new Set(Object.keys(DRAG_MOTION_PRESETS));

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertOptions(value, name) {
  if (!isRecord(value)) throw new TypeError(`${name} must be an object`);
}

function assertPreset(value) {
  if (typeof value !== "string" || !presetNames.has(value)) {
    throw new RangeError(`Drag motion preset must be one of: ${[...presetNames].join(", ")}`);
  }
}

function assertFinite(value, field) {
  if (!Number.isFinite(value)) throw new RangeError(`Drag motion ${field} must be finite`);
}

function assertNonnegative(value, field) {
  assertFinite(value, field);
  if (value < 0) throw new RangeError(`Drag motion ${field} must be non-negative`);
}

function assertTime(value, field, positive) {
  assertFinite(value, field);
  if (positive ? value <= 0 : value < 0 || value > MAX_TIME) {
    throw new RangeError(`Drag motion ${field} must be ${positive ? "positive" : "non-negative"} and at most ${MAX_TIME} ms`);
  }
  if (positive && value > MAX_TIME) {
    throw new RangeError(`Drag motion ${field} must be at most ${MAX_TIME} ms`);
  }
}

function validateField(field, value) {
  switch (field) {
    case "liftScale":
    case "dangle":
    case "upright":
    case "liftDepth":
    case "grabPivotTilt":
      assertNonnegative(value, field);
      break;
    case "liftTime":
    case "liftDepthTime":
    case "landingDelay":
      assertTime(value, field, false);
      break;
    case "responseTime":
    case "landingTime":
    case "grabPivotResponse":
      assertTime(value, field, true);
      break;
    case "damping":
      assertFinite(value, field);
      if (value <= 0) throw new RangeError("Drag motion damping must be positive");
      break;
    case "maxTilt":
      assertFinite(value, field);
      if (value < 0 || value > MAX_TILT) throw new RangeError(`Drag motion maxTilt must be between 0 and ${MAX_TILT} degrees`);
      break;
    case "maxTwist":
      assertFinite(value, field);
      if (value < 0 || value > MAX_TWIST) throw new RangeError(`Drag motion maxTwist must be between 0 and ${MAX_TWIST} degrees`);
      break;
    case "maxGrabTilt":
      assertFinite(value, field);
      if (value < 0 || value > MAX_TILT) throw new RangeError(`Drag motion maxGrabTilt must be between 0 and ${MAX_TILT} degrees`);
      break;
    case "landingBounce":
    case "weightInfluence":
      assertFinite(value, field);
      if (value < 0 || value > 1) throw new RangeError(`Drag motion ${field} must be between 0 and 1`);
      break;
    default:
      throw new Error(`Unknown drag motion field: ${field}`);
  }
}

function normalizedBase(base) {
  if (base === undefined) return { ...DRAG_MOTION_PRESETS.natural };
  assertOptions(base, "Drag motion base");
  const preset = base.preset ?? "natural";
  assertPreset(preset);
  const result = { ...DRAG_MOTION_PRESETS[preset] };
  for (const field of FIELD_NAMES) {
    if (base[field] === undefined) continue;
    validateField(field, base[field]);
    result[field] = base[field];
  }
  return result;
}

/**
 * Normalize a complete or partial drag motion configuration.
 *
 * A patch without a preset inherits the supplied base. Changing the preset
 * starts from that preset's defaults, then applies the explicit patch fields.
 * Every result is a fresh flat object, so preset data is never shared mutable
 * state between scenes or consumers.
 */
export function normalizeDragMotion(input = {}, base) {
  assertOptions(input, "Drag motion options");
  const current = normalizedBase(base);
  const requestedPreset = input.preset ?? current.preset;
  assertPreset(requestedPreset);
  const result = input.preset !== undefined && requestedPreset !== current.preset
    ? { ...DRAG_MOTION_PRESETS[requestedPreset] }
    : { ...current };
  result.preset = requestedPreset;
  for (const field of FIELD_NAMES) {
    if (input[field] === undefined) continue;
    validateField(field, input[field]);
    result[field] = input[field];
  }
  return result;
}
