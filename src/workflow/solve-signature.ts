import type { TilingProjectJson } from '@/domain/project';

/**
 * Structural fingerprint of everything the solver reads.
 *
 * This is what an auto-solve effect keys on, and the exclusions are the whole
 * point. `persist()` stamps `meta.updatedAt` on every write and the solver's own
 * output lands in `instance`, so an effect watching the project object — or any
 * key that included those two fields — would solve, write, see a changed
 * project, and solve again forever. Leaving `meta` and `instance` out is the
 * loop guard, which is why it has a test of its own.
 *
 * Baked textures are stripped as well: they are data URLs running to megabytes,
 * they have no bearing on where a tile goes, and hashing them on every keystroke
 * would cost more than the solve.
 */
export function solveSignature(project: TilingProjectJson, seed: number): string {
  return JSON.stringify({
    seed,
    tiles: project.tileDefinitions.map((tile) => ({
      ...tile,
      texture: undefined,
      // Rounding changes how a tile is drawn, never where it goes. Hashing it would re-solve
      // on every slider tick and hand every placement a fresh id.
      cornerRounding: undefined,
    })),
    stock: project.stock,
    designFamily: project.designFamily,
    boundaries: project.boundaries,
    tileSchema: project.tileSchema,
  });
}

/**
 * Rough cell count the fill would visit for this project.
 *
 * The fill walks the boundary's bounding box a cell at a time and runs several
 * point-in-polygon tests on each, so cost scales with area over cell size. A
 * large boundary at a fine cell size is a main-thread freeze that debouncing
 * cannot help with once it has started — the caller uses this to decline the
 * work rather than lock the page up.
 */
export function estimateSolveCells(project: TilingProjectJson): number {
  const cell = project.tileSchema?.tileGrids[0]?.cell;
  if (!cell) return 0;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const geometry of [...project.boundaries.outers, ...project.boundaries.holes]) {
    const vertices = (geometry as { vertices?: Array<{ x: number; y: number }> }).vertices;
    if (!Array.isArray(vertices)) continue;
    for (const v of vertices) {
      if (typeof v?.x !== 'number' || typeof v?.y !== 'number') continue;
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return 0;
  const columns = Math.ceil((maxX - minX) / cell.x) + 1;
  const rows = Math.ceil((maxY - minY) / cell.y) + 1;
  return Math.max(0, columns) * Math.max(0, rows);
}
