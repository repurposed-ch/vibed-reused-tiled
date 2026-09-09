import { hash2scale } from '../hash/core';
import { Angle, type AngleOptions } from './angle';
import { Epsilon } from './epsilon';
import type { Mat3 } from './mat3';

export class Vec2 {
  static readonly type = 'Vec2' as const;

  constructor(
    public x = 0,
    public y = 0,
  ) {}

  add(v: Vec2): Vec2 {
    return new Vec2(this.x + v.x, this.y + v.y);
  }

  subtract(v: Vec2): Vec2 {
    return new Vec2(this.x - v.x, this.y - v.y);
  }

  scale(s: number): Vec2 {
    return new Vec2(this.x * s, this.y * s);
  }

  unit(): Vec2 {
    if (this.length() < Epsilon.value) {
      throw new Error('Vec2.unit cannot be called on a zero vector');
    }
    return this.scale(1 / this.length());
  }

  negate(): Vec2 {
    return this.scale(-1);
  }

  perpendicular(): Vec2 {
    return new Vec2(-this.y, this.x);
  }

  distance(v: Vec2): number {
    return Math.hypot(this.x - v.x, this.y - v.y);
  }

  length(): number {
    return Math.hypot(this.x, this.y);
  }

  isZeroLength(): boolean {
    return this.length() < Epsilon.value;
  }

  dot(v: Vec2): number {
    return this.x * v.x + this.y * v.y;
  }

  /** parallel (same direction) */
  parallelCondition(v: Vec2, slack: Epsilon = Epsilon.preferIn): 'parallel' | 'antiparallel' | null {
    const lenProduct = this.length() * v.length();

    if (lenProduct < Epsilon.sq) {
      return null;
    }

    const sinTheta = this.crossProduct(v) / lenProduct;

    if (Math.abs(sinTheta) >= slack.value) {
      return null;
    }

    return this.dot(v) >= 0 ? 'parallel' : 'antiparallel';
  }

  /** parallel or antiparallel */
  parallel(v: Vec2, slack: Epsilon = Epsilon.preferIn): boolean {
    return this.parallelCondition(v, slack) !== null;
  }

  /** antiparallel (opposite direction) */
  antiparallel(v: Vec2, slack: Epsilon = Epsilon.preferIn): boolean {
    return this.parallelCondition(v, slack) === 'antiparallel';
  }

  /** Z component of the 3D cross product when both vectors have z = 0. */
  crossProduct(v: Vec2): number {
    return this.x * v.y - this.y * v.x;
  }

  /**
   * Signed parallelogram area of triangle `a→b→c` (`(b-a)×(c-a)`).
   * Positive ⇒ CCW / `c` left of `a→b`; negative ⇒ CW / right; near zero ⇒ collinear.
   */
  static orient(a: Vec2, b: Vec2, c: Vec2): number {
    return b.subtract(a).crossProduct(c.subtract(a));
  }

  clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }

  transform(m: Mat3): Vec2 {
    const e = m.elements;
    return new Vec2(e[0]! * this.x + e[3]! * this.y + e[6]!, e[1]! * this.x + e[4]! * this.y + e[7]!);
  }

  hash(scale = Epsilon.value): number {
    return hash2scale(this.x, this.y, scale);
  }

  toJson(): Vec2Json {
    return { type: Vec2.type, x: this.x, y: this.y };
  }

  static origin(): Vec2 {
    return new Vec2(0, 0);
  }

  static baseX(): Vec2 {
    return new Vec2(1, 0);
  }

  static baseY(): Vec2 {
    return new Vec2(0, 1);
  }

  static center(...points: Vec2[]): Vec2 {
    if (points.length === 0) {
      throw new Error('Vec2.center requires at least one point');
    }

    let sumX = 0;
    let sumY = 0;

    for (const p of points) {
      sumX += p.x;
      sumY += p.y;
    }

    return new Vec2(sumX / points.length, sumY / points.length);
  }

  /** Directed CCW angle from this vector to `v`, in `[0, 2π)`. */
  angleWith(v: Vec2, options?: AngleOptions): Angle {
    return Angle.fromTwoVectors(this, v, options);
  }

  /** Smallest unsigned angle between this vector and `v`, in `[0, π]`. */
  angleWithSmallest(v: Vec2, options?: AngleOptions): Angle {
    return Angle.fromTwoVectors(this, v, { ...options, ignoreSens: true });
  }

  /** Absolute polar angle from +X, in `[0, 2π)` (or `[0, π]` when `ignoreSens`). */
  anglePositive(options?: AngleOptions): Angle {
    return Angle.vectorWithX(this, options);
  }
}

export type Vec2Json = {
  type: typeof Vec2.type;
  x: number;
  y: number;
};
