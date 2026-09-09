import {
  createTileDefinition,
  type FacadeSide,
  type MaterialDefinitionJson,
  type TileDefinitionJson,
} from '@/domain/project';
import { bakeMaterialTexture } from '@/render/materials';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProject } from '../project-context';

const SIDES: FacadeSide[] = ['south', 'east', 'north', 'west'];

const MAX_PREVIEW_W = 160;
const MAX_PREVIEW_H = 100;

function formatMeters(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2).replace(/\.?0+$/, '') : '—';
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

  const [textureUrl, setTextureUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!material) {
      setTextureUrl(null);
      return;
    }
    try {
      // Smaller bake for UI preview; full 1024 used in 3D / export.
      const baked = bakeMaterialTexture(material, tile.color, 256);
      setTextureUrl(baked.dataUrl);
    } catch {
      setTextureUrl(null);
    }
  }, [material, tile.color]);

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
          fill={textureUrl ? `url(#${patternId})` : tile.color}
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
      </p>
    </div>
  );
}

export function TilesPage() {
  const { project, updateProject } = useProject();

  const updateTile = (id: string, patch: Partial<TileDefinitionJson>) => {
    updateProject((p) => ({
      ...p,
      tileDefinitions: p.tileDefinitions.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t, ...patch };
        if (patch.color && !next.colors.includes(patch.color)) {
          next.colors = [...next.colors, patch.color];
        }
        if (patch.colors && !patch.colors.includes(next.color)) {
          next.color = patch.colors[0] ?? next.color;
        }
        return next;
      }),
    }));
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
        const current = t.rhythm?.[side] ?? { name: 'A', mirrored: false };
        return {
          ...t,
          rhythm: {
            ...t.rhythm,
            [side]: { ...current, [field]: value },
          },
        };
      }),
    }));
  };

  const defaultMaterialId = project.materials[0]?.id ?? 'material-ceramic';

  return (
    <div className="page">
      <h1>Tile definitions</h1>
      <p className="lede">
        Rectangles with length (+X), width (+Y), thickness (+Z), a material recipe, color
        swatches (2D uses the active color), and optional rhythm labels. Edit SDF materials on the{' '}
        <Link to="/materials">Materials</Link> page.
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
        {project.tileDefinitions.map((tile) => (
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
                  <label>Color swatches</label>
                  <div className="row" style={{ flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
                    {tile.colors.map((c, i) => (
                      <button
                        key={`${c}-${i}`}
                        type="button"
                        title={c}
                        onClick={() => updateTile(tile.id, { color: c })}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 4,
                          border:
                            c === tile.color ? '2px solid #f3ebe1' : '1px solid #5a4f45',
                          background: c,
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      />
                    ))}
                    <input
                      type="color"
                      value={tile.color.startsWith('#') ? tile.color : '#c4a574'}
                      onChange={(e) => {
                        const next = e.target.value;
                        updateTile(tile.id, {
                          color: next,
                          colors: tile.colors.includes(next)
                            ? tile.colors
                            : [...tile.colors, next],
                        });
                      }}
                      title="Add / set active color"
                    />
                    <button
                      type="button"
                      className="btn"
                      disabled={tile.colors.length <= 1}
                      onClick={() => {
                        const next = tile.colors.filter((c) => c !== tile.color);
                        if (!next.length) return;
                        updateTile(tile.id, { colors: next, color: next[0]! });
                      }}
                    >
                      Remove active
                    </button>
                  </div>
                  <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.8rem' }}>
                    Active: <span className="mono">{tile.color}</span> (2D fill + bake tint)
                  </p>
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
                              onChange={(e) => setRhythm(tile.id, side, 'name', e.target.value)}
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
              <div className="canvas-frame" style={{ display: 'grid', placeItems: 'center', gap: '0.75rem' }}>
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
        ))}
      </div>
    </div>
  );
}
