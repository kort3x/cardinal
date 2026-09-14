export function createClock() {
  const frame = typeof requestAnimationFrame === "function"
    ? (callback) => requestAnimationFrame(callback)
    : (callback) => setTimeout(() => callback(performance.now()), 16);
  const cancel = typeof cancelAnimationFrame === "function"
    ? (id) => cancelAnimationFrame(id)
    : (id) => clearTimeout(id);
  return { now: () => performance.now(), requestFrame: frame, cancelFrame: cancel };
}

export function interpolate(from, to, progress) {
  return from + (to - from) * progress;
}

export function shortestAngleTarget(from, to) {
  let delta = ((to - from + 180) % 360 + 360) % 360 - 180;
  if (delta === -180) delta = 180;
  return from + delta;
}
