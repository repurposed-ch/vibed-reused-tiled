import { useProject } from '../project-context';
import { DEFAULT_GEMINI_MODEL } from '@/llm/assist';

export function SettingsPage() {
  const { llmSettings, setLlmSettings } = useProject();

  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="lede">
        LLM assist calls Google Gemini <span className="mono">generateContent</span> from this
        browser. The API key is stored only in localStorage and sent to Google’s Generative
        Language API.
      </p>

      <section className="panel">
        <h2>Gemini</h2>
        <div className="stack">
          <div className="field">
            <label htmlFor="apiKey">API key</label>
            <input
              id="apiKey"
              type="password"
              className="mono"
              value={llmSettings.apiKey}
              onChange={(e) => setLlmSettings({ ...llmSettings, apiKey: e.target.value })}
              autoComplete="off"
              placeholder="from Google AI Studio"
            />
          </div>
          <div className="field">
            <label htmlFor="model">Model</label>
            <input
              id="model"
              className="mono"
              value={llmSettings.model}
              onChange={(e) => setLlmSettings({ ...llmSettings, model: e.target.value })}
              placeholder={DEFAULT_GEMINI_MODEL}
            />
          </div>
        </div>
        <p className="muted" style={{ marginTop: '0.75rem' }}>
          Default model from <span className="mono">VITE_GEMINI_MODEL</span> when set at build time
          (falls back to <span className="mono">{DEFAULT_GEMINI_MODEL}</span>). Prefer a concrete model
          id if you see 503 overload errors (avoid <span className="mono">gemini-flash-latest</span>).
          Create a key at{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            Google AI Studio
          </a>
          . Do not commit keys.
        </p>
      </section>
    </div>
  );
}
