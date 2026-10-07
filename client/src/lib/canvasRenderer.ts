import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { isSeamless, meanAbsDiff } from '../../../shared/loop';
import type { RenderSettings } from '../../../shared/settings';
import { frameDurationUs, frameTimestampUs, totalFrames } from '../../../shared/timing';
import { encodeAudioTrack, isAudioSupported, prepareAudio, type PreparedAudio } from './audio';
import { SandboxBridge, injectBridge } from './bridge';
import { KEYFRAME_INTERVAL_SECONDS, isWebCodecsSupported, pickVideoEncoderConfig } from './codec';
import { UserError, throwIfAborted } from './errors';
import { describeSizeMismatch, drawLetterboxed, thumbnailPixels } from './frame';

export interface Progress {
  framesDone: number;
  totalFrames: number;
  elapsedMs: number;
  etaSeconds: number | null;
  label: string;
}

export interface LoopReport {
  difference: number;
  seamless: boolean;
}

export interface CanvasRenderOutput {
  blob: Blob;
  loop?: LoopReport;
  warnings: string[];
}

export interface CanvasRenderOptions {
  html: string;
  settings: RenderSettings;
  audio: File | null;
  signal: AbortSignal;
  onProgress: (p: Progress) => void;
  onWarning: (message: string) => void;
}

/** Max frames waiting inside the encoder before we pause feeding it. */
const MAX_QUEUE = 10;

export async function renderCanvas(opts: CanvasRenderOptions): Promise<CanvasRenderOutput> {
  const { html, settings, audio, signal, onProgress, onWarning } = opts;
  const { width, height, fps, duration } = settings;

  if (!isWebCodecsSupported()) {
    throw new UserError(
      'This browser does not support WebCodecs. Use a recent Chrome or Edge, or switch to the “Full page (server)” render mode.',
    );
  }
  const total = totalFrames(duration, fps);
  const warnings: string[] = [];
  const warn = (m: string) => {
    warnings.push(m);
    onWarning(m);
  };

  const videoConfig = await pickVideoEncoderConfig(settings);

  let prepared: PreparedAudio | null = null;
  if (audio) {
    try {
      prepared = await prepareAudio(audio, duration);
      if (!(await isAudioSupported(prepared))) {
        warn('This browser cannot encode AAC audio, so the video will have no sound.');
        prepared = null;
      }
    } catch {
      warn('The audio file could not be decoded, so the video will have no sound.');
      prepared = null;
    }
  }
  throwIfAborted(signal);

  const bridge = await SandboxBridge.createHidden(injectBridge(html));
  let encoder: VideoEncoder | null = null;
  try {
    const info = await bridge.init();
    if (!info.hasCanvas) {
      throw new UserError('No <canvas> element was found. Add one, or use the “Full page (server)” mode.');
    }
    if (!info.hasDraw) {
      throw new UserError('window.draw(t) is not defined. Define it, or use the “Full page (server)” mode.');
    }
    if (info.width !== width || info.height !== height) {
      warn(describeSizeMismatch(info.width, info.height, width, height));
    }

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: 'avc', width, height, frameRate: fps },
      audio: prepared
        ? { codec: 'aac', numberOfChannels: prepared.channels, sampleRate: prepared.sampleRate }
        : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });

    const state: { error: Error | null; wake: (() => void) | null } = { error: null, wake: null };
    const enc = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        state.error = e;
        state.wake?.();
      },
    });
    encoder = enc;
    enc.configure(videoConfig);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) throw new UserError('Could not create a drawing surface at this resolution.');

    const waitForQueue = (): Promise<void> =>
      new Promise((resolve) => {
        const done = () => {
          enc.removeEventListener('dequeue', done);
          signal.removeEventListener('abort', done);
          state.wake = null;
          resolve();
        };
        state.wake = done;
        enc.addEventListener('dequeue', done);
        signal.addEventListener('abort', done);
      });

    const keyEvery = Math.max(1, Math.round(fps * KEYFRAME_INTERVAL_SECONDS));
    const startedAt = performance.now();
    let lastReport = 0;
    let firstThumb: Uint8ClampedArray | null = null;

    for (let i = 0; i < total; i++) {
      throwIfAborted(signal);
      const bitmap = await bridge.drawFrame(i / fps);
      drawLetterboxed(ctx, bitmap, width, height);
      bitmap.close();
      if (i === 0 && settings.loopCheck) firstThumb = thumbnailPixels(canvas);

      const frame = new VideoFrame(canvas, {
        timestamp: frameTimestampUs(i, fps),
        duration: frameDurationUs(fps),
      });
      enc.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();

      while (enc.encodeQueueSize >= MAX_QUEUE && !state.error) {
        await waitForQueue();
        throwIfAborted(signal);
      }
      if (state.error) throw new UserError(`The video encoder failed: ${state.error.message}`);

      const now = performance.now();
      if (now - lastReport > 100 || i === total - 1) {
        lastReport = now;
        const elapsedMs = now - startedAt;
        const done = i + 1;
        onProgress({
          framesDone: done,
          totalFrames: total,
          elapsedMs,
          etaSeconds: done > 0 ? ((elapsedMs / done) * (total - done)) / 1000 : null,
          label: 'Rendering frames',
        });
      }
    }

    onProgress({
      framesDone: total,
      totalFrames: total,
      elapsedMs: performance.now() - startedAt,
      etaSeconds: null,
      label: 'Finishing video',
    });
    await enc.flush();
    if (state.error) throw new UserError(`The video encoder failed: ${state.error.message}`);

    if (prepared) await encodeAudioTrack(prepared, muxer, signal);

    let loop: LoopReport | undefined;
    if (settings.loopCheck && firstThumb) {
      // draw(duration) is compared with draw(0): a seamless loop starts over without a jump.
      const endBitmap = await bridge.drawFrame(total / fps);
      drawLetterboxed(ctx, endBitmap, width, height);
      endBitmap.close();
      const difference = meanAbsDiff(firstThumb, thumbnailPixels(canvas), 4);
      loop = { difference, seamless: isSeamless(difference) };
    }

    throwIfAborted(signal);
    muxer.finalize();
    return { blob: new Blob([target.buffer], { type: 'video/mp4' }), loop, warnings };
  } finally {
    bridge.dispose();
    if (encoder && encoder.state !== 'closed') encoder.close();
  }
}
