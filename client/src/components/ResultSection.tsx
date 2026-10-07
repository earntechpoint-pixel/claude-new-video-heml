import { formatBytes, formatClock } from '../lib/format';
import type { RenderResult } from '../lib/useRenderJob';

export function ResultSection({ result }: { result: RenderResult | null }) {
  if (!result) return null;
  const loop = result.loop;
  return (
    <section aria-labelledby="h-result" className="card">
      <h2 id="h-result">5 · Result</h2>
      <video className="player" src={result.url} controls playsInline loop preload="metadata" />
      <dl className="meta">
        <div>
          <dt>Size</dt>
          <dd>{result.sizeBytes ? formatBytes(result.sizeBytes) : '—'}</dd>
        </div>
        <div>
          <dt>Resolution</dt>
          <dd>
            {result.width}×{result.height}
          </dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{formatClock(result.duration)}</dd>
        </div>
      </dl>
      <a className="button primary big" href={result.downloadUrl} download="code2video.mp4">
        Download MP4
      </a>
      {loop && (
        <p role="status" className={loop.seamless ? 'ok' : 'warn'}>
          {loop.seamless ? '✓ Seamless loop OK' : '⚠ This animation may not loop seamlessly'}{' '}
          <span className="muted">(difference {(loop.difference * 100).toFixed(2)}%)</span>
        </p>
      )}
      {result.mode === 'server' && (
        <p className="muted">The server deletes your video after you download it, or after one hour.</p>
      )}
    </section>
  );
}
