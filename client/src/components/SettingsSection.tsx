import { useState } from 'react';
import {
  FPS_OPTIONS,
  LIMITS,
  QUALITY_OPTIONS,
  RESOLUTION_PRESETS,
  type Fps,
  type Quality,
  type RenderSettings,
} from '../../../shared/settings';

export type ModeChoice = 'auto' | 'canvas' | 'server';

interface Props {
  settings: RenderSettings;
  onChange: (patch: Partial<RenderSettings>) => void;
  modeChoice: ModeChoice;
  onModeChoice: (m: ModeChoice) => void;
  audio: File | null;
  onAudio: (f: File | null) => void;
  errors: string[];
}

const even = (n: number): number => (n % 2 === 0 ? n : n + 1);
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function SettingsSection({ settings, onChange, modeChoice, onModeChoice, audio, onAudio, errors }: Props) {
  const presetIdx = RESOLUTION_PRESETS.findIndex((p) => p.width === settings.width && p.height === settings.height);
  const [custom, setCustom] = useState(presetIdx < 0);
  const selectValue = custom || presetIdx < 0 ? 'custom' : String(presetIdx);

  return (
    <section aria-labelledby="h-settings" className="card">
      <h2 id="h-settings">3 · Settings</h2>
      <div className="grid">
        <div className="field">
          <label htmlFor="res">Resolution</label>
          <select
            id="res"
            value={selectValue}
            onChange={(e) => {
              if (e.target.value === 'custom') return setCustom(true);
              setCustom(false);
              const p = RESOLUTION_PRESETS[Number(e.target.value)];
              onChange({ width: p.width, height: p.height });
            }}
          >
            {RESOLUTION_PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </div>

        {selectValue === 'custom' && (
          <div className="field two">
            <div>
              <label htmlFor="w">Width</label>
              <input
                id="w"
                type="number"
                inputMode="numeric"
                min={LIMITS.minSide}
                max={LIMITS.maxSide}
                step={2}
                value={settings.width}
                onChange={(e) => onChange({ width: Math.round(Number(e.target.value)) })}
                onBlur={() => onChange({ width: even(clamp(settings.width || 0, LIMITS.minSide, LIMITS.maxSide)) })}
              />
            </div>
            <div>
              <label htmlFor="h">Height</label>
              <input
                id="h"
                type="number"
                inputMode="numeric"
                min={LIMITS.minSide}
                max={LIMITS.maxSide}
                step={2}
                value={settings.height}
                onChange={(e) => onChange({ height: Math.round(Number(e.target.value)) })}
                onBlur={() => onChange({ height: even(clamp(settings.height || 0, LIMITS.minSide, LIMITS.maxSide)) })}
              />
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="fps">Frame rate</label>
          <select id="fps" value={settings.fps} onChange={(e) => onChange({ fps: Number(e.target.value) as Fps })}>
            {FPS_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="dur">Duration (seconds, {LIMITS.minDuration}–{LIMITS.maxDuration})</label>
          <input
            id="dur"
            type="number"
            inputMode="decimal"
            min={LIMITS.minDuration}
            max={LIMITS.maxDuration}
            step={0.5}
            value={Number.isFinite(settings.duration) ? settings.duration : ''}
            onChange={(e) => onChange({ duration: e.target.value === '' ? Number.NaN : Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <label htmlFor="quality">Quality</label>
          <select id="quality" value={settings.quality} onChange={(e) => onChange({ quality: e.target.value as Quality })}>
            {QUALITY_OPTIONS.map((q) => (
              <option key={q} value={q}>
                {q[0].toUpperCase() + q.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="mode">Render mode</label>
          <select id="mode" value={modeChoice} onChange={(e) => onModeChoice(e.target.value as ModeChoice)}>
            <option value="auto">Auto (recommended)</option>
            <option value="canvas">Canvas (in-browser)</option>
            <option value="server">Full page (server)</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="audio">Audio (optional, mp3 / wav / m4a)</label>
          <input
            id="audio"
            type="file"
            accept=".mp3,.wav,.m4a,audio/*"
            onChange={(e) => onAudio(e.target.files?.[0] ?? null)}
          />
          {audio && (
            <p className="muted">
              {audio.name} — trimmed or padded with silence to {Number.isFinite(settings.duration) ? settings.duration : '?'} s.{' '}
              <button type="button" className="link" onClick={() => onAudio(null)}>
                Remove
              </button>
            </p>
          )}
        </div>

        <div className="field check">
          <input
            id="loop"
            type="checkbox"
            checked={settings.loopCheck}
            onChange={(e) => onChange({ loopCheck: e.target.checked })}
          />
          <label htmlFor="loop">Loop check (compare the last frame with the first)</label>
        </div>
      </div>

      {errors.length > 0 && (
        <ul role="alert" className="error list">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
