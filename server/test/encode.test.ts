import { describe, expect, it } from 'vitest';
import { buildFfmpegArgs } from '../src/encode';

describe('buildFfmpegArgs', () => {
  const base = { fps: 30, crf: 16, framesPattern: '/x/f_%05d.png', outPath: '/x/out.mp4' };

  it('builds a video-only command', () => {
    const args = buildFfmpegArgs(base);
    expect(args).toContain('libx264');
    expect(args).toContain('yuv420p');
    expect(args.join(' ')).toContain('-crf 16 -preset medium');
    expect(args).toContain('+faststart');
    expect(args).not.toContain('-shortest');
  });

  it('adds audio with padding and -shortest', () => {
    const args = buildFfmpegArgs({ ...base, audioPath: '/x/audio.mp3' });
    expect(args).toContain('/x/audio.mp3');
    expect(args).toContain('aac');
    expect(args).toContain('-shortest');
    expect(args[args.length - 1]).toBe('/x/out.mp4');
  });
});
