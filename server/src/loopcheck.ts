import sharp from 'sharp';
import { LOOP_H, LOOP_W, isSeamless, meanAbsDiff } from '../../shared/loop';

export interface LoopResult {
  difference: number;
  seamless: boolean;
}

const thumb = (file: string): Promise<Buffer> =>
  sharp(file).resize(LOOP_W, LOOP_H, { fit: 'fill' }).removeAlpha().raw().toBuffer();

/** Compares frame 0 with the frame at t = duration (downscaled to 160×90). */
export async function loopDifference(firstFrame: string, endFrame: string): Promise<LoopResult> {
  const [a, b] = await Promise.all([thumb(firstFrame), thumb(endFrame)]);
  const difference = meanAbsDiff(a, b, 3);
  return { difference: Number(difference.toFixed(5)), seamless: isSeamless(difference) };
}
