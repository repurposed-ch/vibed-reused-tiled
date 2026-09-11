import { MAX_JOINT_DEPTH, sanitizeJoint, type ProjectJointJson } from '@/domain/project';
import { useProject } from '../project-context';
import { TileColorEditor } from './tile-color-editor';

/**
 * The grout between tiles: its width, material, colour and recess, in one place.
 *
 * The width is a tiling parameter that lives on the tile grid, so the page passes it in with
 * a setter — and omits the setter when there is no grid to hold it. The appearance is project
 * level and edited here directly, so every layout draws grout, including design-family ones.
 */
export function JointPanel({
  width,
  onWidthChange,
}: {
  width?: number;
  onWidthChange?: (metres: number) => void;
}) {
  const { project, updateProject } = useProject();
  const joint = project.joint;
  const patch = (next: Partial<ProjectJointJson>) =>
    updateProject((prev) => ({ ...prev, joint: { ...prev.joint, ...next } }));
  const mm = (metres: number) => Number((metres * 1000).toFixed(2));

  return (
    <section className="panel no-print">
      <h2>Joint</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        The cell is one unit tile plus one joint, so a tile spanning k cells is nominally
        k × cell − joint. Tiles a little smaller are centred and their joints widen; tiles too
        large for their footprint are left out. Raising the joint without raising the cell makes
        tiles too large.
      </p>
      <div className="row">
        {onWidthChange && (
          <div className="field">
            <label>Width (mm)</label>
            <input
              type="number"
              step="0.5"
              min="0"
              value={mm(sanitizeJoint(width))}
              onChange={(e) => onWidthChange(Math.max(0, Number(e.target.value) || 0) / 1000)}
            />
          </div>
        )}
        <div className="field">
          <label>Material</label>
          <select value={joint.materialId} onChange={(e) => patch({ materialId: e.target.value })}>
            {project.materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Recess (mm)</label>
          <input
            type="number"
            step="0.5"
            min="0"
            max={MAX_JOINT_DEPTH * 1000}
            value={mm(joint.depth)}
            onChange={(e) =>
              patch({
                depth: Math.min(MAX_JOINT_DEPTH, Math.max(0, Number(e.target.value) || 0) / 1000),
              })
            }
          />
        </div>
      </div>
      <TileColorEditor label="Colour" value={joint.color} onChange={(color) => patch({ color })} />
    </section>
  );
}
