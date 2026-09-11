import type { BoundaryConditionsJson } from '@/domain/boundaries';
import type { PlacementJson } from '@/domain/instance';
import {
  multiplyMat3,
  rotationMat3,
  scaleMat3,
  translationMat3,
  type Mat3Json,
} from '@/domain/mat3';
import type { TileDefinitionJson } from '@/domain/tile';
import { spanFor, toFrame2, type IntVec2, type TileSchemaJson } from '@/domain/tile-grid';
import { Epsilon } from '@/math/core/epsilon';
import { Vec2 } from '@/math/core/vec2';
import { Polygon2 } from '@/math/geometry/regions/polygon2';
import { resolveBoundaryRegion } from './boundary-region';
import { resolveCell, resolveSchema, type Mirror, type ResolvedSchema } from './tile-grid-lattice';
import type { SampledStock } from './sample-stock';

/**
 * Fill a boundary with a tile schema.
 *
 * The polygon is overlaid with the base cell grid, each cell is mapped back
 * through the master lattice to the tile occurrence that owns it, and occurrences
 * are then emitted whole or broken down:
 *
 * - a unit tile is placed whenever its cell touches the polygon at all, so cut
 *   tiles overrun the edge rather than leaving a gap;
 * - a larger format is placed only when every one of its cells sits fully inside
 *   the polygon. Otherwise it is dropped and its touched cells are filled with the
 *   schema's fallback unit tile.
 *
 * The polygon is always filled completely. Stock is honoured where it can be —
 * a format that runs out degrades to unit tiles by the same path as a clipped one
 * — but the fill never leaves a hole to stay within stock; it reports the
 * overdraw instead.
 */

/** Grid-local space: cells are axis-aligned there whatever pose the frame carries. */
type LocalLoop = { x: number; y: number }[];

type Rect = { minX: number; minY: number; maxX: number; maxY: number };

export type TileGridFillStats = {
  cells: number;
  wholeTiles: number;
  fallbackTiles: number;
  cutTiles: number;
  /** Cells left bare because the schema offers no unit-sized format to break down to. */
  unfilled: number;
  /** Set when the declared fallback was not unit-sized and another format stood in. */
  fallbackSubstitutedFor?: string;
  /** Tiles placed beyond the sampled stock, per tile definition. */
  shortfall: Record<string, number>;
};

export type TileGridFillResult = {
  placements: PlacementJson[];
  /** Position matrices per tile type. */
  byTile: Record<string, Mat3Json[]>;
  stats: TileGridFillStats;
};

export type TileGridFillInput = {
  schema: TileSchemaJson;
  tiles: TileDefinitionJson[];
  boundaries: BoundaryConditionsJson;
  sampledStock?: SampledStock[];
};

/** Liang–Barsky: does the segment touch the rectangle at all? */
function segmentIntersectsRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rect: Rect,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;

  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  return (
    clip(-dx, ax - rect.minX) &&
    clip(dx, rect.maxX - ax) &&
    clip(-dy, ay - rect.minY) &&
    clip(dy, rect.maxY - ay)
  );
}

function anyEdgeCrosses(loops: readonly LocalLoop[], rect: Rect): boolean {
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      if (segmentIntersectsRect(a.x, a.y, b.x, b.y, rect)) return true;
    }
  }
  return false;
}

/**
 * Orientation of one tile inside its cell block: rotation first, then any mirror,
 * both about the tile's own footprint so the tile stays put and only its geometry
 * flips. Mirroring is baked into the matrix rather than normalised away, because
 * a tile's rhythm edges are directional.
 */
function orientationMat3(tile: TileDefinitionJson, rotated: boolean, flip: Mirror): Mat3Json {
  const orient = rotated
    ? multiplyMat3(translationMat3(tile.width, 0), rotationMat3(Math.PI / 2))
    : null;

  const width = rotated ? tile.width : tile.length;
  const height = rotated ? tile.length : tile.width;

  const mirror =
    flip.x || flip.y
      ? multiplyMat3(
          translationMat3(flip.x ? width : 0, flip.y ? height : 0),
          scaleMat3(flip.x ? -1 : 1, flip.y ? -1 : 1),
        )
      : null;

  if (mirror && orient) return multiplyMat3(mirror, orient);
  return mirror ?? orient ?? translationMat3(0, 0);
}

export function fillPolygonWithTileSchema(input: TileGridFillInput): TileGridFillResult {
  const resolved: ResolvedSchema = resolveSchema(input.schema);
  const tileGrid = resolved.tileGrid;
  const tiles = new Map(input.tiles.map((t) => [t.id, t]));
  const frame = toFrame2(input.schema.frame);

  // The union of the outers less the holes, computed once and shared with the
  // preview. The previous test was even-odd over every loop together, so two
  // overlapping outers cancelled in their overlap and a hole drawn outside the
  // outline became a tiled island.
  const region = resolveBoundaryRegion(input.boundaries);
  if (region.empty) {
    return {
      placements: [],
      byTile: {},
      stats: { cells: 0, wholeTiles: 0, fallbackTiles: 0, cutTiles: 0, unfilled: 0, shortfall: {} },
    };
  }

  // Everything downstream works in grid-local space, where cells are axis-aligned
  // regardless of how the frame rotates or mirrors the setting-out.
  const localLoops: LocalLoop[] = region.polygons.map((polygon) =>
    polygon.vertices.map((v) => {
      const local = frame.toLocal(v);
      return { x: local.x, y: local.y };
    }),
  );
  const localPolygons = localLoops.map(
    (loop) => new Polygon2(loop.map((v) => new Vec2(v.x, v.y))),
  );

  const { x: cellX, y: cellY } = tileGrid.cell;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const loop of localLoops) {
    for (const v of loop) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }
  }

  const i0 = Math.floor(minX / cellX);
  const i1 = Math.ceil(maxX / cellX);
  const j0 = Math.floor(minY / cellY);
  const j1 = Math.ceil(maxY / cellY);

  // Non-zero winding over the region's loops: the boolean returns holes as
  // clockwise loops, so their winding cancels the surrounding outer. A point on
  // an edge counts as inside, so a cell flush with the boundary is a whole cell.
  // A mirrored frame flips every loop's orientation together, which negates the
  // sum but leaves the non-zero test intact.
  const edgeSlack = Math.abs(Epsilon.preferIn.value);
  const inside = (x: number, y: number): boolean => {
    const point = new Vec2(x, y);
    if (localPolygons.some((p) => p.distanceToPoint(point) <= edgeSlack)) return true;
    return localPolygons.reduce((sum, p) => sum + p.windingNumber(point), 0) !== 0;
  };

  /**
   * Shrink used to sample a cell's open interior rather than its closed rect.
   * It has to clear `Epsilon.value`: `inside` reports anything within that
   * distance of an edge as lying on the boundary, and therefore inside, so a
   * smaller nudge would not escape the boundary band at all.
   */
  const nudge = Math.max(Math.min(cellX, cellY) * 1e-3, Epsilon.value * 10);

  type Occurrence = {
    tileDefinitionId: string;
    rotated: boolean;
    flip: Mirror;
    originCell: IntVec2;
    iSpan: number;
    jSpan: number;
    /** Cells of this occurrence that touch the polygon. */
    touched: IntVec2[];
    containedCount: number;
  };

  const occurrences = new Map<string, Occurrence>();
  let cellCount = 0;

  for (let i = i0; i <= i1; i += 1) {
    for (let j = j0; j <= j1; j += 1) {
      const rect: Rect = {
        minX: i * cellX,
        minY: j * cellY,
        maxX: (i + 1) * cellX,
        maxY: (j + 1) * cellY,
      };

      // Both predicates are about area, not about points, so they are evaluated
      // against the cell's open interior. Sampling the closed cell instead would
      // treat a cell merely sharing an edge with the boundary as overlapping —
      // point-in-polygon counts boundary points as inside — and would spill a
      // spurious ring of tiles around every flush edge.
      const interior: Rect = {
        minX: rect.minX + nudge,
        minY: rect.minY + nudge,
        maxX: rect.maxX - nudge,
        maxY: rect.maxY - nudge,
      };

      const centreInside = inside((rect.minX + rect.maxX) / 2, (rect.minY + rect.maxY) / 2);
      const interiorCorners: Array<[number, number]> = [
        [interior.minX, interior.minY],
        [interior.maxX, interior.minY],
        [interior.maxX, interior.maxY],
        [interior.minX, interior.maxY],
      ];
      const crossesInterior = anyEdgeCrosses(localLoops, interior);

      const overlaps =
        centreInside || interiorCorners.some(([x, y]) => inside(x, y)) || crossesInterior;
      if (!overlaps) continue;

      // Contained means the whole closed cell is inside: every real corner in — a
      // corner sitting exactly on the boundary still counts — and no boundary
      // running through the interior.
      const contained =
        !crossesInterior &&
        centreInside &&
        inside(rect.minX, rect.minY) &&
        inside(rect.maxX, rect.minY) &&
        inside(rect.maxX, rect.maxY) &&
        inside(rect.minX, rect.maxY);

      const hit = resolveCell(resolved, { i, j });
      if (!hit) continue;

      cellCount += 1;
      const existing = occurrences.get(hit.occurrenceKey);
      if (existing) {
        existing.touched.push({ i, j });
        if (contained) existing.containedCount += 1;
        continue;
      }
      occurrences.set(hit.occurrenceKey, {
        tileDefinitionId: hit.resolved.instance.tileDefinitionId,
        rotated: hit.resolved.instance.rotated,
        flip: hit.resolved.flip,
        originCell: hit.originCell,
        iSpan: hit.resolved.iSpan,
        jSpan: hit.resolved.jSpan,
        touched: [{ i, j }],
        containedCount: contained ? 1 : 0,
      });
    }
  }

  const frameMat3 = (() => {
    const m = frame.toMat3().elements;
    // src/math Mat3 stores column-major, same convention as Mat3Json.
    return { type: 'Mat3' as const, elements: [...m] as Mat3Json['elements'] };
  })();

  const placements: PlacementJson[] = [];
  const byTile: Record<string, Mat3Json[]> = {};
  const used = new Map<string, number>();
  const stock = new Map((input.sampledStock ?? []).map((s) => [s.tileDefinitionId, s.count]));
  const hasStock = input.sampledStock != null && input.sampledStock.length > 0;

  const remaining = (tileId: string): number => {
    if (!hasStock) return Infinity;
    return (stock.get(tileId) ?? 0) - (used.get(tileId) ?? 0);
  };

  /**
   * Place a tile centred in the cells it claims.
   *
   * A cell is the tile plus its joint, so a tile anchored at the cell corner
   * would push its whole joint onto one side and leave none at the pattern edge.
   * Centring splits it, which puts half a joint against the boundary and a full
   * joint between neighbours. Joints only line up across the pattern when every
   * format shares one cell size — where they do not, they still read as joints,
   * which is the normal outcome with mixed reclaimed formats.
   */
  const emit = (
    tileId: string,
    cell: IntVec2,
    rotated: boolean,
    flip: Mirror,
    span: { iSpan: number; jSpan: number },
    moduleId?: string,
  ): boolean => {
    const tile = tiles.get(tileId);
    if (!tile) return false;

    const drawnWidth = rotated ? tile.width : tile.length;
    const drawnHeight = rotated ? tile.length : tile.width;
    const insetX = (span.iSpan * cellX - drawnWidth) / 2;
    const insetY = (span.jSpan * cellY - drawnHeight) / 2;

    const mat3 = multiplyMat3(
      frameMat3,
      multiplyMat3(
        translationMat3(cell.i * cellX + insetX, cell.j * cellY + insetY),
        orientationMat3(tile, rotated, flip),
      ),
    );
    placements.push({ id: crypto.randomUUID(), tileDefinitionId: tileId, mat3, moduleId });
    (byTile[tileId] ??= []).push(mat3);
    used.set(tileId, (used.get(tileId) ?? 0) + 1);
    return true;
  };

  /**
   * Breaking a clipped format down means putting one tile on each of its cells,
   * so the fallback has to be a format that covers exactly one cell. A larger
   * one would be drawn at its real size on a single cell and overlap every
   * neighbour — the schema cannot express that constraint, so it is enforced
   * here rather than trusted.
   */
  const coversOneCell = (tile: TileDefinitionJson): boolean => {
    const span = spanFor(tile, tileGrid.cell, tileGrid.joint, false);
    return span?.iSpan === 1 && span.jSpan === 1;
  };

  const declaredFallback = tiles.get(tileGrid.fallbackTileDefinitionId);
  let fallbackId: string | null = null;
  let fallbackSubstitutedFor: string | undefined;

  if (declaredFallback && coversOneCell(declaredFallback)) {
    fallbackId = declaredFallback.id;
  } else {
    // Stand in with a unit-sized format the pattern already uses, so a boundary
    // still gets filled instead of being covered in overlapping tiles.
    const used = [...new Set(tileGrid.instances.map((i) => i.tileDefinitionId))];
    const substitute = used
      .map((id) => tiles.get(id))
      .find((tile): tile is TileDefinitionJson => tile != null && coversOneCell(tile));
    fallbackId = substitute?.id ?? null;
    if (declaredFallback) fallbackSubstitutedFor = declaredFallback.id;
  }

  let wholeTiles = 0;
  let fallbackTiles = 0;
  let cutTiles = 0;
  let unfilled = 0;

  for (const [key, occurrence] of occurrences) {
    const area = occurrence.iSpan * occurrence.jSpan;

    if (area === 1) {
      // A unit tile is placed wherever its cell touches the polygon; the ones the
      // boundary crosses are the cut tiles.
      if (
        emit(
          occurrence.tileDefinitionId,
          occurrence.touched[0]!,
          occurrence.rotated,
          occurrence.flip,
          { iSpan: 1, jSpan: 1 },
          key,
        )
      ) {
        if (occurrence.containedCount === 0) cutTiles += 1;
        else wholeTiles += 1;
      }
      continue;
    }

    const complete = occurrence.touched.length === area && occurrence.containedCount === area;
    const inStock = remaining(occurrence.tileDefinitionId) >= 1;

    if (complete && inStock) {
      if (
        emit(
          occurrence.tileDefinitionId,
          occurrence.originCell,
          occurrence.rotated,
          occurrence.flip,
          { iSpan: occurrence.iSpan, jSpan: occurrence.jSpan },
          key,
        )
      ) {
        wholeTiles += 1;
        continue;
      }
    }

    // Clipped, or out of stock: the polygon still has to be filled, so every
    // touched cell of this occurrence takes a unit tile instead.
    if (!fallbackId) {
      unfilled += occurrence.touched.length;
      continue;
    }
    for (const cell of occurrence.touched) {
      if (emit(fallbackId, cell, false, { x: false, y: false }, { iSpan: 1, jSpan: 1 }, key))
        fallbackTiles += 1;
    }
  }

  const shortfall: Record<string, number> = {};
  if (hasStock) {
    for (const [tileId, count] of used) {
      const over = count - (stock.get(tileId) ?? 0);
      if (over > 0) shortfall[tileId] = over;
    }
  }

  return {
    placements,
    byTile,
    stats: {
      cells: cellCount,
      wholeTiles,
      fallbackTiles,
      cutTiles,
      unfilled,
      ...(fallbackSubstitutedFor ? { fallbackSubstitutedFor } : {}),
      shortfall,
    },
  };
}
