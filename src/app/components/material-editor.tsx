import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DEFAULT_RELIEF,
  DEFAULT_ROUGHNESS,
  MaterialDefinitionJsonSchema,
  removeMaterial,
  SdfNodeJsonSchema,
  type MaterialDefinitionJson,
  type SdfNodeJson,
  type SdfOp,
} from '@/domain/project';
import { assistMaterial } from '@/llm/assist';
import { getProvider, providerRequiresApiKey } from '@/llm/providers';
import {
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
import { useProject } from '../project-context';
import { useUiState } from '../ui-state';
import { Collapsible } from './collapsible';
import { MaterialThumb, materialPreviewContext } from './material-thumb';
import { OpGallery } from './op-gallery';
import { SdfInspector } from './sdf-inspector';
import { SdfTree } from './sdf-tree';

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

function SeamIssues({ issues }: { issues: SeamIssue[] }) {
  if (issues.length === 0) {
    return (
      <p className="muted mono tiny m-0">
        No seamlessness issues.
      </p>
    );
  }
  return (
    <ul className="issues">
      {issues.map((issue, i) => (
        <li key={`${issue.op}-${i}`} className={`mono tiny sev-${issue.severity}`}>
          <strong>{issue.severity}</strong> · {issue.op}
          {issue.path.length > 0 && <span className="muted"> @{issue.path.join('.')}</span>} —{' '}
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

/**
 * The full editor for one material.
 *
 * The preview stays pinned to the top of the viewport while everything below it scrolls,
 * so a slider or a graph edit can be seen as it is made — on a phone especially, where
 * the controls alone fill the screen. Everything but the graph starts collapsed.
 */
export function MaterialEditor({
  material,
  onClose,
}: {
  material: MaterialDefinitionJson;
  onClose: () => void;
}) {
  const { project, updateProject, llmSettings } = useProject();
  const { ui, patchUi } = useUiState();
  const [sdfText, setSdfText] = useState('');
  const [sdfError, setSdfError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [litPreview, setLitPreview] = useState(true);

  const prompt = ui.materialPrompt;
  const setPrompt = (next: string) => patchUi({ materialPrompt: next });

  // Draft-then-commit: `updateProject` re-parses the whole project through zod and
  // rewrites localStorage on every call, so a slider bound straight to it would do that
  // per frame. The draft drives the tree, thumbnails and preview immediately; the commit
  // lands COMMIT_MS later.
  const [draft, setDraft] = useState<SdfNodeJson | null>(material.sdf);

  // Reset only on a material switch — resetting on `material.sdf` would fight the commit.
  useEffect(() => {
    setDraft(material.sdf);
    setSdfError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material.id]);

  const draftKey = useMemo(() => (draft ? JSON.stringify(draft) : ''), [draft]);

  useEffect(() => {
    if (!draft) return;
    // Structural compare, not identity: the committed value comes back as a fresh object
    // after zod reparses it, which would otherwise re-trigger this forever.
    if (draftKey === JSON.stringify(material.sdf)) return;
    const timer = window.setTimeout(() => {
      const parsed = MaterialDefinitionJsonSchema.safeParse({ ...material, sdf: draft });
      if (parsed.success) {
        updateProject((p) => ({
          ...p,
          materials: p.materials.map((m) => (m.id === material.id ? { ...m, sdf: parsed.data.sdf } : m)),
        }));
      }
    }, COMMIT_MS);
    return () => window.clearTimeout(timer);
  }, [draftKey, material, draft, updateProject]);

  useEffect(() => {
    setSdfText(draft ? JSON.stringify(draft, null, 2) : '');
  }, [draftKey]);

  // Relief and roughness are slider-driven, so they get the same draft-then-commit as the
  // SDF: binding a slider straight to updateProject would reparse the project per frame.
  const [surface, setSurface] = useState<{ relief: number; roughness: [number, number] }>(() => ({
    relief: material.relief ?? DEFAULT_RELIEF,
    roughness: [...(material.roughness ?? DEFAULT_ROUGHNESS)] as [number, number],
  }));
  useEffect(() => {
    setSurface({
      relief: material.relief ?? DEFAULT_RELIEF,
      roughness: [...(material.roughness ?? DEFAULT_ROUGHNESS)] as [number, number],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material.id]);
  const surfaceKey = `${surface.relief}|${surface.roughness[0]}|${surface.roughness[1]}`;
  useEffect(() => {
    if (
      material.relief === surface.relief &&
      material.roughness[0] === surface.roughness[0] &&
      material.roughness[1] === surface.roughness[1]
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      updateProject((p) => ({
        ...p,
        materials: p.materials.map((m) =>
          m.id === material.id ? { ...m, relief: surface.relief, roughness: surface.roughness } : m,
        ),
      }));
    }, COMMIT_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceKey, material.id]);

  const provider = getProvider(llmSettings.provider);
  const assistEnabled =
    Boolean(llmSettings.provider) &&
    (!providerRequiresApiKey(provider) || Boolean(llmSettings.apiKey.trim()));

  const { colorHex, length, width } = materialPreviewContext(project, material);
  const period: Vec2 = useMemo(() => [length, width], [length, width]);
  const isSquareTile = Math.abs(length - width) < 1e-6;

  // Memoised on the serialised draft so the GPU bake does not re-run on every render.
  const previewMaterial = useMemo(
    () => ({ ...material, sdf: draft ?? material.sdf, relief: surface.relief, roughness: surface.roughness }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [material.id, material.name, material.seed, draftKey, surfaceKey],
  );

  const issues = useMemo(
    () => (draft ? seamlessnessReport(draft, { length, width }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftKey, length, width],
  );
  const severity = worstSeverity(issues);

  const seam = useMemo(() => {
    try {
      return draft ? maxSeamDelta(draft, material.seed, period) : null;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, material.seed, period]);
  const seamClass =
    seam === null ? undefined : seam <= SEAM_OK ? 'ok' : seam <= SEAM_WARN ? 'warn' : 'sev-error';

  // A stored path can point at a node that no longer exists after an edit.
  const selectedPath: SdfPath = useMemo(() => {
    const stored = pathFromKey(ui.selectedSdfPath ?? 'root');
    if (!draft) return [];
    return getNodeAt(draft, stored) ? stored : [];
  }, [ui.selectedSdfPath, draftKey, draft]);

  const selectedNode = draft ? getNodeAt(draft, selectedPath) : null;

  const updateMaterial = (patch: Partial<MaterialDefinitionJson>) => {
    updateProject((p) => ({
      ...p,
      materials: p.materials.map((m) => (m.id === material.id ? { ...m, ...patch } : m)),
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
    <div className="stack gap-0">
      <div className="sticky-preview no-print">
        <MaterialThumb
          material={previewMaterial}
          colorHex={colorHex}
          length={length}
          width={width}
          lit={litPreview}
          size={256}
          alt={`${material.name} preview`}
        />
        <div className="stack gap-2 sticky-preview-controls">
          <div className="field">
            <label>Name</label>
            <input value={material.name} onChange={(e) => updateMaterial({ name: e.target.value })} />
          </div>
          <div className="row gap-2 center">
            <button
              type="button"
              className={litPreview ? 'btn sm' : 'btn sm primary'}
              onClick={() => setLitPreview(false)}
            >
              Flat
            </button>
            <button
              type="button"
              className={litPreview ? 'btn sm primary' : 'btn sm'}
              title="Shade the preview with the normal map derived from this field"
              onClick={() => setLitPreview(true)}
            >
              Lit
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => updateMaterial({ seed: (Math.random() * 1e9) | 0 })}
            >
              Reseed
            </button>
          </div>
          <div className="stack gap-0 mono muted tiny">
            <span className={seamClass}>
              {seam === null ? 'seam —' : seam <= SEAM_OK ? 'seam exact' : `seam ${seam.toFixed(4)}`}
            </span>
            <span>
              {length.toFixed(2)} × {width.toFixed(2)} m · seed {material.seed}
            </span>
          </div>
        </div>
      </div>

      {draft && selectedNode && (
        <Collapsible title="Graph" note="each row previews its own subtree; a dot flags a seam issue" defaultOpen>
          <div className="split split-2">
            <SdfTree
              root={draft}
              seed={material.seed}
              period={period}
              issues={issues}
              selected={selectedPath}
              onSelect={selectPath}
            />
            <div className="panel m-0">
              <SdfInspector
                node={selectedNode}
                path={selectedPath}
                issues={issues}
                isSquareTile={isSquareTile}
                onSetParam={(key, value) => editDraft((root) => setParamAt(root, selectedPath, key, value))}
                onChangeOp={(op: SdfOp) => editDraft((root) => changeOpAt(root, selectedPath, op))}
                onWrap={(op: SdfOp) => editDraft((root) => wrapNodeAt(root, selectedPath, op))}
                onDelete={() => editDraft((root) => unwrapNodeAt(root, selectedPath))}
              />
            </div>
          </div>
        </Collapsible>
      )}

      <Collapsible
        title="Surface"
        note={`relief ${(surface.relief * 1000).toFixed(2)} mm · rough ${surface.roughness[0].toFixed(2)}–${surface.roughness[1].toFixed(2)}`}
      >
        <div className="stack gap-2">
          <p className="muted tiny m-0">
            The normal and roughness maps are derived from this same field — its gradient is the
            relief, its value picks the roughness. Negative relief engraves: bright areas sink, so a
            light joint line reads as recessed.
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
                set: (v: number) => setSurface((prev) => ({ ...prev, roughness: [v, prev.roughness[1]] })),
              },
              {
                label: 'Rough @ high',
                value: surface.roughness[1],
                min: 0,
                max: 1,
                step: 0.01,
                unit: '',
                set: (v: number) => setSurface((prev) => ({ ...prev, roughness: [prev.roughness[0], v] })),
              },
            ] as const
          ).map((c) => (
            <div key={c.label} className="row tight">
              <label className="mono muted param-label">{c.label}</label>
              {/* Range inputs stay outside .field, whose padding and border wreck the track. */}
              <input
                type="range"
                min={c.min}
                max={c.max}
                step={c.step}
                value={c.value}
                className="range"
                onChange={(e) => c.set(Number(e.target.value))}
              />
              <span className="readout wide">
                {c.value.toFixed(2)}
                {c.unit}
              </span>
            </div>
          ))}
        </div>
      </Collapsible>

      <Collapsible
        title="Seamlessness"
        note={
          <span className={severity ? `sev-${severity}` : undefined}>
            {severity ? `${issues.length} issue${issues.length === 1 ? '' : 's'} · ${severity}` : 'clean'}
          </span>
        }
      >
        <SeamIssues issues={issues} />
      </Collapsible>

      <Collapsible
        title="Op reference"
        note="every op, rendered live — Insert replaces the selected node, Wrap puts it inside"
      >
        <OpGallery
          seed={material.seed}
          period={period}
          onInsert={(op) => editDraft((root) => replaceNodeAt(root, selectedPath, defaultNodeForOp(op)))}
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
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={busy} rows={3} />
            </div>
            {assistError && <p className="error">{assistError}</p>}
            <div className="row">
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
                      request: { prompt, currentMaterial: material },
                    });
                    updateMaterial({ name: next.name, seed: next.seed });
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

      <div className="row end no-print">
        <button
          type="button"
          className="btn danger"
          disabled={project.materials.length <= 1}
          title={project.materials.length <= 1 ? 'A project keeps at least one material' : undefined}
          onClick={() => {
            if (project.materials.length <= 1) return;
            // Repoints tiles and the joint alike, so nothing is left on a missing material.
            updateProject((p) => removeMaterial(p, material.id));
            onClose();
          }}
        >
          Delete material
        </button>
      </div>
    </div>
  );
}
