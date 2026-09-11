import { describe, expect, it } from 'vitest';
import { Vec2 } from '../core/vec2';
import { Polygon2 } from '../geometry/regions/polygon2';
import { Boolean2 } from './boolean2';

/**
 * Characterisation of `Boolean2` on the shapes the boundary editor produces.
 *
 * `Boolean2` had no callers and no tests before the boundary region started
 * depending on it, and its crossing finder discards collinear overlaps. The
 * editor snaps every vertex to a grid, so shared and collinear edges are the
 * normal case here, not an edge case — these tests exist to find out whether the
 * kernel holds up on exactly that before tile positions are built on it.
 *
 * Results are checked by sampling points rather than comparing vertex lists: the
 * triangulation adds Steiner points along edges, so an exact loop comparison
 * would fail on correct output.
 */

function rect(x0: number, y0: number, x1: number, y1: number): Polygon2 {
  return new Polygon2([new Vec2(x0, y0), new Vec2(x1, y0), new Vec2(x1, y1), new Vec2(x0, y1)]);
}

/** Non-zero winding over the result loops — how `Boolean2` encodes holes. */
function insideResult(polygons: readonly Polygon2[], point: Vec2): boolean {
  return polygons.reduce((sum, p) => sum + p.windingNumber(point), 0) !== 0;
}

/** The specification: inside some outer, and inside no hole. */
function insideSpec(outers: readonly Polygon2[], holes: readonly Polygon2[], point: Vec2): boolean {
  return outers.some((o) => o.containsPoint(point)) && !holes.some((h) => h.containsPoint(point));
}

function totalArea(polygons: readonly Polygon2[]): number {
  return Math.abs(polygons.reduce((sum, p) => sum + Polygon2.signedArea(p.vertices), 0));
}

/**
 * Sample a grid of points offset from any integer or half-integer coordinate, so
 * no sample lands on an edge — on an edge both answers are legitimately either.
 */
function samples(x0: number, y0: number, x1: number, y1: number, step = 0.25): Vec2[] {
  const out: Vec2[] = [];
  for (let x = x0 + step * 0.37; x < x1; x += step) {
    for (let y = y0 + step * 0.41; y < y1; y += step) out.push(new Vec2(x, y));
  }
  return out;
}

function expectAgrees(
  result: readonly Polygon2[],
  outers: readonly Polygon2[],
  holes: readonly Polygon2[],
  window: [number, number, number, number],
) {
  const wrong = samples(...window).filter(
    (p) => insideResult(result, p) !== insideSpec(outers, holes, p),
  );
  expect(wrong.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)).toEqual([]);
}

describe('Boolean2.union', () => {
  it('keeps two disjoint rectangles', () => {
    const outers = [rect(0, 0, 1, 1), rect(3, 0, 4, 1)];
    const { polygons } = Boolean2.union(outers);
    expectAgrees(polygons, outers, [], [-1, -1, 5, 2]);
    expect(totalArea(polygons)).toBeCloseTo(2, 6);
  });

  it('covers the overlap of two overlapping rectangles', () => {
    // Even-odd gets this backwards: two crossings in the overlap read as outside.
    const outers = [rect(0, 0, 2, 2), rect(1, 1, 3, 3)];
    const { polygons } = Boolean2.union(outers);
    expectAgrees(polygons, outers, [], [-1, -1, 4, 4]);
    expect(totalArea(polygons)).toBeCloseTo(7, 6);
  });

  it('merges two grid-snapped rectangles that share an edge exactly', () => {
    // The collinear case the crossing finder discards — and the normal case for a
    // grid-snapped editor.
    const outers = [rect(0, 0, 2, 1), rect(2, 0, 4, 1)];
    const { polygons } = Boolean2.union(outers);
    expectAgrees(polygons, outers, [], [-1, -1, 5, 2]);
    expect(totalArea(polygons)).toBeCloseTo(4, 6);
  });

  it('merges rectangles that share part of an edge', () => {
    const outers = [rect(0, 0, 4, 1), rect(1, 1, 3, 3)];
    const { polygons } = Boolean2.union(outers);
    expectAgrees(polygons, outers, [], [-1, -1, 5, 4]);
    expect(totalArea(polygons)).toBeCloseTo(8, 6);
  });

  it('builds an L from two overlapping rectangles', () => {
    const outers = [rect(0, 0, 4, 1.5), rect(0, 0, 2, 3)];
    const { polygons } = Boolean2.union(outers);
    expectAgrees(polygons, outers, [], [-1, -1, 5, 4]);
    // 4×1.5 plus 2×3, less the 2×1.5 they share.
    expect(totalArea(polygons)).toBeCloseTo(6 + 6 - 3, 6);
  });
});

describe('Boolean2.subtract', () => {
  it('empties a hole strictly inside the outer', () => {
    const outers = [rect(0, 0, 4, 3)];
    const holes = [rect(1, 1, 3, 2)];
    const { polygons } = Boolean2.subtract(outers, holes);
    expectAgrees(polygons, outers, holes, [-1, -1, 5, 4]);
    expect(totalArea(polygons)).toBeCloseTo(12 - 2, 6);
  });

  it('cuts a clean notch when the hole shares an edge with the outer', () => {
    // Collinear again: the hole's bottom edge lies on the outer's bottom edge.
    const outers = [rect(0, 0, 4, 3)];
    const holes = [rect(1, 0, 3, 1)];
    const { polygons } = Boolean2.subtract(outers, holes);
    expectAgrees(polygons, outers, holes, [-1, -1, 5, 4]);
    expect(totalArea(polygons)).toBeCloseTo(12 - 2, 6);
  });

  it('changes nothing when the hole lies outside the outer', () => {
    // Even-odd turns this into a tiled island.
    const outers = [rect(0, 0, 4, 3)];
    const holes = [rect(6, 0, 8, 2)];
    const { polygons } = Boolean2.subtract(outers, holes);
    expectAgrees(polygons, outers, holes, [-1, -1, 9, 4]);
    expect(totalArea(polygons)).toBeCloseTo(12, 6);
  });

  it('leaves nothing when the hole covers the outer', () => {
    const outers = [rect(0, 0, 4, 3)];
    const holes = [rect(0, 0, 4, 3)];
    const { polygons } = Boolean2.subtract(outers, holes);
    expect(totalArea(polygons)).toBeCloseTo(0, 6);
    expectAgrees(polygons, outers, holes, [-1, -1, 5, 4]);
  });

  it('subtracts from a union of overlapping outers', () => {
    const outers = [rect(0, 0, 2, 2), rect(1, 1, 3, 3)];
    const holes = [rect(1.25, 1.25, 1.75, 1.75)];
    const merged = Boolean2.union(outers).polygons;
    const { polygons } = Boolean2.subtract(merged, holes);
    expectAgrees(polygons, outers, holes, [-1, -1, 4, 4]);
    expect(totalArea(polygons)).toBeCloseTo(7 - 0.25, 6);
  });
});
