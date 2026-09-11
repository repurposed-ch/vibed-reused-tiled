import { describe, expect, it } from 'vitest';
import type { BoundaryConditionsJson } from '@/domain/boundaries';
import { Vec2 } from '@/math/core/vec2';
import { resolveBoundaryRegion } from '@/workflow/boundary-region';

type Pt = [number, number];

/** A loop in exactly the vertex order given — so tests control tracing direction. */
function loop(points: Pt[]) {
  return { type: 'Polygon2', vertices: points.map(([x, y]) => ({ type: 'Vec2', x, y })) };
}

const ccw = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const cw = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x0, y1], [x1, y1], [x1, y0]];

function boundaries(outers: Pt[][], holes: Pt[][] = []): BoundaryConditionsJson {
  return { type: 'BoundaryConditions', outers: outers.map(loop), holes: holes.map(loop), guides: [] };
}

describe('resolveBoundaryRegion orientation', () => {
  it('covers the overlap of two solids traced in opposite directions', () => {
    // Summed winding gives +1 − 1 = 0 in the overlap, which dropped it. Every
    // earlier test built its rectangles counter-clockwise, so none saw this.
    const region = resolveBoundaryRegion(boundaries([ccw(0, 0, 2, 2), cw(1, 1, 3, 3)]));
    expect(region.area).toBeCloseTo(4 + 4 - 1, 6);
    expect(region.contains(new Vec2(1.5, 1.5))).toBe(true);
  });

  it('reads a clockwise loop stored as an outer as solid', () => {
    // Keeps projects saved before orientation became the role: an outline traced
    // clockwise sits in `outers`, and must not flip into a hole.
    const region = resolveBoundaryRegion(boundaries([cw(0, 0, 2, 2)]));
    expect(region.area).toBeCloseTo(4, 6);
    expect(region.contains(new Vec2(1, 1))).toBe(true);
  });

  it('keeps two overlapping holes empty where they overlap', () => {
    // A plain winding sum reads −2 there, which is non-zero, and turns it solid.
    const region = resolveBoundaryRegion(
      boundaries([ccw(0, 0, 4, 4)], [cw(1, 1, 3, 3), cw(2, 2, 3.5, 3.5)]),
    );
    expect(region.contains(new Vec2(2.5, 2.5))).toBe(false);
    // 16 − (4 + 2.25 − 1)
    expect(region.area).toBeCloseTo(16 - 5.25, 6);
  });

  it('is unaffected by the direction a hole was traced', () => {
    const asCw = resolveBoundaryRegion(boundaries([ccw(0, 0, 4, 3)], [cw(1, 1, 3, 2)]));
    const asCcw = resolveBoundaryRegion(boundaries([ccw(0, 0, 4, 3)], [ccw(1, 1, 3, 2)]));
    expect(asCw.area).toBeCloseTo(10, 6);
    expect(asCcw.area).toBeCloseTo(10, 6);
  });
});
