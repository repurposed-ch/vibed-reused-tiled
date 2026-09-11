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

/** Every cell of a rectangular extent, row-major from the origin. */
export function extentCells(extent: { iCount: number; jCount: number }): IntVec2[] {
  const cells: IntVec2[] = [];
  for (let i = 0; i < extent.iCount; i += 1) {
    for (let j = 0; j < extent.jCount; j += 1) cells.push({ i, j });
  }
  return cells;
}

/**
 * Oversize beyond float noise is an error. Allowing even half a millimetre here would let
 * two "barely over" neighbours overlap by a millimetre, and their tops would z-fight in 3D.
 */
export const FIT_OVER_TOLERANCE = 1e-6;

/**
 * Undersize below this counts as exact. It only decides whether the editor warns: an
 * undersized tile is centred in its footprint either way, so the joints around it widen.
 */
export const FIT_UNDER_TOLERANCE = 0.0005;

export type TileFitKind = 'exact' | 'under' | 'over' | 'tooSmall';

export type TileFit = {
  /** Spans the tile was judged against, always at least 1. */
  iSpan: number;
  jSpan: number;
  fit: TileFitKind;
  /** Largest tile the footprint holds, `span · cell − joint`, per grid axis. */
  nominal: { x: number; y: number };
  /** `nominal − tile` per grid axis: positive when undersized, negative when oversized. */
  slack: { x: number; y: number };
};

/**
 * A joint as a usable number. `ui.schemaDraft` is not zod-parsed, so a draft stored by an
 * older build can carry no joint at all — which would otherwise make every span NaN.
 */
export function sanitizeJoint(joint: unknown): number {
  return typeof joint === 'number' && Number.isFinite(joint) && joint > 0 ? joint : 0;
}

/** Judge a tile against a given footprint, e.g. a span stored in the schema. */
export function fitTileInSpan(
  tile: { length: number; width: number },
  cell: { x: number; y: number },
  joint: number,
  rotated: boolean,
  span: { iSpan: number; jSpan: number },
): TileFit {
  const j = sanitizeJoint(joint);
  const along = rotated ? tile.width : tile.length;
  const across = rotated ? tile.length : tile.width;
  const nominal = { x: span.iSpan * cell.x - j, y: span.jSpan * cell.y - j };
  const slack = { x: nominal.x - along, y: nominal.y - across };
  let fit: TileFitKind = 'exact';
  if (slack.x < -FIT_OVER_TOLERANCE || slack.y < -FIT_OVER_TOLERANCE) fit = 'over';
  else if (slack.x > FIT_UNDER_TOLERANCE || slack.y > FIT_UNDER_TOLERANCE) fit = 'under';
  return { iSpan: span.iSpan, jSpan: span.jSpan, fit, nominal, slack };
}

/**
 * The footprint a tile takes on a grid, and how well it fits it.
 *
 * A cell is the unit tile plus one joint, so a tile spanning k cells is nominally
 * `k · cell − joint`. The span is the nearest whole number: a tile may be up to half a cell
 * short on an axis and still take the larger span (undersized — centred, with wider joints),
 * and past that it is judged against the smaller span, where it is too large. So 0.22 m on a
 * 0.15 m cell with a 0.01 m joint is 70 mm under a 2×1, while 0.21 m is 70 mm over a 1×1.
 */
export function fitTile(
  tile: { length: number; width: number },
  cell: { x: number; y: number },
  joint: number,
  rotated: boolean,
): TileFit {
  const j = sanitizeJoint(joint);
  const along = rotated ? tile.width : tile.length;
  const across = rotated ? tile.length : tile.width;
  const iSpan = Math.round((along + j) / cell.x);
  const jSpan = Math.round((across + j) / cell.y);
  if (iSpan < 1 || jSpan < 1) {
    const fit = fitTileInSpan(tile, cell, j, rotated, {
      iSpan: Math.max(1, iSpan),
      jSpan: Math.max(1, jSpan),
    });
    return { ...fit, fit: 'tooSmall' };
  }
  return fitTileInSpan(tile, cell, j, rotated, { iSpan, jSpan });
}

/**
 * How many cells a tile covers, or null when it has no legal footprint.
 *
 * A tile has exactly two footprints — upright and turned — and both are derived, never
 * chosen, which is what keeps the stored spans and the drawn tiles in step. An undersized
 * tile still has a footprint (the fill centres it); an oversized or too-small one does not.
 */
export function spanFor(
  tile: { length: number; width: number },
  cell: { x: number; y: number },
  joint: number,
  rotated: boolean,
): { iSpan: number; jSpan: number } | null {
  const fit = fitTile(tile, cell, joint, rotated);
  return fit.fit === 'exact' || fit.fit === 'under' ? { iSpan: fit.iSpan, jSpan: fit.jSpan } : null;
}

export type SpanOption = {
  rotated: boolean;
  iSpan: number;
  jSpan: number;
  fit: 'exact' | 'under';
  slack: { x: number; y: number };
};

/** Both legal footprints of a tile, upright first. A square format has only one. */
export function spanOptions(
  tile: { length: number; width: number },
  cell: { x: number; y: number },
  joint: number,
): SpanOption[] {
  const out: SpanOption[] = [];
  const add = (rotated: boolean) => {
    const f = fitTile(tile, cell, joint, rotated);
    if (f.fit === 'exact' || f.fit === 'under') {
      out.push({ rotated, iSpan: f.iSpan, jSpan: f.jSpan, fit: f.fit, slack: f.slack });
    }
  };
  add(false);
  if (tile.length !== tile.width) add(true);
  return out;
}

/** The joints beside an undersized tile: half the slack next to an exact neighbour, all of it at worst. */
export function widenedJoint(joint: number, slack: number): { min: number; max: number } {
  const j = sanitizeJoint(joint);
  const s = Math.max(0, slack);
  return { min: j + s / 2, max: j + s };
}

export function formatMm(metres: number): string {
  // Round before choosing the precision: 9.999999 mm is float noise for 10, and deciding on the
  // raw value would print it as "10.0 mm" beside a clean "10 mm".
  const tenths = Math.round(metres * 10000) / 10;
  return Math.abs(tenths) < 10 ? `${tenths.toFixed(1)} mm` : `${Math.round(tenths)} mm`;
}

/** One-line description of a fit, for editor messages. */
export function describeFit(name: string, fit: TileFit): string {
  const size = `${fit.iSpan}×${fit.jSpan}`;
  switch (fit.fit) {
    case 'exact':
      return `${name} fits its ${size} footprint.`;
    case 'under':
      return `${name} is ${formatMm(Math.max(fit.slack.x, fit.slack.y))} under its ${size} footprint, so the joints around it widen.`;
    case 'over':
      return `${name} is ${formatMm(Math.max(-fit.slack.x, -fit.slack.y))} larger than its ${size} footprint and would overlap its neighbours.`;
    case 'tooSmall':
      return `${name} is less than half a cell, so it has no footprint on this grid.`;
  }
}

/** The footprint closest to a drawn rectangle. Used to turn a drag into a legal instance. */
export function bestSpanForDrag(
  tile: { length: number; width: number },
  cell: { x: number; y: number },
  joint: number,
  drag: { iSpan: number; jSpan: number },
): { rotated: boolean; iSpan: number; jSpan: number } | null {
  const options = spanOptions(tile, cell, joint);
  if (options.length === 0) return null;
  let best = options[0]!;
  let bestCost = Infinity;
  for (const option of options) {
    const cost = Math.abs(drag.iSpan - option.iSpan) + Math.abs(drag.jSpan - option.jSpan);
    if (cost < bestCost) {
      bestCost = cost;
      best = option;
    }
  }
  return best;
}

export function instanceCoversCell(instance: TileGridInstanceJson, i: number, j: number): boolean {
  return (
    i >= instance.i &&
    j >= instance.j &&
    i < instance.i + instance.iSpan &&
    j < instance.j + instance.jSpan
  );
}

export function instanceAtCell(
  grid: TileGridJson,
  i: number,
  j: number,
): TileGridInstanceJson | undefined {
  return grid.instances.find((instance) => instanceCoversCell(instance, i, j));
}

function rectsOverlap(
  a: { i: number; j: number; iSpan: number; jSpan: number },
  b: { i: number; j: number; iSpan: number; jSpan: number },
): boolean {
  return (
    a.i < b.i + b.iSpan && b.i < a.i + a.iSpan && a.j < b.j + b.jSpan && b.j < a.j + a.jSpan
  );
}

/**
 * Lay an occurrence down, clearing whatever it lands on.
 *
 * An occurrence is atomic — half a tile is not a thing — so anything the new
 * footprint touches is removed whole. That routinely leaves cells unclaimed,
 * which is the usual reason a domain stops tiling; {@link unclaimedCells} is how
 * the editor points at them.
 */
export function putInstance(
  grid: TileGridJson,
  instance: TileGridInstanceJson,
): { grid: TileGridJson; replaced: number } {
  const kept = grid.instances.filter((existing) => !rectsOverlap(existing, instance));
  return {
    grid: { ...grid, instances: [...kept, instance] },
    replaced: grid.instances.length - kept.length,
  };
}

export function removeInstanceAt(grid: TileGridJson, i: number, j: number): TileGridJson {
  const hit = instanceAtCell(grid, i, j);
  if (!hit) return grid;
  return { ...grid, instances: grid.instances.filter((instance) => instance.id !== hit.id) };
}

/**
 * Cells inside the extent that no occurrence claims.
 *
 * This is the diagnostic that matters most in the editor. `validateLattice`
 * reports a count mismatch before it ever looks at residues, so its `collisions`
 * list is empty in exactly this case — the user would otherwise be told the
 * numbers disagree with no indication of where.
 */
export function unclaimedCells(grid: TileGridJson): IntVec2[] {
  const claimed = new Set<string>();
  for (const instance of grid.instances) {
    for (const cell of instanceCells(instance)) claimed.add(`${cell.i}:${cell.j}`);
  }
  return extentCells(grid.extent).filter((cell) => !claimed.has(`${cell.i}:${cell.j}`));
}

/** Cells claimed more than once, or claimed from outside the extent. */
export function overclaimedCells(grid: TileGridJson): IntVec2[] {
  const seen = new Map<string, number>();
  for (const instance of grid.instances) {
    for (const cell of instanceCells(instance)) {
      const key = `${cell.i}:${cell.j}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  const out: IntVec2[] = [];
  for (const [key, count] of seen) {
    const [i, j] = key.split(':').map(Number) as [number, number];
    const outside = i < 0 || j < 0 || i >= grid.extent.iCount || j >= grid.extent.jCount;
    if (count > 1 || outside) out.push({ i, j });
  }
  return out;
}

const MAX_NESTING = 8;

/**
 * The master-grid levels from the root inward. Depth-capped: a `childId` cycle
 * would otherwise spin forever, and the schema format cannot forbid one.
 */
export function masterChain(schema: TileSchemaJson): MasterGridJson[] {
  const chain: MasterGridJson[] = [];
  let current = findMasterGrid(schema, schema.rootMasterGridId);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.id) || chain.length >= MAX_NESTING) {
      throw new Error('TileSchema master grids form a cycle or nest too deeply');
    }
    seen.add(current.id);
    chain.push(current);
    current = findMasterGrid(schema, current.childId);
  }
  return chain;
}

/**
 * The tile grid the master chain actually reaches — the one the fill uses. Undefined when
 * the chain is broken (a cycle, or too deep), rather than throwing into a render.
 */
export function innermostTileGrid(schema: TileSchemaJson): TileGridJson | undefined {
  try {
    const chain = masterChain(schema);
    const innermost = chain[chain.length - 1];
    return (innermost && findTileGrid(schema, innermost.childId)) ?? schema.tileGrids[0];
  } catch {
    return undefined;
  }
}

/**
 * Insert a new unbounded level above the root, leaving the tiling untouched.
 *
 * The old root has to gain an extent, because only the root may be unbounded —
 * and if it mirrors, that extent must be the doubled block `resolveSchema` was
 * building for it implicitly. Miss that and a mirrored pattern silently halves
 * its period the moment a level is added, from an action the user expects to
 * change nothing. The new level then steps by exactly that block, so the
 * composite lattice and cell count both come out unchanged.
 */
export function addMasterLevelAboveRoot(schema: TileSchemaJson): TileSchemaJson {
  const root = findMasterGrid(schema, schema.rootMasterGridId);
  if (!root) throw new Error('TileSchema root master grid not found');

  const mx = root.mirror.x === 'alternate';
  const my = root.mirror.y === 'alternate';
  const blockI = mx ? 2 : 1;
  const blockJ = my ? 2 : 1;

  const boundedOldRoot: MasterGridJson = {
    ...root,
    extent: { iCount: blockI, jCount: blockJ },
  };
  const newRoot = createMasterGrid({
    name: `Level ${schema.masterGrids.length + 1}`,
    childId: root.id,
    u: { i: blockI, j: 0 },
    v: { i: 0, j: blockJ },
  });

  return {
    ...schema,
    masterGrids: [...schema.masterGrids.map((m) => (m.id === root.id ? boundedOldRoot : m)), newRoot],
    rootMasterGridId: newRoot.id,
  };
}

/**
 * Drop the root level, promoting its child. The promoted level loses its extent
 * because the root must be unbounded — which changes the repeat, so the result
 * is not guaranteed to tile. Callers validate before offering it.
 */
export function removeRootMasterLevel(schema: TileSchemaJson): TileSchemaJson {
  const chain = masterChain(schema);
  if (chain.length < 2) throw new Error('TileSchema needs at least one master grid');
  const [root, next] = chain as [MasterGridJson, MasterGridJson];

  const promoted: MasterGridJson = { ...next };
  delete promoted.extent;

  return {
    ...schema,
    // Drop the old root and any master grid the new chain no longer reaches.
    masterGrids: schema.masterGrids
      .filter((m) => m.id !== root.id)
      .map((m) => (m.id === next.id ? promoted : m)),
    rootMasterGridId: next.id,
  };
}

/** Axis-aligned lattice that steps by exactly one block of the given extent. */
export function blockStep(extent: { iCount: number; jCount: number }): {
  u: IntVec2;
  v: IntVec2;
} {
  return { u: { i: extent.iCount, j: 0 }, v: { i: 0, j: extent.jCount } };
}

export function sameVec(a: IntVec2, b: IntVec2): boolean {
  return a.i === b.i && a.j === b.j;
}

/**
 * Change a level's extent and keep its parent stepping by the new block.
 *
 * The parent's lattice is only retargeted when it still matches the *old*
 * block — i.e. the user had not hand-tuned it. A sheared parent lattice is
 * deliberate and is left alone, with the validator to report any mismatch;
 * without this the common case would break the schema on every extent edit.
 */
export function setLevelExtent(
  schema: TileSchemaJson,
  levelId: string,
  extent: { iCount: number; jCount: number },
): TileSchemaJson {
  const level = findMasterGrid(schema, levelId);
  if (!level?.extent) return schema;

  const previous = blockStep(level.extent);
  const next = blockStep(extent);
  const parent = schema.masterGrids.find((m) => m.childId === levelId);
  const parentTracks =
    parent != null && sameVec(parent.u, previous.u) && sameVec(parent.v, previous.v);

  return {
    ...schema,
    masterGrids: schema.masterGrids.map((m) => {
      if (m.id === levelId) return { ...m, extent };
      if (parentTracks && m.id === parent?.id) return { ...m, u: next.u, v: next.v };
      return m;
    }),
  };
}
