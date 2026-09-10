import { describe, expect, it } from 'vitest';
import { createTileDefinition } from '@/domain/tile';
import {
  addMasterLevelAboveRoot,
  bestSpanForDrag,
  blockStep,
  createMasterGrid,
  createTileGrid,
  createTileGridInstance,
  createTileSchema,
  extentCells,
  instanceAtCell,
  masterChain,
  overclaimedCells,
  putInstance,
  removeInstanceAt,
  removeRootMasterLevel,
  setLevelExtent,
  spanFor,
  spanOptions,
  unclaimedCells,
  type TileGridInstanceJson,
  type TileGridJson,
  type TileSchemaJson,
} from '@/domain/tile-grid';
import { resolveSchema } from '@/workflow/tile-grid-lattice';

const CELL = 0.15;

function instance(
  id: string,
  tileDefinitionId: string,
  i: number,
  j: number,
  span = 1,
): TileGridInstanceJson {
  return { id, tileDefinitionId, i, j, iSpan: span, jSpan: span, rotated: false };
}

/** The 4×4 repeat: one 3×3 a, seven unit b. */
function gridA3(): TileGridJson {
  return createTileGrid({
    id: 'grid',
    name: 'Grid',
    cell: { x: CELL, y: CELL },
    extent: { iCount: 4, jCount: 4 },
    instances: [
      instance('a0', 'a', 0, 0, 3),
      instance('b0', 'b', 3, 0),
      instance('b1', 'b', 3, 1),
      instance('b2', 'b', 3, 2),
      instance('b3', 'b', 0, 3),
      instance('b4', 'b', 1, 3),
      instance('b5', 'b', 2, 3),
      instance('b6', 'b', 3, 3),
    ],
    fallbackTileDefinitionId: 'b',
  });
}

function schemaFor(grid: TileGridJson, mirror?: { x: 'none' | 'alternate'; y: 'none' | 'alternate' }) {
  const master = createMasterGrid({
    id: 'master',
    name: 'Master',
    childId: grid.id,
    ...blockStep(grid.extent),
    mirror,
  });
  return createTileSchema({
    id: 'schema',
    name: 'Schema',
    tileGrids: [grid],
    masterGrids: [master],
    rootMasterGridId: master.id,
  });
}

describe('spanFor', () => {
  const cell = { x: CELL, y: CELL };

  it('derives the footprint from the tile size, not from a choice', () => {
    const a = createTileDefinition({ id: 'a', length: 0.45, width: 0.45 });
    expect(spanFor(a, cell, 0, false)).toEqual({ iSpan: 3, jSpan: 3 });
  });

  it('swaps the spans when the tile is turned', () => {
    const slab = createTileDefinition({ id: 'slab', length: 0.3, width: 0.15 });
    expect(spanFor(slab, cell, 0, false)).toEqual({ iSpan: 2, jSpan: 1 });
    expect(spanFor(slab, cell, 0, true)).toEqual({ iSpan: 1, jSpan: 2 });
  });

  it('accounts for the joint, one per cell', () => {
    // A 0.29 m tile on a 0.15 m cell with a 0.01 m joint spans exactly two.
    const tile = createTileDefinition({ id: 't', length: 0.29, width: 0.14 });
    expect(spanFor(tile, cell, 0.01, false)).toEqual({ iSpan: 2, jSpan: 1 });
  });

  it('returns null for a format that is not a whole number of cells', () => {
    const odd = createTileDefinition({ id: 'odd', length: 0.3, width: 0.3 });
    expect(spanFor(odd, { x: 0.25, y: 0.25 }, 0, false)).toBeNull();
  });

  it('offers one footprint for a square format and two otherwise', () => {
    const square = createTileDefinition({ id: 'a', length: 0.45, width: 0.45 });
    const slab = createTileDefinition({ id: 'slab', length: 0.3, width: 0.15 });
    expect(spanOptions(square, cell, 0)).toHaveLength(1);
    expect(spanOptions(slab, cell, 0)).toHaveLength(2);
  });

  it('picks the orientation nearest the drawn rectangle', () => {
    const slab = createTileDefinition({ id: 'slab', length: 0.3, width: 0.15 });
    expect(bestSpanForDrag(slab, cell, 0, { iSpan: 3, jSpan: 1 })?.rotated).toBe(false);
    expect(bestSpanForDrag(slab, cell, 0, { iSpan: 1, jSpan: 3 })?.rotated).toBe(true);
  });

  it('has no footprint to offer when the format does not fit the grid', () => {
    const odd = createTileDefinition({ id: 'odd', length: 0.3, width: 0.3 });
    expect(bestSpanForDrag(odd, { x: 0.25, y: 0.25 }, 0, { iSpan: 1, jSpan: 1 })).toBeNull();
  });
});

describe('instance editing', () => {
  it('finds the occurrence covering any cell of a large format', () => {
    const grid = gridA3();
    expect(instanceAtCell(grid, 2, 2)?.id).toBe('a0');
    expect(instanceAtCell(grid, 0, 0)?.id).toBe('a0');
    expect(instanceAtCell(grid, 3, 0)?.id).toBe('b0');
    expect(instanceAtCell(grid, 9, 9)).toBeUndefined();
  });

  it('removes a whole occurrence when any of its cells is clicked', () => {
    const grid = removeInstanceAt(gridA3(), 1, 1);
    expect(grid.instances.some((i) => i.id === 'a0')).toBe(false);
    expect(grid.instances).toHaveLength(7);
  });

  it('clears everything a new footprint lands on, whole', () => {
    // A 2×2 at the origin overlaps the 3×3 a and nothing else.
    const result = putInstance(gridA3(), instance('new', 'b', 0, 0, 2));
    expect(result.replaced).toBe(1);
    expect(result.grid.instances.some((i) => i.id === 'a0')).toBe(false);
    expect(result.grid.instances.filter((i) => i.tileDefinitionId === 'b')).toHaveLength(8);
  });

  it('leaves disjoint occurrences alone', () => {
    const result = putInstance(gridA3(), createTileGridInstance('b', 3, 0));
    expect(result.replaced).toBe(1); // only the unit b already at (3,0)
    expect(result.grid.instances.some((i) => i.id === 'a0')).toBe(true);
  });
});

describe('cover diagnostics', () => {
  it('reports nothing unclaimed for a complete repeat', () => {
    expect(unclaimedCells(gridA3())).toEqual([]);
    expect(overclaimedCells(gridA3())).toEqual([]);
  });

  it('names the cells a removed occurrence left behind', () => {
    // This is the failure the lattice check cannot describe: a count mismatch
    // returns before it looks at residues, so it reports no colliding cells.
    const grid = removeInstanceAt(gridA3(), 1, 1);
    expect(unclaimedCells(grid)).toHaveLength(9);
    expect(unclaimedCells(grid)).toContainEqual({ i: 0, j: 0 });
  });

  it('names cells claimed twice', () => {
    const grid = gridA3();
    const doubled: TileGridJson = {
      ...grid,
      instances: [...grid.instances, instance('dup', 'b', 0, 0)],
    };
    expect(overclaimedCells(doubled)).toEqual([{ i: 0, j: 0 }]);
  });

  it('flags an occurrence that hangs outside the block', () => {
    const grid = gridA3();
    const spilling: TileGridJson = {
      ...grid,
      instances: [...grid.instances, instance('out', 'b', 5, 5)],
    };
    expect(overclaimedCells(spilling)).toContainEqual({ i: 5, j: 5 });
  });
});

describe('extentCells', () => {
  it('enumerates the whole rectangle', () => {
    expect(extentCells({ iCount: 2, jCount: 3 })).toHaveLength(6);
    expect(extentCells({ iCount: 2, jCount: 3 })).toContainEqual({ i: 1, j: 2 });
  });
});

describe('masterChain', () => {
  it('walks from the root inward', () => {
    const schema = schemaFor(gridA3());
    expect(masterChain(schema).map((m) => m.id)).toEqual(['master']);
  });

  it('throws rather than hanging on a childId cycle', () => {
    const schema = schemaFor(gridA3());
    const cyclic: TileSchemaJson = {
      ...schema,
      masterGrids: [
        { ...schema.masterGrids[0]!, childId: 'second' },
        createMasterGrid({ id: 'second', name: 'Second', childId: 'master' }),
      ],
    };
    expect(() => masterChain(cyclic)).toThrow(/cycle|deeply/);
  });
});

describe('nesting', () => {
  it('inserts a level without changing the tiling', () => {
    const before = resolveSchema(schemaFor(gridA3()));
    const after = resolveSchema(addMasterLevelAboveRoot(schemaFor(gridA3())));

    expect(after.u).toEqual(before.u);
    expect(after.v).toEqual(before.v);
    expect(after.cells).toHaveLength(before.cells.length);
  });

  it('preserves a mirrored root, which the naive 1×1 default would collapse', () => {
    // resolveSchema wraps a mirrored root into a doubled block. Once that grid
    // stops being the root the wrap no longer happens, so the insertion has to
    // reproduce it or the pattern silently halves its period.
    const mirrored = schemaFor(gridA3(), { x: 'alternate', y: 'none' });
    const before = resolveSchema(mirrored);
    expect(before.u).toEqual({ i: 8, j: 0 });
    expect(before.cells).toHaveLength(32);

    const after = resolveSchema(addMasterLevelAboveRoot(mirrored));
    expect(after.u).toEqual(before.u);
    expect(after.v).toEqual(before.v);
    expect(after.cells).toHaveLength(before.cells.length);
    expect(after.cells.filter((c) => c.flip.x)).toHaveLength(16);
  });

  it('round-trips insert then remove', () => {
    const schema = schemaFor(gridA3());
    const restored = resolveSchema(removeRootMasterLevel(addMasterLevelAboveRoot(schema)));
    const original = resolveSchema(schema);
    expect(restored.u).toEqual(original.u);
    expect(restored.v).toEqual(original.v);
    expect(restored.cells).toHaveLength(original.cells.length);
  });

  it('refuses to remove the only level', () => {
    expect(() => removeRootMasterLevel(schemaFor(gridA3()))).toThrow(/at least one/);
  });

  it('keeps the schema tiling when a block grows', () => {
    const nested = addMasterLevelAboveRoot(schemaFor(gridA3()));
    const innerId = masterChain(nested)[1]!.id;
    const grown = setLevelExtent(nested, innerId, { iCount: 2, jCount: 1 });

    const resolved = resolveSchema(grown);
    // Two copies of a 16-cell repeat, so the period doubles along x.
    expect(resolved.cells).toHaveLength(32);
    expect(resolved.u).toEqual({ i: 8, j: 0 });
  });

  it('leaves a hand-tuned parent lattice alone when a block grows', () => {
    const nested = addMasterLevelAboveRoot(schemaFor(gridA3()));
    const rootId = nested.rootMasterGridId;
    const innerId = masterChain(nested)[1]!.id;

    const sheared: TileSchemaJson = {
      ...nested,
      masterGrids: nested.masterGrids.map((m) =>
        m.id === rootId ? { ...m, u: { i: 1, j: 1 } } : m,
      ),
    };
    const grown = setLevelExtent(sheared, innerId, { iCount: 2, jCount: 1 });
    const root = grown.masterGrids.find((m) => m.id === rootId);
    expect(root?.u).toEqual({ i: 1, j: 1 });
  });
});
