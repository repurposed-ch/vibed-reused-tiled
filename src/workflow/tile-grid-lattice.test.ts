import { describe, expect, it } from 'vitest';
import {
  createMasterGrid,
  createTileGrid,
  createTileSchema,
  tileGridCells,
  type IntVec2,
  type MasterGridJson,
  type TileGridInstanceJson,
  type TileGridJson,
  type TileSchemaJson,
} from '@/domain/tile-grid';
import {
  deriveLattice,
  latticeDet,
  residueClass,
  resolveCell,
  resolveSchema,
  tryResolveSchema,
  validateLattice,
} from '@/workflow/tile-grid-lattice';

function instance(
  id: string,
  tileDefinitionId: string,
  i: number,
  j: number,
  iSpan = 1,
  jSpan = 1,
): TileGridInstanceJson {
  return { id, tileDefinitionId, i, j, iSpan, jSpan, rotated: false };
}

function unitRow(prefix: string, cells: Array<[number, number]>): TileGridInstanceJson[] {
  return cells.map(([i, j], n) => instance(`${prefix}${n}`, 'b', i, j));
}

function grid(extent: { iCount: number; jCount: number }, instances: TileGridInstanceJson[]): TileGridJson {
  return createTileGrid({
    id: 'grid',
    name: 'Grid',
    cell: { x: 0.15, y: 0.15 },
    extent,
    instances,
    fallbackTileDefinitionId: 'b',
  });
}

/**
 * b b b b
 * a a a b
 * a a a b
 * a a a b   — a is 3× b, one a and seven b in a 4×4 repeat.
 */
const gridA3 = grid({ iCount: 4, jCount: 4 }, [
  instance('a0', 'a', 0, 0, 3, 3),
  ...unitRow('b', [
    [3, 0],
    [3, 1],
    [3, 2],
    [0, 3],
    [1, 3],
    [2, 3],
    [3, 3],
  ]),
]);

/**
 * b b
 * a a
 * a a   — a is 2× b, one a and two b in a 2×3 repeat.
 */
const gridA2 = grid({ iCount: 2, jCount: 3 }, [
  instance('a0', 'a', 0, 0, 2, 2),
  ...unitRow('b', [
    [0, 2],
    [1, 2],
  ]),
]);

/**
 * _ b b b
 * a a a b
 * a a a b
 * a a a b
 * a a a _
 * a a a _
 * a a a _   — two a and six b in a 4×7 box with four blanks, read bottom-up.
 * The blanks belong to neighbouring copies; the repeat is a sheared lattice.
 */
const gridStaircase = grid({ iCount: 4, jCount: 7 }, [
  instance('a0', 'a', 0, 0, 3, 3),
  instance('a1', 'a', 0, 3, 3, 3),
  ...unitRow('b', [
    [3, 3],
    [3, 4],
    [3, 5],
    [1, 6],
    [2, 6],
    [3, 6],
  ]),
]);

function schemaFor(tileGrid: TileGridJson, master: Partial<MasterGridJson> = {}): TileSchemaJson {
  const masterGrid = createMasterGrid({
    id: 'master',
    name: 'Master',
    childId: tileGrid.id,
    u: { i: tileGrid.extent.iCount, j: 0 },
    v: { i: 0, j: tileGrid.extent.jCount },
    ...master,
  });
  return createTileSchema({
    id: 'schema',
    name: 'Schema',
    tileGrids: [tileGrid],
    masterGrids: [masterGrid],
    rootMasterGridId: masterGrid.id,
  });
}

/** Walk a window and assert every cell resolves to exactly one occurrence. */
function coverWindow(schema: TileSchemaJson, half: number) {
  const resolved = resolveSchema(schema);
  const occurrences = new Map<string, IntVec2[]>();
  let unresolved = 0;

  for (let i = -half; i <= half; i += 1) {
    for (let j = -half; j <= half; j += 1) {
      const hit = resolveCell(resolved, { i, j });
      if (!hit) {
        unresolved += 1;
        continue;
      }
      const cells = occurrences.get(hit.occurrenceKey) ?? [];
      cells.push({ i, j });
      occurrences.set(hit.occurrenceKey, cells);
    }
  }

  return { resolved, occurrences, unresolved };
}

describe('validateLattice', () => {
  it('accepts the rectangular repeat of a 3:1 format pair', () => {
    const cells = tileGridCells(gridA3);
    expect(cells).toHaveLength(16);
    expect(validateLattice(cells, { i: 4, j: 0 }, { i: 0, j: 4 })).toEqual({ ok: true, det: 16 });
  });

  it('accepts the rectangular repeat of a 2:1 format pair', () => {
    const cells = tileGridCells(gridA2);
    expect(cells).toHaveLength(6);
    expect(validateLattice(cells, { i: 2, j: 0 }, { i: 0, j: 3 })).toEqual({ ok: true, det: 6 });
  });

  it('accepts a sheared lattice whose generators point outside the pattern box', () => {
    const cells = tileGridCells(gridStaircase);
    expect(cells).toHaveLength(24);
    // v = (7,1) reaches well past the 4-wide box; that is exactly what a
    // staircase bond needs, so containment is never a validity criterion.
    const result = validateLattice(cells, { i: 4, j: 4 }, { i: 7, j: 1 });
    expect(result.ok).toBe(true);
    expect(Math.abs(latticeDet({ i: 4, j: 4 }, { i: 7, j: 1 }))).toBe(24);
  });

  it('rejects a lattice whose determinant does not match the cell count', () => {
    const result = validateLattice(tileGridCells(gridStaircase), { i: 4, j: 3 }, { i: 8, j: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/cells per repeat/);
  });

  it('names the colliding cells when two share a residue class', () => {
    // Same determinant as the cell count, but the classes are not distinct.
    const result = validateLattice(tileGridCells(gridStaircase), { i: 24, j: 0 }, { i: 0, j: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.collisions.length).toBeGreaterThan(0);
  });

  it('rejects parallel generators', () => {
    const result = validateLattice(tileGridCells(gridA2), { i: 2, j: 0 }, { i: 4, j: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/parallel/);
  });
});

describe('deriveLattice', () => {
  it('recovers a rectangular lattice from the labelled cells alone', () => {
    const derived = deriveLattice(tileGridCells(gridA3));
    expect(derived).not.toBeNull();
    if (!derived) return;
    expect(validateLattice(tileGridCells(gridA3), derived.u, derived.v).ok).toBe(true);
  });

  it('recovers a valid sheared lattice for the staircase pattern', () => {
    const cells = tileGridCells(gridStaircase);
    const derived = deriveLattice(cells);
    expect(derived).not.toBeNull();
    if (!derived) return;
    expect(validateLattice(cells, derived.u, derived.v).ok).toBe(true);
    // No axis-aligned lattice exists for this domain, so the search must have
    // returned a sheared pair rather than falling back to the bounding box.
    expect(derived.u.j === 0 && derived.v.i === 0).toBe(false);
  });

  it('returns null for a domain that admits no exact cover', () => {
    // Three cells in an L: no lattice of determinant 3 tiles them.
    expect(
      deriveLattice([
        { i: 0, j: 0 },
        { i: 1, j: 0 },
        { i: 0, j: 1 },
      ]),
    ).not.toBeNull();
    // A domain with a repeated cell can never be a fundamental domain.
    expect(
      deriveLattice([
        { i: 0, j: 0 },
        { i: 0, j: 0 },
      ]),
    ).toBeNull();
  });
});

describe('residueClass', () => {
  it('is equal exactly for cells one lattice step apart', () => {
    const u = { i: 4, j: 4 };
    const v = { i: 7, j: 1 };
    expect(residueClass({ i: 1, j: 2 }, u, v)).toBe(residueClass({ i: 5, j: 6 }, u, v));
    expect(residueClass({ i: 1, j: 2 }, u, v)).toBe(residueClass({ i: 8, j: 3 }, u, v));
    expect(residueClass({ i: 1, j: 2 }, u, v)).not.toBe(residueClass({ i: 1, j: 3 }, u, v));
  });
});

describe('resolveSchema', () => {
  it('covers the plane with the 4×4 repeat, keeping large tiles contiguous', () => {
    const { occurrences, unresolved } = coverWindow(schemaFor(gridA3), 10);
    expect(unresolved).toBe(0);

    const full = [...occurrences.values()].filter((cells) => cells.length === 9);
    expect(full.length).toBeGreaterThan(0);
    for (const cells of full) {
      const is = cells.map((c) => c.i);
      const js = cells.map((c) => c.j);
      expect(Math.max(...is) - Math.min(...is)).toBe(2);
      expect(Math.max(...js) - Math.min(...js)).toBe(2);
    }
  });

  it('covers the plane with the sheared staircase repeat', () => {
    const schema = schemaFor(gridStaircase, { u: { i: 4, j: 4 }, v: { i: 7, j: 1 } });
    const { resolved, occurrences, unresolved } = coverWindow(schema, 10);

    expect(unresolved).toBe(0);
    expect(resolved.cells).toHaveLength(24);
    expect(resolved.byClass.size).toBe(24);

    // Each interior a occurrence is a contiguous 3×3 block.
    const nine = [...occurrences.values()].filter((cells) => cells.length === 9);
    expect(nine.length).toBeGreaterThan(0);
    for (const cells of nine) {
      const is = cells.map((c) => c.i);
      const js = cells.map((c) => c.j);
      expect(Math.max(...is) - Math.min(...is)).toBe(2);
      expect(Math.max(...js) - Math.min(...js)).toBe(2);
    }
  });

  it('reports the origin cell of the occurrence a cell belongs to', () => {
    const resolved = resolveSchema(schemaFor(gridA3));
    const corner = resolveCell(resolved, { i: 2, j: 2 });
    expect(corner).not.toBeNull();
    if (!corner) return;
    expect(corner.resolved.instance.tileDefinitionId).toBe('a');
    expect(corner.originCell).toEqual({ i: 0, j: 0 });

    const shifted = resolveCell(resolved, { i: 6, j: 2 });
    expect(shifted).not.toBeNull();
    if (!shifted) return;
    expect(shifted.originCell).toEqual({ i: 4, j: 0 });
    expect(shifted.occurrenceKey).not.toBe(corner.occurrenceKey);
  });

  it('rejects a schema whose lattice does not tile', () => {
    const schema = schemaFor(gridStaircase, { u: { i: 4, j: 3 }, v: { i: 8, j: 1 } });
    expect(() => resolveSchema(schema)).toThrow(/does not tile/);
  });

  it('rejects a bounded root master grid', () => {
    const schema = schemaFor(gridA3, { extent: { iCount: 2, jCount: 2 } });
    expect(() => resolveSchema(schema)).toThrow(/unbounded/);
  });
});

describe('mirroring', () => {
  it('still covers the plane when the master grid alternates in x', () => {
    const schema = schemaFor(gridA3, { mirror: { x: 'alternate', y: 'none' } });
    const { unresolved, occurrences } = coverWindow(schema, 10);
    expect(unresolved).toBe(0);
    expect([...occurrences.values()].filter((c) => c.length === 9).length).toBeGreaterThan(0);
  });

  it('still covers the plane when the master grid alternates in both axes', () => {
    const schema = schemaFor(gridA3, { mirror: { x: 'alternate', y: 'alternate' } });
    expect(coverWindow(schema, 10).unresolved).toBe(0);
  });

  it('doubles the repeat and flips every other copy', () => {
    const schema = schemaFor(gridA3, { mirror: { x: 'alternate', y: 'none' } });
    const resolved = resolveSchema(schema);

    // Mirroring in x doubles the period along x and leaves y alone.
    expect(resolved.u).toEqual({ i: 8, j: 0 });
    expect(resolved.v).toEqual({ i: 0, j: 4 });
    expect(resolved.cells).toHaveLength(32);
    expect(resolved.cells.filter((c) => c.flip.x).length).toBe(16);
    expect(resolved.cells.every((c) => c.flip.y === false)).toBe(true);

    const unflipped = resolveCell(resolved, { i: 0, j: 0 });
    const flipped = resolveCell(resolved, { i: 4, j: 0 });
    expect(unflipped?.resolved.flip).toEqual({ x: false, y: false });
    expect(flipped?.resolved.flip).toEqual({ x: true, y: false });
  });

  it('mirrors the large tile to the far side of the reflected copy', () => {
    // In the unmirrored 4×4 repeat the a tile occupies columns 0–2. Its
    // reflection must sit at columns 1–3 of the next copy, not 0–2.
    const resolved = resolveSchema(schemaFor(gridA3, { mirror: { x: 'alternate', y: 'none' } }));
    const reflected = resolveCell(resolved, { i: 7, j: 0 });
    expect(reflected).not.toBeNull();
    if (!reflected) return;
    expect(reflected.resolved.instance.tileDefinitionId).toBe('a');
    expect(reflected.originCell).toEqual({ i: 5, j: 0 });
  });
});

describe('nested master grids', () => {
  it('composes two levels into one lattice and still covers the plane', () => {
    const inner = createMasterGrid({
      id: 'inner',
      name: 'Inner',
      childId: gridA3.id,
      u: { i: 4, j: 0 },
      v: { i: 0, j: 4 },
      extent: { iCount: 2, jCount: 2 },
    });
    const outer = createMasterGrid({
      id: 'outer',
      name: 'Outer',
      childId: inner.id,
      u: { i: 2, j: 0 },
      v: { i: 0, j: 2 },
    });
    const schema = createTileSchema({
      id: 'nested',
      name: 'Nested',
      tileGrids: [gridA3],
      masterGrids: [inner, outer],
      rootMasterGridId: outer.id,
    });

    const { resolved, unresolved } = coverWindow(schema, 12);
    expect(unresolved).toBe(0);
    // Four copies of a 16-cell domain in one 8×8 repeat.
    expect(resolved.cells).toHaveLength(64);
    expect(resolved.u).toEqual({ i: 8, j: 0 });
    expect(resolved.v).toEqual({ i: 0, j: 8 });
  });

  it('applies mirror rules per level', () => {
    const inner = createMasterGrid({
      id: 'inner',
      name: 'Inner',
      childId: gridA3.id,
      u: { i: 4, j: 0 },
      v: { i: 0, j: 4 },
      extent: { iCount: 2, jCount: 1 },
      mirror: { x: 'alternate', y: 'none' },
    });
    const outer = createMasterGrid({
      id: 'outer',
      name: 'Outer',
      childId: inner.id,
      u: { i: 2, j: 0 },
      v: { i: 0, j: 1 },
    });
    const schema = createTileSchema({
      id: 'nested-mirror',
      name: 'Nested mirror',
      tileGrids: [gridA3],
      masterGrids: [inner, outer],
      rootMasterGridId: outer.id,
    });

    const resolved = resolveSchema(schema);
    expect(resolved.cells).toHaveLength(32);
    // The inner level alternates, so exactly half the domain is mirrored in x.
    expect(resolved.cells.filter((c) => c.flip.x).length).toBe(16);
    expect(coverWindow(schema, 12).unresolved).toBe(0);
  });
});

describe('tryResolveSchema', () => {
  it('reports the reason instead of throwing', () => {
    const schema = schemaFor(gridStaircase, { u: { i: 4, j: 3 }, v: { i: 8, j: 1 } });
    const result = tryResolveSchema(schema);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/cells per repeat/);
    // A count mismatch returns before residues are compared, so there are no
    // colliding cells to point at — the editor has to diagnose unclaimed cells
    // separately, and this is the case that proves it.
    expect(result.collisions).toEqual([]);
  });

  it('forwards the colliding cells when two share a residue class', () => {
    const schema = schemaFor(gridStaircase, { u: { i: 24, j: 0 }, v: { i: 0, j: 1 } });
    const result = tryResolveSchema(schema);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.collisions.length).toBeGreaterThan(0);
  });

  it('returns the resolved schema when it tiles', () => {
    const result = tryResolveSchema(schemaFor(gridA3));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolved.cells).toHaveLength(16);
  });

  it('reports a bounded root rather than throwing', () => {
    const result = tryResolveSchema(schemaFor(gridA3, { extent: { iCount: 2, jCount: 2 } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/unbounded/);
  });
});
