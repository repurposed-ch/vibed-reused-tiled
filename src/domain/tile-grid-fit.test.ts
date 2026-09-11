import { describe, expect, it } from 'vitest';
import {
  createMasterGrid,
  createTileGrid,
  createTileSchema,
  describeFit,
  FIT_OVER_TOLERANCE,
  FIT_UNDER_TOLERANCE,
  fitTile,
  fitTileInSpan,
  innermostTileGrid,
  sanitizeJoint,
  spanFor,
  spanOptions,
  widenedJoint,
} from './tile-grid';

const CELL = { x: 0.15, y: 0.15 };
const tile = (length: number, width: number) => ({ length, width });

describe('fitTile', () => {
  it('fits an exact tile: k·cell − joint', () => {
    const f = fitTile(tile(0.29, 0.14), CELL, 0.01, false);
    expect(f).toMatchObject({ iSpan: 2, jSpan: 1, fit: 'exact' });
  });

  it('marks an undersized tile and reports its slack', () => {
    const f = fitTile(tile(0.28, 0.14), CELL, 0.01, false);
    expect(f.fit).toBe('under');
    expect(f.iSpan).toBe(2);
    expect(f.slack.x).toBeCloseTo(0.01, 9);
    expect(f.slack.y).toBeCloseTo(0, 9);
  });

  it('marks an oversized tile', () => {
    const f = fitTile(tile(0.3, 0.3), { x: 0.25, y: 0.25 }, 0, false);
    expect(f.fit).toBe('over');
    expect(f.slack.x).toBeCloseTo(-0.05, 9);
  });

  // Nearest-span rounding: up to half a cell short takes the larger span; past that the tile
  // is judged against the smaller span, where it is too large.
  it('rounds to the nearest span, so a tile just past half a cell short is oversized', () => {
    expect(fitTile(tile(0.21, 0.14), CELL, 0.01, false)).toMatchObject({ iSpan: 1, fit: 'over' });
    expect(fitTile(tile(0.22, 0.14), CELL, 0.01, false)).toMatchObject({ iSpan: 2, fit: 'under' });
  });

  it('swaps spans when turned', () => {
    expect(fitTile(tile(0.29, 0.14), CELL, 0.01, true)).toMatchObject({ iSpan: 1, jSpan: 2, fit: 'exact' });
  });

  it('marks a tile under half a cell as too small', () => {
    const f = fitTile(tile(0.05, 0.05), CELL, 0, false);
    expect(f.fit).toBe('tooSmall');
    expect(f.iSpan).toBeGreaterThanOrEqual(1);
    expect(spanFor(tile(0.05, 0.05), CELL, 0, false)).toBeNull();
  });

  it('is lopsided at the tolerance edges', () => {
    expect(fitTile(tile(0.15 - 0.0004, 0.15), CELL, 0, false).fit).toBe('exact');
    expect(fitTile(tile(0.15 - 0.0006, 0.15), CELL, 0, false).fit).toBe('under');
    // Anything beyond float noise over is an error — neighbours would overlap and z-fight.
    expect(fitTile(tile(0.15 + 2e-6, 0.15), CELL, 0, false).fit).toBe('over');
    expect(FIT_UNDER_TOLERANCE).toBeGreaterThan(FIT_OVER_TOLERANCE);
  });

  it('treats a missing or invalid joint as zero instead of producing NaN spans', () => {
    const base = fitTile(tile(0.3, 0.15), CELL, 0, false);
    for (const bad of [NaN, undefined, -0.01, Infinity]) {
      expect(fitTile(tile(0.3, 0.15), CELL, bad as unknown as number, false)).toEqual(base);
    }
    expect(sanitizeJoint('0.01')).toBe(0);
  });
});

describe('spanFor and spanOptions', () => {
  it('keeps the existing exact cases', () => {
    expect(spanFor(tile(0.45, 0.45), CELL, 0, false)).toEqual({ iSpan: 3, jSpan: 3 });
    expect(spanFor(tile(0.29, 0.14), CELL, 0.01, false)).toEqual({ iSpan: 2, jSpan: 1 });
    expect(spanFor(tile(0.3, 0.3), { x: 0.25, y: 0.25 }, 0, false)).toBeNull();
  });

  it('now accepts an undersized tile', () => {
    expect(spanFor(tile(0.28, 0.14), CELL, 0.01, false)).toEqual({ iSpan: 2, jSpan: 1 });
  });

  it('rejects an oversized tile, as before', () => {
    // A 0.15 tile on a 0.15 cell with a 0.01 joint needs 0.14 — it is 10 mm too large.
    expect(spanFor(tile(0.15, 0.15), CELL, 0.01, false)).toBeNull();
  });

  it('carries the fit and slack on each option', () => {
    const options = spanOptions(tile(0.28, 0.14), CELL, 0.01);
    expect(options).toHaveLength(2);
    expect(options[0]).toMatchObject({ rotated: false, fit: 'under' });
    expect(options[1]).toMatchObject({ rotated: true, iSpan: 1, jSpan: 2 });
  });
});

describe('fitTileInSpan', () => {
  it('judges a tile against a stored span that no longer suits it', () => {
    expect(fitTileInSpan(tile(0.31, 0.14), CELL, 0.01, false, { iSpan: 2, jSpan: 1 }).fit).toBe('over');
    expect(fitTileInSpan(tile(0.14, 0.14), CELL, 0.01, false, { iSpan: 2, jSpan: 1 }).fit).toBe('under');
  });
});

describe('helpers', () => {
  it('widens the joints beside an undersized tile', () => {
    const w = widenedJoint(0.01, 0.02);
    expect(w.min).toBeCloseTo(0.02, 9);
    expect(w.max).toBeCloseTo(0.03, 9);
  });

  it('describes fits in millimetres', () => {
    expect(describeFit('A', fitTile(tile(0.3, 0.3), { x: 0.25, y: 0.25 }, 0, false))).toMatch(/50 mm larger than its 1×1/);
    expect(describeFit('A', fitTile(tile(0.28, 0.14), CELL, 0.01, false))).toMatch(/10 mm under its 2×1/);
  });

  it('finds the innermost tile grid, and survives a broken chain', () => {
    const grid = createTileGrid({ fallbackTileDefinitionId: 't' });
    const master = createMasterGrid({ childId: grid.id });
    const schema = createTileSchema({ tileGrids: [grid], masterGrids: [master], rootMasterGridId: master.id });
    expect(innermostTileGrid(schema)?.id).toBe(grid.id);

    const a = createMasterGrid({ id: 'a', childId: 'b' });
    const b = createMasterGrid({ id: 'b', childId: 'a' });
    const cyclic = createTileSchema({ tileGrids: [grid], masterGrids: [a, b], rootMasterGridId: 'a' });
    expect(innermostTileGrid(cyclic)).toBeUndefined();
  });
});
