# Code2Video Web

Paste or upload an HTML/JavaScript animation → preview it → pick video settings → get an **MP4**.
Frames are rendered **deterministically, one by one, never in real time**, so output is smooth even if the
machine is slow or the tab is in the background.

| Mode | For | Where it runs | Encoder |
| --- | --- | --- | --- |
| **A · Canvas (in-browser)** | `<canvas>` animations that expose `window.draw(t)` | Your browser only (no upload) | WebCodecs `VideoEncoder` + `mp4-muxer` |
| **B · Full page (server)** | Any HTML/CSS/JS/SVG page | Node + Playwright (Chromium) | ffmpeg (libx264) |

The app inspects your code (and the live sandbox) and **recommends** a mode; you can override it.

## Features

- Paste code (a full page, or just JS that defines `window.draw(t)`) or upload an `.html` file; two loopable samples.
- Sandboxed live preview (`sandbox="allow-scripts"`, no `allow-same-origin`, `postMessage` only), play/pause, scrubber, console panel (errors + `console.log`).
- Resolution presets up to 4K or custom (even numbers, ≤ 3840×2160), 24/30/60 fps, 1–120 s, Low/Medium/High quality, optional audio (mp3/wav/m4a, trimmed or padded to the duration), loop check, PNG export of the current frame.
- Mode A: H.264 High, automatic level selection (e.g. `avc1.640028` for 1080p30, `avc1.640033` for 4K30), `isConfigSupported` checks with fallbacks, keyframe every 2 s, back-pressure on the encoder queue, cancel at any time, AAC audio via `AudioEncoder`. No `MediaRecorder`/`captureStream`.
- Mode B: REST API + SSE progress (polling fallback), worker pool of 1–4 Playwright pages, atomic PNG writes with resume (corrupt/missing frames are re-rendered), automatic retry, ffmpeg encode, Range-capable video streaming, TTL cleanup.
- Safety: no network for the page (all requests aborted + DNS blocked), per-frame and per-job timeouts, 5 MB upload cap, ≤ 4K / ≤ 120 s, concurrency cap + queue, per-IP rate limits, random job IDs, sanitised errors (no server paths), user code runs only inside Chromium.
- Dark, mobile-first UI usable at ~380 px, keyboard accessible, reduced-motion aware.

## Requirements

- Node.js ≥ 20, npm
- Chromium for Playwright (`npm run install:browsers`)
- ffmpeg is bundled through `ffmpeg-static` (override with `FFMPEG_PATH`)
- For Mode A: a WebCodecs browser (current Chrome / Edge; recent Safari has partial support)

## Install & run (development)

```bash
npm run install:all        # root + server + client dependencies
npm run install:browsers   # downloads Chromium for Playwright (Mode B)
npm run dev                # server on :8080, client on :5173 (client proxies /api to the server)
```

Open http://localhost:5173. Mode A works even if the server is not running.

### Tests, lint, format

```bash
npm run test:unit    # fast tests (timestamps, range splitting, PNG validity, settings validation, codec levels, ffmpeg args)
npm test             # + end-to-end smoke test: renders 1 s @ 720p through the real HTTP API (needs Chromium)
npm run typecheck
npm run lint
npm run format
```

## Docker

```bash
docker compose up --build        # API on http://localhost:8080
```

The image is based on `mcr.microsoft.com/playwright:v1.49.1-noble` (keep it in sync with the pinned `playwright` version).
The compose file runs as a non-root user with a read-only filesystem, dropped capabilities, memory/CPU/pids limits and
tmpfs job storage. See "Chromium sandbox" below.

## Deployment

- **Frontend (Vercel / Netlify):** root = `client`, build `npm run build`, output `dist`. Set `VITE_API_URL=https://your-api.example.com`.
- **Backend (Railway / Fly.io / VPS):** deploy `server/Dockerfile` with the repo root as build context. Give it ≥ 2 GB RAM (4 GB for 4K), set `CORS_ORIGIN` to your frontend origin, `TRUST_PROXY=1` behind a proxy, and make sure the proxy does not buffer `text/event-stream` (the client falls back to polling anyway).
- Single-host option: `npm run build`, then run the server with `CLIENT_DIST=../client/dist` and it serves the UI too.

## Environment variables (server)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 8080 | HTTP port |
| `RENDER_WORKERS` | 2 | Parallel Playwright pages per job (1–4) |
| `MAX_CONCURRENT_JOBS` / `MAX_QUEUED_JOBS` | 1 / 10 | Jobs rendering at once / waiting in queue |
| `FRAME_TIMEOUT_MS` | 15000 | Per-frame timeout |
| `JOB_TIMEOUT_MS` | 1800000 | Whole-job timeout |
| `JOB_TTL_MS` | 3600000 | Finished jobs are deleted after this long (or ~2 min after a completed download) |
| `JOB_RETRIES` | 1 | Retries after a recoverable failure (existing valid frames are reused) |
| `JOBS_DIR` | `/tmp/jobs` | Working directory (frames, audio, output) |
| `MAX_AUDIO_MB` | 25 | Audio upload limit (HTML limit is fixed at 5 MB) |
| `CHROMIUM_SANDBOX` | true | Set `false` only inside a locked-down container (see below) |
| `CORS_ORIGIN` | `*` | Comma-separated allowed origins |
| `TRUST_PROXY` | 0 | Number of proxy hops (for correct per-IP rate limiting) |
| `RATE_LIMIT_PER_MIN` / `RATE_LIMIT_JOBS_PER_10MIN` | 600 / 10 | Per-IP limits (all API calls / job creation) |
| `FFMPEG_PATH` | bundled | Use a system ffmpeg |
| `CLIENT_DIST` | – | Path to `client/dist` to serve the UI from the API |

Client: `VITE_API_URL` (API base URL in production; empty in dev because Vite proxies `/api`), `VITE_DEV_PROXY` (dev proxy target).

### API

- `POST /api/jobs` — multipart: `file` (html) or `html` (text), `settings` (JSON), optional `audio` → `202 { jobId }`
- `GET /api/jobs/:id` → `{ status: queued|rendering|encoding|done|error|cancelled, framesDone, totalFrames, etaSeconds, error?, sizeBytes?, loop? }`
- `GET /api/jobs/:id/events` — Server-Sent Events with the same payload
- `GET /api/jobs/:id/video` — streams the MP4 (Range supported); `?download=1` adds `Content-Disposition`
- `DELETE /api/jobs/:id` — cancel and delete

## Authoring guide: `window.draw(t)`

Define one global function that paints your canvas for time `t` (seconds). The renderer calls it once per frame
(`t = frame / fps`), so never depend on `requestAnimationFrame`, `Date.now()` or `performance.now()`.

```html
<canvas id="c" width="1280" height="720"></canvas>
<script>
  var LOOP = 4;                       // loop length in seconds (set the Duration to this value)
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');

  window.draw = function (t) {
    var p = (t / LOOP) * Math.PI * 2; // phase: 0 → 2π over one loop
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#4af';
    ctx.beginPath();
    // 1 cycle per loop for the orbit, 3 cycles per loop for the size pulse (integers!)
    ctx.arc(640 + Math.cos(p) * 200, 360 + Math.sin(p) * 120, 40 + 8 * Math.sin(3 * p), 0, Math.PI * 2);
    ctx.fill();
  };
</script>
```

**Seamless loops:** every periodic motion must complete a **whole number of cycles** within the loop, so that
`draw(duration)` equals `draw(0)`. The loop check compares those two frames (160×90, mean absolute difference; > 2 % warns).
Set *Duration* to your loop length. Draw relative to `canvas.width/height` so it stays crisp when sizes differ.

Pages **without** `draw(t)` (CSS animations, SVG/SMIL, Web Animations, `requestAnimationFrame`, `setTimeout`) are rendered by
Mode B using Chrome DevTools virtual time: time is paused and advanced by exactly `1000/fps` ms per frame, and
`Date.now()`/`performance.now()` are normalised to start at the same value in every worker.

## Defaults & decisions (ambiguities resolved)

- Width/height must be even (H.264); the custom fields round up on blur. Max 3840 per side and ≤ 3840×2160 pixels.
- Frames = `round(duration × fps)`; fractional durations are allowed.
- Pasted code that contains no HTML tags is wrapped in a page with a 1280×720 `<canvas>`.
- Canvas size ≠ output size: scaled to fit, letterboxed in black, with a warning (Mode A). In Mode B the viewport equals the output size and your CSS decides the layout.
- Mode B audio is `-af apad -shortest` (silence-padded, trimmed to the video length). Mode A trims/pads the decoded PCM before AAC encoding.
- Download cleanup: after a completed `?download=1` request the job is removed after a 2-minute grace period (so the on-page player keeps working); otherwise after the TTL.
- Mode A bitrates are 8/14/24 Mbps at 1080p30, scaled by pixel count and frame rate. Mode B CRF is 18/16/14.
- Mode A keeps the whole MP4 in memory (`fastStart: 'in-memory'`), so very long 4K clips can exhaust RAM; use Mode B for those.

### Chromium sandbox

Chromium's own sandbox is **on** by default (`CHROMIUM_SANDBOX=true`). Inside Docker it normally requires user
namespaces (a custom seccomp profile such as Playwright's recommended one). The provided `docker-compose.yml` instead sets
`CHROMIUM_SANDBOX=false` and relies on the container boundary (non-root, `cap_drop: ALL`, read-only root, no-new-privileges,
resource limits) plus the page-level network block. If you can supply Playwright's seccomp profile, enable the Chromium sandbox.

## Known limitations

- Mode A is canvas-only (`<canvas>` + `window.draw(t)`) and needs a WebCodecs browser with H.264 encoding. Safari/Firefox support is limited.
- `window.draw` must be a property of `window` (`window.draw = …` or `function draw(){}` at top level); `const draw = …` is not visible to the bridge.
- WebGL canvases work only if the frame can be read right after `draw(t)` (use `preserveDrawingBuffer: true` if you get black frames).
- Frame export (PNG) is available only for `window.draw` canvases.
- Mode B virtual-time capture depends on Chromium's behaviour; heavy pages, GPU-only effects, video elements and web fonts that must be fetched from the network will not render (the page has no network access). Inline assets as `data:` URLs.
- Mode B needs a server with Chromium and several GB of RAM for 4K; jobs are stored in memory, so a server restart drops running jobs.
- Mode A audio needs `AudioEncoder` with AAC support; if unavailable the video is rendered without sound (with a warning).
- Mode A cannot show a page that sets its own canvas size inside `draw`.

## Project layout

```
code2video-web/
├── package.json  eslint.config.js  .prettierrc  docker-compose.yml  README.md
├── shared/        settings.ts  timing.ts  loop.ts          (used by client and server)
├── client/        React + Vite + TS
│   └── src/ App.tsx  main.tsx  styles.css
│       ├── components/  InputSection  PreviewSection  SettingsSection  RenderSection  ResultSection  HelpCard
│       └── lib/         bridge  detect  samples  codec  frame  audio  canvasRenderer  api  useRenderJob  format  errors  (+ tests)
└── server/        Express + Playwright + ffmpeg
    ├── Dockerfile
    ├── src/   index  app  config  jobs  render  encode  loopcheck  png  ranges  errors
    └── test/  ranges  png  encode  smoke (end-to-end)
```

## Final checklist

- [x] Input: paste / upload, two loopable `window.draw(t)` samples
- [x] Sandboxed preview, scale-to-fit 16:9, play/pause, scrubber, time label, console panel
- [x] Settings: resolution (presets + custom), FPS, duration, quality, render mode, loop check, optional audio
- [x] Render: progress bar, frames, elapsed, ETA, cancel, PNG export
- [x] Result: player, download, size/resolution/duration, loop result
- [x] Mode A: WebCodecs H.264 with auto level, `isConfigSupported`, 2 s keyframes, mp4-muxer in-memory fast start, back-pressure, cancel, AAC audio, no MediaRecorder
- [x] Mode B: all four endpoints + SSE, Playwright worker pool, `draw(t)` and CDP virtual-time paths, resume with PNG validation, ffmpeg libx264 with CRF 18/16/14, TTL cleanup
- [x] Safety: network blocked, timeouts, size/duration/resolution caps, concurrency + rate limits, sanitised errors
- [x] Loop check in both modes (160×90 mean absolute difference)
- [x] Auto-detection + help card with copy-paste example
- [x] Strict TypeScript, ESLint + Prettier, unit tests + end-to-end smoke test
- [x] Dockerfile + docker-compose.yml, deployment notes, known limitations
