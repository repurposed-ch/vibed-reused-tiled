import { useEffect, useMemo, useRef } from 'react';
import { mulberry32, sampleStock } from '@/workflow/sample-stock';
import { solveLayout } from '@/workflow/solve-layout';
import { estimateSolveCells, solveSignature } from '@/workflow/solve-signature';
import { useProject } from './project-context';
import { useUiState } from './ui-state';

/**
 * Keeps `project.instance` in step with the rest of the project.
 *
 * Nothing used to re-solve: the solver had one call site, a button on `#/solve`.
 * Change a boundary or a tile size and the 2D and 3D views carried on drawing
 * the previous result against the new inputs, with nothing on screen saying so.
 *
 * Renders nothing; it exists to hold the effect somewhere inside both providers.
 */

/** Quiet period after the last edit before solving. */
const DEBOUNCE_MS = 250;

/**
 * Above this the fill is left to a deliberate run on `#/solve`. It walks the
 * boundary bounding box a cell at a time with several point-in-polygon tests
 * each, all on the main thread — past a certain size that is a visible freeze on
 * every keystroke, and a debounce does not help once the work has begun.
 */
const MAX_AUTO_CELLS = 200_000;

export function AutoSolve() {
  const { project, setInstance } = useProject();
  const { ui, setSolveStatus } = useUiState();

  // The effect keys on this string, never on `project`. Every write stamps
  // `meta.updatedAt`, and the solve writes `instance`, so keying on the object
  // would make the solve retrigger itself without end. The signature leaves both
  // of those out on purpose.
  const signature = useMemo(() => solveSignature(project, ui.seed), [project, ui.seed]);

  // Read inside the timeout without making the effect depend on them.
  const latest = useRef({ project, setInstance, setSolveStatus });
  latest.current = { project, setInstance, setSolveStatus };

  useEffect(() => {
    const timer = setTimeout(() => {
      const { project: current, setInstance: commit, setSolveStatus: status } = latest.current;

      const cells = estimateSolveCells(current);
      if (cells > MAX_AUTO_CELLS) {
        status({
          kind: 'error',
          reason: `${cells.toLocaleString()} cells is too many to solve on every edit — run it from the Solve page.`,
        });
        return;
      }

      status({ kind: 'solving' });
      try {
        const sampled = sampleStock(current.stock, mulberry32(ui.seed));
        const instance = solveLayout({
          tileDefinitions: current.tileDefinitions,
          designFamily: current.designFamily,
          boundaries: current.boundaries,
          sampledStock: sampled,
          seed: ui.seed,
          tileSchema: current.tileSchema,
        });
        commit(instance);
        status({ kind: 'idle' });
      } catch (error) {
        // Keep whatever was solved last rather than blanking the views.
        status({
          kind: 'error',
          reason: error instanceof Error ? error.message : 'Could not solve',
        });
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, ui.seed]);

  return null;
}
