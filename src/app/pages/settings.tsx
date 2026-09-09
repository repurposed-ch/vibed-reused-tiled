import { useProject } from '../project-context';
import {
  AWESOME_FREE_LLM_APIS_URL,
  getProvider,
  LLM_PROVIDERS,
  providerRequiresApiKey,
  resolveModelForProvider,
} from '@/llm/providers';

export function SettingsPage() {
  const { llmSettings, setLlmSettings } = useProject();
  const provider = getProvider(llmSettings.provider);
  const needsKey = providerRequiresApiKey(provider);

  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="lede">
        LLM assist calls a free-tier provider from this browser. Keys stay in localStorage and are
        only sent to the selected provider. Some providers need no key.
      </p>

      <section className="panel">
        <h2>LLM</h2>
        <div className="stack">
          <div className="field">
            <label htmlFor="provider">Provider</label>
            <select
              id="provider"
              value={provider.id}
              onChange={(e) => {
                const next = getProvider(e.target.value);
                setLlmSettings({
                  ...llmSettings,
                  provider: next.id,
                  model: resolveModelForProvider(next, undefined),
                });
              }}
            >
              {LLM_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.auth === 'none' ? ' (no key)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="model">Model</label>
            <select
              id="model"
              value={resolveModelForProvider(provider, llmSettings.model)}
              onChange={(e) => setLlmSettings({ ...llmSettings, model: e.target.value })}
            >
              {provider.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {needsKey ? (
            <div className="field">
              <label htmlFor="apiKey">
                API key{' '}
                <a href={AWESOME_FREE_LLM_APIS_URL} target="_blank" rel="noreferrer">
                  Free LLM API list
                </a>
              </label>
              <input
                id="apiKey"
                type="password"
                className="mono"
                value={llmSettings.apiKey}
                onChange={(e) => setLlmSettings({ ...llmSettings, apiKey: e.target.value })}
                autoComplete="off"
                placeholder={`${provider.label} API key`}
              />
              {provider.keyUrl && (
                <p className="muted" style={{ marginTop: '0.35rem' }}>
                  Get a key:{' '}
                  <a href={provider.keyUrl} target="_blank" rel="noreferrer">
                    {provider.keyUrl.replace(/^https?:\/\//, '')}
                  </a>
                </p>
              )}
            </div>
          ) : (
            <p className="muted">
              This provider does not require an API key for its free anonymous tier. See the{' '}
              <a href={AWESOME_FREE_LLM_APIS_URL} target="_blank" rel="noreferrer">
                free LLM API list
              </a>
              .
            </p>
          )}
        </div>
        <p className="muted" style={{ marginTop: '0.75rem' }}>
          Defaults from <span className="mono">VITE_LLM_PROVIDER</span> /{' '}
          <span className="mono">VITE_LLM_MODEL</span> when set at build time. Browser CORS may
          block some providers — switch provider if a call fails with a network error. Do not
          commit keys.
        </p>
      </section>
    </div>
  );
}
