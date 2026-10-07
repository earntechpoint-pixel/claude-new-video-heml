import { useCallback, useMemo, useRef, useState } from 'react';
import { validateSettings, type RenderSettings } from '../../shared/settings';
import { HelpCard } from './components/HelpCard';
import { InputSection } from './components/InputSection';
import { PreviewSection, type PreviewHandle } from './components/PreviewSection';
import { RenderSection } from './components/RenderSection';
import { ResultSection } from './components/ResultSection';
import { SettingsSection, type ModeChoice } from './components/SettingsSection';
import type { LiveInfo } from './lib/bridge';
import { isWebCodecsSupported } from './lib/codec';
import { normalizeInput, recommend } from './lib/detect';
import { errorMessage } from './lib/errors';
import type { Sample } from './lib/samples';
import { useRenderJob } from './lib/useRenderJob';

const DEFAULTS: RenderSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 6,
  quality: 'medium',
  loopCheck: true,
};

export default function App() {
  const [code, setCode] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [settings, setSettings] = useState<RenderSettings>(DEFAULTS);
  const [modeChoice, setModeChoice] = useState<ModeChoice>('auto');
  const [audio, setAudio] = useState<File | null>(null);
  const [live, setLive] = useState<LiveInfo | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const previewRef = useRef<PreviewHandle>(null);
  const job = useRenderJob();

  const html = useMemo(() => normalizeInput(code), [code]);
  const rec = useMemo(() => recommend(code, live), [code, live]);
  const validation = useMemo(() => validateSettings(settings), [settings]);
  const settingsErrors = validation.ok ? [] : validation.errors;

  const effectiveMode: 'canvas' | 'server' | 'none' =
    modeChoice === 'auto' ? rec.mode : modeChoice;
  const webCodecs = isWebCodecsSupported();

  const disabledReason = useMemo<string | null>(() => {
    if (!code.trim()) return 'Add some code first.';
    if (!validation.ok) return 'Fix the settings above first.';
    if (effectiveMode === 'none') return 'This code cannot be rendered yet — see the help card above.';
    if (effectiveMode === 'canvas' && !webCodecs) return 'This browser has no WebCodecs support (see the note above).';
    if (effectiveMode === 'canvas' && live && !(live.hasCanvas && live.hasDraw)) {
      return 'Canvas mode needs a <canvas> and window.draw(t). Switch to “Full page (server)”.';
    }
    return null;
  }, [code, validation.ok, effectiveMode, webCodecs, live]);

  const onCode = useCallback((next: string, name: string | null) => {
    setCode(next);
    setFileName(name);
  }, []);

  const onSample = useCallback((s: Sample) => {
    setCode(s.html);
    setFileName(null);
    setSettings((prev) => ({ ...prev, duration: s.loopSeconds }));
  }, []);

  const onRender = () => {
    if (!validation.ok || (effectiveMode !== 'canvas' && effectiveMode !== 'server')) return;
    void job.start({ mode: effectiveMode, html, settings: validation.settings, audio });
  };

  const onExport = async () => {
    setExportError(null);
    try {
      const blob = await previewRef.current?.capturePng(settings.width, settings.height);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'frame.png';
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setExportError(errorMessage(e));
    }
  };

  const modeLabel =
    effectiveMode === 'canvas'
      ? 'Canvas (in-browser, WebCodecs)'
      : effectiveMode === 'server'
        ? 'Full page (server: Playwright + ffmpeg)'
        : 'not available';

  return (
    <main className="app">
      <header>
        <h1>Code2Video Web</h1>
        <p className="muted">Turn an HTML/JavaScript animation into an MP4 — rendered frame by frame, never in real time.</p>
      </header>

      <InputSection code={code} fileName={fileName} onCode={onCode} onSample={onSample} />

      {rec.mode === 'none' && code.trim() !== '' && <HelpCard onUseExample={(c) => onCode(c, null)} />}

      <PreviewSection
        ref={previewRef}
        html={html}
        width={validation.ok ? settings.width : 1280}
        height={validation.ok ? settings.height : 720}
        duration={Number.isFinite(settings.duration) && settings.duration > 0 ? settings.duration : 1}
        onInfo={setLive}
      />

      {code.trim() !== '' && (
        <p className="card note" role="status">
          <strong>
            Recommended:{' '}
            {rec.mode === 'canvas' ? 'Canvas (in-browser)' : rec.mode === 'server' ? 'Full page (server)' : 'none yet'}.
          </strong>{' '}
          {rec.reason}
        </p>
      )}
      {effectiveMode === 'canvas' && !webCodecs && (
        <p className="card error" role="alert">
          This browser does not support WebCodecs. Use a recent Chrome or Edge for in-browser rendering, or{' '}
          <button type="button" className="link" onClick={() => setModeChoice('server')}>
            switch to the server renderer
          </button>
          .
        </p>
      )}

      <SettingsSection
        settings={settings}
        onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
        modeChoice={modeChoice}
        onModeChoice={setModeChoice}
        audio={audio}
        onAudio={setAudio}
        errors={settingsErrors}
      />

      <RenderSection
        phase={job.phase}
        progress={job.progress}
        elapsedMs={job.elapsedMs}
        disabledReason={disabledReason}
        error={job.error}
        notice={job.notice}
        warnings={job.warnings}
        modeLabel={modeLabel}
        canExport={!!live?.hasDraw && !!live.hasCanvas}
        exportError={exportError}
        onRender={onRender}
        onCancel={job.cancel}
        onExport={() => void onExport()}
      />

      <ResultSection result={job.result} />

      <footer className="muted">
        Canvas mode runs entirely in your browser — your code is never uploaded. Server mode sends your HTML to the
        render server.
      </footer>
    </main>
  );
}
