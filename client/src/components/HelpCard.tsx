import { MINIMAL_EXAMPLE } from '../lib/samples';

export function HelpCard({ onUseExample }: { onUseExample: (code: string) => void }) {
  return (
    <aside className="card help" aria-labelledby="h-help">
      <h3 id="h-help">How to structure your code</h3>
      <p>
        Define one global function <code>window.draw(t)</code> that paints your <code>&lt;canvas&gt;</code> for time{' '}
        <code>t</code> (in seconds). Don’t rely on <code>requestAnimationFrame</code> or <code>Date.now()</code> — the
        renderer calls <code>draw</code> once per frame, so output is identical every time. For a seamless loop, use a
        whole number of cycles per loop.
      </p>
      <pre tabIndex={0}>
        <code>{MINIMAL_EXAMPLE}</code>
      </pre>
      <button type="button" onClick={() => onUseExample(MINIMAL_EXAMPLE)}>
        Use this example
      </button>
      <p className="muted">
        Pure DOM/CSS/SVG pages without <code>draw(t)</code> also work through the server renderer.
      </p>
    </aside>
  );
}
