/** Round to the nearest whole pence. Used throughout the engine. */
export function roundPence(value: number): number {
  return Math.round(value);
}

/** Round a percentage or ratio to 2 decimal places for display. */
export function round2dp(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Divide safely -- returns 0 if divisor is zero. */
export function safeDivide(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

/** Clamp a value between a min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
