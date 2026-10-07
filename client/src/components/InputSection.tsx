import { useRef, useState } from 'react';
import { SAMPLES, type Sample } from '../lib/samples';

const MAX_BYTES = 5 * 1024 * 1024;

interface Props {
  code: string;
  fileName: string | null;
  onCode: (code: string, fileName: string | null) => void;
  onSample: (sample: Sample) => void;
}

export function InputSection({ code, fileName, onCode, onSample }: Props) {
  const [tab, setTab] = useState<'paste' | 'upload'>('paste');
  const [fileError, setFileError] = useState<string | null>(null);
  const [sampleIdx, setSampleIdx] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    if (!/\.html?$/i.test(file.name)) return setFileError('Please choose an .html file.');
    if (file.size > MAX_BYTES) return setFileError('That file is larger than the 5 MB limit.');
    try {
      onCode(await file.text(), file.name);
    } catch {
      setFileError('The file could not be read.');
    }
  };

  return (
    <section aria-labelledby="h-input" className="card">
      <h2 id="h-input">1 · Input</h2>
      <div role="tablist" aria-label="Input method" className="tabs">
        {(['paste', 'upload'] as const).map((id) => (
          <button
            key={id}
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') setTab(tab === 'paste' ? 'upload' : 'paste');
            }}
          >
            {id === 'paste' ? 'Paste code' : 'Upload file'}
          </button>
        ))}
      </div>

      {tab === 'paste' ? (
        <div role="tabpanel" id="panel-paste" aria-labelledby="tab-paste">
          <label htmlFor="code" className="sr-only">
            HTML or JavaScript code
          </label>
          <textarea
            id="code"
            className="code"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="Paste a full HTML page, or just JavaScript that defines window.draw(t) on a canvas…"
            value={code}
            onChange={(e) => onCode(e.target.value, null)}
            rows={10}
          />
        </div>
      ) : (
        <div role="tabpanel" id="panel-upload" aria-labelledby="tab-upload">
          <input
            ref={fileRef}
            id="file"
            type="file"
            accept=".html,.htm,text/html"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          {fileName && (
            <p className="muted">
              Loaded <strong>{fileName}</strong> ({code.length.toLocaleString()} characters). Switch to “Paste code”
              to edit it.
            </p>
          )}
          {fileError && (
            <p role="alert" className="error">
              {fileError}
            </p>
          )}
        </div>
      )}

      <div className="row">
        <label htmlFor="sample" className="sr-only">
          Sample animation
        </label>
        <select id="sample" value={sampleIdx} onChange={(e) => setSampleIdx(Number(e.target.value))}>
          {SAMPLES.map((s, i) => (
            <option key={s.id} value={i}>
              {s.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => onSample(SAMPLES[sampleIdx])}>
          Load sample
        </button>
        {code && (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              onCode('', null);
              if (fileRef.current) fileRef.current.value = '';
            }}
          >
            Clear
          </button>
        )}
      </div>
    </section>
  );
}
