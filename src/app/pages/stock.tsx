import type { StockEntryJson } from '@/domain/project';
import { useProject } from '../project-context';

export function StockPage() {
  const { project, updateProject } = useProject();

  const upsert = (tileDefinitionId: string, entry: StockEntryJson) => {
    updateProject((p) => {
      const others = p.stock.entries.filter((e) => e.tileDefinitionId !== tileDefinitionId);
      return { ...p, stock: { ...p.stock, entries: [...others, entry] } };
    });
  };

  return (
    <div className="page">
      <h1>Stock</h1>
      <p className="lede">
        Exact counts or probabilistic allocations (poisson / normal / uniform) sampled before
        solve.
      </p>

      <section className="panel">
        <div className="table-scroll"><table className="table">
          <thead>
            <tr>
              <th>Tile</th>
              <th>Kind</th>
              <th>Parameters</th>
            </tr>
          </thead>
          <tbody>
            {project.tileDefinitions.map((tile) => {
              const entry = project.stock.entries.find((e) => e.tileDefinitionId === tile.id);
              const kind = entry?.kind ?? 'exact';
              return (
                <tr key={tile.id}>
                  <td>
                    <strong>{tile.name}</strong>
                    <div className="muted mono">{tile.id.slice(0, 8)}</div>
                  </td>
                  <td>
                    <select
                      value={kind}
                      onChange={(e) => {
                        const nextKind = e.target.value as 'exact' | 'distribution';
                        if (nextKind === 'exact') {
                          upsert(tile.id, {
                            tileDefinitionId: tile.id,
                            kind: 'exact',
                            count: entry?.kind === 'exact' ? entry.count : 10,
                          });
                        } else {
                          upsert(tile.id, {
                            tileDefinitionId: tile.id,
                            kind: 'distribution',
                            distribution: 'normal',
                            params: { mean: 10, stdDev: 2 },
                          });
                        }
                      }}
                    >
                      <option value="exact">exact</option>
                      <option value="distribution">distribution</option>
                    </select>
                  </td>
                  <td>
                    {(!entry || entry.kind === 'exact') && (
                      <div className="field">
                        <label>Count</label>
                        <input
                          type="number"
                          min={0}
                          value={entry?.kind === 'exact' ? entry.count : 0}
                          onChange={(e) =>
                            upsert(tile.id, {
                              tileDefinitionId: tile.id,
                              kind: 'exact',
                              count: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                        />
                      </div>
                    )}
                    {entry?.kind === 'distribution' && (
                      <div className="row">
                        <div className="field">
                          <label>Dist</label>
                          <select
                            value={entry.distribution}
                            onChange={(e) => {
                              const distribution = e.target.value as
                                | 'poisson'
                                | 'normal'
                                | 'uniform';
                              const params: Record<string, number> =
                                distribution === 'poisson'
                                  ? { lambda: 10 }
                                  : distribution === 'uniform'
                                    ? { min: 5, max: 15 }
                                    : { mean: 10, stdDev: 2 };
                              upsert(tile.id, { ...entry, distribution, params });
                            }}
                          >
                            <option value="poisson">poisson</option>
                            <option value="normal">normal</option>
                            <option value="uniform">uniform</option>
                          </select>
                        </div>
                        {Object.entries(entry.params).map(([key, value]) => (
                          <div className="field" key={key}>
                            <label>{key}</label>
                            <input
                              type="number"
                              value={value}
                              onChange={(e) =>
                                upsert(tile.id, {
                                  ...entry,
                                  params: {
                                    ...entry.params,
                                    [key]: Number(e.target.value) || 0,
                                  },
                                })
                              }
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </section>
    </div>
  );
}
