import type { Mat3 } from '../../core/mat3';
import { Aabb2 } from '../../bounds/aabb2';
import { Interval2 } from '../../bounds/interval2';
import { Epsilon } from '../../core/epsilon';
import { Vec2, type Vec2Json } from '../../core/vec2';
import { intersectionLines, type LineLike2IntersectionResult } from '../../operations/intersection/line2-like';
import { type LineLike2 } from '../kinds';
import { Hesse2 } from './hesse2';
import { Line2 } from './line2';

/** Infinite line passing through a point in both directions. */
export class InfiniteLine2 {
  static readonly type = 'InfiniteLine2' as const;
  static readonly parameterInterval = Interval2.infinite;

  constructor(
    public readonly through: Vec2,
    public readonly direction: Vec2,
  ) {}

  evaluate(t: number): Vec2 {
    return this.through.add(this.direction.scale(t));
  }

  unitDirection(): Vec2 {
    if (this.direction.isZeroLength()) {
      throw new Error(`InfiniteLine2.unitDirection cannot be used for an infinite line with a zero length direction. `);
    }
    return this.direction.unit();
  }

  closestParameterForPoint(point: Vec2): number {
    const dirLenSq = this.direction.dot(this.direction);

    if (dirLenSq < Epsilon.sq) {
      return 0;
    }

    return point.subtract(this.through).dot(this.direction) / dirLenSq;
  }

  closestPointForPoint(point: Vec2): Vec2 {
    return this.evaluate(this.closestParameterForPoint(point));
  }

  distanceToPoint(point: Vec2): number {
    return Math.abs(this.signedDistance(point));
  }

  /** Finite segment from `through` to `through + direction` used to bound the line definition. */
  definitionLine(): Line2 {
    return new Line2(this.through.clone(), this.through.add(this.direction));
  }

  aabb2(definitionGeometry = false): Aabb2 {
    if (definitionGeometry) {
      return this.definitionLine().aabb2();
    }
    return Aabb2.fromParameterInterval(this.through, this.direction, InfiniteLine2.parameterInterval);
  }

  transform(matrix: Mat3): InfiniteLine2 {
    return new InfiniteLine2(this.through.transform(matrix), this.direction.transform(matrix));
  }

  infiniteLine(): InfiniteLine2 {
    return this;
  }

  interval(): Interval2 {
    return InfiniteLine2.parameterInterval;
  }

  /** Signed distance of a point along the line's unitDirection. Ignores the line's through point. */
  parametricOffset(point: Vec2): number {
    return point.dot(this.unitDirection());
  }

  intersect(other: LineLike2): LineLike2IntersectionResult {
    return intersectionLines(this, other);
  }

  /** Perpendicular signed distance; positive to the left of `direction`. */
  signedDistance(point: Vec2): number {
    const dirLen = this.direction.length();

    if (dirLen < Epsilon.value) {
      return point.distance(this.through);
    }

    // same as Vec2.orient
    return this.direction.crossProduct(point.subtract(this.through)) / dirLen;
  }

  /** Hesse form with left unit normal of `direction`. */
  hesseNormal(): Hesse2 {
    return Hesse2.fromInfiniteLine(this);
  }

  toJson(): InfiniteLine2Json {
    return {
      type: InfiniteLine2.type,
      through: this.through.toJson(),
      direction: this.direction.toJson(),
    };
  }
}

export type InfiniteLine2Json = {
  type: typeof InfiniteLine2.type;
  through: Vec2Json;
  direction: Vec2Json;
};
