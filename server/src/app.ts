import path from 'node:path';
import { existsSync } from 'node:fs';
import cors from 'cors';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { validateSettings } from '../../shared/settings';
import type { ServerConfig } from './config';
import { UserFacingError, publicMessage } from './errors';
import { isTerminal, type JobManager } from './jobs';

const ID_RE = /^[a-f0-9]{32}$/;
const AUDIO_EXTS = ['.mp3', '.wav', '.m4a'] as const;

const wrap =
  (fn: (req: Request, res: Response) => Promise<void> | void): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

export function createApp(cfg: ServerConfig, manager: JobManager): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy);
  app.use(
    cors({
      origin: cfg.corsOrigins === '*' ? true : cfg.corsOrigins,
      exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, workers: cfg.workers });
  });

  app.use(
    '/api',
    rateLimit({
      windowMs: cfg.rateWindowMs,
      limit: cfg.rateMax,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests. Please slow down.' },
    }),
  );
  const jobLimiter = rateLimit({
    windowMs: cfg.jobRateWindowMs,
    limit: cfg.jobRateMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many render jobs from your address. Please wait a few minutes.' },
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: Math.max(cfg.maxHtmlBytes, cfg.maxAudioBytes),
      fieldSize: cfg.maxHtmlBytes,
      files: 2,
      fields: 6,
    },
  });

  app.post(
    '/api/jobs',
    jobLimiter,
    upload.fields([
      { name: 'file', maxCount: 1 },
      { name: 'audio', maxCount: 1 },
    ]),
    wrap(async (req, res) => {
      const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
      const body = req.body as Record<string, unknown>;
      const htmlFile = files.file?.[0];
      const html = typeof body.html === 'string' ? body.html : htmlFile?.buffer.toString('utf8');
      if (!html || !html.trim()) throw new UserFacingError('No HTML was provided.', 400);
      if (Buffer.byteLength(html) > cfg.maxHtmlBytes) {
        throw new UserFacingError('The HTML is larger than the 5 MB limit.', 413);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof body.settings === 'string' ? body.settings : '');
      } catch {
        throw new UserFacingError('The settings are missing or not valid JSON.', 400);
      }
      const validation = validateSettings(parsed);
      if (!validation.ok) throw new UserFacingError(validation.errors.join(' '), 400);

      let audio: { data: Buffer; ext: (typeof AUDIO_EXTS)[number] } | undefined;
      const audioFile = files.audio?.[0];
      if (audioFile) {
        const ext = path.extname(audioFile.originalname).toLowerCase();
        if (!AUDIO_EXTS.includes(ext as (typeof AUDIO_EXTS)[number])) {
          throw new UserFacingError('Audio must be an .mp3, .wav or .m4a file.', 400);
        }
        if (audioFile.size > cfg.maxAudioBytes) throw new UserFacingError('The audio file is too large.', 413);
        audio = { data: audioFile.buffer, ext: ext as (typeof AUDIO_EXTS)[number] };
      }

      const job = await manager.create({ html, settings: validation.settings, audio });
      res.status(202).json({ jobId: job.id });
    }),
  );

  const withJob = (
    fn: (req: Request, res: Response, job: NonNullable<ReturnType<JobManager['get']>>) => void,
  ): RequestHandler =>
    wrap((req, res) => {
      const id = String(req.params.id);
      const job = ID_RE.test(id) ? manager.get(id) : undefined;
      if (!job) {
        res.status(404).json({ error: 'Job not found (it may have expired).' });
        return;
      }
      fn(req, res, job);
    });

  app.get('/api/jobs/:id', withJob((_req, res, job) => void res.json(job.snapshot())));

  app.get(
    '/api/jobs/:id/events',
    withJob((req, res, job) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      let timer: NodeJS.Timeout | undefined;
      let lastSent = 0;
      const send = () => {
        lastSent = Date.now();
        timer = undefined;
        res.write(`data: ${JSON.stringify(job.snapshot())}\n\n`);
        if (isTerminal(job.status)) {
          cleanup();
          res.end();
        }
      };
      const onUpdate = () => {
        if (isTerminal(job.status)) {
          send();
          return;
        }
        if (timer) return;
        timer = setTimeout(send, Math.max(0, 250 - (Date.now() - lastSent)));
      };
      const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
      function cleanup() {
        clearInterval(heartbeat);
        if (timer) clearTimeout(timer);
        job.emitter.off('update', onUpdate);
      }
      job.emitter.on('update', onUpdate);
      req.on('close', cleanup);
      send();
    }),
  );

  app.get(
    '/api/jobs/:id/video',
    withJob((req, res, job) => {
      if (job.status !== 'done') {
        res.status(409).json({ error: 'The video is not ready yet.' });
        return;
      }
      const download = req.query.download === '1';
      if (download) res.attachment('code2video.mp4');
      res.on('finish', () => {
        // Keep the file briefly so an in-page player using the same job keeps working.
        if (download && res.statusCode === 200) manager.scheduleCleanup(job.id, 120_000);
      });
      // sendFile implements Range requests (206) and conditional GETs.
      res.sendFile(job.outPath, { headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' } }, (err) => {
        if (err && !res.headersSent) res.status(404).json({ error: 'The video is no longer available.' });
      });
    }),
  );

  app.delete(
    '/api/jobs/:id',
    wrap(async (req, res) => {
      const id = String(req.params.id);
      if (!ID_RE.test(id) || !(await manager.cancel(id))) {
        res.status(404).json({ error: 'Job not found.' });
        return;
      }
      res.status(204).end();
    }),
  );

  if (cfg.clientDist && existsSync(cfg.clientDist)) {
    app.use(express.static(cfg.clientDist));
  }

  app.use('/api', (_req, res) => void res.status(404).json({ error: 'Not found.' }));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FIELD_VALUE';
      res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'An uploaded file is too large.' : 'Invalid upload.' });
      return;
    }
    if (err instanceof UserFacingError) {
      res.status(err.status).json({ error: publicMessage(err) });
      return;
    }
    console.error('[http] unexpected error', err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return app;
}
