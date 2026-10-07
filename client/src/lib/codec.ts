import type { Quality, RenderSettings } from '../../../shared/settings';
import { UserError } from './errors';

/** H.264 levels: [level_idc, max macroblocks per frame, max macroblocks per second]. */
const LEVELS: ReadonlyArray<readonly [number, number, number]> = [
  [0x1f, 3600, 108_000],
  [0x28, 8192, 245_760],
  [0x2a, 8704, 522_240],
  [0x32, 22_080, 589_824],
  [0x33, 36_864, 983_040],
  [0x34, 36_864, 2_073_600],
  [0x3c, 139_264, 4_177_920],
];

export function pickLevelIdc(width: number, height: number, fps: number): number {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const level = LEVELS.find(([, maxFs, maxMbps]) => mbs <= maxFs && mbs * fps <= maxMbps);
  return (level ?? LEVELS[LEVELS.length - 1])[0];
}

/** `avc1.PPCCLL`: profile (64 = High, 4d = Main), constraint flags (00), level_idc. */
export const avcCodecString = (profileHex: string, levelIdc: number): string =>
  `avc1.${profileHex}00${levelIdc.toString(16).padStart(2, '0')}`;

const BASE_BITRATE: Record<Quality, number> = { low: 8_000_000, medium: 14_000_000, high: 24_000_000 };

/** 8/14/24 Mbps at 1080p30, scaled by pixel count and frame rate. */
export function bitrateFor(quality: Quality, width: number, height: number, fps: number): number {
  const pixelFactor = (width * height) / (1920 * 1080);
  const fpsFactor = fps >= 60 ? 1.6 : fps <= 24 ? 0.85 : 1;
  return Math.round(BASE_BITRATE[quality] * pixelFactor * fpsFactor);
}

export const KEYFRAME_INTERVAL_SECONDS = 2;

export async function pickVideoEncoderConfig(s: RenderSettings): Promise<VideoEncoderConfig> {
  const startIdx = LEVELS.findIndex(([idc]) => idc === pickLevelIdc(s.width, s.height, s.fps));
  const levels = LEVELS.slice(Math.max(0, startIdx)).map(([idc]) => idc);
  const bitrate = bitrateFor(s.quality, s.width, s.height, s.fps);

  for (const profile of ['64', '4d']) {
    for (const level of levels) {
      for (const hardwareAcceleration of ['prefer-hardware', 'no-preference'] as const) {
        const config: VideoEncoderConfig = {
          codec: avcCodecString(profile, level),
          width: s.width,
          height: s.height,
          bitrate,
          framerate: s.fps,
          hardwareAcceleration,
          latencyMode: 'quality',
          avc: { format: 'avc' },
        };
        try {
          const { supported } = await VideoEncoder.isConfigSupported(config);
          if (supported) return config;
        } catch {
          /* try the next candidate */
        }
      }
    }
  }
  throw new UserError(
    `Your browser cannot encode H.264 at ${s.width}×${s.height} @ ${s.fps} fps. Try a lower resolution or frame rate, or use the server renderer.`,
  );
}

export function isWebCodecsSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined'
  );
}
