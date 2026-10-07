import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { SandboxBridge, injectBridge, type ConsoleEntry, type LiveInfo } from '../lib/bridge';
import { UserError } from '../lib/errors';
import { drawLetterboxed } from '../lib/frame';
import { formatClock } from '../lib/format';

export interface PreviewHandle {
  /** Renders the frame at the current preview time as PNG at the output resolution. */
  capturePng(width: number, height: number): Promise<Blob>;
}

interface Props {
  html: string;
  width: number;
  height: number;
  duration: number;
  onInfo: (info: LiveInfo | null) => void;
}

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const PreviewSection = forwardRef<PreviewHandle, Props>(function PreviewSection(
  { html, width, height, duration, onInfo },
  ref,
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<SandboxBridge | null>(null);
  const timeRef = useRef(0);
  const inflightRef = useRef(false);

  const [srcDoc, setSrcDoc] = useState('');
  const [info, setInfo] = useState<LiveInfo | null>(null);
  const [logs, setLogs] = useState<ConsoleEntry[]>([]);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [layout, setLayout] = useState({ scale: 0.3, x: 0, y: 0 });

  // Debounce so typing in the textarea does not reload the sandbox on every key.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSrcDoc(html.trim() ? injectBridge(html) : '');
      setLogs([]);
      setInfo(null);
      onInfo(null);
      setPlaying(false);
    }, 400);
    return () => window.clearTimeout(t);
  }, [html, onInfo]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const bridge = new SandboxBridge(iframe, (e) => setLogs((l) => [...l.slice(-199), e]));
    bridgeRef.current = bridge;
    return () => {
      bridge.dispose();
      bridgeRef.current = null;
    };
  }, []);

  // Fit the (width × height) page into the 16:9 stage.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const { clientWidth: cw, clientHeight: ch } = stage;
      const scale = Math.min(cw / width, ch / height);
      setLayout({ scale, x: (cw - width * scale) / 2, y: (ch - height * scale) / 2 });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [width, height]);

  const seek = useCallback((t: number) => {
    timeRef.current = t;
    setTime(t);
    const bridge = bridgeRef.current;
    if (!bridge || inflightRef.current) return;
    inflightRef.current = true;
    bridge
      .setTime(t)
      .catch(() => undefined)
      .finally(() => {
        inflightRef.current = false;
        // The user may have scrubbed further while this call was in flight.
        if (timeRef.current !== t && bridgeRef.current === bridge) seek(timeRef.current);
      });
  }, []);

  const onLoad = useCallback(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !srcDoc) return;
    bridge
      .init()
      .then((i) => {
        setInfo(i);
        onInfo(i);
        if (i.hasDraw) {
          seek(0);
          setPlaying(!prefersReducedMotion());
        }
      })
      .catch(() => undefined);
  }, [srcDoc, onInfo, seek]);

  // Preview playback loop. (Only the preview uses rAF — rendering never does.)
  useEffect(() => {
    if (!playing || !info?.hasDraw) return;
    const startedAt = performance.now() - timeRef.current * 1000;
    let raf = 0;
    const tick = () => {
      seek(((performance.now() - startedAt) / 1000) % duration);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, info, duration, seek]);

  useImperativeHandle(ref, () => ({
    async capturePng(w, h) {
      const bridge = bridgeRef.current;
      if (!bridge || !info?.hasDraw || !info.hasCanvas) {
        throw new UserError('Frame export needs a <canvas> and a window.draw(t) function.');
      }
      const bitmap = await bridge.drawFrame(Math.min(timeRef.current, duration));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new UserError('Could not create a drawing surface.');
      drawLetterboxed(ctx, bitmap, w, h);
      bitmap.close();
      return canvas.convertToBlob({ type: 'image/png' });
    },
  }));

  const controllable = info?.hasDraw === true;

  return (
    <section aria-labelledby="h-preview" className="card">
      <h2 id="h-preview">2 · Preview</h2>
      <div className="stage" ref={stageRef}>
        <iframe
          ref={iframeRef}
          title="Animation preview (sandboxed)"
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          onLoad={onLoad}
          style={{
            width,
            height,
            display: srcDoc ? 'block' : 'none',
            transform: `translate(${layout.x}px, ${layout.y}px) scale(${layout.scale})`,
          }}
        />
        {!srcDoc && <p className="stage-empty">Your animation will appear here.</p>}
      </div>

      <div className="row controls">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          disabled={!controllable}
          aria-pressed={playing}
          className="primary-ish"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <label htmlFor="scrub" className="sr-only">
          Time
        </label>
        <input
          id="scrub"
          type="range"
          min={0}
          max={duration}
          step={0.01}
          value={Math.min(time, duration)}
          disabled={!controllable}
          onChange={(e) => {
            setPlaying(false);
            seek(Number(e.target.value));
          }}
        />
        <output className="time" aria-live="off">
          {formatClock(time)} / {formatClock(duration)}
        </output>
      </div>
      {srcDoc && info && !controllable && (
        <p className="muted">
          Live preview: this page has no <code>window.draw(t)</code>, so it plays on its own clock and cannot be
          scrubbed. The server renders it frame by frame.
        </p>
      )}

      <details className="console" open={logs.some((l) => l.level === 'error')}>
        <summary>
          Console {logs.length > 0 && <span className="badge">{logs.length}</span>}
        </summary>
        <div role="log" aria-label="Console output" className="log">
          {logs.length === 0 && <span className="muted">No output yet.</span>}
          {logs.map((l, i) => (
            <div key={i} className={`log-${l.level}`}>
              <span className="log-level">{l.level}</span> {l.text}
            </div>
          ))}
        </div>
        {logs.length > 0 && (
          <button type="button" className="ghost small" onClick={() => setLogs([])}>
            Clear console
          </button>
        )}
      </details>
    </section>
  );
});
