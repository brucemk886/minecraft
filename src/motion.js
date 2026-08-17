export function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function parabolicArc(progress) {
  const t = clamp01(progress);
  return 4 * t * (1 - t);
}

export function parabolicArcSlope(progress) {
  const t = clamp01(progress);
  return 4 * (1 - 2 * t);
}

export function shortestAngleDelta(from, to) {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function dampAngle(current, target, response, dt) {
  const blend = 1 - Math.exp(-response * Math.max(0, dt));
  return current + shortestAngleDelta(current, target) * blend;
}

export function damp(current, target, response, dt) {
  const blend = 1 - Math.exp(-response * Math.max(0, dt));
  return current + (target - current) * blend;
}

