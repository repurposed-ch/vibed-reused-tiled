import { createTileDefinition, type FacadeSide, type TileDefinitionJson } from '@/domain/project';
import { useProject } from '../project-context';

const SIDES: FacadeSide[] = ['south', 'east', 'north', 'west'];

function RhythmViz({ tile }: { tile: TileDefinitionJson }) {
  const w = 160;
  const h = 100;
  const pad = 28;
  return (
    <svg width={w + pad * 2} height={h + pad * 2} viewBox={`0 0 ${w + pad * 2} ${h + pad * 2}`}>
      <rect
        x={pad}
        y={pad}
        width={w}
        height={h}
        fill={tile.color}
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

  return (
    <div className="page">
      <h1>Tile definitions</h1>
      <p className="lede">
        Rectangles with length (+X), width (+Y), thickness (+Z), material, color, and optional
        rhythm labels per facade (mirrored sides use the prime mark).
      </p>

      <div className="row no-print" style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          className="btn primary"
          onClick={() =>
            updateProject((p) => ({
              ...p,
              tileDefinitions: [...p.tileDefinitions, createTileDefinition()],
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
                    <label>Color</label>
                    <input
                      type="color"
                      value={tile.color.startsWith('#') ? tile.color : '#c4a574'}
                      onChange={(e) => updateTile(tile.id, { color: e.target.value })}
                    />
                  </div>
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
                  <div className="field">
                    <label>Material</label>
                    <input
                      value={tile.material}
                      onChange={(e) => updateTile(tile.id, { material: e.target.value })}
                    />
                  </div>
                </div>
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
                            onChange={(e) => setRhythm(tile.id, side, 'mirrored', e.target.checked)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
              <div className="canvas-frame" style={{ display: 'grid', placeItems: 'center' }}>
                <RhythmViz tile={tile} />
                <p className="muted mono" style={{ marginTop: '0.5rem' }}>
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
