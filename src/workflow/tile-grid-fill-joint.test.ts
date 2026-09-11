import { describe, expect, it } from 'vitest';
import type { BoundaryConditionsJson } from '@/domain/boundaries';
import { placementBlock } from '@/domain/instance';
import { transformPointMat3 } from '@/domain/mat3';
import { createTileDefinition, type TileDefinitionJson } from '@/domain/tile';
import {
  createMasterGrid,
  createTileGrid,
  createTileSchema,
  frame2ToJson,
  type TileGridInstanceJson,
  type TileSchemaJson,
} from '@/domain/tile-grid';
import { Frame2 } from '@/math/core/frame2';
import { Vec2 } from '@/math/core/vec2';
import { fillPolygonWithTileSchema } from './tile-grid-fill';

const CELL = 0.15;
const JOINT = 0.01;
const small = createTileDefinition({ id: 's', name: 's', length: 0.14, width: 0.14 });

function rect(x0: number, y0: number, x1: number, y1: number): BoundaryConditionsJson {
  return {
    type: 'BoundaryConditions',
    outers: [
      {
        type: 'Polygon2',
        vertices: [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ].map(([x, y]) => ({ type: 'Vec2' as const, x: x!, y: y! })),
      },
    ],
    holes: [],
    guides: [],
  } as BoundaryConditionsJson;
}

const inst = (id: string, tile: string, i: number, j: number, iSpan = 1, jSpan = 1): TileGridInstanceJson => ({
  id,
  tileDefinitionId: tile,
  i,
  j,
  iSpan,
  jSpan,
  rotated: false,
});

/** A 2×2 repeat: slab `g` stored as 2×1 on the bottom row, two unit tiles above it. */
function schema(frame?: TileSchemaJson['frame']): TileSchemaJson {
  const grid = createTileGrid({
    id: 'grid',
    cell: { x: CELL, y: CELL },
    joint: JOINT,
    extent: { iCount: 2, jCount: 2 },
    instances: [inst('g0', 'g', 0, 0, 2, 1), inst('s0', 's', 0, 1), inst('s1', 's', 1, 1)],
    fallbackTileDefinitionId: 's',
  });
  const master = createMasterGrid({ id: 'm', childId: grid.id, u: { i: 2, j: 0 }, v: { i: 0, j: 2 } });
  return createTileSchema({ tileGrids: [grid], masterGrids: [master], rootMasterGridId: master.id, frame });
}

describe('fill with a joint', () => {
  it('centres an undersized tile, widening its joints', () => {
    const slab = createTileDefinition({ id: 'g', name: 'g', length: 0.28, width: 0.14 });
    const result = fillPolygonWithTileSchema({ schema: schema(), tiles: [small, slab], boundaries: rect(0, 0, 0.3, 0.3) });
    const origin = transformPointMat3(result.byTile.g![0]!, 0, 0);
    // (joint + slack) / 2 along the slab: (0.01 + 0.01) / 2.
    expect(origin.x).toBeCloseTo(0.01, 9);
    expect(origin.y).toBeCloseTo(JOINT / 2, 9);
    expect(result.stats.oversized).toEqual({});
  });

  // A stored span is never re-derived. A tile edited larger than its footprint must not be
  // placed on top of its neighbours — and the boundary must still be filled completely.
  it('leaves out a tile too large for its stored span and fills its cells with fallback tiles', () => {
    const grown = createTileDefinition({ id: 'g', name: 'g', length: 0.31, width: 0.14 });
    const result = fillPolygonWithTileSchema({ schema: schema(), tiles: [small, grown], boundaries: rect(0, 0, 0.3, 0.3) });
    expect(result.byTile.g).toBeUndefined();
    expect(result.stats.oversized).toEqual({ g: 1 });
    expect(result.byTile.s).toHaveLength(4);
    const claimed = result.placements.reduce((n, p) => n + p.cell!.iSpan * p.cell!.jSpan, 0);
    expect(claimed).toBe(result.stats.cells);
  });

  it('records each placement cell block and the grid it refers to', () => {
    const slab = createTileDefinition({ id: 'g', name: 'g', length: 0.29, width: 0.14 });
    const result = fillPolygonWithTileSchema({ schema: schema(), tiles: [small, slab], boundaries: rect(0, 0, 0.3, 0.3) });
    expect(result.grid).toMatchObject({ cell: { x: CELL, y: CELL }, joint: JOINT });
    const g = result.placements.find((p) => p.tileDefinitionId === 'g')!;
    expect(g.cell).toEqual({ i: 0, j: 0, iSpan: 2, jSpan: 1 });
  });

  const frames: Array<[string, TileSchemaJson['frame'] | undefined]> = [
    ['plain', undefined],
    [
      'rotated',
      frame2ToJson(new Frame2(new Vec2(0.1, 0.2), new Vec2(Math.cos(0.6), Math.sin(0.6)), new Vec2(-Math.sin(0.6), Math.cos(0.6)))),
    ],
    ['mirrored', frame2ToJson(new Frame2(new Vec2(0.3, -0.1), new Vec2(-1, 0), new Vec2(0, 1)))],
  ];

  it.each(frames)('keeps every tile inside its block, with blocks covering the cells exactly: %s frame', (_name, frame) => {
    const slab = createTileDefinition({ id: 'g', name: 'g', length: 0.29, width: 0.14 });
    const tiles = new Map<string, TileDefinitionJson>([
      ['s', small],
      ['g', slab],
    ]);
    const result = fillPolygonWithTileSchema({ schema: schema(frame), tiles: [small, slab], boundaries: rect(-0.6, -0.6, 0.6, 0.6) });
    expect(result.stats.unfilled).toBe(0);
    expect(result.placements.length).toBeGreaterThan(0);

    for (const placement of result.placements) {
      const tile = tiles.get(placement.tileDefinitionId)!;
      const block = placementBlock(placement, tile, result.grid!);
      const e = block.mat3.elements;
      const det = e[0] * e[4] - e[3] * e[1];
      const toBlock = (x: number, y: number) => {
        const dx = x - e[6];
        const dy = y - e[7];
        return { x: (e[4] * dx - e[3] * dy) / det, y: (-e[1] * dx + e[0] * dy) / det };
      };
      for (const [x, y] of [
        [0, 0],
        [tile.length, 0],
        [tile.length, tile.width],
        [0, tile.width],
      ] as const) {
        const world = transformPointMat3(placement.mat3, x, y);
        const local = toBlock(world.x, world.y);
        expect(local.x).toBeGreaterThanOrEqual(-1e-9);
        expect(local.y).toBeGreaterThanOrEqual(-1e-9);
        expect(local.x).toBeLessThanOrEqual(block.width + 1e-9);
        expect(local.y).toBeLessThanOrEqual(block.height + 1e-9);
      }
    }

    const claimed = result.placements.reduce((n, p) => n + p.cell!.iSpan * p.cell!.jSpan, 0);
    expect(claimed).toBe(result.stats.cells);
  });
});
