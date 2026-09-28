import { mulberry32, sampleStock } from '@/workflow/sample-stock';
import { solveLayout } from '@/workflow/solve-layout';
import { useState } from 'react';
import { NumberField } from '../components/number-field';
import { useProject } from '../project-context';
import { useUiState } from '../ui-state';

export function SolvePage() {
  const { project, setInstance } = useProject();
  const { ui, patchUi, solveStatus } = useUiState();
  // Seed and variants persist: they are choices, and losing them on navigation
  // meant a re-run silently used 42 rather than what was typed.
  const seed = ui.seed;
  const setSeed = (next: number) => patchUi({ seed: next });
  const variants = ui.variants;
  const setVariants = (next: number[]) => patchUi({ variants: next });
  const [message, setMessage] = useState<string | null>(null);

  const run = (nextSeed: number) => {
    const sampled = sampleStock(project.stock, mulberry32(nextSeed));
    const instance = solveLayout({
      tileDefinitions: project.tileDefinitions,
      designFamily: project.designFamily,
      boundaries: project.boundaries,
      sampledStock: sampled,
      seed: nextSeed,
      tileSchema: project.tileSchema,
    });
    setInstance(instance);
    setMessage(
      `Seed ${nextSeed}: ${instance.placements.length} placements · sampled ${sampled
        .map((s) => `${s.count}`)
        .join('/')}`,
    );
    return instance;
  };

  return (
    <div className="page">
      <h1>Solve</h1>
      <p className="lede">
        Sample stock from distributions, place primary modules inside the boundary, then greedily
        fill leftovers with soft constraints. This runs automatically after every edit; the controls
        below are for re-rolling a seed deliberately.
      </p>

      {solveStatus.kind === 'solving' && (
        <p className="muted">Solving…</p>
      )}
      {solveStatus.kind === 'error' && (
        <p className="error">Automatic solve is not running: {solveStatus.reason}</p>
      )}

      <section className="panel no-print">
        <div className="row">
          <div className="field">
            <label>Seed</label>
            <NumberField value={seed} onChange={setSeed} integer />
          </div>
          <button type="button" className="btn primary" onClick={() => run(seed)}>
            Run solve
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const seeds = [seed, seed + 1, seed + 2, seed + 3];
              setVariants(seeds);
              run(seeds[0]!);
            }}
          >
            Generate 4 variants
          </button>
        </div>
        {message && <p className="success mt-3">{message}</p>}
      </section>

      {variants.length > 0 && (
        <section className="panel no-print">
          <h2>Variants</h2>
          <div className="row">
            {variants.map((s) => (
              <button key={s} type="button" className="btn" onClick={() => run(s)}>
                Seed {s}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Instance</h2>
        {!project.instance && <p className="muted">No instance yet.</p>}
        {project.instance && (
          <>
            <p className="mono muted">
              placements={project.instance.placements.length} · seed=
              {project.instance.meta?.seed ?? '—'}
            </p>
            <div className="table-scroll"><table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Tile</th>
                  <th>x / y</th>
                  <th>Rotation</th>
                  <th>Mirror</th>
                </tr>
              </thead>
              <tbody>
                {project.instance.placements.slice(0, 40).map((p, i) => {
                  const tile = project.tileDefinitions.find((t) => t.id === p.tileDefinitionId);
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{tile?.name ?? p.tileDefinitionId.slice(0, 8)}</td>
                      <td className="mono">
                        {p.position.x.toFixed(3)} / {p.position.y.toFixed(3)}
                      </td>
                      <td className="mono">{p.rotation}°</td>
                      <td>{p.mirror ? 'yes' : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
            {project.instance.placements.length > 40 && (
              <p className="muted">Showing first 40 of {project.instance.placements.length}.</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
