import type { LiveInfo } from './bridge';

export interface Analysis {
  hasCanvas: boolean;
  hasDraw: boolean;
  looksLikeHtml: boolean;
  hasTimeBasedHints: boolean;
}

export type Recommendation =
  | { mode: 'canvas'; reason: string }
  | { mode: 'server'; reason: string }
  | { mode: 'none'; reason: string };

const HTML_RE = /<\s*(?:!doctype|html|head|body|canvas|div|svg|script|style|main|section|h[1-6]|p|span)\b/i;

export function looksLikeHtml(code: string): boolean {
  return HTML_RE.test(code);
}

/** Pure-JS snippets are wrapped in a page with a 1280×720 <canvas>. */
export function normalizeInput(code: string): string {
  if (!code.trim() || looksLikeHtml(code)) return code;
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000}canvas{display:block;width:100vw;height:100vh;object-fit:contain}</style></head><body><canvas id="canvas" width="1280" height="720"></canvas><script>
${code}
</script></body></html>`;
}

export function analyzeCode(code: string): Analysis {
  return {
    hasCanvas: /<canvas[\s>]/i.test(code) || /createElement\(\s*['"]canvas['"]\s*\)/.test(code) || /getContext\(/.test(code),
    hasDraw:
      /window\s*(?:\.\s*draw|\[\s*['"]draw['"]\s*\])\s*=/.test(code) ||
      /(?:^|[\s;}])function\s+draw\s*\(/.test(code),
    looksLikeHtml: looksLikeHtml(code),
    hasTimeBasedHints: /requestAnimationFrame|setInterval|setTimeout|@keyframes|animation\s*:|transition\s*:|\.animate\(|<animate/i.test(code),
  };
}

/** Live info (from actually loading the page in the sandbox) wins over static analysis. */
export function recommend(code: string, live: LiveInfo | null): Recommendation {
  if (!code.trim()) return { mode: 'none', reason: 'Paste some code or upload an .html file to get started.' };

  if (live) {
    if (live.hasDraw && live.hasCanvas) {
      return { mode: 'canvas', reason: 'Your page has a <canvas> and defines window.draw(t), so it can be rendered frame-perfectly in your browser.' };
    }
    if (live.hasDraw) {
      return { mode: 'server', reason: 'window.draw(t) exists but there is no <canvas>, so the full page is rendered on the server.' };
    }
    return { mode: 'server', reason: 'There is no window.draw(t) function, so the page is captured on the server with a virtual clock (CSS animations, SVG, requestAnimationFrame and timers stay in sync).' };
  }

  const a = analyzeCode(code);
  if (a.hasCanvas && a.hasDraw) {
    return { mode: 'canvas', reason: 'Detected a <canvas> and a global draw(t) function.' };
  }
  if (a.looksLikeHtml || a.hasTimeBasedHints) {
    return { mode: 'server', reason: 'No canvas + window.draw(t) pair detected, so the page needs the server renderer (virtual time).' };
  }
  return { mode: 'none', reason: 'This does not look like an animation the app can render yet.' };
}
