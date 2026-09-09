import { Epsilon } from '../core/epsilon';
import { Interval2, type Interval2Json } from './interval2';
import { Vec2 } from '../core/vec2';
import { Polygon2 } from '../geometry/regions/polygon2';

/** Axis-aligned bounding box stored as per-axis intervals. */
export class Aabb2 {
  static readonly type = 'Aabb2' as const;

  readonly x: Interval2;
  readonly y: Interval2;

  constructor(x: Interval2, y: Interval2) {
    this.x = x.clone();
    this.y = y.clone();
  }

  min(): Vec2 {
    return new Vec2(this.x.min, this.y.min);
  }

  max(): Vec2 {
    return new Vec2(this.x.max, this.y.max);
  }

  center(): Vec2 {
    return new Vec2((this.x.min + this.x.max) / 2, (this.y.min + this.y.max) / 2);
  }

  static infinite(): Aabb2 {
    return new Aabb2(Interval2.infinite, Interval2.infinite);
  }

  static fromMinMax(min: Vec2, max: Vec2): Aabb2 {
    return new Aabb2(new Interval2(min.x, max.x), new Interval2(min.y, max.y));
  }

  /** Build a box from per-axis intervals (named factory for the constructor). */
  static fromIntervals(x: Interval2, y: Interval2): Aabb2 {
    return new Aabb2(x, y);
  }

  static fromPoints(...points: readonly Vec2[]): Aabb2 {
    if (points.length === 0) {
      throw new Error('Aabb2.fromPoints requires at least one point');
    }

    return new Aabb2(
      Interval2.union(...points.map((point) => point.x)),
      Interval2.union(...points.map((point) => point.y)),
    );
  }

  static union(...items: readonly (Aabb2 | Vec2)[]): Aabb2 {
    if (items.length === 0) {
      throw new Error('Aabb2.union requires at least one item');
    }

    return new Aabb2(Interval2.union(...items.map((item) => item.x)), Interval2.union(...items.map((item) => item.y)));
  }

  /** AABB of `origin + t * direction` for `t` in `parameter`. */
  static fromParameterInterval(origin: Vec2, direction: Vec2, parameter: Interval2): Aabb2 {
    return new Aabb2(parameter.mapLinear(origin.x, direction.x), parameter.mapLinear(origin.y, direction.y));
  }

  isInfinite(): boolean {
    return this.x.isInfinite() || this.y.isInfinite();
  }

  isFullyInfinite(): boolean {
    return this.x.isFullyInfinite() && this.y.isFullyInfinite();
  }

  width(): number {
    return this.x.width();
  }

  height(): number {
    return this.y.width();
  }

  containsPoint(point: Vec2): boolean {
    return this.x.contains(point.x) && this.y.contains(point.y);
  }

  /** Negative inside, positive outside, zero on the boundary. */
  signedDistance(point: Vec2): number {
    const dx = this.x.signedDistance(point.x);
    const dy = this.y.signedDistance(point.y);

    if (dx <= 0 && dy <= 0) return Math.max(dx, dy); // both directions inside
    if (dx > 0 && dy > 0) return new Vec2(dx, dy).length(); // both directions outside
    return Math.max(dx, dy); // is outside, but only in one direction
  }

  /** Corner vertices in min-x/min-y order around the box. Requires finite bounds on both axes. */
  corners(): [Vec2, Vec2, Vec2, Vec2] {
    const min = this.min();
    const max = this.max();
    return [min, new Vec2(max.x, min.y), max, new Vec2(min.x, max.y)];
  }

  /** Closed quadrilateral with the same bounds as this box. Requires finite bounds on both axes. */
  polygon2(): Polygon2 {
    if (this.isInfinite()) {
      throw new Error('Aabb2.toPolygon2 requires finite bounds');
    }

    const [a, b, c, d] = this.corners();
    return new Polygon2([a, b, c, d]);
  }

  aabb2(): Aabb2 {
    return this.clone();
  }

  /** True when this box fully covers `other` on both axes. */
  containsBox(other: Aabb2, slack: Epsilon = Epsilon.preferIn): boolean {
    return this.x.containsInterval(other.x, slack) && this.y.containsInterval(other.y, slack);
  }

  clone(): Aabb2 {
    return new Aabb2(this.x, this.y);
  }

  toJson(): Aabb2Json {
    return {
      type: Aabb2.type,
      x: this.x.toJson(),
      y: this.y.toJson(),
    };
  }
}

export type Aabb2Json = {
  type: typeof Aabb2.type;
  x: Interval2Json;
  y: Interval2Json;
};
