import {
  cornerRadiusMetres,
  createTileDefinition,
  describeFit,
  fitTile,
  formatMm,
  hasCompleteRhythm,
  innermostTileGrid,
  MAX_CORNER_ROUNDING,
  tileDisplayColor,
  widenedJoint,
  type TileGridJson,
  type FacadeSide,
  type MaterialDefinitionJson,
  type TileColorJson,
  type TileDefinitionJson,
} from '@/domain/project';
import { bakeInputFromTile, bakeMaterialTexture } from '@/render/materials';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TileColorEditor } from '../components/tile-color-editor';
import { useProject } from '../project-context';

const SIDES: FacadeSide[] = ['south', 'east', 'north', 'west'];

const MAX_PREVIEW_W = 160;
const MAX_PREVIEW_H = 100;

function formatMeters(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2).replace(/\.?0+$/, '') : '—';
}

function rhythmStatus(rhythm: TileDefinitionJson['rhythm']): 'none' | 'complete' | 'partial' {
  if (!rhythm) return 'none';
  const n = SIDES.filter((s) => rhythm[s] != null).length;
  if (n === 0) return 'none';
  if (n === 4) return 'complete';
  return 'partial';
}

function TilePreview({
  tile,
  material,
}: {
  tile: TileDefinitionJson;
  material?: MaterialDefinitionJson;
}) {
  const length = Math.max(tile.length, 1e-6);
  const width = Math.max(tile.width, 1e-6);
  const scale = Math.min(MAX_PREVIEW_W / length, MAX_PREVIEW_H / width);
  const w = length * scale;
  const h = width * scale;
  const pad = 28;
  const vbW = w + pad * 2;
  const vbH = h + pad * 2;
  const dims = `${formatMeters(tile.length)}×${formatMeters(tile.width)}×${formatMeters(tile.thickness)} m`;
  const patternId = `tile-tex-${tile.id}`;
  const fallback = tileDisplayColor(tile.color);

  const [textureUrl, setTextureUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!material) {
      setTextureUrl(null);
      return;
    }
    try {
      const baked = bakeMaterialTexture(bakeInputFromTile(tile, material), 256);
      setTextureUrl(baked.dataUrl);
    } catch {
      setTextureUrl(null);
    }
  }, [material, tile]);

  return (
    <div style={{ display: 'grid', placeItems: 'center', gap: '0.35rem' }}>
      <svg
        className="fluid-svg"
        viewBox={`0 0 ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ aspectRatio: `${vbW} / ${vbH}`, maxWidth: 280 }}
        role="img"
        aria-label={`Texture preview for ${tile.name}, ${dims}`}
      >
        <defs>
          {textureUrl && (
            <pattern
              id={patternId}
              patternUnits="userSpaceOnUse"
              x={pad}
              y={pad}
              width={w}
              height={h}
            >
              <image
                href={textureUrl}
                x={0}
                y={0}
                width={w}
                height={h}
                preserveAspectRatio="none"
              />
            </pattern>
          )}
        </defs>
        <rect
          x={pad}
          y={pad}
          width={w}
          height={h}
          rx={cornerRadiusMetres(tile) * scale}
          ry={cornerRadiusMetres(tile) * scale}
          fill={textureUrl ? `url(#${patternId})` : fallback}
          stroke="#f3ebe1"
          strokeWidth={1.5}
        />
        {SIDES.map((side) => {
          const r = tile.rhythm?.[side];
          if (!r) return null;
          const label = `${r.name}${r.mirrored ? '′' : ''}`;
          const pos =
            side === 'south'
              ? { x: pad + w / 2, y: pad + h + 14 }
              : side === 'north'
                ? { x: pad + w / 2, y: pad - 10 }
                : side === 'east'
                  ? { x: pad + w + 14, y: pad + h / 2 }
                  : { x: pad - 14, y: pad + h / 2 };
          return (
            <text
              key={side}
              x={pos.x}
              y={pos.y}
              fill="#b5a89a"
              fontSize={11}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="Fragment Mono, monospace"
            >
              {label}
            </text>
          );
        })}
      </svg>
      <p className="muted mono" style={{ margin: 0, fontSize: '0.8rem' }}>
        {dims}
        {hasCompleteRhythm(tile.rhythm) ? ' · edged UV' : ' · continuous UV'}
      </p>
    </div>
  );
}

type FitStatus = { kind: 'ok' | 'warning' | 'error'; message: string };

/**
 * How a tile fits the tile schema's grid: checked in the orientations the schema actually uses
 * for it (both, when it is unused), because a tile placed turned that is too large turned is
 * broken now even if it would fit upright.
 */
function tileFitStatus(tile: TileDefinitionJson, grid: TileGridJson | undefined): FitStatus | null {
  if (!grid) return null;
  const used = grid.instances.filter((instance) => instance.tileDefinitionId === tile.id);
  const orientations = used.length > 0 ? [...new Set(used.map((i) => i.rotated))] : [false, true];
  const fits = orientations.map((rotated) => ({ rotated, fit: fitTile(tile, grid.cell, grid.joint, rotated) }));
  const turned = (rotated: boolean) => (rotated ? ' (turned)' : '');

  const bad = fits.filter((f) => f.fit.fit === 'over' || f.fit.fit === 'tooSmall');
  if (used.length > 0 ? bad.length > 0 : bad.length === fits.length) {
    const first = bad[0]!;
    return {
      kind: 'error',
      message: `${describeFit(`${tile.name}${turned(first.rotated)}`, first.fit)}${
        used.length > 0 ? ' The fill leaves it out and uses fallback tiles in its place.' : ''
      }`,
    };
  }

  const under = fits.find((f) => f.fit.fit === 'under');
  if (under) {
    const slack = Math.max(under.fit.slack.x, under.fit.slack.y);
    const joint = widenedJoint(grid.joint, slack);
    return {
      kind: 'warning',
      message: `${tile.name}${turned(under.rotated)} is ${formatMm(slack)} under its ${under.fit.iSpan}×${under.fit.jSpan} footprint. It is centred, so the joints beside it widen to ${formatMm(joint.min)}–${formatMm(joint.max)}.`,
    };
  }

  const exact = fits.find((f) => f.fit.fit === 'exact')!;
  return { kind: 'ok', message: `Fits its ${exact.fit.iSpan}×${exact.fit.jSpan} footprint.` };
}

export function TilesPage() {
  const { project, updateProject } = useProject();
  const grid = project.tileSchema ? innermostTileGrid(project.tileSchema) : undefined;

  const updateTile = (id: string, patch: Partial<TileDefinitionJson>) => {
    updateProject((p) => ({
      ...p,
      tileDefinitions: p.tileDefinitions.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  };

  const setColor = (id: string, color: TileColorJson) => {
    updateTile(id, { color });
  };

  const setRhythm = (
    id: string,
    side: FacadeSide,
    field: 'name' | 'mirrored',
    value: string | boolean,
  ) => {
    updateProject((p) => ({
      ...p,
      tileDefinitions: p.tileDefinitions.map((t) => {
        if (t.id !== id) return t;
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

  const enableAllEdges = (id: string) => {
    updateTile(id, {
      rhythm: {
        south: { name: 'A', mirrored: false },
        north: { name: 'A', mirrored: true },
        east: { name: 'B', mirrored: false },
        west: { name: 'B', mirrored: true },
      },
    });
  };

  const clearEdges = (id: string) => {
    updateTile(id, { rhythm: undefined });
  };

  const defaultMaterialId = project.materials[0]?.id ?? 'material-ceramic';

  return (
    <div className="page">
      <h1>Tile definitions</h1>
      <p className="lede">
        Geometry, SDF material, brightness or palette color, and optional edge rhythm (all four
        sides or none). Layout 2D uses a flat display color; preview / 3D use the GLSL bake. Edit
        materials on the <Link to="/materials">Materials</Link> page.
      </p>

      <div className="row no-print" style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          className="btn primary"
          onClick={() =>
            updateProject((p) => ({
              ...p,
              tileDefinitions: [
                ...p.tileDefinitions,
                createTileDefinition({ materialId: defaultMaterialId }),
              ],
            }))
          }
        >
          Add tile
        </button>
      </div>

      <div className="stack">
        {project.tileDefinitions.map((tile) => {
          const status = rhythmStatus(tile.rhythm);
          return (
            <section key={tile.id} className="panel">
              <div className="split split-2">
                <div className="stack">
                  <div className="row">
                    <div className="field" style={{ flex: 1 }}>
                      <label>Name</label>
                      <input
                        value={tile.name}
                        onChange={(e) => updateTile(tile.id, { name: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label>Material</label>
                      <select
                        value={tile.materialId}
                        onChange={(e) => updateTile(tile.id, { materialId: e.target.value })}
                      >
                        {project.materials.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <TileColorEditor value={tile.color} onChange={(color) => setColor(tile.id, color)} />

                  <div className="row">
                    {(['length', 'width', 'thickness'] as const).map((dim) => (
                      <div className="field" key={dim}>
                        <label>{dim} (m)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={tile[dim]}
                          onChange={(e) =>
                            updateTile(tile.id, { [dim]: Number(e.target.value) || 0.01 })
                          }
                        />
                      </div>
                    ))}
                  </div>

                  <div className="stack" style={{ gap: '0.3rem' }}>
                    <span
                      className="muted"
                      style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}
                    >
                      Corner rounding
                    </span>
                    <div className="row" style={{ alignItems: 'center', gap: '0.5rem', flexWrap: 'nowrap' }}>
                      {/* Range inputs stay outside .field, whose padding and border wreck the track. */}
                      <input
                        type="range"
                        min={0}
                        max={MAX_CORNER_ROUNDING}
                        step={0.005}
                        value={tile.cornerRounding ?? 0}
                        style={{ flex: 1, accentColor: '#d9773a', background: 'transparent' }}
                        onChange={(e) => updateTile(tile.id, { cornerRounding: Number(e.target.value) })}
                      />
                      <span className="mono muted" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                        {((tile.cornerRounding ?? 0) * 100).toFixed(1)} % ·{' '}
                        {(cornerRadiusMetres(tile) * 1000).toFixed(1)} mm
                      </span>
                    </div>
                  </div>

                  {(() => {
                    const fit = tileFitStatus(tile, grid);
                    if (!fit) return null;
                    if (fit.kind === 'error') return <p className="error">{fit.message}</p>;
                    return (
                      <p
                        className="muted"
                        style={{
                          margin: 0,
                          fontSize: '0.8rem',
                          ...(fit.kind === 'warning' ? { color: '#d9773a' } : {}),
                        }}
                      >
                        {fit.message}
                      </p>
                    );
                  })()}

                  <div className="field">
                    <label>Edge rhythm (texture + composition)</label>
                    <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: '0.8rem' }}>
                      None → continuous UV. All four sides → edged UV (SDF mirrored/merged per
                      edge). Partial is invalid.
                    </p>
                    <div className="row" style={{ marginBottom: '0.5rem', gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => enableAllEdges(tile.id)}
                      >
                        Set all four edges
                      </button>
                      <button type="button" className="btn" onClick={() => clearEdges(tile.id)}>
                        Clear edges
                      </button>
                    </div>
                    {status === 'partial' && (
                      <p className="error">
                        Incomplete rhythm — set all four sides or clear edges.
                      </p>
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
                                <input
                                  value={tile.rhythm?.[side]?.name ?? ''}
                                  placeholder="—"
                                  onChange={(e) =>
                                    setRhythm(tile.id, side, 'name', e.target.value)
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={tile.rhythm?.[side]?.mirrored ?? false}
                                  disabled={!tile.rhythm?.[side]?.name}
                                  onChange={(e) =>
                                    setRhythm(tile.id, side, 'mirrored', e.target.checked)
                                  }
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn danger"
                    onClick={() =>
                      updateProject((p) => ({
                        ...p,
                        tileDefinitions: p.tileDefinitions.filter((t) => t.id !== tile.id),
                        stock: {
                          ...p.stock,
                          entries: p.stock.entries.filter((e) => e.tileDefinitionId !== tile.id),
                        },
                      }))
                    }
                  >
                    Delete tile
                  </button>
                </div>
                <div
                  className="canvas-frame"
                  style={{ display: 'grid', placeItems: 'center', gap: '0.75rem' }}
                >
                  <TilePreview
                    tile={tile}
                    material={project.materials.find((m) => m.id === tile.materialId)}
                  />
                  <p className="muted mono" style={{ marginTop: 0 }}>
                    {tile.id.slice(0, 8)}
                  </p>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
