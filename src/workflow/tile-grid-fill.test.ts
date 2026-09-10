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
