import { describe, expect, it } from 'vitest';
import { createTileDefinition } from '@/domain/tile';
import {
  addMasterLevelAboveRoot,
  bestSpanForDrag,
  blockStep,
  clearTileGrid,
  createMasterGrid,
  createTileGrid,
  createTileGridInstance,
  createTileSchema,
  extentCells,
  instanceAtCell,
  masterChain,
  overclaimedCells,
  pickUnitFallback,
  putInstance,
  removeInstanceAt,
  removeRootMasterLevel,
  setLevelExtent,
  setTileGridExtent,
  spanFor,
  spanOptions,
  stretchLattice,
  unclaimedCells,
  type IntVec2,
  type TileGridInstanceJson,
  type TileGridJson,
  type TileSchemaJson,
} from '@/domain/tile-grid';
import { resolveSchema, tryResolveSchema } from '@/workflow/tile-grid-lattice';

const CELL = 0.15;

function instance(tileDefinitionId: string, i: number, j: number, span = 1): TileGridInstanceJson {
  return { tileDefinitionId, i, j, iSpan: span, jSpan: span, rotated: false };
}

/** The 3×3 `a` at the origin of `gridA3`. */
const isA0 = (i: TileGridInstanceJson) => i.tileDefinitionId === 'a' && i.i === 0 && i.j === 0;

/** The 4×4 repeat: one 3×3 a, seven unit b. */
function gridA3(): TileGridJson {
  return createTileGrid({
    id: 'grid',
    name: 'Grid',
    cell: { x: CELL, y: CELL },
    extent: { iCount: 4, jCount: 4 },
    instances: [
      instance('a', 0, 0, 3),
      instance('b', 3, 0),
      instance('b', 3, 1),
      instance('b', 3, 2),
      instance('b', 0, 3),
      instance('b', 1, 3),
      instance('b', 2, 3),
      instance('b', 3, 3),
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
    const a0 = grid.instances.find(isA0);
    expect(instanceAtCell(grid, 2, 2)).toBe(a0);
    expect(instanceAtCell(grid, 0, 0)).toBe(a0);
    expect(instanceAtCell(grid, 3, 0)).toMatchObject({ tileDefinitionId: 'b', i: 3, j: 0 });
    expect(instanceAtCell(grid, 9, 9)).toBeUndefined();
  });

  it('removes a whole occurrence when any of its cells is clicked', () => {
    const grid = removeInstanceAt(gridA3(), 1, 1);
    expect(grid.instances.some(isA0)).toBe(false);
    expect(grid.instances).toHaveLength(7);
  });

  it('clears everything a new footprint lands on, whole', () => {
    // A 2×2 at the origin overlaps the 3×3 a and nothing else.
    const result = putInstance(gridA3(), instance('b', 0, 0, 2));
    expect(result.replaced).toBe(1);
    expect(result.grid.instances.some(isA0)).toBe(false);
    expect(result.grid.instances.filter((i) => i.tileDefinitionId === 'b')).toHaveLength(8);
  });

  it('leaves disjoint occurrences alone', () => {
    const result = putInstance(gridA3(), createTileGridInstance('b', 3, 0));
    expect(result.replaced).toBe(1); // only the unit b already at (3,0)
    expect(result.grid.instances.some(isA0)).toBe(true);
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
      instances: [...grid.instances, instance('b', 0, 0)],
    };
    expect(overclaimedCells(doubled)).toEqual([{ i: 0, j: 0 }]);
  });

  it('flags an occurrence that hangs outside the block', () => {
    const grid = gridA3();
    const spilling: TileGridJson = {
      ...grid,
      instances: [...grid.instances, instance('b', 5, 5)],
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

describe('stretchLattice', () => {
  it('stretches a block step along the changed axis, both ways', () => {
    expect(stretchLattice({ i: 4, j: 0 }, { i: 0, j: 4 }, 'i', 4, 5)).toEqual({
      u: { i: 5, j: 0 },
      v: { i: 0, j: 4 },
    });
    expect(stretchLattice({ i: 4, j: 0 }, { i: 0, j: 4 }, 'j', 4, 3)).toEqual({
      u: { i: 4, j: 0 },
      v: { i: 0, j: 3 },
    });
  });

  it('keeps a half-bond offset a half-bond where the block allows it', () => {
    expect(stretchLattice({ i: 2, j: 0 }, { i: 1, j: 1 }, 'i', 2, 4)).toEqual({
      u: { i: 4, j: 0 },
      v: { i: 2, j: 1 },
    });
  });

  it('refuses a sheared lattice whose area would not follow the block', () => {
    expect(stretchLattice({ i: 4, j: 4 }, { i: 7, j: 1 }, 'i', 4, 5)).toBeNull();
  });
});

describe('setTileGridExtent', () => {
  function schemaOf(grid: TileGridJson, u: IntVec2, v: IntVec2): TileSchemaJson {
    const master = createMasterGrid({ id: 'm', childId: grid.id, u, v });
    return createTileSchema({ tileGrids: [grid], masterGrids: [master], rootMasterGridId: 'm' });
  }

  function stack(iCount: number, jCount: number): TileSchemaJson {
    const grid = createTileGrid({
      id: 'grid',
      cell: { x: CELL, y: CELL },
      extent: { iCount, jCount },
      instances: extentCells({ iCount, jCount }).map((c) => instance('b', c.i, c.j)),
      fallbackTileDefinitionId: 'b',
    });
    return schemaOf(grid, { i: iCount, j: 0 }, { i: 0, j: jCount });
  }

  const unit = { fallbackId: 'b' };
  const master = (schema: TileSchemaJson) => schema.masterGrids[0]!;
  const grid = (schema: TileSchemaJson) => schema.tileGrids[0]!;

  it('grows a stack: u follows and the new column is filled', () => {
    const grown = setTileGridExtent(stack(4, 4), 'grid', { iCount: 5, jCount: 4 }, unit);
    expect(grown.lattice).toBe('stretched');
    expect(grown.filled).toBe(4);
    expect(master(grown.schema).u).toEqual({ i: 5, j: 0 });
    expect(tryResolveSchema(grown.schema).ok).toBe(true);

    const back = setTileGridExtent(grown.schema, 'grid', { iCount: 4, jCount: 4 }, unit);
    expect(master(back.schema).u).toEqual({ i: 4, j: 0 });
    expect(grid(back.schema).instances).toHaveLength(16);
    expect(tryResolveSchema(back.schema).ok).toBe(true);
  });

  it('grows rows through the j components', () => {
    const grown = setTileGridExtent(stack(2, 2), 'grid', { iCount: 2, jCount: 3 }, unit);
    expect(master(grown.schema).v).toEqual({ i: 0, j: 3 });
    expect(grown.filled).toBe(2);
    expect(tryResolveSchema(grown.schema).ok).toBe(true);
  });

  it('keeps a running bond tiling as it widens', () => {
    const slab = createTileGrid({
      id: 'grid',
      cell: { x: CELL, y: CELL },
      extent: { iCount: 2, jCount: 1 },
      instances: [{ tileDefinitionId: 'c', i: 0, j: 0, iSpan: 2, jSpan: 1, rotated: false }],
      fallbackTileDefinitionId: 'b',
    });
    const grown = setTileGridExtent(
      schemaOf(slab, { i: 2, j: 0 }, { i: 1, j: 1 }),
      'grid',
      { iCount: 3, jCount: 1 },
      unit,
    );
    expect(master(grown.schema).u).toEqual({ i: 3, j: 0 });
    expect(tryResolveSchema(grown.schema).ok).toBe(true);
  });

  it('leaves a staircase lattice alone and adds nothing', () => {
    const stairs = createTileGrid({
      id: 'grid',
      cell: { x: CELL, y: CELL },
      extent: { iCount: 4, jCount: 7 },
      instances: [
        instance('a', 0, 0, 3),
        instance('a', 0, 3, 3),
        instance('b', 1, 6),
        instance('b', 2, 6),
        instance('b', 3, 6),
        instance('b', 3, 5),
        instance('b', 3, 4),
        instance('b', 3, 3),
      ],
      fallbackTileDefinitionId: 'b',
    });
    const schema = schemaOf(stairs, { i: 4, j: 4 }, { i: 7, j: 1 });
    expect(tryResolveSchema(schema).ok).toBe(true);
    const grown = setTileGridExtent(schema, 'grid', { iCount: 5, jCount: 7 }, unit);
    expect(grown.lattice).toBe('kept');
    expect(grown.filled).toBe(0);
    expect(master(grown.schema).u).toEqual({ i: 4, j: 4 });
    expect(tryResolveSchema(grown.schema).ok).toBe(true);
  });

  it('breaks a large format cut by the new edge into fallback units', () => {
    const shrunk = setTileGridExtent(
      schemaOf(gridA3(), { i: 4, j: 0 }, { i: 0, j: 4 }),
      'grid',
      { iCount: 2, jCount: 4 },
      unit,
    );
    expect(shrunk.brokenDown).toBe(6);
    expect(master(shrunk.schema).u).toEqual({ i: 2, j: 0 });
    expect(grid(shrunk.schema).instances.some(isA0)).toBe(false);
    expect(tryResolveSchema(shrunk.schema).ok).toBe(true);
  });

  it('drops cut formats and fills nothing without a one-cell fallback', () => {
    const shrunk = setTileGridExtent(
      schemaOf(gridA3(), { i: 4, j: 0 }, { i: 0, j: 4 }),
      'grid',
      { iCount: 2, jCount: 4 },
      { fallbackId: null },
    );
    expect(shrunk.brokenDown).toBe(0);
    expect(grid(shrunk.schema).instances.every((i) => i.tileDefinitionId === 'b')).toBe(true);
    const grown = setTileGridExtent(stack(2, 2), 'grid', { iCount: 3, jCount: 2 }, {
      fallbackId: null,
    });
    expect(grown.filled).toBe(0);
  });
});

describe('clearTileGrid', () => {
  it('empties the grid and resets its lattice to the block step', () => {
    const grid = gridA3();
    const master = createMasterGrid({
      id: 'm',
      childId: grid.id,
      u: { i: 4, j: 1 },
      v: { i: 0, j: 4 },
      mirror: { x: 'alternate', y: 'none' },
    });
    const schema = createTileSchema({ tileGrids: [grid], masterGrids: [master], rootMasterGridId: 'm' });
    const cleared = clearTileGrid(schema, grid.id);
    expect(cleared.tileGrids[0]!.instances).toEqual([]);
    expect(cleared.tileGrids[0]!.extent).toEqual(grid.extent);
    expect(cleared.tileGrids[0]!.cell).toEqual(grid.cell);
    expect(cleared.masterGrids[0]!.u).toEqual({ i: 4, j: 0 });
    expect(cleared.masterGrids[0]!.v).toEqual({ i: 0, j: 4 });
    expect(cleared.masterGrids[0]!.mirror).toEqual({ x: 'none', y: 'none' });
  });
});

describe('pickUnitFallback', () => {
  const unitB = createTileDefinition({ id: 'b', name: 'b', length: CELL, width: CELL });
  const bigA = createTileDefinition({ id: 'a', name: 'a', length: CELL * 3, width: CELL * 3 });
  const smallS = createTileDefinition({ id: 's', name: 's', length: CELL - 0.01, width: CELL - 0.01 });
  const tinyT = createTileDefinition({ id: 't', name: 't', length: CELL - 0.05, width: CELL - 0.05 });

  it('keeps a declared fallback that covers one cell, undersized included', () => {
    expect(pickUnitFallback(gridA3(), [bigA, unitB])?.id).toBe('b');
    const declaredSmall = { ...gridA3(), fallbackTileDefinitionId: 's' };
    expect(pickUnitFallback(declaredSmall, [bigA, unitB, smallS])?.id).toBe('s');
  });

  it('prefers a one-cell format the grid already uses when the declared one is gone', () => {
    const stale = { ...gridA3(), fallbackTileDefinitionId: 'deleted' };
    expect(pickUnitFallback(stale, [smallS, bigA, unitB])?.id).toBe('b');
  });

  it('otherwise takes the one-cell catalogue format closest to the cell', () => {
    const onlyA = { ...gridA3(), instances: [instance('a', 0, 0, 3)], fallbackTileDefinitionId: 'a' };
    expect(pickUnitFallback(onlyA, [bigA, tinyT, smallS])?.id).toBe('s');
  });

  it('finds nothing when no format covers one cell', () => {
    const onlyA = { ...gridA3(), fallbackTileDefinitionId: 'a' };
    expect(pickUnitFallback(onlyA, [bigA])).toBeUndefined();
  });
});
