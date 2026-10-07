import { LOOP_H, LOOP_W } from '../../../shared/loop';

/**
 * Draws `src` onto the W×H canvas, letterboxed with black bars and keeping aspect ratio.
 * Returns true if the source size differs from the output size.
 */
export function drawLetterboxed(
  ctx: OffscreenCanvasRenderingContext2D,
  src: ImageBitmap,
  width: number,
  height: number,
): boolean {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  const scale = Math.min(width / src.width, height / src.height);
  const w = src.width * scale;
  const h = src.height * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, (width - w) / 2, (height - h) / 2, w, h);
  return src.width !== width || src.height !== height;
}

/** RGBA pixels of a 160×90 thumbnail, used by the loop check. */
export function thumbnailPixels(canvas: OffscreenCanvas): Uint8ClampedArray {
  const thumb = new OffscreenCanvas(LOOP_W, LOOP_H);
  const ctx = thumb.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create a 2D context for the loop check.');
  ctx.drawImage(canvas, 0, 0, LOOP_W, LOOP_H);
  return ctx.getImageData(0, 0, LOOP_W, LOOP_H).data;
}

export function describeSizeMismatch(srcW: number, srcH: number, outW: number, outH: number): string {
  return `Your canvas is ${srcW}×${srcH} but the output is ${outW}×${outH}. It is scaled to fit with black bars (aspect ratio kept). For the sharpest result, draw at the output resolution.`;
}
