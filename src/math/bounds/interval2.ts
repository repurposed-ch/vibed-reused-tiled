import { Epsilon } from '../core/epsilon';

/** Closed numeric interval `[min, max]`. Endpoints may be `±Infinity`. */
export class Interval2 {
  static readonly type = 'Interval2' as const;
  static readonly unit = new Interval2(0, 1);
  static readonly ray = new Interval2(0, Infinity);
  /** Closed negative indexes `(-∞, -1]`. */
  static readonly negativeRay = new Interval2(-Infinity, -1);
  static readonly infinite = new Interval2(-Infinity, Infinity);

  constructor(
    public min: number,
    public max: number,
  ) {
    if (!Interval2.hasInfiniteEndpoint(min, max) && min > max) {
      throw new Error('Interval2 min must be less than or equal to max');
    }
  }

  /** Empty accumulator; expand via `include` before reading bounds. */
  static empty(): Interval2 {
    return new Interval2(Infinity, -Infinity);
  }

  /**
   * Floor endpoints to integers, clamp into `range`, and order so min ≤ max.
   * Warns when the result differs from the input (beyond epsilon).
   */
  static clampedInteger(
    domain: { readonly min: number; readonly max: number },
    range: { readonly min: number; readonly max: number },
    epsilon: Epsilon = Epsilon.preferIn,
  ): Interval2 {
    const min = Math.max(range.min, Math.floor(domain.min));
    const max = Math.min(range.max, Math.floor(domain.max));

    const result = new Interval2(Math.min(min, max), Math.max(min, max));

    if (!epsilon.areEqual(domain.min, result.min) || !epsilon.areEqual(domain.max, result.max)) {
      console.warn('Interval2 domain constrained', domain, result);
    }

    return result;
  }

  static union(...items: readonly (Interval2 | number)[]): Interval2 {
    if (items.length === 0) {
      throw new Error('Interval2.union requires at least one item');
    }

    const result = Interval2.empty();
    for (const item of items) {
      result.include(item);
    }
    return result;
  }

  scale(factor: number): Interval2 {
    return new Interval2(this.min * factor, this.max * factor);
  }

  offset(offset: number): Interval2 {
    return new Interval2(this.min + offset, this.max + offset);
  }

  clamp(t: number): number {
    return Math.max(this.min, Math.min(this.max, t));
  }

  contains(value: number, slack: Epsilon = Epsilon.preferIn): boolean {
    return value >= this.min - slack.value && value <= this.max + slack.value;
  }

  /**
   * Integers this closed interval contains, low → high.
   * Requires finite endpoints.
   */
  *countUp(): Generator<number, void, undefined> {
    if (!Number.isFinite(this.min) || !Number.isFinite(this.max)) {
      throw new Error('Interval2.countUp requires finite endpoints');
    }

    for (let index = this.min; index <= this.max; index++) {
      yield index;
    }
  }

  /**
   * Integers this closed interval contains, high → low.
   * Requires finite endpoints.
   */
  *countDown(): Generator<number, void, undefined> {
    if (!Number.isFinite(this.min) || !Number.isFinite(this.max)) {
      throw new Error('Interval2.countDown requires finite endpoints');
    }

    for (let index = this.max; index >= this.min; index--) {
      yield index;
    }
  }

  /** True when this interval fully covers `other`, honoring boundary tolerance. */
  containsInterval(other: Interval2, slack: Epsilon = Epsilon.preferIn): boolean {
    return other.min >= this.min - slack.value && other.max <= this.max + slack.value;
  }

  /** Negative inside, positive outside, zero on the boundary. */
  signedDistance(value: number): number {
    if (this.isFullyInfinite()) return -Infinity;
    if (Number.isFinite(this.min) && value < this.min) return this.min - value;
    if (Number.isFinite(this.max) && value > this.max) return value - this.max;

    return -Math.min(value - this.min, this.max - value);
  }

  width(): number {
    return this.isInfinite() ? Infinity : this.max - this.min;
  }

  isInfinite(): boolean {
    return Interval2.hasInfiniteEndpoint(this.min, this.max);
  }

  isFullyInfinite(): boolean {
    return this.min === -Infinity && this.max === Infinity;
  }

  isInteger(): boolean {
    return Number.isInteger(this.min) && Number.isInteger(this.max);
  }

  equals(other: Interval2): boolean {
    return this.containsInterval(other) && other.containsInterval(this);
  }

  /** Expand to cover a scalar or another interval (mutates). */
  include(value: number | Interval2): this {
    if (typeof value === 'number') {
      this.min = Interval2.mergeMin(this.min, value);
      this.max = Interval2.mergeMax(this.max, value);
    } else {
      this.min = Interval2.mergeMin(this.min, value.min);
      this.max = Interval2.mergeMax(this.max, value.max);
    }
    return this;
  }

  /** Image of `origin + t * delta` for `t` in this interval. */
  mapLinear(origin: number, delta: number): Interval2 {
    if (Math.abs(delta) < Epsilon.value) {
      return new Interval2(origin, origin);
    }

    const a = origin + this.min * delta;
    const b = origin + this.max * delta;
    return new Interval2(Math.min(a, b), Math.max(a, b));
  }

  /** Overlap with `other`, or `null` when empty beyond slack. */
  intersect(other: Interval2, slack: Epsilon = Epsilon.preferIn): Interval2 | null {
    const min = Math.max(this.min, other.min);
    const max = Math.min(this.max, other.max);

    if (min > max + slack.value) {
      return null;
    }

    return new Interval2(Math.min(min, max), Math.max(min, max));
  }

  /** Set difference `this \ other` as 0-2 intervals (empty when fully covered). */
  difference(other: Interval2, slack: Epsilon = Epsilon.preferIn): Interval2[] {
    if (!this.intersect(other, slack)) {
      return [this.clone()];
    }

    const parts: Interval2[] = [];

    if (this.min < other.min - slack.value) {
      parts.push(new Interval2(this.min, Math.min(this.max, other.min)));
    }

    if (this.max > other.max + slack.value) {
      parts.push(new Interval2(Math.max(this.min, other.max), this.max));
    }

    return parts;
  }

  negate(): Interval2 {
    return new Interval2(-this.max, -this.min);
  }

  clone(): Interval2 {
    return new Interval2(this.min, this.max);
  }

  toJson(): Interval2Json {
    return { type: Interval2.type, min: this.min, max: this.max };
  }

  private static hasInfiniteEndpoint(min: number, max: number): boolean {
    return !Number.isFinite(min) || !Number.isFinite(max);
  }

  private static mergeMax(current: number, next: number): number {
    if (!Number.isFinite(next)) return Infinity;
    if (current === -Infinity) return next;
    if (!Number.isFinite(current)) return current;
    return Math.max(current, next);
  }

  private static mergeMin(current: number, next: number): number {
    if (!Number.isFinite(next)) return -Infinity;
    if (current === Infinity) return next;
    if (!Number.isFinite(current)) return current;
    return Math.min(current, next);
  }
}

export type Interval2Json = {
  type: typeof Interval2.type;
  min: number;
  max: number;
};
