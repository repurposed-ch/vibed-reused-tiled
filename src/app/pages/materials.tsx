import {
  createMaterialDefinition,
  DEFAULT_RELIEF,
  DEFAULT_ROUGHNESS,
  MaterialDefinitionJsonSchema,
  removeMaterial,
  SdfNodeJsonSchema,
  tileDisplayColor,
  type MaterialDefinitionJson,
  type SdfNodeJson,
  type SdfOp,
} from '@/domain/project';
import { assistMaterial } from '@/llm/assist';
import { getProvider, providerRequiresApiKey } from '@/llm/providers';
import {
  bakeMaterialTexture,
  changeOpAt,
  defaultNodeForOp,
  getNodeAt,
  maxSeamDelta,
  pathFromKey,
  pathKey,
  replaceNodeAt,
  seamlessnessReport,
  setParamAt,
  unwrapNodeAt,
  worstSeverity,
  wrapNodeAt,
  type SdfPath,
  type SeamIssue,
  type Vec2,
} from '@/render/materials';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { OpGallery } from '../components/op-gallery';
import { SdfInspector } from '../components/sdf-inspector';
import { SdfTree } from '../components/sdf-tree';
import { useProject } from '../project-context';
import { useUiState } from '../ui-state';

/** How long an edit sits before it reaches the project. */
const COMMIT_MS = 200;

/**
 * Field-space seam tolerance.
 *
 * Deliberately NOT the pixel-based seamError(): that compares column 0 against column
 * width-1, which are not wrap-equivalent, so any hard-edged field (terrazzo, checker,
 * posterize, truchet) scores a large false positive for what is really just a chip
 * boundary. maxSeamDelta compares p = 0 against p = period and is exact.
 */
const SEAM_OK = 1e-6;
const SEAM_WARN = 1e-3;

const SEVERITY_COLOR: Record<string, string> = {
  error: '#c45c5c',
  warning: '#d9773a',
  info: '#b5a89a',
};

function MaterialPreview({
  material,
  colorHex,
  length,
  width,
  lit,
}: {
  material: MaterialDefinitionJson;
  colorHex: string;
  length: number;
  width: number;
  /** Shade the albedo with the normal derived from the same field, so relief is visible. */
  lit: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [seam, setSeam] = useState<number | null>(null);

  useEffect(() => {
    try {
      const baked = bakeMaterialTexture(
        {
          material,
          color: { mode: 'brightness', color: colorHex },
          length,
          width,
        },
        160,
        { primary: lit ? 'lit' : 'albedo' },
      );
      setUrl(baked.dataUrl);
      setSeam(maxSeamDelta(material.sdf, material.seed, [length, width]));
    } catch {
      setUrl(null);
      setSeam(null);
    }
  }, [material, colorHex, length, width, lit]);

  const seamColor =
    seam === null
      ? '#b5a89a'
      : seam <= SEAM_OK
        ? '#6f8f6a'
        : seam <= SEAM_WARN
          ? '#d9773a'
          : '#c45c5c';

  return (
    <div className="stack" style={{ gap: '0.35rem' }}>
      {url ? (
        <img
          src={url}
          alt={`${material.name} preview`}
          width={160}
          height={160}
          style={{ imageRendering: 'pixelated', border: '1px solid #4a4036' }}
        />
      ) : (
        <div
          style={{
            width: 160,
            height: 160,
            background: colorHex,
            border: '1px solid #4a4036',
          }}
        />
      )}
      <span className="mono" style={{ fontSize: '0.7rem', color: seamColor }}>
        {seam === null ? 'seam —' : seam <= SEAM_OK ? 'seam exact' : `seam ${seam.toFixed(4)}`}
      </span>
      <span className="muted mono" style={{ fontSize: '0.65rem' }}>
        {length.toFixed(2)} × {width.toFixed(2)} m
      </span>
    </div>
  );
}

function SeamIssues({ issues }: { issues: SeamIssue[] }) {
  if (issues.length === 0) {
    return (
      <p className="muted mono" style={{ fontSize: '0.72rem', margin: 0 }}>
        No seamlessness issues.
      </p>
    );
  }
  return (
    <ul className="stack" style={{ gap: '0.3rem', margin: 0, paddingLeft: '1rem' }}>
      {issues.map((issue, i) => (
        <li
          key={`${issue.op}-${i}`}
          className="mono"
          style={{ fontSize: '0.72rem', color: SEVERITY_COLOR[issue.severity] }}
        >
          <strong>{issue.severity}</strong> · {issue.op}
          {issue.path.length > 0 && <span className="muted"> @{issue.path.join('.')}</span>} —{' '}
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

/**
 * A collapsible section.
 *
 * Children are mounted only while open: `<details>` keeps closed content in the DOM and
 * runs its effects, and the op gallery costs ~85 ms of CPU evaluation for its 35
 * thumbnails — not something to pay on every page load and reseed for a closed panel.
 */
function Collapsible({
  title,
  note,
  defaultOpen = false,
  children,
}: {
  title: string;
  note?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="panel no-print"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary style={{ cursor: 'pointer', fontWeight: 600, listStyle: 'revert' }}>
        {title}
        {note && (
          <span className="muted" style={{ fontWeight: 400, marginLeft: '0.5rem', fontSize: '0.8rem' }}>
            {note}
          </span>
        )}
      </summary>
      {open && <div style={{ marginTop: '0.75rem' }}>{children}</div>}
    </details>
  );
}

export function MaterialsPage() {
  const { project, updateProject, llmSettings } = useProject();
  const { ui, patchUi } = useUiState();
  const [selectedId, setSelectedId] = useState<string | null>(
    project.materials[0]?.id ?? null,
  );
  const [sdfText, setSdfText] = useState('');
  const [sdfError, setSdfError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [litPreview, setLitPreview] = useState(true);

  const prompt = ui.materialPrompt;
  const setPrompt = (next: string) => patchUi({ materialPrompt: next });

  const selected = useMemo(
    () => project.materials.find((m) => m.id === selectedId) ?? project.materials[0],
    [project.materials, selectedId],
  );

  // Draft-then-commit: `updateProject` re-parses the whole project through zod and
  // rewrites localStorage on every call, so a slider bound straight to it would do that
  // per frame. The draft drives the tree, thumbnails and preview immediately; the commit
  // lands COMMIT_MS later.
  const [draft, setDraft] = useState<SdfNodeJson | null>(selected?.sdf ?? null);

  // Reset only on a material switch — resetting on `selected.sdf` would fight the commit.
  useEffect(() => {
    setDraft(selected?.sdf ?? null);
    setSdfError(null);
  }, [selected?.id]);

  const draftKey = useMemo(() => (draft ? JSON.stringify(draft) : ''), [draft]);

  useEffect(() => {
    if (!selected || !draft) return;
    // Structural compare, not identity: the committed value comes back as a fresh object
    // after zod reparses it, which would otherwise re-trigger this forever.
    if (draftKey === JSON.stringify(selected.sdf)) return;
    const timer = window.setTimeout(() => {
      const parsed = MaterialDefinitionJsonSchema.safeParse({ ...selected, sdf: draft });
      if (parsed.success) {
        updateProject((p) => ({
          ...p,
          materials: p.materials.map((m) =>
            m.id === selected.id ? { ...m, sdf: parsed.data.sdf } : m,
          ),
        }));
      }
    }, COMMIT_MS);
    return () => window.clearTimeout(timer);
  }, [draftKey, selected, draft, updateProject]);

  useEffect(() => {
    setSdfText(draft ? JSON.stringify(draft, null, 2) : '');
  }, [draftKey]);

  // Relief and roughness are slider-driven, so they get the same draft-then-commit as the
  // SDF: binding a slider straight to updateProject would reparse the project per frame.
  const [surface, setSurface] = useState<{ relief: number; roughness: [number, number] }>(() => ({
    relief: selected?.relief ?? DEFAULT_RELIEF,
    roughness: [...(selected?.roughness ?? DEFAULT_ROUGHNESS)] as [number, number],
  }));
  useEffect(() => {
    setSurface({
      relief: selected?.relief ?? DEFAULT_RELIEF,
      roughness: [...(selected?.roughness ?? DEFAULT_ROUGHNESS)] as [number, number],
    });
  }, [selected?.id]);
  const surfaceKey = `${surface.relief}|${surface.roughness[0]}|${surface.roughness[1]}`;
  useEffect(() => {
    if (!selected) return;
    if (
      selected.relief === surface.relief &&
      selected.roughness[0] === surface.roughness[0] &&
      selected.roughness[1] === surface.roughness[1]
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      updateProject((p) => ({
        ...p,
        materials: p.materials.map((m) =>
          m.id === selected.id
            ? { ...m, relief: surface.relief, roughness: surface.roughness }
            : m,
        ),
      }));
    }, COMMIT_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceKey, selected?.id]);

  const provider = getProvider(llmSettings.provider);
  const assistEnabled =
    Boolean(llmSettings.provider) &&
    (!providerRequiresApiKey(provider) || Boolean(llmSettings.apiKey.trim()));

  const linked = project.tileDefinitions.find((t) => t.materialId === selected?.id);
  const previewColor = linked ? tileDisplayColor(linked.color) : '#c4a574';
  // Preview at the linked tile's real dimensions; a non-square tile is the case that
  // used to seam unconditionally, so it is the one worth showing.
  const previewLength = linked?.length ?? 0.6;
  const previewWidth = linked?.width ?? 0.3;
  const period: Vec2 = useMemo(
    () => [previewLength, previewWidth],
    [previewLength, previewWidth],
  );
  const isSquareTile = Math.abs(previewLength - previewWidth) < 1e-6;

  // Memoised on the serialised draft so the GPU bake does not re-run on every render.
  const previewMaterial = useMemo(
    () =>
      selected
        ? {
            ...selected,
            sdf: draft ?? selected.sdf,
            relief: surface.relief,
            roughness: surface.roughness,
          }
        : selected,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected?.id, selected?.name, selected?.seed, draftKey, surfaceKey],
  );

  const issues = useMemo(
    () =>
      draft ? seamlessnessReport(draft, { length: previewLength, width: previewWidth }) : [],
    [draftKey, previewLength, previewWidth, draft],
  );

  // A stored path can point at a node that no longer exists after an edit.
  const selectedPath: SdfPath = useMemo(() => {
    const stored = pathFromKey(ui.selectedSdfPath ?? 'root');
    if (!draft) return [];
    return getNodeAt(draft, stored) ? stored : [];
  }, [ui.selectedSdfPath, draftKey, draft]);

  const selectedNode = draft ? getNodeAt(draft, selectedPath) : null;

  const updateMaterial = (id: string, patch: Partial<MaterialDefinitionJson>) => {
    updateProject((p) => ({
      ...p,
      materials: p.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
  };

  const editDraft = (fn: (root: SdfNodeJson) => SdfNodeJson) => {
    setDraft((prev) => (prev ? fn(prev) : prev));
  };

  const selectPath = (path: SdfPath) => patchUi({ selectedSdfPath: pathKey(path) });

  const applySdfJson = () => {
    try {
      const parsed = SdfNodeJsonSchema.parse(JSON.parse(sdfText) as unknown);
      setDraft(parsed);
      setSdfError(null);
    } catch (err) {
      setSdfError(err instanceof Error ? err.message : 'Invalid SDF JSON');
    }
  };

  return (
    <div className="page">
      <h1>Materials</h1>
      <p className="lede">
        A material is a tree of SDF ops that bakes to a grayscale field. Build it below — pick a
        node to edit its parameters, or drop in an op from the reference. Colour and edge UV live
        on tiles, not here.
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
            patchUi({ selectedSdfPath: 'root' });
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

        {selected && previewMaterial && (
          <section className="panel stack">
            <div className="row" style={{ alignItems: 'flex-start', gap: '1rem' }}>
              <MaterialPreview
                material={previewMaterial}
                colorHex={previewColor}
                length={previewLength}
                width={previewWidth}
                lit={litPreview}
              />
              <div className="stack" style={{ flex: 1, minWidth: '10rem' }}>
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
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    updateMaterial(selected.id, { seed: (Math.random() * 1e9) | 0 })
                  }
                >
                  Reseed
                </button>
                <div className="row" style={{ gap: '0.35rem' }}>
                  <button
                    type="button"
                    className={litPreview ? 'btn' : 'btn primary'}
                    style={{ padding: '0.35rem 0.6rem', minHeight: 0 }}
                    onClick={() => setLitPreview(false)}
                  >
                    Flat
                  </button>
                  <button
                    type="button"
                    className={litPreview ? 'btn primary' : 'btn'}
                    style={{ padding: '0.35rem 0.6rem', minHeight: 0 }}
                    title="Shade the preview with the normal map derived from this field"
                    onClick={() => setLitPreview(true)}
                  >
                    Lit
                  </button>
                </div>
              </div>
            </div>

            <div className="stack" style={{ gap: '0.4rem' }}>
              <span
                className="muted"
                style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}
              >
                Surface
              </span>
              <p className="muted" style={{ margin: 0, fontSize: '0.72rem' }}>
                The normal and roughness maps are derived from this same field — its gradient
                is the relief, its value picks the roughness. Negative relief engraves: bright
                areas sink, so a light joint line reads as recessed.
              </p>
              {(
                [
                  {
                    label: 'Relief',
                    value: surface.relief * 1000,
                    min: -5,
                    max: 5,
                    step: 0.05,
                    unit: 'mm',
                    set: (v: number) => setSurface((prev) => ({ ...prev, relief: v / 1000 })),
                  },
                  {
                    label: 'Rough @ low',
                    value: surface.roughness[0],
                    min: 0,
                    max: 1,
                    step: 0.01,
                    unit: '',
                    set: (v: number) =>
                      setSurface((prev) => ({ ...prev, roughness: [v, prev.roughness[1]] })),
                  },
                  {
                    label: 'Rough @ high',
                    value: surface.roughness[1],
                    min: 0,
                    max: 1,
                    step: 0.01,
                    unit: '',
                    set: (v: number) =>
                      setSurface((prev) => ({ ...prev, roughness: [prev.roughness[0], v] })),
                  },
                ] as const
              ).map((c) => (
                <div
                  key={c.label}
                  className="row"
                  style={{ alignItems: 'center', gap: '0.5rem', flexWrap: 'nowrap' }}
                >
                  <label
                    className="mono muted"
                    style={{ width: '6.5rem', flex: '0 0 6.5rem', fontSize: '0.72rem', margin: 0 }}
                  >
                    {c.label}
                  </label>
                  {/* Range inputs stay outside .field, whose padding and border wreck the track. */}
                  <input
                    type="range"
                    min={c.min}
                    max={c.max}
                    step={c.step}
                    value={c.value}
                    style={{ flex: 1, accentColor: '#d9773a', background: 'transparent' }}
                    onChange={(e) => c.set(Number(e.target.value))}
                  />
                  <span className="mono muted" style={{ width: '3.5rem', fontSize: '0.72rem' }}>
                    {c.value.toFixed(2)}
                    {c.unit}
                  </span>
                </div>
              ))}
            </div>

            <div className="field">
              <label>
                Seamlessness {worstSeverity(issues) ? `(${worstSeverity(issues)})` : '(clean)'}
              </label>
              <SeamIssues issues={issues} />
            </div>

            <button
              type="button"
              className="btn danger"
              disabled={project.materials.length <= 1}
              onClick={() => {
                const fallback = project.materials.find((m) => m.id !== selected.id)?.id;
                if (!fallback) return;
                // Repoints tiles and the joint alike, so nothing is left on a missing material.
                updateProject((p) => removeMaterial(p, selected.id));
                setSelectedId(fallback);
              }}
            >
              Delete material
            </button>
          </section>
        )}
      </div>

      {draft && selectedNode && (
        <section className="panel no-print">
          <h2>Graph</h2>
          <div className="split split-2">
            <div className="stack" style={{ gap: '0.5rem' }}>
              <p className="muted" style={{ margin: 0, fontSize: '0.75rem' }}>
                Each row previews that node&rsquo;s own subtree. A dot flags a seamlessness issue.
              </p>
              <SdfTree
                root={draft}
                seed={selected?.seed ?? 1}
                period={period}
                issues={issues}
                selected={selectedPath}
                onSelect={selectPath}
              />
            </div>
            <div className="panel" style={{ marginBottom: 0 }}>
              <SdfInspector
                node={selectedNode}
                path={selectedPath}
                issues={issues}
                isSquareTile={isSquareTile}
                onSetParam={(key, value) =>
                  editDraft((root) => setParamAt(root, selectedPath, key, value))
                }
                onChangeOp={(op: SdfOp) =>
                  editDraft((root) => changeOpAt(root, selectedPath, op))
                }
                onWrap={(op: SdfOp) => editDraft((root) => wrapNodeAt(root, selectedPath, op))}
                onDelete={() => editDraft((root) => unwrapNodeAt(root, selectedPath))}
              />
            </div>
          </div>
        </section>
      )}

      <Collapsible
        title="Op reference"
        note="every op, rendered live — Insert replaces the selected node, Wrap puts it inside"
      >
        <OpGallery
          seed={selected?.seed ?? 1}
          period={period}
          onInsert={(op) =>
            editDraft((root) => replaceNodeAt(root, selectedPath, defaultNodeForOp(op)))
          }
          onWrap={(op) => editDraft((root) => wrapNodeAt(root, selectedPath, op))}
        />
      </Collapsible>

      <Collapsible title="JSON" note="escape hatch — edits round-trip with the graph above">
        <div className="stack">
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
              className="btn"
              onClick={() => {
                setSdfText(draft ? JSON.stringify(draft, null, 2) : '');
                setSdfError(null);
              }}
            >
              Reset
            </button>
          </div>
        </div>
      </Collapsible>

      <Collapsible title="Assist with LLM" note="describe a material in words">
        {!assistEnabled ? (
          <p className="muted">
            Configure LLM provider
            {providerRequiresApiKey(provider) ? ' and API key' : ''} in{' '}
            <Link to="/settings">Settings</Link>.
          </p>
        ) : (
          <div className="stack">
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
            <div className="row">
              <button
                type="button"
                className="btn primary"
                disabled={busy || !prompt.trim() || !selected}
                onClick={async () => {
                  if (!selected) return;
                  setBusy(true);
                  setAssistError(null);
                  try {
                    const next = await assistMaterial({
                      provider: llmSettings.provider,
                      model: llmSettings.model,
                      apiKey: llmSettings.apiKey,
                      request: { prompt, currentMaterial: selected },
                    });
                    updateMaterial(selected.id, { name: next.name, seed: next.seed });
                    setDraft(next.sdf);
                    patchUi({ selectedSdfPath: 'root' });
                  } catch (err) {
                    setAssistError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Generating…' : 'Generate SDF'}
              </button>
            </div>
          </div>
        )}
      </Collapsible>
    </div>
  );
}
