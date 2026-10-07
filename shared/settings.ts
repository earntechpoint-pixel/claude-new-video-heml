export type Quality = 'low' | 'medium' | 'high';
export type Fps = 24 | 30 | 60;

export interface RenderSettings {
  width: number;
  height: number;
  fps: Fps;
  /** Seconds, 1..120 (fractions allowed). */
  duration: number;
  quality: Quality;
  loopCheck: boolean;
}

export const FPS_OPTIONS: readonly Fps[] = [24, 30, 60];
export const QUALITY_OPTIONS: readonly Quality[] = ['low', 'medium', 'high'];

export const LIMITS = {
  minDuration: 1,
  maxDuration: 120,
  minSide: 64,
  maxSide: 3840,
  maxPixels: 3840 * 2160,
} as const;

/** x264 CRF per quality level (Mode B). */
export const CRF_BY_QUALITY: Record<Quality, number> = { low: 18, medium: 16, high: 14 };

export const RESOLUTION_PRESETS = [
  { label: '1280 × 720 (HD)', width: 1280, height: 720 },
  { label: '1920 × 1080 (Full HD)', width: 1920, height: 1080 },
  { label: '2560 × 1440 (QHD)', width: 2560, height: 1440 },
  { label: '3840 × 2160 (4K)', width: 3840, height: 2160 },
] as const;

export type ValidationResult =
  | { ok: true; settings: RenderSettings }
  | { ok: false; errors: string[] };

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function checkSide(name: string, v: unknown, errors: string[]): v is number {
  if (!isInt(v) || v < LIMITS.minSide || v > LIMITS.maxSide) {
    errors.push(`${name} must be a whole number between ${LIMITS.minSide} and ${LIMITS.maxSide}.`);
    return false;
  }
  if (v % 2 !== 0) {
    errors.push(`${name} must be an even number (H.264 requirement).`);
    return false;
  }
  return true;
}

export function validateSettings(input: unknown): ValidationResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['Settings are missing.'] };
  }
  const o = input as Record<string, unknown>;
  const errors: string[] = [];

  const wOk = checkSide('Width', o.width, errors);
  const hOk = checkSide('Height', o.height, errors);
  if (wOk && hOk && (o.width as number) * (o.height as number) > LIMITS.maxPixels) {
    errors.push('Resolution is higher than 4K (3840 × 2160).');
  }
  if (!FPS_OPTIONS.includes(o.fps as Fps)) errors.push('FPS must be 24, 30 or 60.');
  if (
    typeof o.duration !== 'number' ||
    !Number.isFinite(o.duration) ||
    o.duration < LIMITS.minDuration ||
    o.duration > LIMITS.maxDuration
  ) {
    errors.push(`Duration must be between ${LIMITS.minDuration} and ${LIMITS.maxDuration} seconds.`);
  }
  if (!QUALITY_OPTIONS.includes(o.quality as Quality)) {
    errors.push('Quality must be low, medium or high.');
  }
  if (o.loopCheck !== undefined && typeof o.loopCheck !== 'boolean') {
    errors.push('Loop check must be true or false.');
  }
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    settings: {
      width: o.width as number,
      height: o.height as number,
      fps: o.fps as Fps,
      duration: o.duration as number,
      quality: o.quality as Quality,
      loopCheck: o.loopCheck === true,
    },
  };
}
