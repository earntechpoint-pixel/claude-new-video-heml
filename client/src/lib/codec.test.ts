import { describe, expect, it } from 'vitest';
import { avcCodecString, bitrateFor, pickLevelIdc } from './codec';

describe('H.264 level selection', () => {
  it('picks the smallest sufficient level', () => {
    expect(pickLevelIdc(1280, 720, 30)).toBe(0x1f);
    expect(pickLevelIdc(1920, 1080, 30)).toBe(0x28);
    expect(pickLevelIdc(1920, 1080, 60)).toBe(0x2a);
    expect(pickLevelIdc(2560, 1440, 30)).toBe(0x32);
    expect(pickLevelIdc(3840, 2160, 30)).toBe(0x33);
    expect(pickLevelIdc(3840, 2160, 60)).toBe(0x34);
  });

  it('formats codec strings', () => {
    expect(avcCodecString('64', 0x28)).toBe('avc1.640028');
    expect(avcCodecString('64', 0x33)).toBe('avc1.640033');
  });
});

describe('bitrates', () => {
  it('matches 8/14/24 Mbps at 1080p30', () => {
    expect(bitrateFor('low', 1920, 1080, 30)).toBe(8_000_000);
    expect(bitrateFor('medium', 1920, 1080, 30)).toBe(14_000_000);
    expect(bitrateFor('high', 1920, 1080, 30)).toBe(24_000_000);
  });
  it('scales with resolution and frame rate', () => {
    expect(bitrateFor('medium', 3840, 2160, 30)).toBe(56_000_000);
    expect(bitrateFor('medium', 1920, 1080, 60)).toBeGreaterThan(14_000_000);
  });
});
