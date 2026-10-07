import { formatDuration } from '../lib/format';
import type { Phase } from '../lib/useRenderJob';
import type { Progress } from '../lib/canvasRenderer';

interface Props {
  phase: Phase;
  progress: Progress | null;
  elapsedMs: number;
  disabledReason: string | null;
  error: string | null;
  notice: string | null;
  warnings: string[];
  modeLabel: string;
  canExport: boolean;
  exportError: string | null;
  onRender: () => void;
  onCancel: () => void;
  onExport: () => void;
}

export function RenderSection(p: Props) {
  const busy = p.phase === 'rendering';
  const total = p.progress?.totalFrames ?? 0;
  const done = p.progress?.framesDone ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <section aria-labelledby="h-render" className="card">
      <h2 id="h-render">4 · Render</h2>
      <p className="muted">Mode: {p.modeLabel}</p>
      <div className="row">
        <button type="button" className="primary big" onClick={p.onRender} disabled={busy || p.disabledReason !== null}>
          {busy ? 'Rendering…' : 'Render video'}
        </button>
        {busy && (
          <button type="button" className="danger" onClick={p.onCancel}>
            Cancel
          </button>
        )}
      </div>
      {p.disabledReason && !busy && <p className="muted">{p.disabledReason}</p>}

      {busy && p.progress && (
        <div className="progress" aria-live="polite">
          <progress max={100} value={pct} aria-label="Render progress" />
          <div className="stats">
            <span>{p.progress.label}</span>
            <span>
              {done.toLocaleString()} / {total > 0 ? total.toLocaleString() : '…'} frames ({pct}%)
            </span>
            <span>Elapsed {formatDuration(p.elapsedMs / 1000)}</span>
            <span>ETA {formatDuration(p.progress.etaSeconds)}</span>
          </div>
          <p className="muted">Keep this tab open. Rendering continues if you switch tabs, just a little slower.</p>
        </div>
      )}

      {p.warnings.map((w) => (
        <p key={w} className="warn" role="status">
          ⚠ {w}
        </p>
      ))}
      {p.notice && <p role="status">{p.notice}</p>}
      {p.error && (
        <p role="alert" className="error">
          {p.error}
        </p>
      )}

      <hr />
      <button type="button" onClick={p.onExport} disabled={!p.canExport}>
        Export current frame as PNG
      </button>
      {p.exportError && (
        <p role="alert" className="error">
          {p.exportError}
        </p>
      )}
    </section>
  );
}
