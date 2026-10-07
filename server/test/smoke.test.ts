import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { JobManager, type JobSnapshot } from '../src/jobs';

// Needs Chromium: `npm run install:browsers`. Skip with SKIP_E2E=1 or `npm run test:unit`.
const DRAW_PAGE = `<!doctype html><html><body style="margin:0"><canvas id="c" width="640" height="360" style="width:100vw;height:100vh"></canvas>
<script>
var c=document.getElementById('c'),x=c.getContext('2d');
window.draw=function(t){x.fillStyle='#102';x.fillRect(0,0,640,360);
var a=t*2*Math.PI; x.fillStyle='#fc3'; x.beginPath(); x.arc(320+Math.cos(a)*100,180+Math.sin(a)*100,30,0,7); x.fill();};
</script></body></html>`;

const CSS_PAGE = `<!doctype html><html><head><style>
html,body{margin:0;background:#000}
.box{position:absolute;top:100px;left:0;width:100px;height:100px;background:#4af;animation:move 1s linear infinite}
@keyframes move{from{transform:translateX(0)}to{transform:translateX(1000px)}}
</style></head><body><div class="box"></div></body></html>`;

describe.skipIf(process.env.SKIP_E2E === '1')('Mode B end-to-end smoke test (1 s, 720p)', () => {
  let server: Server;
  let base: string;
  let manager: JobManager;

  beforeAll(async () => {
    const cfg = loadConfig({}, {
      jobsDir: await mkdtemp(path.join(os.tmpdir(), 'c2v-smoke-')),
      workers: 2,
      port: 0,
    });
    manager = new JobManager(cfg);
    await manager.init();
    server = createApp(cfg, manager).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    await manager?.shutdown();
  });

  async function render(html: string): Promise<{ id: string; final: JobSnapshot }> {
    const fd = new FormData();
    fd.append('file', new Blob([html], { type: 'text/html' }), 'index.html');
    fd.append(
      'settings',
      JSON.stringify({ width: 1280, height: 720, fps: 24, duration: 1, quality: 'low', loopCheck: true }),
    );
    const res = await fetch(`${base}/api/jobs`, { method: 'POST', body: fd });
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };

    const deadline = Date.now() + 150_000;
    for (;;) {
      const snap = (await (await fetch(`${base}/api/jobs/${jobId}`)).json()) as JobSnapshot;
      if (snap.status === 'done' || snap.status === 'error') return { id: jobId, final: snap };
      if (Date.now() > deadline) throw new Error('smoke test timed out');
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async function expectMp4(id: string): Promise<void> {
    const ranged = await fetch(`${base}/api/jobs/${id}/video`, { headers: { Range: 'bytes=0-99' } });
    expect(ranged.status).toBe(206);
    const full = Buffer.from(await (await fetch(`${base}/api/jobs/${id}/video`)).arrayBuffer());
    expect(full.length).toBeGreaterThan(2000);
    expect(full.subarray(4, 8).toString()).toBe('ftyp');
  }

  it('renders a window.draw(t) page to an MP4 and reports a seamless loop', async () => {
    const { id, final } = await render(DRAW_PAGE);
    expect(final.error).toBeUndefined();
    expect(final.status).toBe('done');
    expect(final.framesDone).toBe(24);
    expect(final.loop?.seamless).toBe(true);
    await expectMp4(id);
    const del = await fetch(`${base}/api/jobs/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
  });

  it('renders a CSS-animation page through virtual time', async () => {
    const { id, final } = await render(CSS_PAGE);
    expect(final.error).toBeUndefined();
    expect(final.status).toBe('done');
    await expectMp4(id);
  });

  it('rejects invalid settings with a friendly error', async () => {
    const fd = new FormData();
    fd.append('html', DRAW_PAGE);
    fd.append('settings', JSON.stringify({ width: 1281, height: 720, fps: 25, duration: 500, quality: 'x' }));
    const res = await fetch(`${base}/api/jobs`, { method: 'POST', body: fd });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/even|FPS|Duration/);
  });
});
