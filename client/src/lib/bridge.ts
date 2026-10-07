import { UserError } from './errors';

export interface LiveInfo {
  hasCanvas: boolean;
  hasDraw: boolean;
  width: number;
  height: number;
}

export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  text: string;
  ts: number;
}

/**
 * Runs inside the sandboxed iframe (sandbox="allow-scripts", opaque origin).
 * Talks to the host only through postMessage.
 */
const BRIDGE_SOURCE = `(function () {
  var post = function (m) { m.source = 'c2v'; parent.postMessage(m, '*'); };
  function fmt(a) {
    try {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.stack || String(a);
      return JSON.stringify(a);
    } catch (e) { return String(a); }
  }
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var orig = console[level];
    console[level] = function () {
      post({ type: 'console', level: level, text: Array.prototype.map.call(arguments, fmt).join(' ') });
      if (orig) orig.apply(console, arguments);
    };
  });
  window.addEventListener('error', function (e) {
    post({ type: 'console', level: 'error', text: (e.message || 'Error') + (e.lineno ? ' (line ' + e.lineno + ')' : '') });
  });
  window.addEventListener('unhandledrejection', function (e) {
    post({ type: 'console', level: 'error', text: 'Unhandled promise rejection: ' + fmt(e.reason) });
  });
  function findCanvas() { return document.querySelector('canvas'); }
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.source !== 'c2v-host') return;
    function reply(extra, transfer) {
      extra.source = 'c2v'; extra.type = 'reply'; extra.id = d.id;
      parent.postMessage(extra, '*', transfer || []);
    }
    try {
      if (d.cmd === 'init') {
        var c = findCanvas();
        reply({ ok: true, hasCanvas: !!c, hasDraw: typeof window.draw === 'function',
                width: c ? c.width : 0, height: c ? c.height : 0 });
      } else if (d.cmd === 'setTime') {
        if (typeof window.draw === 'function') window.draw(d.t);
        reply({ ok: true });
      } else if (d.cmd === 'drawFrame') {
        var cv = findCanvas();
        if (!cv) { reply({ ok: false, error: 'No <canvas> element was found in your page.' }); return; }
        if (typeof window.draw !== 'function') { reply({ ok: false, error: 'window.draw(t) is not defined.' }); return; }
        window.draw(d.t);
        createImageBitmap(cv).then(
          function (bmp) { reply({ ok: true, bitmap: bmp, width: cv.width, height: cv.height }, [bmp]); },
          function (err) { reply({ ok: false, error: 'Could not read the canvas: ' + (err && err.message || err) }); }
        );
      } else {
        reply({ ok: false, error: 'Unknown command' });
      }
    } catch (err) {
      reply({ ok: false, error: 'draw(' + d.t + ') threw: ' + (err && err.message || err) });
    }
  });
})();`;

/** Inserts the bridge script as early as possible without breaking doctype/quirks mode. */
export function injectBridge(html: string): string {
  const tag = `<script>${BRIDGE_SOURCE}</script>`;
  const insertAfter = (re: RegExp): string | null => {
    const m = re.exec(html);
    return m ? html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length) : null;
  };
  return (
    insertAfter(/<head(?:\s[^>]*)?>/i) ??
    insertAfter(/<html(?:\s[^>]*)?>/i) ??
    insertAfter(/<!doctype[^>]*>/i) ??
    tag + html
  );
}

interface Reply {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

interface Pending {
  resolve: (r: Reply) => void;
  reject: (e: Error) => void;
  timer: number;
}

export class SandboxBridge {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private disposed = false;

  constructor(
    readonly iframe: HTMLIFrameElement,
    private readonly onConsole?: (entry: ConsoleEntry) => void,
    private readonly ownsIframe = false,
  ) {
    window.addEventListener('message', this.onMessage);
  }

  /** Creates an off-screen iframe used only for rendering, so the visible preview is unaffected. */
  static async createHidden(html: string): Promise<SandboxBridge> {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    Object.assign(iframe.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      width: '1280px',
      height: '720px',
      border: '0',
      visibility: 'hidden',
    });
    const loaded = new Promise<void>((resolve) => iframe.addEventListener('load', () => resolve(), { once: true }));
    iframe.srcdoc = html;
    document.body.appendChild(iframe);
    const bridge = new SandboxBridge(iframe, undefined, true);
    await loaded;
    return bridge;
  }

  private onMessage = (ev: MessageEvent): void => {
    if (ev.source !== this.iframe.contentWindow) return;
    const d = ev.data as { source?: string; type?: string; id?: number } | null;
    if (!d || d.source !== 'c2v') return;
    if (d.type === 'console') {
      const m = ev.data as { level: ConsoleEntry['level']; text: string };
      this.onConsole?.({ level: m.level, text: m.text, ts: Date.now() });
    } else if (d.type === 'reply' && typeof d.id === 'number') {
      const p = this.pending.get(d.id);
      if (!p) return;
      this.pending.delete(d.id);
      window.clearTimeout(p.timer);
      p.resolve(ev.data as Reply);
    }
  };

  private request(cmd: string, payload: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<Reply> {
    return new Promise<Reply>((resolve, reject) => {
      const win = this.iframe.contentWindow;
      if (this.disposed || !win) {
        reject(new UserError('The preview is not available.'));
        return;
      }
      const id = this.nextId++;
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new UserError('Your code did not respond in time. Check for an infinite loop in draw(t).'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      win.postMessage({ source: 'c2v-host', id, cmd, ...payload }, '*');
    });
  }

  async init(): Promise<LiveInfo> {
    const r = await this.request('init');
    return {
      hasCanvas: r.hasCanvas === true,
      hasDraw: r.hasDraw === true,
      width: Number(r.width) || 0,
      height: Number(r.height) || 0,
    };
  }

  async setTime(t: number): Promise<void> {
    const r = await this.request('setTime', { t });
    if (!r.ok) throw new UserError(r.error ?? 'draw(t) failed.');
  }

  /** Calls draw(t) in the sandbox and returns the canvas pixels as a transferred ImageBitmap. */
  async drawFrame(t: number): Promise<ImageBitmap> {
    const r = await this.request('drawFrame', { t });
    if (!r.ok || !(r.bitmap instanceof ImageBitmap)) throw new UserError(r.error ?? 'draw(t) failed.');
    return r.bitmap;
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('message', this.onMessage);
    for (const p of this.pending.values()) {
      window.clearTimeout(p.timer);
      p.reject(new UserError('The preview was closed.'));
    }
    this.pending.clear();
    if (this.ownsIframe) this.iframe.remove();
  }
}
