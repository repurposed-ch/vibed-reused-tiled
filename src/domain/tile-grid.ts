import { z } from 'zod';
import { Frame2 } from '@/math/core/frame2';
import { Vec2 } from '@/math/core/vec2';
import { Grid2 } from '@/math/grid/core/grid2';

/**
 * Two-level grid description of a tiling.
 *
 * A **tile grid** is one fundamental domain: integer cells sized by the smallest
 * format, labelled with the tile occurrences that sit on them. A tile three times
 * the size of the unit format covers a 3×3 block. Cells the domain leaves blank
 * are not holes — they belong to a neighbouring copy.
 *
 * A **master grid** positions copies of a child grid on an integer lattice, and
 * may mirror them. Master grids nest, so a block of tile grids becomes the child
 * of a coarser master grid.
 *
 * Reuse context: the lattice is stored as integer vectors rather than a metric
 * transform because the whole cover test is then exact. A domain of N cells tiles
 * the plane under lattice (u, v) exactly when |det(u, v)| = N and the N cells land
 * in N distinct residue classes — no epsilon anywhere. Lattice vectors are free to
 * point outside the domain's own bounding box; a staircase bond needs that.
 */

export const IntVec2Schema = z.object({
  i: z.number().int(),
  j: z.number().int(),
});

export type IntVec2 = z.infer<typeof IntVec2Schema>;

/** Mirrors `Vec2Json` from `src/math/core/vec2.ts`. */
export const Vec2JsonSchema = z.object({
  type: z.literal('Vec2'),
  x: z.number(),
  y: z.number(),
});

/** Mirrors `Frame2Json` from `src/math/core/frame2.ts`. */
export const Frame2JsonSchema = z.object({
  type: z.literal('Frame2'),
  origin: Vec2JsonSchema,
  xAxis: Vec2JsonSchema,
  yAxis: Vec2JsonSchema,
});

export type Frame2JsonLike = z.infer<typeof Frame2JsonSchema>;

/** One tile occurrence inside the fundamental domain, in integer cells. */
export const TileGridInstanceJsonSchema = z.object({
  id: z.string().min(1),
  tileDefinitionId: z.string().min(1),
  /** Bottom-left cell of the occurrence. */
  i: z.number().int(),
  j: z.number().int(),
  /** Footprint in cells. Carries both the size ratio and the orientation. */
  iSpan: z.number().int().positive(),
  jSpan: z.number().int().positive(),
  /** True when the tile's length runs along +Y. */
  rotated: z.boolean().default(false),
});

/** Level 0: how tiles pack into one repeat unit. */
export const TileGridJsonSchema = z.object({
  type: z.literal('TileGrid'),
  id: z.string().min(1),
  name: z.string().min(1),
  /**
   * Cell size in metres. This is where slack lives: set it to the unit tile plus
   * the joint so a larger format lands on an exact multiple.
   */
  cell: z.object({
    x: z.number().positive(),
    y: z.number().positive(),
  }),
  /** Joint width in metres. Drawn tile size is `span * cell − joint`. */
  joint: z.number().nonnegative().default(0),
  /** Integer bounding box of the fundamental domain. */
  extent: z.object({
    iCount: z.number().int().positive(),
    jCount: z.number().int().positive(),
  }),
  instances: z.array(TileGridInstanceJsonSchema),
  /** Unit-sized tile substituted when a larger format is clipped by the boundary. */
  fallbackTileDefinitionId: z.string().min(1),
});

export const MirrorRuleSchema = z.enum(['none', 'alternate']);

export const MirrorJsonSchema = z.object({
  x: MirrorRuleSchema.default('none'),
  y: MirrorRuleSchema.default('none'),
});

/** Level n: how copies of a child grid are positioned. */
export const MasterGridJsonSchema = z.object({
  type: z.literal('MasterGrid'),
  id: z.string().min(1),
  name: z.string().min(1),
  /** A `TileGrid.id` or another `MasterGrid.id`. */
  childId: z.string().min(1),
  /** Lattice vectors in child steps. May point outside the child extent. */
  u: IntVec2Schema,
  v: IntVec2Schema,
  /**
   * Absent means this level tiles the plane (the root). Present means it is a
   * finite block that a coarser master grid positions in turn.
   */
  extent: z
    .object({
      iCount: z.number().int().positive(),
      jCount: z.number().int().positive(),
    })
    .optional(),
  mirror: MirrorJsonSchema.default({ x: 'none', y: 'none' }),
});

export const TileSchemaJsonSchema = z.object({
  type: z.literal('TileSchema'),
  id: z.string().min(1),
  name: z.string().min(1),
  tileGrids: z.array(TileGridJsonSchema).min(1),
  masterGrids: z.array(MasterGridJsonSchema).min(1),
  rootMasterGridId: z.string().min(1),
  /** World pose of the base cell grid. */
  frame: Frame2JsonSchema,
});

export type TileGridInstanceJson = z.infer<typeof TileGridInstanceJsonSchema>;
export type TileGridJson = z.infer<typeof TileGridJsonSchema>;
export type MirrorRule = z.infer<typeof MirrorRuleSchema>;
export type MirrorJson = z.infer<typeof MirrorJsonSchema>;
export type MasterGridJson = z.infer<typeof MasterGridJsonSchema>;
export type TileSchemaJson = z.infer<typeof TileSchemaJsonSchema>;

export function identityFrame2Json(): Frame2JsonLike {
  return {
    type: 'Frame2',
    origin: { type: 'Vec2', x: 0, y: 0 },
    xAxis: { type: 'Vec2', x: 1, y: 0 },
    yAxis: { type: 'Vec2', x: 0, y: 1 },
  };
}

export function toFrame2(json: Frame2JsonLike): Frame2 {
  return new Frame2(
    new Vec2(json.origin.x, json.origin.y),
    new Vec2(json.xAxis.x, json.xAxis.y),
    new Vec2(json.yAxis.x, json.yAxis.y),
  );
}

export function frame2ToJson(frame: Frame2): Frame2JsonLike {
  return {
    type: 'Frame2',
    origin: { type: 'Vec2', x: frame.origin.x, y: frame.origin.y },
    xAxis: { type: 'Vec2', x: frame.xAxis.x, y: frame.xAxis.y },
    yAxis: { type: 'Vec2', x: frame.yAxis.x, y: frame.yAxis.y },
  };
}

/**
 * The base cell grid as a real `Grid2`: uniform axes at the cell size, posed by
 * the schema frame. Cell → world geometry goes through this rather than through
 * hand-rolled arithmetic.
 */
export function baseGrid2(schema: TileSchemaJson, tileGrid: TileGridJson): Grid2 {
  return Grid2.uniform(tileGrid.cell.x, tileGrid.cell.y, { frame: toFrame2(schema.frame) });
}

export function findTileGrid(schema: TileSchemaJson, id: string): TileGridJson | undefined {
  return schema.tileGrids.find((g) => g.id === id);
}

export function findMasterGrid(schema: TileSchemaJson, id: string): MasterGridJson | undefined {
  return schema.masterGrids.find((g) => g.id === id);
}

/** Every cell a tile occurrence covers, in domain coordinates. */
export function instanceCells(instance: TileGridInstanceJson): IntVec2[] {
  const cells: IntVec2[] = [];
  for (let di = 0; di < instance.iSpan; di += 1) {
    for (let dj = 0; dj < instance.jSpan; dj += 1) {
      cells.push({ i: instance.i + di, j: instance.j + dj });
    }
  }
  return cells;
}

/** Cells the domain labels, in the order the instances claim them. */
export function tileGridCells(tileGrid: TileGridJson): IntVec2[] {
  return tileGrid.instances.flatMap(instanceCells);
}

export function createTileGridInstance(
  tileDefinitionId: string,
  i: number,
  j: number,
  iSpan = 1,
  jSpan = 1,
  rotated = false,
): TileGridInstanceJson {
  return { id: crypto.randomUUID(), tileDefinitionId, i, j, iSpan, jSpan, rotated };
}

export function createTileGrid(
  partial: Partial<Omit<TileGridJson, 'type'>> & { fallbackTileDefinitionId: string },
): TileGridJson {
  return {
    type: 'TileGrid',
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name ?? 'Tile grid',
    cell: partial.cell ?? { x: 0.15, y: 0.15 },
    joint: partial.joint ?? 0,
    extent: partial.extent ?? { iCount: 1, jCount: 1 },
    instances: partial.instances ?? [],
    fallbackTileDefinitionId: partial.fallbackTileDefinitionId,
  };
}

export function createMasterGrid(
  partial: Partial<Omit<MasterGridJson, 'type'>> & { childId: string },
): MasterGridJson {
  return {
    type: 'MasterGrid',
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name ?? 'Master grid',
    childId: partial.childId,
    u: partial.u ?? { i: 1, j: 0 },
    v: partial.v ?? { i: 0, j: 1 },
    extent: partial.extent,
    mirror: partial.mirror ?? { x: 'none', y: 'none' },
  };
}

export function createTileSchema(
  partial: Partial<Omit<TileSchemaJson, 'type'>> & {
    tileGrids: TileGridJson[];
    masterGrids: MasterGridJson[];
    rootMasterGridId: string;
  },
): TileSchemaJson {
  return {
    type: 'TileSchema',
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name ?? 'Tile schema',
    tileGrids: partial.tileGrids,
    masterGrids: partial.masterGrids,
    rootMasterGridId: partial.rootMasterGridId,
    frame: partial.frame ?? identityFrame2Json(),
  };
}
