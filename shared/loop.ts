/** Thumbnail size used for the loop check (both modes). */
export const LOOP_W = 160;
export const LOOP_H = 90;
/** Mean absolute difference (0..1) above which a loop is considered visibly broken. */
export const LOOP_THRESHOLD = 0.02;

/**
 * Mean absolute difference between two RGB(A) pixel buffers, normalised to 0..1.
 * `stride` is the number of bytes per pixel (3 for RGB, 4 for RGBA); alpha is ignored.
 */
export function meanAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>, stride: 3 | 4): number {
  const pixels = Math.min(a.length, b.length) / stride;
  if (pixels === 0) return 0;
  let sum = 0;
  for (let p = 0; p < pixels; p++) {
    const i = p * stride;
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  }
  return sum / (pixels * 3 * 255);
}

export const isSeamless = (difference: number): boolean => difference <= LOOP_THRESHOLD;
