import { Aabb2 } from '../../bounds/aabb2';
import { Interval2 } from '../../bounds/interval2';
import { Epsilon } from '../../core/epsilon';
import { Vec2, type Vec2Json } from '../../core/vec2';

/** Circle in the plane: center + non-negative radius. */
export class Circle2 {
  static readonly type = 'Circle2' as const;

  readonly center: Vec2;
  readonly radius: number;

  constructor(center: Vec2, radius: number) {
    if (!(radius >= 0) || !Number.isFinite(radius)) {
      throw new Error('Circle2 radius must be a finite non-negative number');
    }

    this.center = center.clone();
    this.radius = radius;
  }

  /** Point on the circle at polar angle `theta` (radians, CCW from +x). */
  evaluate(theta: number): Vec2 {
    return this.center.add(new Vec2(Math.cos(theta), Math.sin(theta)).scale(this.radius));
  }

  area(): number {
    return Math.PI * this.radius * this.radius;
  }

  circumference(): number {
    return 2 * Math.PI * this.radius;
  }

  distanceToPoint(point: Vec2): number {
    return Math.abs(this.signedDistance(point));
  }

  /**
   * Signed distance to the boundary: negative inside, positive outside, zero on the circle.
   * For a zero-radius circle this is the distance to the center.
   */
  signedDistance(point: Vec2): number {
    return point.distance(this.center) - this.radius;
  }

  /** True if the point is inside or on the circle (within `Epsilon`). */
  containsPoint(point: Vec2): boolean {
    return this.signedDistance(point) <= Epsilon.value;
  }

  /** True if the point is strictly inside (outside the boundary by more than `Epsilon`). */
  strictlyContainsPoint(point: Vec2): boolean {
    return this.signedDistance(point) < -Epsilon.value;
  }

  aabb2(): Aabb2 {
    return new Aabb2(
      new Interval2(this.center.x - this.radius, this.center.x + this.radius),
      new Interval2(this.center.y - this.radius, this.center.y + this.radius),
    );
  }

  clone(): Circle2 {
    return new Circle2(this.center, this.radius);
  }

  toJson(): Circle2Json {
    return {
      type: Circle2.type,
      center: this.center.toJson(),
      radius: this.radius,
    };
  }

  /** Circle with diameter endpoints `a` and `b`. */
  static fromDiameter(a: Vec2, b: Vec2): Circle2 {
    return new Circle2(Vec2.center(a, b), a.distance(b) / 2);
  }

  /**
   * Circumcircle of triangle `a,b,c`, or `null` if the points are nearly collinear.
   */
  static circumcircle(a: Vec2, b: Vec2, c: Vec2): Circle2 | null {
    const ab = b.subtract(a);
    const ac = c.subtract(a);
    const cross = ab.crossProduct(ac);

    if (Math.abs(cross) < Epsilon.sq) {
      return null;
    }

    const abLenSq = ab.dot(ab);
    const acLenSq = ac.dot(ac);
    const offset = ab
      .perpendicular()
      .scale(acLenSq)
      .add(ac.perpendicular().scale(-abLenSq))
      .scale(0.5 / cross);
    const center = a.add(offset);

    return new Circle2(center, center.distance(a));
  }

  /**
   * True if `d` lies inside the circumcircle of triangle `a,b,c`.
   * Uses the orientation-aware determinant predicate (no explicit circle construction).
   * Nearly cocircular points are treated as outside.
   */
  static inCircle(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
    const ad = a.subtract(d);
    const bd = b.subtract(d);
    const cd = c.subtract(d);

    const det = ad.dot(ad) * bd.crossProduct(cd) - bd.dot(bd) * ad.crossProduct(cd) + cd.dot(cd) * ad.crossProduct(bd);

    const orient = Vec2.orient(a, b, c);
    return orient > 0 ? det > Epsilon.sq : det < -Epsilon.sq;
  }
}

export type Circle2Json = {
  type: typeof Circle2.type;
  center: Vec2Json;
  radius: number;
};
