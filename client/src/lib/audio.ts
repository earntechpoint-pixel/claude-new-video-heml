import type { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { throwIfAborted } from './errors';

export interface PreparedAudio {
  sampleRate: number;
  channels: number;
  /** Planar float samples, exactly duration × sampleRate long (trimmed or zero-padded). */
  planes: Float32Array[];
}

const AUDIO_BITRATE = 192_000;
const CHUNK_FRAMES = 4096;

export async function prepareAudio(file: File, durationSeconds: number): Promise<PreparedAudio> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    const channels = Math.min(2, decoded.numberOfChannels);
    const length = Math.round(durationSeconds * decoded.sampleRate);
    const planes: Float32Array[] = [];
    for (let c = 0; c < channels; c++) {
      const out = new Float32Array(length); // zero-filled = silence padding
      out.set(decoded.getChannelData(c).subarray(0, Math.min(length, decoded.length)));
      planes.push(out);
    }
    return { sampleRate: decoded.sampleRate, channels, planes };
  } finally {
    void ctx.close();
  }
}

export async function isAudioSupported(a: PreparedAudio): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false;
  try {
    const { supported } = await AudioEncoder.isConfigSupported({
      codec: 'mp4a.40.2',
      sampleRate: a.sampleRate,
      numberOfChannels: a.channels,
      bitrate: AUDIO_BITRATE,
    });
    return supported === true;
  } catch {
    return false;
  }
}

export async function encodeAudioTrack(
  a: PreparedAudio,
  muxer: Muxer<ArrayBufferTarget>,
  signal: AbortSignal,
): Promise<void> {
  const state: { error: Error | null } = { error: null };
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => {
      state.error = e;
    },
  });
  encoder.configure({
    codec: 'mp4a.40.2',
    sampleRate: a.sampleRate,
    numberOfChannels: a.channels,
    bitrate: AUDIO_BITRATE,
  });
  try {
    const total = a.planes[0]?.length ?? 0;
    for (let offset = 0; offset < total; offset += CHUNK_FRAMES) {
      throwIfAborted(signal);
      const frames = Math.min(CHUNK_FRAMES, total - offset);
      const data = new Float32Array(frames * a.channels);
      a.planes.forEach((plane, c) => data.set(plane.subarray(offset, offset + frames), c * frames));
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: a.sampleRate,
        numberOfFrames: frames,
        numberOfChannels: a.channels,
        timestamp: Math.round((offset / a.sampleRate) * 1e6),
        data,
      });
      encoder.encode(audioData);
      audioData.close();
      if (state.error) throw state.error;
      if (encoder.encodeQueueSize > 32) await new Promise((r) => encoder.addEventListener('dequeue', r, { once: true }));
    }
    await encoder.flush();
    if (state.error) throw state.error;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
}
