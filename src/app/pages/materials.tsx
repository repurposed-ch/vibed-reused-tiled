import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createMaterialDefinition } from '@/domain/project';
import { MaterialEditor } from '../components/material-editor';
import { MaterialThumb, materialPreviewContext, materialUsage } from '../components/material-thumb';
import { useProject } from '../project-context';
import { useUiState } from '../ui-state';

/**
 * Materials as a gallery: a card per material, and the editor only once one is opened.
 *
 * The editor lives on its own route so the browser's back button leaves it, and so a
 * reload comes back to the material being worked on.
 */
export function MaterialsPage() {
  const { project, updateProject } = useProject();
  const { patchUi } = useUiState();
  const navigate = useNavigate();
  const { materialId } = useParams();
  const selected = project.materials.find((m) => m.id === materialId);

  // A deleted material, or a link to one that never existed, falls back to the gallery.
  useEffect(() => {
    if (materialId && !selected) navigate('/materials', { replace: true });
  }, [materialId, selected, navigate]);

  if (selected) {
    return (
      <div className="page">
        <p className="crumbs no-print">
          <Link to="/materials">← Materials</Link>
        </p>
        <MaterialEditor material={selected} onClose={() => navigate('/materials')} />
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Materials</h1>
      <p className="lede">
        A material is a tree of SDF ops that bakes to a grayscale field. Open one to edit its graph.
        Colour and edge UV live on tiles, not here.
      </p>
      <div className="card-grid">
        {project.materials.map((m) => (
          <button
            key={m.id}
            type="button"
            className="card"
            onClick={() => navigate(`/materials/${m.id}`)}
          >
            <MaterialThumb material={m} {...materialPreviewContext(project, m)} alt={`${m.name} preview`} />
            <span className="card-title">{m.name}</span>
            <span className="card-meta muted mono">{materialUsage(project, m)}</span>
          </button>
        ))}
        <button
          type="button"
          className="card card-add"
          onClick={() => {
            const m = createMaterialDefinition({
              name: `material ${project.materials.length + 1}`,
              seed: (Math.random() * 1e9) | 0,
            });
            updateProject((p) => ({ ...p, materials: [...p.materials, m] }));
            patchUi({ selectedSdfPath: 'root' });
            navigate(`/materials/${m.id}`);
          }}
        >
          + New material
        </button>
      </div>
    </div>
  );
}
