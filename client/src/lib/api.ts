import type { RenderSettings } from '../../../shared/settings';
import { UserError } from './errors';

export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export type ServerStatus = 'queued' | 'rendering' | 'encoding' | 'done' | 'error' | 'cancelled';

export interface ServerJob {
  status: ServerStatus;
  framesDone: number;
  totalFrames: number;
  etaSeconds: number | null;
  width: number;
  height: number;
  fps: number;
  duration: number;
  error?: string;
  sizeBytes?: number;
  loop?: { difference: number; seamless: boolean };
}

const unreachable = () =>
  new UserError(
    `Cannot reach the render server${API_BASE ? ` at ${API_BASE}` : ''}. Make sure it is running (npm run dev) and that VITE_API_URL points to it, or switch to the “Canvas (in-browser)” mode.`,
  );

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* not JSON */
  }
  return `The server answered with HTTP ${res.status}.`;
}

export async function createJob(
  html: string,
  settings: RenderSettings,
  audio: File | null,
  signal: AbortSignal,
): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([html], { type: 'text/html' }), 'index.html');
  form.append('settings', JSON.stringify(settings));
  if (audio) form.append('audio', audio, audio.name);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/jobs`, { method: 'POST', body: form, signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw unreachable();
  }
  if (!res.ok) throw new UserError(await readError(res));
  return ((await res.json()) as { jobId: string }).jobId;
}

export async function deleteJob(id: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/jobs/${id}`, { method: 'DELETE', keepalive: true });
  } catch {
    /* best effort */
  }
}

export const videoUrl = (id: string, download = false): string =>
  `${API_BASE}/api/jobs/${id}/video${download ? '?download=1' : ''}`;

const isFinal = (s: ServerStatus): boolean => s === 'done' || s === 'error' || s === 'cancelled';

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const t = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { window.clearTimeout(t); resolve(); }, { once: true });
  });

async function poll(id: string, onUpdate: (j: ServerJob) => void, signal: AbortSignal): Promise<ServerJob> {
  let failures = 0;
  for (;;) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    try {
      const res = await fetch(`${API_BASE}/api/jobs/${id}`, { signal });
      if (res.status === 404) throw new UserError('The render job expired or was removed on the server.');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      failures = 0;
      const job = (await res.json()) as ServerJob;
      onUpdate(job);
      if (isFinal(job.status)) return job;
    } catch (e) {
      if (e instanceof UserError) throw e;
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (++failures >= 5) throw unreachable();
    }
    await sleep(1000, signal);
  }
}

/** Live progress through Server-Sent Events, falling back to polling if the stream breaks. */
export function watchJob(id: string, onUpdate: (j: ServerJob) => void, signal: AbortSignal): Promise<ServerJob> {
  return new Promise<ServerJob>((resolve, reject) => {
    const source = new EventSource(`${API_BASE}/api/jobs/${id}/events`);
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      source.close();
      signal.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => finish(() => reject(new DOMException('Cancelled', 'AbortError')));
    signal.addEventListener('abort', onAbort, { once: true });

    source.onmessage = (ev: MessageEvent<string>) => {
      const job = JSON.parse(ev.data) as ServerJob;
      onUpdate(job);
      if (isFinal(job.status)) finish(() => resolve(job));
    };
    source.onerror = () => {
      if (settled) return;
      finish(() => {
        poll(id, onUpdate, signal).then(resolve, reject);
      });
    };
  });
}
