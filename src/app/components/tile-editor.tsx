import {
  cornerRadiusMetres,
  hasCompleteRhythm,
  innermostTileGrid,
  MAX_CORNER_ROUNDING,
  tileDisplayColor,
  type FacadeSide,
  type TileColorJson,
  type TileDefinitionJson,
} from '@/domain/project';
import { Link } from 'react-router-dom';
import { useProject } from '../project-context';
import { Collapsible } from './collapsible';
import { NumberField, TextField } from './number-field';
import { TileColorEditor } from './tile-color-editor';
import { SIDES, TilePreview, rhythmStatus, tileDimensions, tileUvLabel } from './tile-preview';
import { tileFitStatus } from './tile-fit';

const RHYTHM_NOTE: Record<ReturnType<typeof rhythmStatus>, string> = {
  none: 'none — continuous UV',
  complete: 'all four sides — edged UV',
  partial: 'incomplete — invalid',
};

/**
 * The full editor for one tile.
 *
 * The preview stays pinned to the top of the viewport while everything below it scrolls, so a
 * dimension, colour or rounding edit can be seen as it is made — on a phone especially, where
 * the controls alone fill the screen. Everything but the geometry starts collapsed.
 */
export function TileEditor({ tile, onClose }: { tile: TileDefinitionJson; onClose: () => void }) {
  const { project, updateProject } = useProject();
  const grid = project.tileSchema ? innermostTileGrid(project.tileSchema) : undefined;
  const material = project.materials.find((m) => m.id === tile.materialId);
  const status = rhythmStatus(tile.rhythm);
  const fit = tileFitStatus(tile, grid);

  const updateTile = (patch: Partial<TileDefinitionJson>) => {
    updateProject((p) => ({
      ...p,
      tileDefinitions: p.tileDefinitions.map((t) => (t.id === tile.id ? { ...t, ...patch } : t)),
    }));
  };

  const setColor = (color: TileColorJson) => updateTile({ color });

  const setRhythm = (side: FacadeSide, field: 'name' | 'mirrored', value: string | boolean) => {
    updateProject((p) => ({
      ...p,
      tileDefinitions: p.tileDefinitions.map((t) => {
        if (t.id !== tile.id) return t;
        const base =
          t.rhythm && hasCompleteRhythm(t.rhythm)
            ? { ...t.rhythm }
            : {
                south: { name: 'A', mirrored: false },
                north: { name: 'A', mirrored: true },
                east: { name: 'B', mirrored: false },
                west: { name: 'B', mirrored: true },
              };
        const current = base[side];
        if (field === 'name' && typeof value === 'string') {
          const name = value.trim() || current.name;
          base[side] = { ...current, name };
        } else if (field === 'mirrored' && typeof value === 'boolean') {
          base[side] = { ...current, mirrored: value };
        }
        return { ...t, rhythm: base };
      }),
    }));
  };

  const enableAllEdges = () =>
    updateTile({
      rhythm: {
        south: { name: 'A', mirrored: false },
        north: { name: 'A', mirrored: true },
        east: { name: 'B', mirrored: false },
        west: { name: 'B', mirrored: true },
      },
    });

  return (
    <div className="stack gap-0">
      <div className="sticky-preview no-print">
        <TilePreview tile={tile} material={material} aspect={4 / 3} maxWidth="100%" />
        <div className="stack gap-2 sticky-preview-controls">
          <div className="row">
            <div className="field flex-1">
              <label>Name</label>
              <input value={tile.name} onChange={(e) => updateTile({ name: e.target.value })} />
            </div>
            <div className="field">
              <label>Material</label>
              <select value={tile.materialId} onChange={(e) => updateTile({ materialId: e.target.value })}>
                {project.materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <span className="mono muted tiny">
            {tileDimensions(tile)} · {tileUvLabel(tile)}
          </span>
        </div>
      </div>

      {fit &&
        (fit.kind === 'error' ? (
          <p className="error mt-0">
            {fit.message}
          </p>
        ) : (
          <p className={`${fit.kind === 'warning' ? 'warn' : 'muted'} small m-0 mb-4`}>
            {fit.message}
          </p>
        ))}

      <Collapsible title="Geometry" note={`${tileDimensions(tile)} · round ${((tile.cornerRounding ?? 0) * 100).toFixed(1)} %`} defaultOpen>
        <div className="stack">
          <div className="row">
            {(['length', 'width', 'thickness'] as const).map((dim) => (
              <div className="field" key={dim}>
                <label>{dim} (m)</label>
                <NumberField
                  value={tile[dim]}
                  onChange={(v) => updateTile({ [dim]: v })}
                  min={0.01}
                  step={0.01}
                />
              </div>
            ))}
          </div>

          <div className="stack gap-1">
            <span className="muted small">Corner rounding</span>
            <div className="row tight">
              {/* Range inputs stay outside .field, whose padding and border wreck the track. */}
              <input
                type="range"
                min={0}
                max={MAX_CORNER_ROUNDING}
                step={0.005}
                value={tile.cornerRounding ?? 0}
                className="range"
                onChange={(e) => updateTile({ cornerRounding: Number(e.target.value) })}
              />
              <span className="readout">
                {((tile.cornerRounding ?? 0) * 100).toFixed(1)} % ·{' '}
                {(cornerRadiusMetres(tile) * 1000).toFixed(1)} mm
              </span>
            </div>
          </div>
        </div>
      </Collapsible>

      <Collapsible
        title="Colour"
        note={
          <span className="swatch-label">
            <span className="swatch" style={{ background: tileDisplayColor(tile.color) }} />
            {tile.color.mode === 'brightness' ? tile.color.color : 'palette'}
          </span>
        }
      >
        <p className="muted small m-0 mb-2">
          Layout 2D uses a flat display colour; preview and 3D use the GLSL bake of{' '}
          <Link to={`/materials/${tile.materialId}`}>{material?.name ?? 'its material'}</Link>.
        </p>
        <TileColorEditor value={tile.color} onChange={setColor} />
      </Collapsible>

      <Collapsible title="Edge rhythm" note={RHYTHM_NOTE[status]}>
        <div className="stack">
          <p className="muted small m-0">
            None → continuous UV. All four sides → edged UV (SDF mirrored/merged per edge). Partial
            is invalid.
          </p>
          <div className="row gap-2">
            <button type="button" className="btn" onClick={enableAllEdges}>
              Set all four edges
            </button>
            <button type="button" className="btn" onClick={() => updateTile({ rhythm: undefined })}>
              Clear edges
            </button>
          </div>
          {status === 'partial' && (
            <p className="error">Incomplete rhythm — set all four sides or clear edges.</p>
          )}
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Side</th>
                  <th>Rhythm</th>
                  <th>Mirrored</th>
                </tr>
              </thead>
              <tbody>
                {SIDES.map((side) => (
                  <tr key={side}>
                    <td>{side}</td>
                    <td>
                      <TextField
                        value={tile.rhythm?.[side]?.name ?? ''}
                        onChange={(v) => setRhythm(side, 'name', v)}
                        placeholder="—"
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={tile.rhythm?.[side]?.mirrored ?? false}
                        disabled={!tile.rhythm?.[side]?.name}
                        onChange={(e) => setRhythm(side, 'mirrored', e.target.checked)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Collapsible>

      <div className="row between no-print">
        <span className="mono muted tiny">
          {tile.id.slice(0, 8)}
        </span>
        <button
          type="button"
          className="btn danger"
          title="Also drops this tile's stock entries"
          onClick={() => {
            updateProject((p) => ({
              ...p,
              tileDefinitions: p.tileDefinitions.filter((t) => t.id !== tile.id),
              stock: {
                ...p.stock,
                entries: p.stock.entries.filter((e) => e.tileDefinitionId !== tile.id),
              },
            }));
            onClose();
          }}
        >
          Delete tile
        </button>
      </div>
    </div>
  );
}
