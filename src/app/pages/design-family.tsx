import { useMemo, useState } from 'react';
import {
  createModulePlacement,
  DesignFamilyJsonSchema,
  type ConstraintKind,
  type DesignModuleJson,
  translationMat3,
} from '@/domain/project';
import { assistDesignFamily } from '@/llm/assist';
import { getProvider, providerRequiresApiKey } from '@/llm/providers';
import { ModulePreviewSvg } from '@/render/svg/module-preview';
import { useProject } from '../project-context';

export function DesignFamilyPage() {
  const { project, setDesignFamily, llmSettings } = useProject();
  const family = project.designFamily;
  const [activeModuleId, setActiveModuleId] = useState(family.modules[0]?.id ?? '');
  const [prompt, setPrompt] = useState(
    'Create a simple running bond module using the available tiles, alternating materials when possible.',
  );
  const [proposal, setProposal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeModule = useMemo(
    () => family.modules.find((m) => m.id === activeModuleId) ?? family.modules[0],
    [family.modules, activeModuleId],
  );

  const updateModule = (id: string, patch: Partial<DesignModuleJson>) => {
    setDesignFamily({
      ...family,
      modules: family.modules.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    });
  };

  const provider = getProvider(llmSettings.provider);
  const assistEnabled =
    Boolean(llmSettings.provider) &&
    (!providerRequiresApiKey(provider) || Boolean(llmSettings.apiKey.trim()));

  return (
    <div className="page">
      <h1>Design family</h1>
      <p className="lede">
        Author modules as relative tile placements, set soft constraints for leftover fill, and
        optionally ask an LLM to propose a family.
      </p>

      <div className="split split-sidebar">
        <section className="panel">
          <h2>Modules</h2>
          <div className="stack">
            {family.modules.map((m) => (
              <button
                key={m.id}
                type="button"
                className={m.id === activeModule?.id ? 'btn primary' : 'btn'}
                onClick={() => setActiveModuleId(m.id)}
              >
                {m.name}
                {family.primaryModuleIds.includes(m.id) ? ' ★' : ''}
              </button>
            ))}
            <button
              type="button"
              className="btn"
              onClick={() => {
                const id = crypto.randomUUID();
                setDesignFamily({
                  ...family,
                  modules: [
                    ...family.modules,
                    {
                      type: 'DesignModule',
                      id,
                      name: `Module ${family.modules.length + 1}`,
                      placements: [],
                      anchor: 'origin',
                    },
                  ],
                  primaryModuleIds: family.primaryModuleIds.length
                    ? family.primaryModuleIds
                    : [id],
                });
                setActiveModuleId(id);
              }}
            >
              Add module
            </button>
          </div>
        </section>

        <div className="stack">
          {activeModule && (
            <section className="panel">
              <h2>{activeModule.name}</h2>
              <div className="row">
                <div className="field" style={{ flex: 1 }}>
                  <label>Name</label>
                  <input
                    value={activeModule.name}
                    onChange={(e) => updateModule(activeModule.id, { name: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Anchor</label>
                  <select
                    value={activeModule.anchor ?? 'origin'}
                    onChange={(e) =>
                      updateModule(activeModule.id, {
                        anchor: e.target.value as DesignModuleJson['anchor'],
                      })
                    }
                  >
                    <option value="origin">origin</option>
                    <option value="centroid">centroid</option>
                    <option value="bboxMin">bboxMin</option>
                  </select>
                </div>
                <label className="field" style={{ minWidth: 'auto' }}>
                  <span>Primary</span>
                  <input
                    type="checkbox"
                    checked={family.primaryModuleIds.includes(activeModule.id)}
                    onChange={(e) => {
                      const ids = e.target.checked
                        ? [...new Set([...family.primaryModuleIds, activeModule.id])]
                        : family.primaryModuleIds.filter((id) => id !== activeModule.id);
                      setDesignFamily({ ...family, primaryModuleIds: ids });
                    }}
                  />
                </label>
              </div>

              <div className="row" style={{ marginTop: '0.75rem' }}>
                <div className="field">
                  <label>Add tile</label>
                  <select
                    id="add-tile"
                    defaultValue=""
                    onChange={(e) => {
                      const tileId = e.target.value;
                      if (!tileId) return;
                      const n = activeModule.placements.length;
                      updateModule(activeModule.id, {
                        placements: [
                          ...activeModule.placements,
                          createModulePlacement(tileId, (n % 4) * 0.65, Math.floor(n / 4) * 0.35),
                        ],
                      });
                      e.target.value = '';
                    }}
                  >
                    <option value="">Choose tile…</option>
                    {project.tileDefinitions.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Repeat count</label>
                  <input
                    type="number"
                    min={1}
                    value={activeModule.repeat?.count ?? 1}
                    onChange={(e) => {
                      const count = Math.max(1, Number(e.target.value) || 1);
                      updateModule(activeModule.id, {
                        repeat:
                          count <= 1
                            ? undefined
                            : {
                                count,
                                offsetMat3:
                                  activeModule.repeat?.offsetMat3 ?? translationMat3(0.65, 0),
                              },
                      });
                    }}
                  />
                </div>
              </div>

              <div className="table-scroll"><table className="table" style={{ marginTop: '0.75rem' }}>
                <thead>
                  <tr>
                    <th>Tile</th>
                    <th>x</th>
                    <th>y</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {activeModule.placements.map((pl) => {
                    const tile = project.tileDefinitions.find((t) => t.id === pl.tileDefinitionId);
                    const x = pl.localMat3.elements[6] ?? 0;
                    const y = pl.localMat3.elements[7] ?? 0;
                    return (
                      <tr key={pl.id}>
                        <td>{tile?.name ?? '—'}</td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            value={x}
                            onChange={(e) => {
                              const nx = Number(e.target.value) || 0;
                              updateModule(activeModule.id, {
                                placements: activeModule.placements.map((p) =>
                                  p.id === pl.id
                                    ? { ...p, localMat3: translationMat3(nx, y) }
                                    : p,
                                ),
                              });
                            }}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            value={y}
                            onChange={(e) => {
                              const ny = Number(e.target.value) || 0;
                              updateModule(activeModule.id, {
                                placements: activeModule.placements.map((p) =>
                                  p.id === pl.id
                                    ? { ...p, localMat3: translationMat3(x, ny) }
                                    : p,
                                ),
                              });
                            }}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn danger"
                            onClick={() =>
                              updateModule(activeModule.id, {
                                placements: activeModule.placements.filter((p) => p.id !== pl.id),
                              })
                            }
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>

              <div className="canvas-frame" style={{ marginTop: '1rem', padding: '1rem' }}>
                <ModulePreviewSvg
                  module={activeModule}
                  tiles={project.tileDefinitions}
                  scale={80}
                />
              </div>
            </section>
          )}

          <section className="panel">
            <h2>Soft constraints</h2>
            <div className="table-scroll"><table className="table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Weight</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {family.constraints.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <select
                        value={c.kind}
                        onChange={(e) =>
                          setDesignFamily({
                            ...family,
                            constraints: family.constraints.map((x) =>
                              x.id === c.id
                                ? { ...x, kind: e.target.value as ConstraintKind }
                                : x,
                            ),
                          })
                        }
                      >
                        <option value="rhythmMatch">rhythmMatch</option>
                        <option value="adjacencyPrefer">adjacencyPrefer</option>
                        <option value="materialAlternate">materialAlternate</option>
                        <option value="gapTolerance">gapTolerance</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        value={c.weight}
                        onChange={(e) =>
                          setDesignFamily({
                            ...family,
                            constraints: family.constraints.map((x) =>
                              x.id === c.id
                                ? { ...x, weight: Number(e.target.value) || 0 }
                                : x,
                            ),
                          })
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn danger"
                        onClick={() =>
                          setDesignFamily({
                            ...family,
                            constraints: family.constraints.filter((x) => x.id !== c.id),
                          })
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <button
              type="button"
              className="btn"
              onClick={() =>
                setDesignFamily({
                  ...family,
                  constraints: [
                    ...family.constraints,
                    {
                      id: crypto.randomUUID(),
                      kind: 'adjacencyPrefer',
                      weight: 1,
                      params: {},
                    },
                  ],
                })
              }
            >
              Add constraint
            </button>
          </section>

          <section className="panel">
            <h2>Import / export family</h2>
            <div className="row">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(family, null, 2)], {
                    type: 'application/json',
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'design-family.json';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Export family JSON
              </button>
              <label className="btn">
                Import family JSON
                <input
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const parsed = DesignFamilyJsonSchema.parse(
                        JSON.parse(await file.text()) as unknown,
                      );
                      setDesignFamily(parsed);
                      setActiveModuleId(parsed.modules[0]?.id ?? '');
                      setError(null);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Invalid family JSON');
                    }
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </section>

          <section className="panel">
            <h2>Assist with LLM</h2>
            {!assistEnabled && (
              <p className="muted">
                Configure LLM provider{providerRequiresApiKey(provider) ? ' and API key' : ''} in
                Settings to enable assist.
              </p>
            )}
            <div className="field">
              <label>Prompt</label>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={!assistEnabled || busy} />
            </div>
            <div className="row" style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                className="btn primary"
                disabled={!assistEnabled || busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  setProposal(null);
                  try {
                    const result = await assistDesignFamily({
                      provider: llmSettings.provider,
                      model: llmSettings.model,
                      apiKey: llmSettings.apiKey,
                      request: {
                        prompt,
                        tileDefinitions: project.tileDefinitions,
                        stock: project.stock,
                        currentFamily: family,
                      },
                    });
                    setProposal(JSON.stringify(result, null, 2));
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Assist failed');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Asking…' : 'Propose family'}
              </button>
              {proposal && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const parsed = DesignFamilyJsonSchema.parse(JSON.parse(proposal) as unknown);
                    setDesignFamily(parsed);
                    setActiveModuleId(parsed.modules[0]?.id ?? '');
                    setProposal(null);
                  }}
                >
                  Apply proposal
                </button>
              )}
            </div>
            {error && <p className="error" style={{ marginTop: '0.75rem' }}>{error}</p>}
            {proposal && (
              <pre className="mono" style={{ marginTop: '0.75rem', whiteSpace: 'pre-wrap' }}>
                {proposal}
              </pre>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
