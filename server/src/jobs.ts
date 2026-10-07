import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RenderSettings } from '../../shared/settings';
import { totalFrames } from '../../shared/timing';
import type { ServerConfig } from './config';
import { encodeJob } from './encode';
import { UserFacingError, publicMessage } from './errors';
import type { LoopResult } from './loopcheck';
import { renderJob } from './render';

export type JobStatus = 'queued' | 'rendering' | 'encoding' | 'done' | 'error' | 'cancelled';
const TERMINAL: readonly JobStatus[] = ['done', 'error', 'cancelled'];
export const isTerminal = (s: JobStatus): boolean => TERMINAL.includes(s);

export interface JobSnapshot {
  status: JobStatus;
  framesDone: number;
  totalFrames: number;
  etaSeconds: number | null;
  width: number;
  height: number;
  fps: number;
  duration: number;
  error?: string;
  sizeBytes?: number;
  loop?: LoopResult;
}

export class Job {
  readonly emitter = new EventEmitter();
  readonly abort = new AbortController();
  readonly totalFrames: number;
  status: JobStatus = 'queued';
  framesDone = 0;
  encodedFrames = 0;
  error?: string;
  loop?: LoopResult;
  sizeBytes?: number;
  mode?: 'draw' | 'virtual';
  createdAt = Date.now();
  renderStartedAt?: number;
  encodeStartedAt?: number;
  finishedAt?: number;
  cleanupAt?: number;
  timedOut = false;
  deleteRequested = false;

  constructor(
    readonly id: string,
    readonly dir: string,
    readonly html: string,
    readonly settings: RenderSettings,
    readonly audioPath?: string,
  ) {
    this.totalFrames = totalFrames(settings.duration, settings.fps);
    this.emitter.setMaxListeners(100);
  }

  get framesDir(): string {
    return path.join(this.dir, 'frames');
  }
  get outPath(): string {
    return path.join(this.dir, 'out.mp4');
  }
  get loopFramePath(): string {
    return path.join(this.dir, 'loop_end.png');
  }
  framePath(i: number): string {
    return path.join(this.framesDir, `f_${String(i).padStart(5, '0')}.png`);
  }

  emit(): void {
    this.emitter.emit('update');
  }
  setStatus(s: JobStatus): void {
    this.status = s;
    if (isTerminal(s)) this.finishedAt = Date.now();
    this.emit();
  }
  resetProgress(): void {
    this.framesDone = 0;
    this.emit();
  }
  frameDone(): void {
    this.framesDone++;
    this.emit();
  }

  private eta(): number | null {
    if (this.status === 'rendering' && this.renderStartedAt && this.framesDone > 0) {
      const elapsed = (Date.now() - this.renderStartedAt) / 1000;
      return Math.max(0, Math.round((elapsed / this.framesDone) * (this.totalFrames - this.framesDone)));
    }
    if (this.status === 'encoding' && this.encodeStartedAt && this.encodedFrames > 0) {
      const elapsed = (Date.now() - this.encodeStartedAt) / 1000;
      return Math.max(0, Math.round((elapsed / this.encodedFrames) * (this.totalFrames - this.encodedFrames)));
    }
    return null;
  }

  snapshot(): JobSnapshot {
    return {
      status: this.status,
      framesDone: this.framesDone,
      totalFrames: this.totalFrames,
      etaSeconds: this.eta(),
      width: this.settings.width,
      height: this.settings.height,
      fps: this.settings.fps,
      duration: this.settings.duration,
      error: this.error,
      sizeBytes: this.sizeBytes,
      loop: this.loop,
    };
  }
}

export interface Pipeline {
  render(job: Job, cfg: ServerConfig): Promise<void>;
  encode(job: Job): Promise<void>;
}

const defaultPipeline: Pipeline = { render: renderJob, encode: encodeJob };

export interface CreateJobInput {
  html: string;
  settings: RenderSettings;
  audio?: { data: Buffer; ext: '.mp3' | '.wav' | '.m4a' };
}

export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private readonly queue: Job[] = [];
  private running = 0;
  private sweeper?: NodeJS.Timeout;

  constructor(
    private readonly cfg: ServerConfig,
    private readonly pipeline: Pipeline = defaultPipeline,
  ) {}

  async init(): Promise<void> {
    await rm(this.cfg.jobsDir, { recursive: true, force: true });
    await mkdir(this.cfg.jobsDir, { recursive: true });
    this.sweeper = setInterval(() => void this.sweep(), 30_000);
    this.sweeper.unref();
  }

  async shutdown(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const job of this.jobs.values()) job.abort.abort();
    await rm(this.cfg.jobsDir, { recursive: true, force: true }).catch(() => undefined);
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  async create(input: CreateJobInput): Promise<Job> {
    if (this.queue.length >= this.cfg.maxQueuedJobs && this.running >= this.cfg.maxConcurrentJobs) {
      throw new UserFacingError('The render server is busy. Please try again in a few minutes.', 503);
    }
    const id = randomBytes(16).toString('hex');
    const dir = path.join(this.cfg.jobsDir, id);
    await mkdir(path.join(dir, 'frames'), { recursive: true });
    await writeFile(path.join(dir, 'index.html'), input.html, 'utf8');
    let audioPath: string | undefined;
    if (input.audio) {
      audioPath = path.join(dir, `audio${input.audio.ext}`);
      await writeFile(audioPath, input.audio.data);
    }
    const job = new Job(id, dir, input.html, input.settings, audioPath);
    this.jobs.set(id, job);
    this.queue.push(job);
    this.pump();
    return job;
  }

  /** Cancels (if running) and removes the job and its files. */
  async cancel(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.deleteRequested = true;
    const queuedAt = this.queue.indexOf(job);
    if (queuedAt >= 0) this.queue.splice(queuedAt, 1);
    const wasActive = job.status === 'rendering' || job.status === 'encoding';
    if (!isTerminal(job.status)) {
      job.abort.abort();
      job.setStatus('cancelled');
    }
    // An active job removes its own files once the pipeline has unwound (see run()).
    if (!wasActive) await this.remove(job);
    return true;
  }

  scheduleCleanup(id: string, delayMs: number): void {
    const job = this.jobs.get(id);
    if (job) job.cleanupAt = Date.now() + delayMs;
  }

  private async remove(job: Job): Promise<void> {
    this.jobs.delete(job.id);
    await rm(job.dir, { recursive: true, force: true }).catch(() => undefined);
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const job of [...this.jobs.values()]) {
      const expired = job.finishedAt !== undefined && now - job.finishedAt > this.cfg.jobTtlMs;
      const downloaded = job.cleanupAt !== undefined && now >= job.cleanupAt;
      if (expired || downloaded) await this.remove(job);
    }
  }

  private pump(): void {
    while (this.running < this.cfg.maxConcurrentJobs && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job || job.status !== 'queued') continue;
      this.running++;
      void this.run(job).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private async run(job: Job): Promise<void> {
    const timer = setTimeout(() => {
      job.timedOut = true;
      job.abort.abort();
    }, this.cfg.jobTimeoutMs);
    try {
      job.renderStartedAt = Date.now();
      job.setStatus('rendering');
      for (let attempt = 0; ; attempt++) {
        try {
          await this.pipeline.render(job, this.cfg);
          break;
        } catch (e) {
          if (job.abort.signal.aborted) throw e;
          const retryable = !(e instanceof UserFacingError) || e.retryable;
          if (!retryable || attempt >= this.cfg.retries) throw e;
          console.warn(`[job ${job.id}] attempt ${attempt + 1} failed, retrying (existing frames are kept)`);
        }
      }
      job.encodeStartedAt = Date.now();
      job.setStatus('encoding');
      await this.pipeline.encode(job);
      job.sizeBytes = (await stat(job.outPath)).size;
      job.setStatus('done');
    } catch (e) {
      if (job.status === 'cancelled') {
        // already reported
      } else if (job.timedOut) {
        job.error = 'The render exceeded the time limit for a single job.';
        job.setStatus('error');
      } else if (job.abort.signal.aborted) {
        job.setStatus('cancelled');
      } else {
        console.error(`[job ${job.id}] failed`, e);
        job.error = publicMessage(e);
        job.setStatus('error');
      }
    } finally {
      clearTimeout(timer);
      if (job.deleteRequested) await this.remove(job);
    }
  }
}
