import os from 'node:os';
import path from 'node:path';

export interface ServerConfig {
  port: number;
  /** Parallel Playwright pages per job (1..4). */
  workers: number;
  maxConcurrentJobs: number;
  maxQueuedJobs: number;
  frameTimeoutMs: number;
  jobTimeoutMs: number;
  jobTtlMs: number;
  /** Extra attempts after a recoverable failure (frames already on disk are reused). */
  retries: number;
  jobsDir: string;
  maxHtmlBytes: number;
  maxAudioBytes: number;
  chromiumSandbox: boolean;
  corsOrigins: '*' | string[];
  trustProxy: number;
  rateWindowMs: number;
  rateMax: number;
  jobRateWindowMs: number;
  jobRateMax: number;
  clientDist?: string;
}

const MB = 1024 * 1024;

function int(env: NodeJS.ProcessEnv, name: string, def: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<ServerConfig> = {},
): ServerConfig {
  const origins = (env.CORS_ORIGIN ?? '*').trim();
  const cfg: ServerConfig = {
    port: int(env, 'PORT', 8080, 1, 65535),
    workers: int(env, 'RENDER_WORKERS', 2, 1, 4),
    maxConcurrentJobs: int(env, 'MAX_CONCURRENT_JOBS', 1, 1, 8),
    maxQueuedJobs: int(env, 'MAX_QUEUED_JOBS', 10, 0, 100),
    frameTimeoutMs: int(env, 'FRAME_TIMEOUT_MS', 15_000, 1_000, 120_000),
    jobTimeoutMs: int(env, 'JOB_TIMEOUT_MS', 30 * 60_000, 10_000, 6 * 3_600_000),
    jobTtlMs: int(env, 'JOB_TTL_MS', 3_600_000, 10_000, 24 * 3_600_000),
    retries: int(env, 'JOB_RETRIES', 1, 0, 3),
    jobsDir: env.JOBS_DIR ?? (os.platform() === 'win32' ? path.join(os.tmpdir(), 'jobs') : '/tmp/jobs'),
    maxHtmlBytes: 5 * MB,
    maxAudioBytes: int(env, 'MAX_AUDIO_MB', 25, 1, 100) * MB,
    chromiumSandbox: env.CHROMIUM_SANDBOX !== 'false',
    corsOrigins: origins === '*' ? '*' : origins.split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: int(env, 'TRUST_PROXY', 0, 0, 10),
    rateWindowMs: 60_000,
    rateMax: int(env, 'RATE_LIMIT_PER_MIN', 600, 10, 100_000),
    jobRateWindowMs: 10 * 60_000,
    jobRateMax: int(env, 'RATE_LIMIT_JOBS_PER_10MIN', 10, 1, 10_000),
    clientDist: env.CLIENT_DIST || undefined,
  };
  return { ...cfg, ...overrides };
}
