import {
  createTileDefinition,
  DEFAULT_PALETTE_C,
  hasCompleteRhythm,
  tileDisplayColor,
  type FacadeSide,
  type MaterialDefinitionJson,
  type TileColorJson,
  type TileDefinitionJson,
} from '@/domain/project';
import { bakeInputFromTile, bakeMaterialTexture } from '@/render/materials';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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

export function TilesPage() {
  const { project, updateProject } = useProject();

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

                  <div className="field">
                    <label>Color</label>
                    <div className="row" style={{ gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <button
                        type="button"
                        className={tile.color.mode === 'brightness' ? 'btn primary' : 'btn'}
                        onClick={() =>
                          setColor(tile.id, {
                            mode: 'brightness',
                            color: tileDisplayColor(tile.color),
                          })
                        }
                      >
                        Brightness
                      </button>
                      <button
                        type="button"
                        className={tile.color.mode === 'palette' ? 'btn primary' : 'btn'}
                        onClick={() => {
                          const base = tileDisplayColor(tile.color);
                          setColor(tile.id, {
                            mode: 'palette',
                            colors:
                              tile.color.mode === 'palette'
                                ? tile.color.colors
                                : [base, base, base],
                            c:
                              tile.color.mode === 'palette'
                                ? tile.color.c
                                : [...DEFAULT_PALETTE_C],
                          });
                        }}
                      >
                        Palette (3)
                      </button>
                    </div>
                    {tile.color.mode === 'brightness' ? (
                      <div className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="color"
                          value={
                            tile.color.color.startsWith('#') ? tile.color.color : '#c4a574'
                          }
                          onChange={(e) =>
                            setColor(tile.id, { mode: 'brightness', color: e.target.value })
                          }
                        />
                        <span className="mono muted">{tile.color.color}</span>
                        <span className="muted" style={{ fontSize: '0.8rem' }}>
                          SDF → brightness
                        </span>
                      </div>
                    ) : (
                      (() => {
                        const paletteColors = tile.color.colors;
                        const paletteC = tile.color.c ?? DEFAULT_PALETTE_C;
                        return (
                          <div className="stack" style={{ gap: '0.75rem' }}>
                            <div className="row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
                              {(['a', 'b', 'd'] as const).map((label, i) => {
                                const hex = paletteColors[i]!;
                                return (
                                  <div key={label} className="field">
                                    <label>palette {label}</label>
                                    <input
                                      type="color"
                                      value={hex.startsWith('#') ? hex : '#c4a574'}
                                      onChange={(e) => {
                                        const colors: [string, string, string] = [
                                          paletteColors[0],
                                          paletteColors[1],
                                          paletteColors[2],
                                        ];
                                        colors[i] = e.target.value;
                                        setColor(tile.id, {
                                          mode: 'palette',
                                          colors,
                                          c: paletteC,
                                        });
                                      }}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                            <div className="stack" style={{ gap: '0.4rem' }}>
                              <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                                Quilez palette(t, a, b, c, d) — adjust c with sliders
                              </p>
                              {(['x', 'y', 'z'] as const).map((axis, i) => (
                                <div
                                  key={axis}
                                  className="row"
                                  style={{ alignItems: 'center', gap: '0.5rem' }}
                                >
                                  <label
                                    className="mono"
                                    style={{ width: '2.5rem', margin: 0, fontSize: '0.8rem' }}
                                  >
                                    c.{axis}
                                  </label>
                                  <input
                                    type="range"
                                    min={0}
                                    max={2}
                                    step={0.01}
                                    value={paletteC[i]!}
                                    style={{ flex: 1 }}
                                    onChange={(e) => {
                                      const next: [number, number, number] = [
                                        paletteC[0],
                                        paletteC[1],
                                        paletteC[2],
                                      ];
                                      next[i] = Number(e.target.value);
                                      setColor(tile.id, {
                                        mode: 'palette',
                                        colors: paletteColors,
                                        c: next,
                                      });
                                    }}
                                  />
                                  <span className="mono muted" style={{ width: '3rem' }}>
                                    {paletteC[i]!.toFixed(2)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()
                    )}
                  </div>

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
