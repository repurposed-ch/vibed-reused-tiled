import { useProject } from '../project-context';

export function SettingsPage() {
  const { llmSettings, setLlmSettings } = useProject();

  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="lede">
        LLM assist calls a user-configured HTTPS endpoint. API keys are stored only in this
        browser (localStorage). Prefer a proxy that holds the provider key for anything beyond
        local demos.
      </p>

      <section className="panel">
        <h2>LLM proxy</h2>
        <div className="stack">
          <div className="field">
            <label htmlFor="endpoint">Endpoint URL</label>
            <input
              id="endpoint"
              className="mono"
              placeholder="https://your-proxy.example/assist"
              value={llmSettings.endpoint}
              onChange={(e) => setLlmSettings({ ...llmSettings, endpoint: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="apiKey">API key (optional)</label>
            <input
              id="apiKey"
              type="password"
              className="mono"
              value={llmSettings.apiKey}
              onChange={(e) => setLlmSettings({ ...llmSettings, apiKey: e.target.value })}
              autoComplete="off"
            />
          </div>
        </div>
        <p className="muted" style={{ marginTop: '0.75rem' }}>
          Default from <span className="mono">VITE_LLM_PROXY_URL</span> when set at build time.
          Expected POST body: prompt, tileDefinitions, stock?, currentFamily?. Response must be
          DesignFamily JSON (or wrapped in a <span className="mono">family</span> /
          <span className="mono">designFamily</span> field).
        </p>
      </section>
    </div>
  );
}
