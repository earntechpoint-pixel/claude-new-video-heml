export interface FrameRange {
  /** First frame (inclusive). */
  start: number;
  /** Last frame (exclusive). */
  end: number;
}

/** Splits `total` frames into at most `workers` contiguous ranges whose sizes differ by at most 1. */
export function splitRanges(total: number, workers: number): FrameRange[] {
  if (!Number.isInteger(total) || total < 0) throw new RangeError('total must be a non-negative integer');
  if (!Number.isFinite(workers) || workers < 1) throw new RangeError('workers must be >= 1');
  if (total === 0) return [];
  const n = Math.min(Math.floor(workers), total);
  const base = Math.floor(total / n);
  const extra = total % n;
  const ranges: FrameRange[] = [];
  let start = 0;
  for (let i = 0; i < n; i++) {
    const size = base + (i < extra ? 1 : 0);
    ranges.push({ start, end: start + size });
    start += size;
  }
  return ranges;
}
