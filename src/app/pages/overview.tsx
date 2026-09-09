import { useRef } from 'react';
import { useProject } from '../project-context';

export function OverviewPage() {
  const { project, updateProject, downloadProject, uploadProject, resetProject } = useProject();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="page">
      <h1>Project</h1>
      <p className="lede">
        Load or save a full tiling project JSON. Workflow: tiles → stock → design family →
        boundaries → solve → 2D/3D views.
      </p>

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
