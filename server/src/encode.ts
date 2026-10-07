import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { CRF_BY_QUALITY } from '../../shared/settings';
import type { Job } from './jobs';

const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';

export interface EncodeArgsInput {
  fps: number;
  crf: number;
  framesPattern: string;
  audioPath?: string;
  outPath: string;
}

export function buildFfmpegArgs(i: EncodeArgsInput): string[] {
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats'];
  args.push('-framerate', String(i.fps), '-i', i.framesPattern);
  if (i.audioPath) args.push('-i', i.audioPath);
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(i.crf), '-preset', 'medium');
  args.push('-movflags', '+faststart');
  // Pad short audio with silence; -shortest then trims everything to the video length.
  if (i.audioPath) args.push('-c:a', 'aac', '-b:a', '192k', '-af', 'apad', '-shortest');
  args.push(i.outPath);
  return args;
}

export async function encodeJob(job: Job): Promise<void> {
  const args = buildFfmpegArgs({
    fps: job.settings.fps,
    crf: CRF_BY_QUALITY[job.settings.quality],
    framesPattern: `${job.framesDir}/f_%05d.png`,
    audioPath: job.audioPath,
    outPath: job.outPath,
  });
  job.encodeStartedAt = Date.now();
  job.encodedFrames = 0;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let buffer = '';
    const kill = () => child.kill('SIGKILL');
    job.abort.signal.addEventListener('abort', kill, { once: true });

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('frame=')) {
          job.encodedFrames = Number(line.slice(6)) || job.encodedFrames;
          job.emit();
        }
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      job.abort.signal.removeEventListener('abort', kill);
      if (job.abort.signal.aborted) return reject(new Error('aborted'));
      if (code === 0) return resolve();
      console.error(`[job ${job.id}] ffmpeg exited with ${code}: ${stderr}`);
      reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}
