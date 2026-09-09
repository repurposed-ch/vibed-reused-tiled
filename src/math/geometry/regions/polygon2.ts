import type { Mat3 } from '../../core/mat3';
import { Aabb2 } from '../../bounds/aabb2';
import { Epsilon } from '../../core/epsilon';
import { Vec2, type Vec2Json } from '../../core/vec2';
import { segmentsFromVertices } from '../curves/segments';
import { Line2 } from '../primitives/line2';

/** Closed polygon: consecutive vertex pairs plus a segment from last to first. */
export class Polygon2 {
  static readonly type = 'Polygon2' as const;

  readonly vertices: readonly Vec2[];

  constructor(vertices: Vec2[]) {
    if (vertices.length < 3) {
      throw new Error('Polygon2 requires at least three vertices');
    }

    this.vertices = vertices.map((v) => v.clone());
  }

  /** Number of boundary segments (`vertices.length`). Parameter domain is `[0, n]`. */
  n(): number {
    return this.vertices.length;
  }

  /** Boundary segments including the closing edge (`n` segments). */
  segments(): Line2[] {
    return segmentsFromVertices(this.vertices, true);
  }

  length(): number {
    return Line2.lengthTable(this.segments())[this.n()]!;
  }

  /**
   * Evaluate in the index domain `[0, n]`.
   * Integer `t` in `0…n - 1` returns `vertices[t]`; `t = n` returns `vertices[0]`.
   * Values wrap around the closed boundary.
   */
  evaluate(t: number): Vec2 {
    const segments = this.segments();
    const period = this.n();
    const u = ((t % period) + period) % period;

    if (u >= period - Number.EPSILON) {
      return this.vertices[0]!.clone();
    }

    const segmentIndex = Math.floor(u);
    const localT = u - segmentIndex;
    return segments[segmentIndex]!.evaluate(localT);
  }

  /** Evaluate by arc length along the boundary. Values outside `[0, length()]` extrapolate. */
  evaluateAtLength(length: number): Vec2 {
    return Line2.evaluateAtLength(this.segments(), length);
  }

  closestParametersForPoint(point: Vec2, additionalTolerance = 0): number[] {
    return Line2.closestToPointForSegments(this.segments(), point, additionalTolerance).tParameters;
  }

  closestPointsForPoint(point: Vec2, additionalTolerance = 0): Vec2[] {
    return Line2.closestToPointForSegments(this.segments(), point, additionalTolerance).points;
  }

  distanceToPoint(point: Vec2): number {
    return Line2.closestToPointForSegments(this.segments(), point).smallestDistance;
  }

  /** Negative inside, positive outside, zero on the boundary. */
  signedDistance(point: Vec2): number {
    const distance = this.distanceToPoint(point);
    return this.containsPoint(point) ? -distance : distance;
  }

  /**
   * Even-odd signed distance over one or more boundary loops.
   * Negative inside the region, positive outside; magnitude is distance to the nearest loop edge.
   */
  static signedDistanceFromLoops(polygons: readonly Polygon2[], point: Vec2): number {
    if (polygons.length === 0) return Infinity;

    const distance = Math.min(...polygons.map((polygon) => polygon.distanceToPoint(point)));
    return Polygon2.isPointInside(polygons, point) ? -distance : distance;
  }

  aabb2(): Aabb2 {
    return Aabb2.fromPoints(...this.vertices);
  }

  containsPoint(point: Vec2): boolean {
    return this.windingNumber(point) !== 0;
  }

  transform(matrix: Mat3): Polygon2 {
    return new Polygon2(this.vertices.map((v) => v.transform(matrix)));
  }

  /**
   * Non-zero winding number at `point` (positive for CCW boundary contribution).
   * Used by boolean fill rules; {@link containsPoint} is `windingNumber !== 0`.
   */
  windingNumber(point: Vec2): number {
    let winding = 0;
    const count = this.vertices.length;

    for (let i = 0; i < count; i++) {
      const a = this.vertices[i]!;
      const b = this.vertices[(i + 1) % count]!;

      if (a.y <= point.y) {
        if (b.y > point.y && Vec2.orient(a, b, point) > 0) {
          winding++;
        }
      } else if (b.y <= point.y && Vec2.orient(a, b, point) < 0) {
        winding--;
      }
    }

    return winding;
  }

  /**
   * Even-odd point-in-region test over one or more boundary loops.
   * Loops may have arbitrary orientation; boundary points count as inside when `slack` is positive.
   */
  static isPointInside(polygons: readonly Polygon2[], point: Vec2, slack: Epsilon = Epsilon.preferIn): boolean {
    if (polygons.length === 0) return false;

    const boundarySlack = Math.abs(slack.value);
    for (const polygon of polygons) {
      if (polygon.distanceToPoint(point) <= boundarySlack) {
        return slack.value > 0;
      }
    }

    let crossings = 0;
    for (const polygon of polygons) {
      const vertices = polygon.vertices;
      const count = vertices.length;

      for (let i = 0; i < count; i++) {
        const a = vertices[i]!;
        const b = vertices[(i + 1) % count]!;

        if ((a.y <= point.y && b.y > point.y) || (b.y <= point.y && a.y > point.y)) {
          const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
          if (point.x < x) crossings++;
        }
      }
    }

    return crossings % 2 === 1;
  }

  /** Signed area; positive when vertices are counter-clockwise. */
  static signedArea(vertices: readonly Vec2[]): number {
    let area = 0;

    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i]!;
      const b = vertices[(i + 1) % vertices.length]!;
      area += a.x * b.y - b.x * a.y;
    }

    return area * 0.5;
  }

  clone(): Polygon2 {
    return new Polygon2(this.vertices.map((v) => v.clone()));
  }

  toJson(): Polygon2Json {
    return {
      type: Polygon2.type,
      vertices: this.vertices.map((v) => v.toJson()),
    };
  }
}

export type Polygon2Json = {
  type: typeof Polygon2.type;
  vertices: Vec2Json[];
};
