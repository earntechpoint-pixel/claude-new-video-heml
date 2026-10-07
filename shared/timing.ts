/** Presentation timestamp of frame `index`, in microseconds. */
export const frameTimestampUs = (index: number, fps: number): number =>
  Math.round((index * 1e6) / fps);

/** Duration of one frame, in microseconds. */
export const frameDurationUs = (fps: number): number => Math.round(1e6 / fps);

/** Number of frames to render for a clip. */
export const totalFrames = (durationSeconds: number, fps: number): number =>
  Math.max(1, Math.round(durationSeconds * fps));
