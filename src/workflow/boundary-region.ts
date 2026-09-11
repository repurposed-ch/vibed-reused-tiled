import type { BoundaryConditionsJson } from '@/domain/boundaries';
import { Epsilon } from '@/math/core/epsilon';
import { Vec2 } from '@/math/core/vec2';
import { Polygon2 } from '@/math/geometry/regions/polygon2';
import { Boolean2 } from '@/math/operations/boolean2';

/**
 * The area that actually gets tiled: the union of the outer contours, less the
 * union of the holes.
 *
 * Before this existed there were three different answers. The fill tested points
 * with an even-odd rule over every loop at once, so overlapping outers cancelled
 * in their overlap and a hole drawn outside the outline became a tiled island.
 * The preview faked holes by painting them in the background colour. What you
 * drew was a third thing again. Everything now derives from this one region.
 *
 * Orientation is each loop's role — counter-clockwise solid, clockwise hole —
 * and the editor keeps `outers` and `holes` in step with it. The region is the
 * union of the solids less the union of the holes, deliberately not a plain
 * winding sum over every loop: a sum reads two overlapping holes as −2, which is
 * non-zero, and would make their overlap solid again.
 *
 * Holes in the result are encoded by winding, the way `Boolean2` returns them,
 * so containment is a non-zero winding test — not even-odd, which is the rule
 * this replaces.
 */

export type BoundaryRegion = {
  /** Computed loops; clockwise loops are holes. */
  polygons: Polygon2[];
  contains(point: Vec2): boolean;
  /** Net area in square metres. */
  area: number;
  empty: boolean;
  /** Set when the boolean could not be computed, so callers can say why. */
  problem?: string;
};

type Point = { x: number; y: number };

/** Vertex loops for the two shapes the app draws; anything else is skipped. */
function loopsOf(geometries: BoundaryConditionsJson['outers'], orientation: 'ccw' | 'cw'): Polygon2[] {
  const polygons: Polygon2[] = [];
  for (const geometry of geometries) {
    const g = geometry as { type?: string; vertices?: unknown; min?: Point; max?: Point };
    let points: Point[] = [];
    if (g.type === 'Polygon2' && Array.isArray(g.vertices)) {
      points = (g.vertices as Point[]).filter(
        (v) => typeof v?.x === 'number' && typeof v?.y === 'number',
      );
    } else if (g.type === 'Aabb2' && g.min && g.max) {
      points = [
        { x: g.min.x, y: g.min.y },
        { x: g.max.x, y: g.min.y },
        { x: g.max.x, y: g.max.y },
        { x: g.min.x, y: g.max.y },
      ];
    }
    // Polygon2 refuses fewer than three vertices; a loop mid-draw is not a region.
    if (points.length < 3) continue;
    // Orient by list: outers counter-clockwise, holes clockwise. The union sums
    // winding, so without this an outer traced clockwise cancels an overlapping
    // counter-clockwise one and their overlap goes untiled. The list, not the
    // stored winding, is also what a project saved before orientation became the
    // role meant — so it is the list that decides here.
    const vectors = points.map((p) => new Vec2(p.x, p.y));
    const isCcw = Polygon2.signedArea(vectors) >= 0;
    polygons.push(new Polygon2(isCcw === (orientation === 'ccw') ? vectors : vectors.reverse()));
  }
  return polygons;
}

function netArea(polygons: readonly Polygon2[]): number {
  return Math.abs(polygons.reduce((sum, p) => sum + Polygon2.signedArea(p.vertices), 0));
}

function regionFrom(polygons: Polygon2[], problem?: string): BoundaryRegion {
  const slack = Math.abs(Epsilon.preferIn.value);
  return {
    polygons,
    area: netArea(polygons),
    empty: polygons.length === 0,
    problem,
    contains(point: Vec2): boolean {
      // A point on the edge counts as inside, matching the closed-region rule the
      // fill's containment test was written against: a cell flush with the
      // boundary is a whole cell, not a cut one.
      if (polygons.some((p) => p.distanceToPoint(point) <= slack)) return true;
      return polygons.reduce((sum, p) => sum + p.windingNumber(point), 0) !== 0;
    },
  };
}

/**
 * One-entry memo. The draw canvas writes on every pointer move while a vertex is
 * dragged, and the boolean runs a triangulation each time — so it is only redone
 * when the geometry itself has changed, not on every render.
 */
let cache: { key: string; region: BoundaryRegion } | null = null;

export function resolveBoundaryRegion(boundaries: BoundaryConditionsJson): BoundaryRegion {
  const key = JSON.stringify([boundaries.outers, boundaries.holes]);
  if (cache?.key === key) return cache.region;

  const outers = loopsOf(boundaries.outers, 'ccw');
  const holes = loopsOf(boundaries.holes, 'cw');

  let region: BoundaryRegion;
  if (outers.length === 0) {
    region = regionFrom([]);
  } else {
    try {
      const merged = Boolean2.union(outers).polygons;
      const polygons = holes.length > 0 ? Boolean2.subtract(merged, holes).polygons : merged;
      region = regionFrom(polygons);
    } catch (error) {
      // Fall back to the outers rather than to nothing: an empty region would
      // silently tile nothing, which is a worse failure than ignoring the holes.
      region = regionFrom(
        outers,
        `Could not combine the boundary shapes (${error instanceof Error ? error.message : 'unknown error'}); holes are being ignored.`,
      );
    }
  }

  cache = { key, region };
  return region;
}
