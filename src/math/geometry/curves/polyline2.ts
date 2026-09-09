import { Aabb2 } from '../../bounds/aabb2';
import { Vec2, type Vec2Json } from '../../core/vec2';
import { Line2 } from '../primitives/line2';
import { segmentsFromVertices } from './segments';

/** Open polyline: consecutive vertex pairs form segments; no closing segment. */
export class Polyline2 {
  static readonly type = 'Polyline2' as const;

  readonly vertices: readonly Vec2[];

  constructor(vertices: Vec2[]) {
    if (vertices.length < 2) {
      throw new Error('Polyline2 requires at least two vertices');
    }

    this.vertices = vertices.map((v) => v.clone());
  }

  /** Last vertex index / number of segments. Parameter domain is `[0, n]`. */
  n(): number {
    return this.vertices.length - 1;
  }

  /** Line segments between consecutive vertices (n segments). */
  segments(): Line2[] {
    return segmentsFromVertices(this.vertices, false);
  }

  length(): number {
    return Line2.lengthTable(this.segments())[this.n()]!;
  }

  /**
   * Evaluate in the index domain `[0, n]`.
   * Integer `t` returns `vertices[t]`; values between `i` and `i + 1` interpolate segment `i`.
   */
  evaluate(t: number): Vec2 {
    const segments = this.segments();
    const clamped = Math.max(0, Math.min(this.n(), t));

    if (clamped >= this.n()) {
      return this.vertices[this.vertices.length - 1]!.clone();
    }

    const segmentIndex = Math.floor(clamped);
    const localT = clamped - segmentIndex;
    return segments[segmentIndex]!.evaluate(localT);
  }

  /** Evaluate by arc length along the polyline. Values outside `[0, length()]` extrapolate. */
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

  aabb2(): Aabb2 {
    return Aabb2.fromPoints(...this.vertices);
  }

  clone(): Polyline2 {
    return new Polyline2(this.vertices.map((v) => v.clone()));
  }

  toJson(): Polyline2Json {
    return {
      type: Polyline2.type,
      vertices: this.vertices.map((v) => v.toJson()),
    };
  }
}

export type Polyline2Json = {
  type: typeof Polyline2.type;
  vertices: Vec2Json[];
};
