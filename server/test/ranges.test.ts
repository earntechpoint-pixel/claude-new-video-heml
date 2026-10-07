import { describe, expect, it } from 'vitest';
import { splitRanges } from '../src/ranges';

describe('splitRanges', () => {
  it('splits evenly with contiguous ranges', () => {
    expect(splitRanges(12, 3)).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 8 },
      { start: 8, end: 12 },
    ]);
  });

  it('spreads the remainder over the first workers', () => {
    const r = splitRanges(10, 3);
    expect(r.map((x) => x.end - x.start)).toEqual([4, 3, 3]);
    expect(r[0].start).toBe(0);
    expect(r[2].end).toBe(10);
  });

  it('never creates empty ranges', () => {
    expect(splitRanges(2, 4)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
    ]);
    expect(splitRanges(0, 4)).toEqual([]);
  });

  it('covers every frame exactly once for many shapes', () => {
    for (const total of [1, 7, 24, 719, 3600]) {
      for (const workers of [1, 2, 3, 4]) {
        const covered = splitRanges(total, workers).flatMap((r) =>
          Array.from({ length: r.end - r.start }, (_, i) => r.start + i),
        );
        expect(covered).toEqual(Array.from({ length: total }, (_, i) => i));
      }
    }
  });

  it('rejects invalid input', () => {
    expect(() => splitRanges(-1, 2)).toThrow(RangeError);
    expect(() => splitRanges(1.5, 2)).toThrow(RangeError);
    expect(() => splitRanges(10, 0)).toThrow(RangeError);
  });
});
