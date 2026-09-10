import type { DesignModuleJson, ModulePlacementJson } from '@/domain/design-family';
import { multiplyMat3, rotationMat3, translationMat3, type Mat3Json } from '@/domain/mat3';
import type { TileDefinitionJson } from '@/domain/tile';
import {
  createMasterGrid,
  createTileGrid,
  createTileSchema,
  type MasterGridJson,
  type TileGridInstanceJson,
  type TileGridJson,
  type TileSchemaJson,
} from '@/domain/tile-grid';
import { mulberry32, type Rng } from './sample-stock';

/**
 * Rapport search: find the smallest rectangle that a given set of tile formats
 * fills exactly (no gaps, no overlaps) while hitting requested area shares as
 * closely as possible. The rectangle is a repeat unit — tiling the plane with
 * it reproduces the requested shares everywhere except at cut edges.
 *
 * Reuse context: shares are the designer's intent ("roughly 60 % of the large
 * format"), not a hard count. The solver treats them as a soft target and
 * reports the deviation it actually achieved, so downstream steps can decide
 * whether a stock sample supports the intent.
 */

/** Desired area share per tile definition. Shares are normalised internally. */
export type RapportTarget = {
  tileDefinitionId: string;
  /** Relative weight; 0.6 and 60 behave identically. */
  areaShare: number;
};

/** One tile inside the module, in grid units relative to the module origin. */
export type RapportPlacement = {
  tileDefinitionId: string;
  xUnits: number;
  yUnits: number;
  widthUnits: number;
  heightUnits: number;
  /** True when the tile sits with its length along Y. */
  rotated: boolean;
};

export type RapportModule = {
  /** Edge length of one grid cell, in metres. */
  unit: number;
  widthUnits: number;
  heightUnits: number;
  /** Module size in metres. */
  width: number;
  height: number;
  placements: RapportPlacement[];
  /** Achieved area share per tile definition, 0..1. */
  achievedShares: Record<string, number>;
  /** Sum of |achieved − target| across formats, in percentage points. */
  deviation: number;
};

export type FindRapportOptions = {
  /** Candidate formats. Two or three give useful results; more explodes the search. */
  tiles: TileDefinitionJson[];
  targets: RapportTarget[];
  /** Upper bound for the module, in metres. Defaults to 3 m × 3 m. */
  maxWidth?: number;
  maxHeight?: number;
  /** Dimension quantisation in metres. Defaults to 1 mm. */
  unitResolution?: number;
  /** Cap on module cells; guards the backtracking search. Defaults to 260. */
  maxModuleCells?: number;
  /** Randomised retries per candidate size. Defaults to 4. */
  attempts?: number;
  /**
   * Deviation in percentage points that counts as good enough. The search
   * stops at the first module inside this band, which is why sizes are visited
   * smallest-first. Defaults to 2.
   */
  tolerance?: number;
  /** Seed for deterministic output. Defaults to 1. */
  seed?: number;
};

const DEFAULT_MAX_EXTENT = 3;
const DEFAULT_UNIT_RESOLUTION = 0.001;
const DEFAULT_MAX_MODULE_CELLS = 260;
const DEFAULT_ATTEMPTS = 4;
const DEFAULT_TOLERANCE = 2;
const MAX_SIDE_UNITS = 18;
const NODE_CAP = 8_000;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Largest grid cell that divides every tile dimension without remainder. */
export function gridUnit(tiles: TileDefinitionJson[], resolution = DEFAULT_UNIT_RESOLUTION): number {
  const steps = tiles.flatMap((t) => [
    Math.round(t.length / resolution),
    Math.round(t.width / resolution),
  ]);
  const g = steps.reduce((a, b) => gcd(a, b));
  return g * resolution;
}

type Candidate = {
  index: number;
  widthUnits: number;
  heightUnits: number;
  rotated: boolean;
};

type FillResult = {
  placements: RapportPlacement[];
  cellsByTile: number[];
};

/**
 * Exact-cover fill by backtracking. Cells are visited in row-major order; at
 * every empty cell the candidate formats are tried, ordered by how far each one
 * still trails its target share. The jitter term keeps repeated calls from
 * collapsing onto the same trivial arrangement.
 */
function fillModule(
  widthUnits: number,
  heightUnits: number,
  candidates: Candidate[],
  tileIds: string[],
  targetFractions: number[],
  rng: Rng,
): FillResult | null {
  const total = widthUnits * heightUnits;
  const grid = new Int16Array(total).fill(-1);
  const cellsByTile = new Array<number>(tileIds.length).fill(0);
  const placements: RapportPlacement[] = [];
  let nodes = 0;

  const firstEmpty = (): number => {
    for (let i = 0; i < total; i += 1) if (grid[i] === -1) return i;
    return -1;
  };

  const fits = (row: number, col: number, w: number, h: number): boolean => {
    if (col + w > widthUnits || row + h > heightUnits) return false;
    for (let r = row; r < row + h; r += 1) {
      for (let c = col; c < col + w; c += 1) {
        if (grid[r * widthUnits + c] !== -1) return false;
      }
    }
    return true;
  };

  const mark = (row: number, col: number, w: number, h: number, value: number): void => {
    for (let r = row; r < row + h; r += 1) {
      for (let c = col; c < col + w; c += 1) {
        grid[r * widthUnits + c] = value;
      }
    }
  };

  const step = (): boolean => {
    nodes += 1;
    if (nodes > NODE_CAP) return false;
    const idx = firstEmpty();
    if (idx < 0) return true;

    const row = Math.floor(idx / widthUnits);
    const col = idx % widthUnits;

    const ordered = candidates
      .map((candidate) => {
        const deficit =
          (targetFractions[candidate.index] ?? 0) * total - (cellsByTile[candidate.index] ?? 0);
        return { candidate, score: deficit + rng() * total * 0.25 };
      })
      .sort((a, b) => b.score - a.score);

    for (const { candidate } of ordered) {
      const { widthUnits: w, heightUnits: h, index } = candidate;
      if (!fits(row, col, w, h)) continue;

      mark(row, col, w, h, index);
      cellsByTile[index] = (cellsByTile[index] ?? 0) + w * h;
      placements.push({
        tileDefinitionId: tileIds[index] ?? '',
        xUnits: col,
        yUnits: row,
        widthUnits: w,
        heightUnits: h,
        rotated: candidate.rotated,
      });

      if (step()) return true;

      placements.pop();
      cellsByTile[index] = (cellsByTile[index] ?? 0) - w * h;
      mark(row, col, w, h, -1);
    }
    return false;
  };

  return step() ? { placements, cellsByTile } : null;
}

/**
 * Search module sizes and return the best repeat unit found, or null when the
 * formats admit no gapless module within the given bounds. Combinations whose
 * edge lengths share no useful divisor (30 cm next to 25 cm) commonly fail —
 * that is information for the designer, not an error.
 */
export function findRapportModule(options: FindRapportOptions): RapportModule | null {
  const {
    tiles,
    targets,
    maxWidth = DEFAULT_MAX_EXTENT,
    maxHeight = DEFAULT_MAX_EXTENT,
    unitResolution = DEFAULT_UNIT_RESOLUTION,
    maxModuleCells = DEFAULT_MAX_MODULE_CELLS,
    attempts = DEFAULT_ATTEMPTS,
    tolerance = DEFAULT_TOLERANCE,
    seed = 1,
  } = options;

  if (tiles.length === 0) return null;

  // A share of zero means "do not use this format", and that has to be applied
  // before anything else looks at the catalogue. `gridUnit` is a GCD over every
  // tile it is handed, so an unwanted format still sets the cell size for the
  // whole pattern — one 0.13 m tile at 0 % drags a 0.15 m unit down to 0.01 m
  // and the search collapses. Filtering here rather than penalising later is
  // what makes the sliders mean what they say.
  const requested = tiles.filter((tile) => {
    const target = targets.find((t) => t.tileDefinitionId === tile.id);
    return Math.max(target?.areaShare ?? 0, 0) > 0;
  });
  if (requested.length === 0) return null;

  const tileIds = requested.map((t) => t.id);
  const weights = tileIds.map((id) => {
    const target = targets.find((t) => t.tileDefinitionId === id);
    return Math.max(target?.areaShare ?? 0, 0);
  });
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) return null;
  const targetFractions = weights.map((w) => w / weightSum);

  const unit = gridUnit(requested, unitResolution);
  const candidates: Candidate[] = [];
  requested.forEach((tile, index) => {
    const lengthUnits = Math.round(tile.length / unit);
    const widthUnits = Math.round(tile.width / unit);
    candidates.push({ index, widthUnits: lengthUnits, heightUnits: widthUnits, rotated: false });
    if (lengthUnits !== widthUnits) {
      candidates.push({ index, widthUnits, heightUnits: lengthUnits, rotated: true });
    }
  });

  const minSide = Math.min(...candidates.map((c) => Math.min(c.widthUnits, c.heightUnits)));
  const capW = Math.min(Math.floor(maxWidth / unit), MAX_SIDE_UNITS);
  const capH = Math.min(Math.floor(maxHeight / unit), MAX_SIDE_UNITS);

  // Smallest module first: a short repeat is easier to set out on site and
  // cheaper to verify, and it lets the search return as soon as one lands
  // inside the tolerance band instead of enumerating every size.
  const sizes: Array<{ w: number; h: number }> = [];
  for (let w = minSide; w <= capW; w += 1) {
    for (let h = minSide; h <= capH; h += 1) {
      if (w * h > maxModuleCells) continue;
      sizes.push({ w, h });
    }
  }
  sizes.sort((a, b) => a.w * a.h - b.w * b.h || a.w - b.w);

  let best: RapportModule | null = null;

  for (const { w, h } of sizes) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const rng = mulberry32(seed + w * 7919 + h * 104_729 + attempt * 31);
      const filled = fillModule(w, h, candidates, tileIds, targetFractions, rng);

      // A size that cannot be filled at all fails structurally, not by luck —
      // retrying it with another seed only burns the node budget.
      if (!filled) break;

      const total = w * h;
      const missingRequested = targetFractions.some(
        (fraction, i) => fraction > 0.001 && (filled.cellsByTile[i] ?? 0) === 0,
      );
      if (missingRequested) continue;

      const achievedShares: Record<string, number> = {};
      let deviation = 0;
      tileIds.forEach((id, i) => {
        const share = (filled.cellsByTile[i] ?? 0) / total;
        achievedShares[id] = share;
        deviation += Math.abs(share - (targetFractions[i] ?? 0)) * 100;
      });

      if (!best || deviation < best.deviation) {
        best = {
          unit,
          widthUnits: w,
          heightUnits: h,
          width: w * unit,
          height: h * unit,
          placements: filled.placements,
          achievedShares,
          deviation,
        };
      }

      if (best.deviation <= tolerance) return best;
    }
  }

  return best;
}

/**
 * Mirror the module into a larger repeat unit. Mirroring preserves area shares
 * exactly and only lengthens the visual period — the book-match seen in
 * Versailles and opus layouts.
 */
export function mirrorRapport(
  module: RapportModule,
  axes: { x?: boolean; y?: boolean },
): RapportModule {
  const nx = axes.x ? 2 : 1;
  const ny = axes.y ? 2 : 1;
  if (nx === 1 && ny === 1) return module;

  const placements: RapportPlacement[] = [];
  for (let by = 0; by < ny; by += 1) {
    for (let bx = 0; bx < nx; bx += 1) {
      const flipX = bx === 1;
      const flipY = by === 1;
      for (const p of module.placements) {
        const localX = flipX ? module.widthUnits - p.xUnits - p.widthUnits : p.xUnits;
        const localY = flipY ? module.heightUnits - p.yUnits - p.heightUnits : p.yUnits;
        placements.push({
          ...p,
          xUnits: bx * module.widthUnits + localX,
          yUnits: by * module.heightUnits + localY,
        });
      }
    }
  }

  const widthUnits = module.widthUnits * nx;
  const heightUnits = module.heightUnits * ny;
  return {
    ...module,
    widthUnits,
    heightUnits,
    width: widthUnits * module.unit,
    height: heightUnits * module.unit,
    placements,
  };
}

/**
 * Offset between successive repeats, snapped to the grid so joints keep
 * meeting. `fraction` is relative to the module edge; 0.5 gives a running bond
 * at module scale, thirds break the module edge up more convincingly.
 */
export function rapportOffsetMat3(
  module: RapportModule,
  axis: 'x' | 'y',
  fraction: number,
): Mat3Json {
  if (axis === 'x') {
    const steps = Math.round(fraction * module.widthUnits);
    return translationMat3(steps * module.unit, module.height);
  }
  const steps = Math.round(fraction * module.heightUnits);
  return translationMat3(module.width, steps * module.unit);
}

/**
 * Pose of one rapport placement in module-local space.
 *
 * A rotated placement has to carry its rotation in the matrix. Every consumer —
 * the solver's footprint test, both SVG renderers, the 3D scene — reads
 * `length` and `width` from the tile definition and applies the matrix, so a
 * rotation recorded only as a `role` string draws and packs at the wrong
 * orientation. `p.widthUnits` is the rotated footprint's width, which is the
 * tile's own `width`, so the tile definitions are not needed here.
 */
function placementMat3(module: RapportModule, p: RapportPlacement): Mat3Json {
  const origin = translationMat3(p.xUnits * module.unit, p.yUnits * module.unit);
  if (!p.rotated) return origin;

  // Rotate a quarter turn about the tile origin, then push it back into the
  // positive quadrant so the footprint lands on (0,0)–(width, length).
  const upright = multiplyMat3(
    translationMat3(p.widthUnits * module.unit, 0),
    rotationMat3(Math.PI / 2),
  );
  return multiplyMat3(origin, upright);
}

/** Wrap a solved module as a DesignModule the existing solver can expand. */
export function rapportToDesignModule(
  module: RapportModule,
  options?: { id?: string; name?: string; repeat?: { count: number; offsetMat3: Mat3Json } },
): DesignModuleJson {
  const placements: ModulePlacementJson[] = module.placements.map((p) => ({
    id: crypto.randomUUID(),
    tileDefinitionId: p.tileDefinitionId,
    localMat3: placementMat3(module, p),
    role: p.rotated ? 'rotated' : undefined,
  }));

  return {
    type: 'DesignModule',
    id: options?.id ?? crypto.randomUUID(),
    name: options?.name ?? 'Rapport',
    placements,
    anchor: 'origin',
    repeat: options?.repeat,
  };
}

/**
 * Turn a solved module into a tile grid — the level-0 half of a tile schema.
 *
 * The rapport search already produces exactly what a fundamental domain is: a
 * gapless, overlap-free block of unit cells with one tile occurrence per region.
 * The only translation needed is from metres back to the integer cell counts the
 * lattice works in.
 */
export function rapportToTileGrid(
  module: RapportModule,
  options?: { id?: string; name?: string; joint?: number; fallbackTileDefinitionId?: string },
): TileGridJson {
  const instances: TileGridInstanceJson[] = module.placements.map((p) => ({
    id: crypto.randomUUID(),
    tileDefinitionId: p.tileDefinitionId,
    i: p.xUnits,
    j: p.yUnits,
    iSpan: p.widthUnits,
    jSpan: p.heightUnits,
    rotated: p.rotated,
  }));

  // The fallback is whatever format occupies a single cell — that is the tile a
  // clipped larger format breaks down into. Falling back to the smallest
  // occurrence keeps the schema usable even when no format is exactly unit-sized.
  const unit = instances.find((i) => i.iSpan === 1 && i.jSpan === 1);
  const smallest = [...instances].sort((a, b) => a.iSpan * a.jSpan - b.iSpan * b.jSpan)[0];
  const fallbackTileDefinitionId =
    options?.fallbackTileDefinitionId ??
    unit?.tileDefinitionId ??
    smallest?.tileDefinitionId ??
    '';

  return createTileGrid({
    id: options?.id,
    name: options?.name ?? 'Rapport grid',
    cell: { x: module.unit, y: module.unit },
    joint: options?.joint ?? 0,
    extent: { iCount: module.widthUnits, jCount: module.heightUnits },
    instances,
    fallbackTileDefinitionId,
  });
}

/**
 * A complete tile schema from a solved module: the rapport as the tile grid, and
 * a rectangular master grid stepping by the module's own extent. Mirroring set
 * here doubles the repeat along that axis, matching {@link mirrorRapport}.
 */
export function rapportToTileSchema(
  module: RapportModule,
  options?: {
    id?: string;
    name?: string;
    joint?: number;
    fallbackTileDefinitionId?: string;
    mirror?: MasterGridJson['mirror'];
    frame?: TileSchemaJson['frame'];
  },
): TileSchemaJson {
  const tileGrid = rapportToTileGrid(module, {
    joint: options?.joint,
    fallbackTileDefinitionId: options?.fallbackTileDefinitionId,
  });
  const masterGrid = createMasterGrid({
    name: 'Rapport master',
    childId: tileGrid.id,
    u: { i: module.widthUnits, j: 0 },
    v: { i: 0, j: module.heightUnits },
    mirror: options?.mirror,
  });

  return createTileSchema({
    id: options?.id,
    name: options?.name ?? 'Rapport',
    tileGrids: [tileGrid],
    masterGrids: [masterGrid],
    rootMasterGridId: masterGrid.id,
    frame: options?.frame,
  });
}

/**
 * Tiles needed per format to cover an area with this module, ignoring cuts.
 * Useful for checking a rapport against a sampled stock before committing.
 */
export function rapportTileDemand(
  module: RapportModule,
  area: { width: number; height: number },
): Record<string, number> {
  const repeatsX = Math.ceil(area.width / module.width);
  const repeatsY = Math.ceil(area.height / module.height);
  const repeats = repeatsX * repeatsY;

  const demand: Record<string, number> = {};
  for (const p of module.placements) {
    demand[p.tileDefinitionId] = (demand[p.tileDefinitionId] ?? 0) + repeats;
  }
  return demand;
}
