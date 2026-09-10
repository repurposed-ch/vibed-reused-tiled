import {
  createMaterialDefinition,
  MaterialDefinitionJsonSchema,
  tileDisplayColor,
  type MaterialDefinitionJson,
} from '@/domain/project';
import { assistMaterial } from '@/llm/assist';
import { getProvider, providerRequiresApiKey } from '@/llm/providers';
import { bakeMaterialTexture } from '@/render/materials';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProject } from '../project-context';
import { useUiState } from '../ui-state';

function MaterialPreview({
  material,
  colorHex,
}: {
  material: MaterialDefinitionJson;
  colorHex: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    try {
      const baked = bakeMaterialTexture(
        {
          material,
          color: { mode: 'brightness', color: colorHex },
          length: 0.3,
          width: 0.3,
        },
        128,
      );
      setUrl(baked.dataUrl);
    } catch {
      setUrl(null);
    }
  }, [material, colorHex]);

  if (!url) {
    return (
      <div
        style={{
          width: 128,
          height: 128,
          background: colorHex,
          border: '1px solid #3a322c',
        }}
      />
    );
  }
  return (
    <img
      src={url}
      alt={`${material.name} preview`}
      width={128}
      height={128}
      style={{ imageRendering: 'pixelated', border: '1px solid #3a322c' }}
    />
  );
}

export function MaterialsPage() {
  const { project, updateProject, llmSettings } = useProject();
  const [selectedId, setSelectedId] = useState<string | null>(
    project.materials[0]?.id ?? null,
  );
  const [sdfText, setSdfText] = useState('');
  const [sdfError, setSdfError] = useState<string | null>(null);
  const { ui, patchUi } = useUiState();
  const prompt = ui.materialPrompt;
  const setPrompt = (next: string) => patchUi({ materialPrompt: next });
  const [busy, setBusy] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);

  const selected = useMemo(
    () => project.materials.find((m) => m.id === selectedId) ?? project.materials[0],
    [project.materials, selectedId],
  );

  useEffect(() => {
    if (!selected) {
      setSdfText('');
      return;
    }
    setSdfText(JSON.stringify(selected.sdf, null, 2));
    setSdfError(null);
  }, [selected?.id, selected?.sdf]);

  const provider = getProvider(llmSettings.provider);
  const assistEnabled =
    Boolean(llmSettings.provider) &&
    (!providerRequiresApiKey(provider) || Boolean(llmSettings.apiKey.trim()));

  const linked = project.tileDefinitions.find((t) => t.materialId === selected?.id);
  const previewColor = linked ? tileDisplayColor(linked.color) : '#c4a574';

  const updateMaterial = (id: string, patch: Partial<MaterialDefinitionJson>) => {
    updateProject((p) => ({
      ...p,
      materials: p.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
  };

  const applySdfJson = () => {
    if (!selected) return;
    try {
      const parsed = JSON.parse(sdfText) as unknown;
      const full = MaterialDefinitionJsonSchema.parse({
        ...selected,
        sdf: parsed,
      });
      updateMaterial(selected.id, { sdf: full.sdf });
      setSdfError(null);
    } catch (err) {
      setSdfError(err instanceof Error ? err.message : 'Invalid SDF JSON');
    }
  };

  return (
    <div className="page">
      <h1>Materials</h1>
      <p className="lede">
        SDF-only recipes (plus a noise seed). Color and edge UV live on tiles. Bake uses GLSL on
        an OffscreenCanvas for 3D / GLB / USDZ.
      </p>

      <div className="row no-print" style={{ marginBottom: '1rem', gap: '0.5rem' }}>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            const m = createMaterialDefinition({
              name: `material ${project.materials.length + 1}`,
              seed: (Math.random() * 1e9) | 0,
            });
            updateProject((p) => ({ ...p, materials: [...p.materials, m] }));
            setSelectedId(m.id);
          }}
        >
          Add material
        </button>
      </div>

      <div className="split split-2">
        <div className="stack">
          {project.materials.map((m) => (
            <button
              key={m.id}
              type="button"
              className={m.id === selected?.id ? 'btn primary' : 'btn'}
              style={{ justifyContent: 'flex-start' }}
              onClick={() => setSelectedId(m.id)}
            >
              {m.name}
              <span className="muted mono" style={{ marginLeft: '0.5rem', fontSize: '0.75rem' }}>
                seed {m.seed}
              </span>
            </button>
          ))}
        </div>

        {selected && (
          <section className="panel stack">
            <div className="row" style={{ alignItems: 'flex-start', gap: '1rem' }}>
              <MaterialPreview material={selected} colorHex={previewColor} />
              <div className="stack" style={{ flex: 1 }}>
                <div className="field">
                  <label>Name</label>
                  <input
                    value={selected.name}
                    onChange={(e) => updateMaterial(selected.id, { name: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Seed</label>
                  <input
                    type="number"
                    value={selected.seed}
                    onChange={(e) =>
                      updateMaterial(selected.id, { seed: Number(e.target.value) || 0 })
                    }
                  />
                </div>
              </div>
            </div>

            <div className="field">
              <label>SDF JSON</label>
              <textarea
                value={sdfText}
                onChange={(e) => setSdfText(e.target.value)}
                rows={14}
                spellCheck={false}
                className="mono"
                style={{ fontFamily: 'Fragment Mono, monospace', fontSize: '0.8rem' }}
              />
            </div>
            {sdfError && <p className="error">{sdfError}</p>}
            <div className="row">
              <button type="button" className="btn primary" onClick={applySdfJson}>
                Apply SDF
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={project.materials.length <= 1}
                onClick={() => {
                  const fallback = project.materials.find((m) => m.id !== selected.id)?.id;
                  if (!fallback) return;
                  updateProject((p) => ({
                    ...p,
                    materials: p.materials.filter((m) => m.id !== selected.id),
                    tileDefinitions: p.tileDefinitions.map((t) =>
                      t.materialId === selected.id ? { ...t, materialId: fallback } : t,
                    ),
                  }));
                  setSelectedId(fallback);
                }}
              >
                Delete
              </button>
            </div>

            <div className="panel" style={{ marginTop: '0.5rem' }}>
              <h2>Assist with LLM</h2>
              {!assistEnabled ? (
                <p className="muted">
                  Configure LLM provider
                  {providerRequiresApiKey(provider) ? ' and API key' : ''} in{' '}
                  <Link to="/settings">Settings</Link>.
                </p>
              ) : (
                <>
                  <div className="field">
                    <label>Prompt</label>
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      disabled={busy}
                      rows={3}
                    />
                  </div>
                  {assistError && <p className="error">{assistError}</p>}
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy || !prompt.trim()}
                    onClick={async () => {
                      setBusy(true);
                      setAssistError(null);
                      try {
                        const next = await assistMaterial({
                          provider: llmSettings.provider,
                          model: llmSettings.model,
                          apiKey: llmSettings.apiKey,
                          request: { prompt, currentMaterial: selected },
                        });
                        updateMaterial(selected.id, {
                          name: next.name,
                          seed: next.seed,
                          sdf: next.sdf,
                        });
                      } catch (err) {
                        setAssistError(err instanceof Error ? err.message : String(err));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? 'Generating…' : 'Generate SDF'}
                  </button>
                </>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
