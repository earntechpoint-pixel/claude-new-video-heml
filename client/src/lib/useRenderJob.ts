import { useCallback, useEffect, useRef, useState } from 'react';
import type { RenderSettings } from '../../../shared/settings';
import { createJob, deleteJob, videoUrl, watchJob, type ServerJob } from './api';
import { renderCanvas, type LoopReport, type Progress } from './canvasRenderer';
import { UserError, errorMessage, isAbortError } from './errors';

export type Phase = 'idle' | 'rendering' | 'done' | 'error';

export interface RenderResult {
  mode: 'canvas' | 'server';
  url: string;
  downloadUrl: string;
  sizeBytes: number;
  width: number;
  height: number;
  duration: number;
  loop?: LoopReport;
}

export interface RenderArgs {
  mode: 'canvas' | 'server';
  html: string;
  settings: RenderSettings;
  audio: File | null;
}

const STATUS_LABEL: Record<ServerJob['status'], string> = {
  queued: 'Waiting in the server queue',
  rendering: 'Rendering frames on the server',
  encoding: 'Encoding the video with ffmpeg',
  done: 'Done',
  error: 'Failed',
  cancelled: 'Cancelled',
};

export function useRenderJob() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  const objectUrlRef = useRef<string | null>(null);

  const releaseOutputs = useCallback(() => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    if (jobIdRef.current) void deleteJob(jobIdRef.current);
    jobIdRef.current = null;
  }, []);

  // Wall-clock ticker (setInterval keeps running, at a lower rate, in background tabs).
  useEffect(() => {
    if (phase !== 'rendering') return;
    const t = window.setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 250);
    return () => window.clearInterval(t);
  }, [phase]);

  useEffect(() => () => releaseOutputs(), [releaseOutputs]);

  const start = useCallback(
    async ({ mode, html, settings, audio }: RenderArgs) => {
      releaseOutputs();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setPhase('rendering');
      setResult(null);
      setError(null);
      setNotice(null);
      setWarnings([]);
      setProgress({ framesDone: 0, totalFrames: 0, elapsedMs: 0, etaSeconds: null, label: 'Starting' });
      try {
        if (mode === 'canvas') {
          const out = await renderCanvas({
            html,
            settings,
            audio,
            signal: ctrl.signal,
            onProgress: setProgress,
            onWarning: (m) => setWarnings((w) => [...w, m]),
          });
          const url = URL.createObjectURL(out.blob);
          objectUrlRef.current = url;
          setResult({
            mode,
            url,
            downloadUrl: url,
            sizeBytes: out.blob.size,
            width: settings.width,
            height: settings.height,
            duration: settings.duration,
            loop: out.loop,
          });
        } else {
          const id = await createJob(html, settings, audio, ctrl.signal);
          jobIdRef.current = id;
          const final = await watchJob(
            id,
            (j) =>
              setProgress({
                framesDone: j.framesDone,
                totalFrames: j.totalFrames,
                elapsedMs: Date.now() - startedAtRef.current,
                etaSeconds: j.etaSeconds,
                label: STATUS_LABEL[j.status],
              }),
            ctrl.signal,
          );
          if (final.status === 'error') throw new UserError(final.error ?? 'The server could not render this page.');
          if (final.status === 'cancelled') throw new DOMException('Cancelled', 'AbortError');
          setResult({
            mode,
            url: videoUrl(id),
            downloadUrl: videoUrl(id, true),
            sizeBytes: final.sizeBytes ?? 0,
            width: final.width,
            height: final.height,
            duration: final.duration,
            loop: final.loop,
          });
        }
        setPhase('done');
      } catch (e) {
        if (isAbortError(e) || ctrl.signal.aborted) {
          setNotice('Render cancelled.');
          setPhase('idle');
        } else {
          setError(errorMessage(e));
          setPhase('error');
        }
        if (jobIdRef.current) {
          void deleteJob(jobIdRef.current);
          jobIdRef.current = null;
        }
      }
    },
    [releaseOutputs],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    if (jobIdRef.current) {
      void deleteJob(jobIdRef.current);
      jobIdRef.current = null;
    }
  }, []);

  return { phase, progress, result, error, notice, warnings, elapsedMs, start, cancel };
}
