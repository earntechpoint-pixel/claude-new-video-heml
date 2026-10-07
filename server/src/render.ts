import { mkdir, rename, writeFile } from 'node:fs/promises';
import { chromium, type Browser, type CDPSession } from 'playwright';
import type { ServerConfig } from './config';
import { UserFacingError } from './errors';
import type { Job } from './jobs';
import { loopDifference } from './loopcheck';
import { isValidPngFile } from './png';
import { splitRanges, type FrameRange } from './ranges';

/** draw: call window.draw(t) per frame. virtual: CDP virtual time drives CSS/rAF/timers. */
type Mode = 'draw' | 'virtual';

interface FrameRenderer {
  renderAt(index: number, file: string): Promise<void>;
  close(): Promise<void>;
}

const VIRTUAL_EPOCH_S = 1_700_000_000;

/** Normalises performance.now() / Date.now() so every worker starts its clock at the same value. */
const CLOCK_SCRIPT = `(() => {
  const nativeNow = performance.now.bind(performance);
  const origin = nativeNow();
  const epochMs = ${VIRTUAL_EPOCH_S * 1000};
  const now = () => nativeNow() - origin;
  try { Object.defineProperty(performance, 'now', { value: now, configurable: true, writable: true }); } catch (e) {}
  try { Date.now = () => Math.floor(epochMs + now()); } catch (e) {}
})();`;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new UserFacingError(message, 422, true)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function openPage(browser: Browser, job: Job) {
  const { width, height } = job.settings;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  // The page gets no network at all: every request is aborted.
  await context.route('**/*', (route) => route.abort('blockedbyclient'));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => void d.dismiss());
  page.on('popup', (p) => void p.close());
  return { context, page, errors };
}

function toUserError(e: unknown, errors: string[], index: number): never {
  if (e instanceof UserFacingError) throw e;
  if (errors.length > 0) throw new UserFacingError(`Your page threw an error: ${errors[0]}`, 422, false);
  throw new UserFacingError(
    `Frame ${index} could not be rendered (the page crashed or stopped responding).`,
    422,
    true,
  );
}

async function saveAtomic(file: string, data: Buffer): Promise<void> {
  const tmp = `${file}.part`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

async function createDrawRenderer(browser: Browser, job: Job, cfg: ServerConfig): Promise<FrameRenderer> {
  const { context, page, errors } = await openPage(browser, job);
  const fps = job.settings.fps;
  try {
    await withTimeout(page.setContent(job.html, { waitUntil: 'load' }), cfg.frameTimeoutMs * 2, 'The page took too long to load.');
  } catch (e) {
    await context.close().catch(() => undefined);
    return toUserError(e, errors, 0);
  }
  return {
    async renderAt(index, file) {
      try {
        const t = index / fps;
        const failure = await withTimeout(
          page.evaluate(async (time) => {
            try {
              const w = window as unknown as { draw: (t: number) => unknown };
              await w.draw(time);
              return null;
            } catch (err) {
              return err instanceof Error ? err.message : String(err);
            }
          }, t),
          cfg.frameTimeoutMs,
          `window.draw(${t.toFixed(3)}) did not return in time.`,
        );
        if (failure !== null) {
          throw new UserFacingError(`window.draw(${t.toFixed(3)}) threw: ${failure}`, 422, false);
        }
        const png = await withTimeout(
          page.screenshot({ type: 'png', timeout: cfg.frameTimeoutMs }),
          cfg.frameTimeoutMs + 1000,
          `Frame ${index} timed out.`,
        );
        await saveAtomic(file, png);
      } catch (e) {
        toUserError(e, errors, index);
      }
    },
    close: () => context.close().catch(() => undefined),
  };
}

async function createVirtualRenderer(browser: Browser, job: Job, cfg: ServerConfig): Promise<FrameRenderer> {
  const { context, page, errors } = await openPage(browser, job);
  const frameMs = 1000 / job.settings.fps;
  let cdp: CDPSession;
  try {
    cdp = await context.newCDPSession(page);
    // Pause virtual time BEFORE any page code runs so all workers start from the same instant.
    await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pause', initialVirtualTime: VIRTUAL_EPOCH_S });
    await page.addInitScript(CLOCK_SCRIPT);
    await withTimeout(page.setContent(job.html, { waitUntil: 'load' }), cfg.frameTimeoutMs * 2, 'The page took too long to load.');
  } catch (e) {
    await context.close().catch(() => undefined);
    return toUserError(e, errors, 0);
  }

  let currentMs = 0;
  const advanceTo = async (targetMs: number): Promise<void> => {
    const delta = targetMs - currentMs;
    if (delta <= 0) return;
    const limit = cfg.frameTimeoutMs * Math.max(1, Math.ceil(delta / frameMs));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cdp.off('Emulation.virtualTimeBudgetExpired', onExpired);
        reject(new UserFacingError('The page did not settle while advancing animation time.', 422, true));
      }, limit);
      const onExpired = () => {
        clearTimeout(timer);
        resolve();
      };
      cdp.once('Emulation.virtualTimeBudgetExpired', onExpired);
      cdp
        .send('Emulation.setVirtualTimePolicy', { policy: 'pauseIfNetworkFetchesPending', budget: delta })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
    currentMs = targetMs;
  };

  return {
    async renderAt(index, file) {
      try {
        await advanceTo(index * frameMs);
        const shot = await withTimeout(
          cdp.send('Page.captureScreenshot', { format: 'png' }),
          cfg.frameTimeoutMs,
          `Frame ${index} timed out.`,
        );
        await saveAtomic(file, Buffer.from(shot.data, 'base64'));
      } catch (e) {
        toUserError(e, errors, index);
      }
    },
    close: () => context.close().catch(() => undefined),
  };
}

async function detectMode(browser: Browser, job: Job, cfg: ServerConfig): Promise<Mode> {
  const { context, page } = await openPage(browser, job);
  try {
    await withTimeout(page.setContent(job.html, { waitUntil: 'load' }), cfg.frameTimeoutMs * 2, 'The page took too long to load.');
    const hasDraw = await page.evaluate(
      () => typeof (window as unknown as { draw?: unknown }).draw === 'function',
    );
    return hasDraw ? 'draw' : 'virtual';
  } catch (e) {
    if (e instanceof UserFacingError) throw e;
    throw new UserFacingError('The page could not be loaded.', 422, false);
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function runWorker(
  job: Job,
  cfg: ServerConfig,
  browser: Browser,
  mode: Mode,
  range: FrameRange,
  isLast: boolean,
): Promise<void> {
  let renderer: FrameRenderer | undefined;
  const get = async (): Promise<FrameRenderer> => {
    renderer ??=
      mode === 'draw'
        ? await createDrawRenderer(browser, job, cfg)
        : await createVirtualRenderer(browser, job, cfg);
    return renderer;
  };
  try {
    for (let i = range.start; i < range.end; i++) {
      if (job.abort.signal.aborted) throw new Error('aborted');
      const file = job.framePath(i);
      // Resume: keep frames that are already complete, re-render corrupt/missing ones.
      if (!(await isValidPngFile(file))) await (await get()).renderAt(i, file);
      job.frameDone();
    }
    if (isLast && job.settings.loopCheck && !(await isValidPngFile(job.loopFramePath))) {
      await (await get()).renderAt(job.totalFrames, job.loopFramePath);
    }
  } finally {
    await renderer?.close();
  }
}

export async function renderJob(job: Job, cfg: ServerConfig): Promise<void> {
  await mkdir(job.framesDir, { recursive: true });
  job.resetProgress();

  let browser: Browser;
  try {
    browser = await chromium.launch({
      headless: true,
      chromiumSandbox: cfg.chromiumSandbox,
      args: [
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-background-networking',
        '--mute-audio',
        '--hide-scrollbars',
        '--force-color-profile=srgb',
        '--font-render-hinting=none',
        '--run-all-compositor-stages-before-draw',
        '--disable-threaded-animation',
        '--disable-threaded-scrolling',
        '--disable-checker-imaging',
        // Defence in depth: nothing but localhost can be resolved.
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
      ],
    });
  } catch (e) {
    console.error(`[job ${job.id}] chromium failed to launch`, e);
    throw new UserFacingError('The render browser could not be started on the server.', 500, true);
  }

  const onAbort = () => void browser.close().catch(() => undefined);
  job.abort.signal.addEventListener('abort', onAbort, { once: true });
  try {
    job.mode ??= await detectMode(browser, job, cfg);
    const ranges = splitRanges(job.totalFrames, cfg.workers);
    await Promise.all(
      ranges.map((range, i) => runWorker(job, cfg, browser, job.mode as Mode, range, i === ranges.length - 1)),
    );
    if (job.settings.loopCheck) {
      try {
        job.loop = await loopDifference(job.framePath(0), job.loopFramePath);
      } catch (e) {
        console.error(`[job ${job.id}] loop check failed`, e);
      }
    }
  } finally {
    job.abort.signal.removeEventListener('abort', onAbort);
    await browser.close().catch(() => undefined);
  }
}
