const MAX_RESPONSE_TIME = 60_000;

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

/**
 * Advance a unit-mass second-order spring without frame-sized integration.
 *
 * `responseTimeMs` is the nominal time for a critically damped spring to
 * settle. `damping` is the damping ratio: 1 is critical, below 1 bounces,
 * and above 1 settles without overshoot.
 */
export function advanceSpring(value, velocity, target, elapsedSeconds, responseTimeMs, damping) {
  const current = finite(value);
  const speed = finite(velocity);
  const destination = finite(target, current);
  const elapsed = Math.max(0, finite(elapsedSeconds));
  if (elapsed === 0) return { value: current, velocity: speed };

  const response = Math.min(MAX_RESPONSE_TIME, Math.max(1, finite(responseTimeMs, 160)));
  // Keep the overdamped roots well-conditioned for any finite public input.
  const ratio = Math.min(1000, Math.max(0, finite(damping, 0.8)));
  // Eight natural time constants leave a critically damped spring within
  // roughly 0.3% of its target at responseTimeMs.
  const omega = 8000 / response;
  const displacement = current - destination;
  const safeElapsed = Math.min(Number.MAX_VALUE / Math.max(1, omega), elapsed);

  if (ratio < 1 - 1e-7) {
    const dampedOmega = omega * Math.sqrt(1 - ratio * ratio);
    const decay = Math.exp(-ratio * omega * safeElapsed);
    const angle = dampedOmega * safeElapsed;
    const sine = Math.sin(angle);
    const cosine = Math.cos(angle);
    const coefficient = (speed + ratio * omega * displacement) / dampedOmega;
    const envelope = displacement * cosine + coefficient * sine;
    return {
      value: destination + decay * envelope,
      velocity: decay * (-ratio * omega * envelope
        - displacement * dampedOmega * sine + coefficient * dampedOmega * cosine),
    };
  }

  if (Math.abs(ratio - 1) <= 1e-7) {
    const decay = Math.exp(-omega * safeElapsed);
    const coefficient = speed + omega * displacement;
    const envelope = displacement + coefficient * safeElapsed;
    return {
      value: destination + decay * envelope,
      velocity: decay * (coefficient - omega * envelope),
    };
  }

  const root = Math.sqrt(ratio * ratio - 1);
  const first = -omega * (ratio - root);
  const second = -omega * (ratio + root);
  const firstCoefficient = (speed - second * displacement) / (first - second);
  const secondCoefficient = displacement - firstCoefficient;
  const firstTerm = firstCoefficient * Math.exp(first * safeElapsed);
  const secondTerm = secondCoefficient * Math.exp(second * safeElapsed);
  return {
    value: destination + firstTerm + secondTerm,
    velocity: first * firstTerm + second * secondTerm,
  };
}
