import type { Mat3 } from '../../core/mat3';
import { Aabb2 } from '../../bounds/aabb2';
import { Interval2 } from '../../bounds/interval2';
import { Vec2, type Vec2Json } from '../../core/vec2';
import { intersectionLines, type LineLike2IntersectionResult } from '../../operations/intersection/line2-like';
import { type LineLike2 } from '../kinds';
import { InfiniteLine2 } from './infinite-line2';
import { Line2 } from './line2';

/** Half-infinite ray starting at a point and extending in one direction. */
export class Ray2 {
  static readonly type = 'Ray2' as const;
  static readonly parameterInterval = Interval2.ray;

  constructor(
    public readonly start: Vec2,
    public readonly direction: Vec2,
  ) {}

  evaluate(t: number): Vec2 {
    return this.infiniteLine().evaluate(t);
  }

  closestParameterForPoint(point: Vec2): number {
    return Ray2.parameterInterval.clamp(this.infiniteLine().closestParameterForPoint(point));
  }

  closestPointForPoint(point: Vec2): Vec2 {
    return this.evaluate(this.closestParameterForPoint(point));
  }

  distanceToPoint(point: Vec2): number {
    return point.distance(this.closestPointForPoint(point));
  }

  /** Finite segment from `start` to `start + direction` used to bound the ray definition. */
  definitionLine(): Line2 {
    return new Line2(this.start.clone(), this.start.add(this.direction));
  }

  aabb2(definitionGeometry = false): Aabb2 {
    if (definitionGeometry) {
      return this.definitionLine().aabb2();
    }
    return Aabb2.fromParameterInterval(this.start, this.direction, Ray2.parameterInterval);
  }

  infiniteLine(): InfiniteLine2 {
    return new InfiniteLine2(this.start, this.direction);
  }

  interval(): Interval2 {
    return Ray2.parameterInterval;
  }

  transform(matrix: Mat3): Ray2 {
    return new Ray2(this.start.transform(matrix), this.direction.transform(matrix));
  }

  intersect(other: LineLike2): LineLike2IntersectionResult {
    return intersectionLines(this, other);
  }

  toJson(): Ray2Json {
    return {
      type: Ray2.type,
      start: this.start.toJson(),
      direction: this.direction.toJson(),
    };
  }
}

export type Ray2Json = {
  type: typeof Ray2.type;
  start: Vec2Json;
  direction: Vec2Json;
};
