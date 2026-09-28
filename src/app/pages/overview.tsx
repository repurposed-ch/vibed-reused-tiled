import { InstanceSvg } from '@/render/svg/instance-svg';
import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SceneCanvas } from '../components/scene-canvas';
import { useProject } from '../project-context';
import { useUiState } from '../ui-state';

function PreviewCard({ title, to, children }: { title: string; to: string; children: ReactNode }) {
  return (
    <section className="panel preview-card">
      <header className="preview-card-head">
        <h2>{title}</h2>
        <Link to={to}>Open {title} →</Link>
      </header>
      {children}
    </section>
  );
}

export function OverviewPage() {
  const { project, updateProject, downloadProject, uploadProject, resetProject } = useProject();
  const { ui, solveStatus } = useUiState();
  const inputRef = useRef<HTMLInputElement>(null);
  const instance = project.instance;

  const placeholder = (
    <div className="preview-frame preview-empty muted">
      {solveStatus.kind === 'error' ? solveStatus.reason : 'Solving…'}
    </div>
  );

  return (
    <div className="page">
      <h1>{project.meta?.name || 'Project'}</h1>
      <p className="lede">
        The current design, solved from your tiles, stock, boundaries and tile schema. Open a
        view to explore it, or load and save the whole project as JSON below.
      </p>

      <div className="preview-grid">
        <PreviewCard title="3D" to="/view/3d">
          {instance ? (
            <div className="preview-frame preview-3d">
              <SceneCanvas
                instance={instance}
                tiles={project.tileDefinitions}
                materials={project.materials}
                joint={project.joint}
                variation={ui.tileVariation}
              />
            </div>
          ) : (
            placeholder
          )}
        </PreviewCard>
        <PreviewCard title="2D" to="/view/2d">
          {instance ? (
            <div className="preview-frame preview-2d">
              <InstanceSvg
                instance={instance}
                tiles={project.tileDefinitions}
                boundaries={project.boundaries}
                joint={project.joint}
              />
            </div>
          ) : (
            placeholder
          )}
        </PreviewCard>
      </div>

      <section className="panel">
        <h2>Meta</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              value={project.meta?.name ?? ''}
              onChange={(e) =>
                updateProject((p) => ({
                  ...p,
                  meta: { ...p.meta, name: e.target.value },
                }))
              }
            />
          </div>
          <div className="field">
            <label>Updated</label>
            <input className="mono" readOnly value={project.meta?.updatedAt ?? '—'} />
          </div>
          <div className="field">
            <label>Schema</label>
            <input className="mono" readOnly value={`v${project.schemaVersion}`} />
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Persistence</h2>
        <div className="row">
          <button type="button" className="btn primary" onClick={downloadProject}>
            Download JSON
          </button>
          <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
            Upload JSON
          </button>
          <button type="button" className="btn danger" onClick={resetProject}>
            Reset to sample
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadProject(file);
              e.target.value = '';
            }}
          />
        </div>
        <p className="muted" style={{ marginTop: '0.75rem' }}>
          Autosaved in localStorage. Counts: {project.tileDefinitions.length} tiles,{' '}
          {project.stock.entries.length} stock entries, {project.designFamily.modules.length}{' '}
          modules, {project.instance?.placements.length ?? 0} placements.
        </p>
      </section>
    </div>
  );
}
