import { describe, expect, it } from 'vitest';
import { isSeamless, meanAbsDiff } from '../../../shared/loop';
import { validateSettings } from '../../../shared/settings';
import { frameDurationUs, frameTimestampUs, totalFrames } from '../../../shared/timing';

describe('frame timestamps', () => {
  it('computes microsecond timestamps with rounding', () => {
    expect(frameTimestampUs(0, 30)).toBe(0);
    expect(frameTimestampUs(1, 30)).toBe(33_333);
    expect(frameTimestampUs(3, 30)).toBe(100_000);
    expect(frameTimestampUs(1, 24)).toBe(41_667);
    expect(frameTimestampUs(60, 60)).toBe(1_000_000);
    expect(frameTimestampUs(719, 24)).toBe(Math.round((719 * 1e6) / 24));
  });

  it('computes the per-frame duration', () => {
    expect(frameDurationUs(30)).toBe(33_333);
    expect(frameDurationUs(24)).toBe(41_667);
    expect(frameDurationUs(60)).toBe(16_667);
  });

  it('is strictly increasing and never drifts more than 1 µs from the exact time', () => {
    for (const fps of [24, 30, 60]) {
      let prev = -1;
      for (let i = 0; i < fps * 120; i += 7) {
        const ts = frameTimestampUs(i, fps);
        expect(ts).toBeGreaterThan(prev);
        expect(Math.abs(ts - (i * 1e6) / fps)).toBeLessThanOrEqual(0.5);
        prev = ts;
      }
    }
  });

  it('counts frames', () => {
    expect(totalFrames(10, 30)).toBe(300);
    expect(totalFrames(1.5, 24)).toBe(36);
    expect(totalFrames(120, 60)).toBe(7200);
  });
});

describe('validateSettings', () => {
  const ok = { width: 1920, height: 1080, fps: 30, duration: 10, quality: 'medium', loopCheck: true };

  it('accepts valid settings', () => {
    const r = validateSettings(ok);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.loopCheck).toBe(true);
  });

  it('accepts the documented extremes', () => {
    expect(validateSettings({ ...ok, width: 3840, height: 2160, duration: 120, fps: 60 }).ok).toBe(true);
    expect(validateSettings({ ...ok, duration: 1 }).ok).toBe(true);
  });

  it('rejects odd, tiny and oversized dimensions', () => {
    expect(validateSettings({ ...ok, width: 1281 }).ok).toBe(false);
    expect(validateSettings({ ...ok, height: 10 }).ok).toBe(false);
    expect(validateSettings({ ...ok, width: 4096 }).ok).toBe(false);
    expect(validateSettings({ ...ok, width: 3840, height: 3840 }).ok).toBe(false);
  });

  it('rejects bad fps, duration and quality', () => {
    expect(validateSettings({ ...ok, fps: 25 }).ok).toBe(false);
    expect(validateSettings({ ...ok, duration: 0.5 }).ok).toBe(false);
    expect(validateSettings({ ...ok, duration: 121 }).ok).toBe(false);
    expect(validateSettings({ ...ok, duration: Number.NaN }).ok).toBe(false);
    expect(validateSettings({ ...ok, quality: 'ultra' }).ok).toBe(false);
  });

  it('rejects non-objects and collects every error', () => {
    expect(validateSettings(null).ok).toBe(false);
    const r = validateSettings({ width: 1, height: 1, fps: 1, duration: 0, quality: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe('loop difference', () => {
  it('is zero for identical buffers and ~1 for black vs white', () => {
    const a = new Uint8Array(160 * 90 * 4).fill(0);
    const b = new Uint8Array(160 * 90 * 4).fill(255);
    expect(meanAbsDiff(a, a, 4)).toBe(0);
    expect(meanAbsDiff(a, b, 4)).toBeCloseTo(1, 5);
    expect(isSeamless(0)).toBe(true);
    expect(isSeamless(0.5)).toBe(false);
  });

  it('ignores alpha', () => {
    const a = Uint8Array.from([10, 20, 30, 0]);
    const b = Uint8Array.from([10, 20, 30, 255]);
    expect(meanAbsDiff(a, b, 4)).toBe(0);
  });
});
