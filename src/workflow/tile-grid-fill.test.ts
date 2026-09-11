import { describe, expect, it } from 'vitest';
import type { BoundaryConditionsJson } from '@/domain/boundaries';
import { transformPointMat3, type Mat3Json } from '@/domain/mat3';
import { createTileDefinition, type TileDefinitionJson } from '@/domain/tile';
import {
  createMasterGrid,
  createTileGrid,
  createTileSchema,
  frame2ToJson,
  type MasterGridJson,
  type TileGridInstanceJson,
  type TileSchemaJson,
} from '@/domain/tile-grid';
import { Frame2 } from '@/math/core/frame2';
import { Vec2 } from '@/math/core/vec2';
import { resolveBoundaryRegion } from '@/workflow/boundary-region';
import { fillPolygonWithTileSchema } from '@/workflow/tile-grid-fill';

const CELL = 0.15;

/** b is one cell; a is three cells on each side. */
const tileB: TileDefinitionJson = createTileDefinition({
  id: 'b',
  name: 'b',
  length: CELL,
  width: CELL,
});
const tileA: TileDefinitionJson = createTileDefinition({
  id: 'a',
  name: 'a',
  length: CELL * 3,
  width: CELL * 3,
});
const tiles = [tileA, tileB];

function instance(
  id: string,
  tileDefinitionId: string,
  i: number,
  j: number,
  iSpan = 1,
  jSpan = 1,
  rotated = false,
): TileGridInstanceJson {
  return { id, tileDefinitionId, i, j, iSpan, jSpan, rotated };
}

/**
 * b b b b
 * a a a b
 * a a a b
 * a a a b   — the 4×4 repeat, 0.6 m square.
 */
const gridA3 = createTileGrid({
  id: 'grid',
  name: 'Grid',
  cell: { x: CELL, y: CELL },
  extent: { iCount: 4, jCount: 4 },
  instances: [
    instance('a0', 'a', 0, 0, 3, 3),
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

function schemaFor(master: Partial<MasterGridJson> = {}, frame?: TileSchemaJson['frame']): TileSchemaJson {
  const masterGrid = createMasterGrid({
    id: 'master',
    name: 'Master',
    childId: gridA3.id,
    u: { i: 4, j: 0 },
    v: { i: 0, j: 4 },
    ...master,
  });
  return createTileSchema({
    id: 'schema',
    name: 'Schema',
    tileGrids: [gridA3],
    masterGrids: [masterGrid],
    rootMasterGridId: masterGrid.id,
    frame,
  });
}

function polygonBoundary(vertices: Array<[number, number]>): BoundaryConditionsJson {
  return {
    type: 'BoundaryConditions',
    outers: [
      {
        type: 'Polygon2',
        vertices: vertices.map(([x, y]) => ({ type: 'Vec2', x, y })),
      },
    ],
    holes: [],
    guides: [],
  };
}

function rectBoundary(width: number, height: number): BoundaryConditionsJson {
  return polygonBoundary([
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ]);
}

const byTileId = (placements: { tileDefinitionId: string }[]) =>
  placements.reduce<Record<string, number>>((acc, p) => {
    acc[p.tileDefinitionId] = (acc[p.tileDefinitionId] ?? 0) + 1;
    return acc;
  }, {});

/**
 * Which cells a placement covers, derived from its matrix and the tile's own
 * footprint. Used to prove the fill leaves no gap and no double-cover.
 */
function coveredCells(mat3: Mat3Json, tile: TileDefinitionJson): string[] {
  const corners = [
    transformPointMat3(mat3, 0, 0),
    transformPointMat3(mat3, tile.length, 0),
    transformPointMat3(mat3, tile.length, tile.width),
    transformPointMat3(mat3, 0, tile.width),
  ];
  const minX = Math.min(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const maxX = Math.max(...corners.map((c) => c.x));
  const maxY = Math.max(...corners.map((c) => c.y));

  const cells: string[] = [];
  for (let i = Math.round(minX / CELL); i < Math.round(maxX / CELL); i += 1) {
    for (let j = Math.round(minY / CELL); j < Math.round(maxY / CELL); j += 1) {
      cells.push(`${i}:${j}`);
    }
  }
  return cells;
}

function coverage(result: ReturnType<typeof fillPolygonWithTileSchema>) {
  const map = new Map(tiles.map((t) => [t.id, t]));
  const seen = new Map<string, number>();
  for (const placement of result.placements) {
    const tile = map.get(placement.tileDefinitionId)!;
    for (const key of coveredCells(placement.mat3, tile)) {
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  return {
    cells: seen,
    doubled: [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k),
  };
}

describe('fillPolygonWithTileSchema', () => {
  it('covers a boundary that is an exact multiple of the repeat', () => {
    // 1.2 m square = 8×8 cells = four 4×4 repeats.
    const result = fillPolygonWithTileSchema({
      schema: schemaFor(),
      tiles,
      boundaries: rectBoundary(1.2, 1.2),
    });

    expect(result.stats.cells).toBe(64);
    expect(byTileId(result.placements)).toEqual({ a: 4, b: 28 });
    expect(result.stats.fallbackTiles).toBe(0);
    expect(result.stats.cutTiles).toBe(0);

    const { cells, doubled } = coverage(result);
    expect(doubled).toEqual([]);
    expect(cells.size).toBe(64);
  });

  it('replaces a large format the boundary clips with unit tiles', () => {
    // Two cells wide: the 3×3 a can never fit, so its touched cells become b.
    const result = fillPolygonWithTileSchema({
      schema: schemaFor(),
      tiles,
      boundaries: rectBoundary(CELL * 2, CELL * 4),
    });

    expect(result.stats.cells).toBe(8);
    expect(byTileId(result.placements)).toEqual({ b: 8 });
    expect(result.stats.fallbackTiles).toBe(6);

    const { cells, doubled } = coverage(result);
    expect(doubled).toEqual([]);
    expect(cells.size).toBe(8);
  });

  it('keeps large formats whole in the interior of an L-shaped boundary', () => {
    // 8×8 cells with the top-right 4×4 quadrant removed.
    const result = fillPolygonWithTileSchema({
      schema: schemaFor(),
      tiles,
      boundaries: polygonBoundary([
        [0, 0],
        [1.2, 0],
        [1.2, 0.6],
        [0.6, 0.6],
        [0.6, 1.2],
        [0, 1.2],
      ]),
    });

    expect(result.stats.cells).toBe(48);
    expect(byTileId(result.placements)).toEqual({ a: 3, b: 21 });
    expect(result.stats.fallbackTiles).toBe(0);

    const { cells, doubled } = coverage(result);
    expect(doubled).toEqual([]);
    expect(cells.size).toBe(48);
  });

  it('fills the whole polygon when the boundary falls between cells', () => {
    // 0.5 m is 3⅓ cells: the last column is cut and must still be tiled.
    const result = fillPolygonWithTileSchema({
      schema: schemaFor(),
      tiles,
      boundaries: rectBoundary(0.5, 0.5),
    });

    expect(result.stats.cutTiles).toBeGreaterThan(0);
    expect(result.stats.cells).toBe(16); // 4×4 cells touched

    const { cells, doubled } = coverage(result);
    expect(doubled).toEqual([]);
    expect(cells.size).toBe(16);

    // Cut tiles overrun the edge rather than leaving the polygon short.
    const maxX = Math.max(
      ...result.placements.map((p) => transformPointMat3(p.mat3, CELL, CELL).x),
    );
    expect(maxX).toBeGreaterThan(0.5);
  });

  it('groups position matrices per tile type', () => {
    const result = fillPolygonWithTileSchema({
      schema: schemaFor(),
      tiles,
      boundaries: rectBoundary(1.2, 1.2),
    });

    expect(Object.keys(result.byTile).sort()).toEqual(['a', 'b']);
    expect(result.byTile.a).toHaveLength(4);
    expect(result.byTile.b).toHaveLength(28);
    expect(result.byTile.a?.every((m) => m.type === 'Mat3')).toBe(true);
  });

  it('degrades a format that runs out of stock to unit tiles and reports the overdraw', () => {
    const result = fillPolygonWithTileSchema({
      schema: schemaFor(),
      tiles,
      boundaries: rectBoundary(1.2, 1.2),
      sampledStock: [
        { tileDefinitionId: 'a', count: 1 },
        { tileDefinitionId: 'b', count: 10 },
      ],
    });

    const counts = byTileId(result.placements);
    expect(counts.a).toBe(1);
    // The three a tiles that had no stock became nine b tiles each.
    expect(counts.b).toBe(28 + 27);
    expect(result.stats.shortfall.b).toBe(28 + 27 - 10);
    expect(result.stats.shortfall.a).toBeUndefined();

    // Stock pressure never leaves a hole.
    const { cells, doubled } = coverage(result);
    expect(doubled).toEqual([]);
    expect(cells.size).toBe(64);
  });

  it('poses the tiling through the schema frame', () => {
    const frame = frame2ToJson(new Frame2(new Vec2(1, 2), Vec2.baseX(), Vec2.baseY()));
    const result = fillPolygonWithTileSchema({
      schema: schemaFor({}, frame),
      tiles,
      boundaries: polygonBoundary([
        [1, 2],
        [1.6, 2],
        [1.6, 2.6],
        [1, 2.6],
      ]),
    });

    expect(byTileId(result.placements)).toEqual({ a: 1, b: 7 });
    const aMatrix = result.byTile.a?.[0];
    expect(aMatrix).toBeDefined();
    if (!aMatrix) return;
    const origin = transformPointMat3(aMatrix, 0, 0);
    expect(origin.x).toBeCloseTo(1, 9);
    expect(origin.y).toBeCloseTo(2, 9);
  });

  it('bakes mirroring into the placement matrix', () => {
    const result = fillPolygonWithTileSchema({
      schema: schemaFor({ mirror: { x: 'alternate', y: 'none' } }),
      tiles,
      boundaries: rectBoundary(1.2, 0.6),
    });

    // A mirrored placement has a negative determinant; an unmirrored one does not.
    const determinant = (m: Mat3Json) => m.elements[0]! * m.elements[4]! - m.elements[1]! * m.elements[3]!;
    const dets = result.placements.map((p) => determinant(p.mat3));
    expect(dets.some((d) => d < 0)).toBe(true);
    expect(dets.some((d) => d > 0)).toBe(true);

    // Mirroring flips geometry in place, so coverage is unchanged.
    const { cells, doubled } = coverage(result);
    expect(doubled).toEqual([]);
    expect(cells.size).toBe(32);
  });

  it('centres a tile in the cells it claims, splitting the joint', () => {
    // Cell 0.15 with a 0.01 joint takes a 0.14 tile and a 0.29 tile: each sits
    // half a joint in from its block, so neighbours are a full joint apart and
    // the pattern edge keeps a half joint instead of none.
    const jointCell = 0.15;
    const joint = 0.01;
    const small = createTileDefinition({ id: 's', name: 's', length: 0.14, width: 0.14 });
    const big = createTileDefinition({ id: 'g', name: 'g', length: 0.29, width: 0.14 });

    const grid = createTileGrid({
      id: 'jointed',
      name: 'Jointed',
      cell: { x: jointCell, y: jointCell },
      joint,
      extent: { iCount: 2, jCount: 2 },
      instances: [
        instance('g0', 'g', 0, 0, 2, 1),
        instance('s0', 's', 0, 1),
        instance('s1', 's', 1, 1),
      ],
      fallbackTileDefinitionId: 's',
    });
    const master = createMasterGrid({
      id: 'jm',
      name: 'Jointed master',
      childId: grid.id,
      u: { i: 2, j: 0 },
      v: { i: 0, j: 2 },
    });
    const schema = createTileSchema({
      id: 'js',
      name: 'Jointed schema',
      tileGrids: [grid],
      masterGrids: [master],
      rootMasterGridId: master.id,
    });

    const result = fillPolygonWithTileSchema({
      schema,
      tiles: [small, big],
      boundaries: rectBoundary(jointCell * 2, jointCell * 2),
    });

    const gOrigin = transformPointMat3(result.byTile.g![0]!, 0, 0);
    expect(gOrigin.x).toBeCloseTo(joint / 2, 9);
    expect(gOrigin.y).toBeCloseTo(joint / 2, 9);

    // The unit tile above it clears the big tile's top edge by one full joint.
    const sTop = result.byTile.s!.map((m) => transformPointMat3(m, 0, 0).y).sort((a, b) => a - b);
    expect(sTop[0]).toBeCloseTo(jointCell + joint / 2, 9);
    expect(sTop[0]! - (joint / 2 + big.width)).toBeCloseTo(joint, 9);
  });

  it('stands in a unit format when the declared fallback is larger than one cell', () => {
    // A fallback is placed once per cell, so a multi-cell format would be drawn
    // at its real size on a single cell and overlap every neighbour. Declaring
    // the 3x3 a here is exactly that mistake.
    const badFallback = { ...gridA3, id: 'bad', fallbackTileDefinitionId: 'a' };
    const master = createMasterGrid({
      id: 'bm',
      name: 'Bad master',
      childId: badFallback.id,
      u: { i: 4, j: 0 },
      v: { i: 0, j: 4 },
    });
    const schema = createTileSchema({
      id: 'bs',
      name: 'Bad fallback',
      tileGrids: [badFallback],
      masterGrids: [master],
      rootMasterGridId: master.id,
    });

    // Two cells wide: the a never fits, so every cell goes to the fallback.
    const result = fillPolygonWithTileSchema({
      schema,
      tiles,
      boundaries: rectBoundary(CELL * 2, CELL * 4),
    });

    expect(result.stats.fallbackSubstitutedFor).toBe('a');
    expect(result.stats.unfilled).toBe(0);
    expect(byTileId(result.placements)).toEqual({ b: 8 });

    const { cells, doubled } = coverage(result);
    expect(doubled).toEqual([]);
    expect(cells.size).toBe(8);
  });

  it('leaves cells bare rather than overlapping when no unit format exists', () => {
    // Every format spans more than one cell, so there is nothing to break down
    // to. Reporting the shortfall beats covering the boundary in overlaps.
    const bigOnly = createTileGrid({
      id: 'big',
      name: 'Big only',
      cell: { x: CELL, y: CELL },
      extent: { iCount: 3, jCount: 3 },
      instances: [instance('a0', 'a', 0, 0, 3, 3)],
      fallbackTileDefinitionId: 'a',
    });
    const master = createMasterGrid({
      id: 'gm',
      name: 'Big master',
      childId: bigOnly.id,
      u: { i: 3, j: 0 },
      v: { i: 0, j: 3 },
    });
    const schema = createTileSchema({
      id: 'gs',
      name: 'Big only',
      tileGrids: [bigOnly],
      masterGrids: [master],
      rootMasterGridId: master.id,
    });

    const result = fillPolygonWithTileSchema({
      schema,
      tiles,
      boundaries: rectBoundary(CELL * 2, CELL * 2),
    });

    expect(result.placements).toEqual([]);
    expect(result.stats.unfilled).toBe(4);
  });

  it('returns nothing when the boundary carries no usable geometry', () => {
    const result = fillPolygonWithTileSchema({
      schema: schemaFor(),
      tiles,
      boundaries: { type: 'BoundaryConditions', outers: [], holes: [], guides: [] },
    });
    expect(result.placements).toEqual([]);
    expect(result.stats.cells).toBe(0);
  });

  it('leaves a hole in the boundary untiled', () => {
    const result = fillPolygonWithTileSchema({
      schema: schemaFor(),
      tiles,
      boundaries: {
        type: 'BoundaryConditions',
        outers: [
          {
            type: 'Polygon2',
            vertices: [
              { type: 'Vec2', x: 0, y: 0 },
              { type: 'Vec2', x: 1.2, y: 0 },
              { type: 'Vec2', x: 1.2, y: 1.2 },
              { type: 'Vec2', x: 0, y: 1.2 },
            ],
          },
        ],
        holes: [
          {
            type: 'Polygon2',
            vertices: [
              { type: 'Vec2', x: 0.45, y: 0.45 },
              { type: 'Vec2', x: 0.75, y: 0.45 },
              { type: 'Vec2', x: 0.75, y: 0.75 },
              { type: 'Vec2', x: 0.45, y: 0.75 },
            ],
          },
        ],
        guides: [],
      },
    });

    // The 2×2 cell hole is not tiled, and the a tiles it clips break down to b.
    expect(result.stats.cells).toBe(60);
    expect(result.stats.fallbackTiles).toBeGreaterThan(0);
    const { doubled, cells } = coverage(result);
    expect(doubled).toEqual([]);
    expect(cells.has('3:3')).toBe(false);
  });
});

describe('boundary region', () => {
  function rectLoop(x0: number, y0: number, x1: number, y1: number) {
    return {
      type: 'Polygon2',
      vertices: [
        { type: 'Vec2', x: x0, y: y0 },
        { type: 'Vec2', x: x1, y: y0 },
        { type: 'Vec2', x: x1, y: y1 },
        { type: 'Vec2', x: x0, y: y1 },
      ],
    };
  }

  function boundaryOf(
    outers: ReturnType<typeof rectLoop>[],
    holes: ReturnType<typeof rectLoop>[] = [],
  ): BoundaryConditionsJson {
    return { type: 'BoundaryConditions', outers, holes, guides: [] };
  }

  it('tiles across the overlap of two overlapping outers', () => {
    // Even-odd counted two crossings in the overlap and left it untiled. Both
    // squares are 8×8 cells and overlap by 4×4, so the union is 112 cells.
    const boundaries = boundaryOf([rectLoop(0, 0, 1.2, 1.2), rectLoop(0.6, 0.6, 1.8, 1.8)]);
    const result = fillPolygonWithTileSchema({ schema: schemaFor(), tiles, boundaries });

    expect(result.stats.cells).toBe(112);
    const { cells, doubled } = coverage(result);
    expect(doubled).toEqual([]);
    expect(cells.size).toBe(112);
    // A cell deep inside the overlap is covered.
    expect(cells.has('6:6')).toBe(true);
  });

  it('does not tile a hole drawn outside the outline', () => {
    // Even-odd counted one crossing inside it and laid tiles there.
    const boundaries = boundaryOf([rectLoop(0, 0, 1.2, 1.2)], [rectLoop(2.4, 0, 3, 0.6)]);
    const result = fillPolygonWithTileSchema({ schema: schemaFor(), tiles, boundaries });

    expect(result.stats.cells).toBe(64);
    const maxX = Math.max(...result.placements.map((p) => transformPointMat3(p.mat3, 0, 0).x));
    expect(maxX).toBeLessThan(1.2);
  });

  it('keeps a hole inside a hole as a hole', () => {
    // Nested holes both subtract. Even-odd flipped the inner one back to material.
    const boundaries = boundaryOf(
      [rectLoop(0, 0, 1.8, 1.8)],
      [rectLoop(0.3, 0.3, 1.5, 1.5), rectLoop(0.6, 0.6, 1.2, 1.2)],
    );
    const result = fillPolygonWithTileSchema({ schema: schemaFor(), tiles, boundaries });

    // 12×12 cells less the 8×8 outer hole.
    expect(result.stats.cells).toBe(144 - 64);
    const { cells } = coverage(result);
    expect(cells.has('6:6')).toBe(false);
  });

  it('fills an L built from two overlapping rectangles completely', () => {
    const boundaries = boundaryOf([rectLoop(0, 0, 1.2, 0.6), rectLoop(0, 0, 0.6, 1.2)]);
    const result = fillPolygonWithTileSchema({ schema: schemaFor(), tiles, boundaries });

    // 8×4 plus 4×8, less the 4×4 they share.
    expect(result.stats.cells).toBe(32 + 32 - 16);
    const { cells, doubled } = coverage(result);
    expect(doubled).toEqual([]);
    expect(cells.size).toBe(48);
  });

  it('never lays a tile wholly inside a hole that falls between cells', () => {
    // The realistic case: a drawn hole rarely lands on cell lines. Cells that
    // straddle its edge are part material, so unit tiles there overrun into the
    // hole as cut tiles, by design. What must never happen is a tile whose whole
    // footprint sits inside the hole. Checked on footprints, not origins: a cell
    // straddling the hole's top edge has its origin inside the hole.
    const hole = [1, 0.2, 2, 1] as const; // no edge on a 0.15 m cell line
    const boundaries = boundaryOf([rectLoop(0, 0, 3, 1.5)], [rectLoop(...hole)]);
    const result = fillPolygonWithTileSchema({ schema: schemaFor(), tiles, boundaries });
    const map = new Map(tiles.map((t) => [t.id, t]));

    const boxes = result.placements.map((p) => {
      const t = map.get(p.tileDefinitionId)!;
      const corners = [
        transformPointMat3(p.mat3, 0, 0),
        transformPointMat3(p.mat3, t.length, 0),
        transformPointMat3(p.mat3, t.length, t.width),
        transformPointMat3(p.mat3, 0, t.width),
      ];
      return {
        minX: Math.min(...corners.map((c) => c.x)),
        maxX: Math.max(...corners.map((c) => c.x)),
        minY: Math.min(...corners.map((c) => c.y)),
        maxY: Math.max(...corners.map((c) => c.y)),
      };
    });

    const [x0, y0, x1, y1] = hole;
    const eps = 1e-9;
    const wholly = boxes.filter(
      (b) => b.minX >= x0 - eps && b.maxX <= x1 + eps && b.minY >= y0 - eps && b.maxY <= y1 + eps,
    );
    expect(wholly).toEqual([]);

    // Anything reaching into the hole must also reach out of it — a cut tile
    // across the edge, never an island inside.
    const reaching = boxes.filter(
      (b) => b.minX < x1 - eps && b.maxX > x0 + eps && b.minY < y1 - eps && b.maxY > y0 + eps,
    );
    expect(reaching.length).toBeGreaterThan(0);
    expect(
      reaching.every((b) => b.minX < x0 - eps || b.maxX > x1 + eps || b.minY < y0 - eps || b.maxY > y1 + eps),
    ).toBe(true);
  });

  it('tiles exactly the region the preview draws', () => {
    // The whole point: one region feeds both the picture and the layout, so a
    // cell is covered precisely when its centre lies in the computed region.
    const boundaries = boundaryOf(
      [rectLoop(0, 0, 1.2, 1.2), rectLoop(0.6, 0.6, 1.8, 1.8)],
      [rectLoop(0.15, 0.15, 0.45, 0.45)],
    );
    const region = resolveBoundaryRegion(boundaries);
    const { cells } = coverage(fillPolygonWithTileSchema({ schema: schemaFor(), tiles, boundaries }));

    const disagreements: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      for (let j = 0; j < 12; j += 1) {
        const centre = new Vec2((i + 0.5) * CELL, (j + 0.5) * CELL);
        if (region.contains(centre) !== cells.has(`${i}:${j}`)) disagreements.push(`${i}:${j}`);
      }
    }
    expect(disagreements).toEqual([]);
  });
});
