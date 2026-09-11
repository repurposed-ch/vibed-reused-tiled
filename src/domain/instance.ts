import { z } from 'zod';
import {
  Mat3JsonSchema,
  multiplyMat3,
  transformedRectAabb,
  translationMat3,
  type Mat3Json,
} from './mat3';
import type { TileDefinitionJson } from './tile';

/** The grid cells a placement's footprint claims, when it came from a tile schema. */
export const PlacementCellJsonSchema = z.object({
  i: z.number().int(),
  j: z.number().int(),
  iSpan: z.number().int().positive(),
  jSpan: z.number().int().positive(),
});

export const PlacementJsonSchema = z.object({
  id: z.string().min(1),
  tileDefinitionId: z.string().min(1),
  mat3: Mat3JsonSchema,
  moduleId: z.string().optional(),
  /**
   * Integer cell block, rather than a block matrix per placement: the instance is persisted
   * on every edit, and one shared `grid` plus four integers keeps it light. It also
   * guarantees every block shares the same frame axes, which grout texture continuity needs.
   */
  cell: PlacementCellJsonSchema.optional(),
});

/** The base grid a schema fill laid out: world frame, cell pitch (unit + joint), joint. */
export const InstanceGridJsonSchema = z.object({
  frame: Mat3JsonSchema,
  cell: z.object({ x: z.number().positive(), y: z.number().positive() }),
  joint: z.number().nonnegative(),
});

export const DesignInstanceJsonSchema = z.object({
  type: z.literal('DesignInstance'),
  placements: z.array(PlacementJsonSchema),
  grid: InstanceGridJsonSchema.optional(),
  meta: z
    .object({
      seed: z.number().optional(),
      sampledStock: z
        .array(
          z.object({
            tileDefinitionId: z.string(),
            count: z.number(),
          }),
        )
        .optional(),
      unmetConstraintIds: z.array(z.string()).optional(),
      solverStats: z.record(z.string(), z.number()).optional(),
    })
    .optional(),
});

export type PlacementCellJson = z.infer<typeof PlacementCellJsonSchema>;
export type PlacementJson = z.infer<typeof PlacementJsonSchema>;
export type InstanceGridJson = z.infer<typeof InstanceGridJsonSchema>;
export type DesignInstanceJson = z.infer<typeof DesignInstanceJsonSchema>;

/** Grout margin around a placement with no grid block (design-family layouts). */
export const FALLBACK_GROUT_MARGIN = 0.001;

/**
 * The area a placement's grout covers: a rectangle `width × height` in the frame `mat3`
 * places at the origin.
 */
export type PlacementBlock = {
  mat3: Mat3Json;
  width: number;
  height: number;
  /** True for a schema cell block; false for the axis-aligned fallback around a loose tile. */
  gridAligned: boolean;
};

/**
 * A placement's full cell block — the tile plus half a joint on every side, and any extra
 * room an undersized tile leaves. Grout under exactly these blocks fills every joint, even
 * where edge tiles overhang the boundary, which grout shaped like the region itself would miss.
 *
 * Without a grid block (a design-family layout), the grout falls back to the tile's own
 * axis-aligned bounds plus a small margin. Axis-aligned rather than the tile's own frame, so
 * texture space stays identical across mirrored and rotated loose tiles.
 */
export function placementBlock(
  placement: PlacementJson,
  tile: Pick<TileDefinitionJson, 'length' | 'width'>,
  grid?: InstanceGridJson,
): PlacementBlock {
  if (grid && placement.cell) {
    const { i, j, iSpan, jSpan } = placement.cell;
    return {
      mat3: multiplyMat3(grid.frame, translationMat3(i * grid.cell.x, j * grid.cell.y)),
      width: iSpan * grid.cell.x,
      height: jSpan * grid.cell.y,
      gridAligned: true,
    };
  }
  const box = transformedRectAabb(placement.mat3, tile.length, tile.width);
  const m = FALLBACK_GROUT_MARGIN;
  return {
    mat3: translationMat3(box.minX - m, box.minY - m),
    width: box.maxX - box.minX + 2 * m,
    height: box.maxY - box.minY + 2 * m,
    gridAligned: false,
  };
}

export type InstanceBlock = PlacementBlock & { tileDefinitionId: string };

/** Every placement's grout block, skipping placements whose tile no longer exists. */
export function instanceBlocks(
  instance: DesignInstanceJson,
  tiles: ReadonlyMap<string, Pick<TileDefinitionJson, 'length' | 'width'>>,
): InstanceBlock[] {
  const out: InstanceBlock[] = [];
  for (const placement of instance.placements) {
    const tile = tiles.get(placement.tileDefinitionId);
    if (!tile) continue;
    out.push({
      ...placementBlock(placement, tile, instance.grid),
      tileDefinitionId: placement.tileDefinitionId,
    });
  }
  return out;
}
