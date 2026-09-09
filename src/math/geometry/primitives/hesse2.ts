import type { Mat3 } from '../../core/mat3';
import { Angle, type AnglePrecisions } from '../../core/angle';
import { Epsilon } from '../../core/epsilon';
import { Vec2, type Vec2Json } from '../../core/vec2';
import { InfiniteLine2 } from './infinite-line2';
import { dehashValueOfCustomBitwidth, valueToHashableIntegerOfCustomBitwidth } from '../../hash/core';
import type { Interval2 } from '../../bounds/interval2';
import type { Aabb2 } from '../../bounds/aabb2';

/**
 * Hesse normal form of an oriented line / half-plane: `normal · x = offset`, `|normal| = 1`.
 * Also called half-space / plane.
 *
 * Matches `InfiniteLine2.signedDistance`: positive on the left of the reconstructed direction
 * (`direction = (normal.y, -normal.x)`). Half-plane interior is `signedDistance <= 0`.
 */
export class Hesse2 {
  static readonly type = 'Hesse2' as const;

  /** τ-domain precision whose bucket count fits in `HASH_ANGLE_BITWIDTH` (3600 ≤ 2^12). */
  private static readonly HASH_ANGLE_PRECISION: AnglePrecisions = 1e-1;
  private static readonly HASH_ANGLE_BITWIDTH = Angle.getBitWidthForPrecision(Hesse2.HASH_ANGLE_PRECISION, 'tau');
  private static readonly HASH_SCALE = 1e-6;
  private static readonly HASH_MIN = -1e6;
  private static readonly HASH_OFFSET_BITWIDTH = 41;

  readonly normal: Vec2;
  readonly offset: number;

  constructor(normal: Vec2, offset: number) {
    if (normal.isZeroLength()) {
      throw new Error('Hesse2 requires a non-zero normal');
    }

    const length = normal.length();
    this.normal = normal.scale(1 / length);
    this.offset = offset / length;
  }

  /** Build from any normal and a point on the line (`offset = unitNormal · point`). */
  static fromNormalAndPoint(normal: Vec2, point: Vec2): Hesse2 {
    const unit = normal.unit();
    return new Hesse2(unit, unit.dot(point));
  }

  /** Left unit normal of `line.direction`, offset through `line.through`. */
  static fromInfiniteLine(line: InfiniteLine2): Hesse2 {
    return Hesse2.fromNormalAndPoint(line.direction.perpendicular(), line.through);
  }

  interval(): Interval2 {
    return InfiniteLine2.parameterInterval;
  }

  /** `normal · point - offset`; positive on the half-plane opposite the interior. */
  signedDistance(point: Vec2): number {
    return this.normal.dot(point) - this.offset;
  }

  distanceToPoint(point: Vec2): number {
    return Math.abs(this.signedDistance(point));
  }

  closestPointForPoint(point: Vec2): Vec2 {
    return point.subtract(this.normal.scale(this.signedDistance(point)));
  }

  /** Flip orientation (same carrier, opposite half-plane). */
  flip(): Hesse2 {
    return new Hesse2(this.normal.negate(), -this.offset);
  }

  /**
   * Canonical undirected form: force `normal.x > 0`, or `normal.x ≈ 0 && normal.y > 0`.
   * Useful when grouping parallel carriers without caring about half-plane side.
   */
  canonicalizeUndirected(slack: Epsilon = Epsilon.preferIn): Hesse2 {
    if (this.normal.x < -slack.value || (Math.abs(this.normal.x) <= slack.value && this.normal.y < 0)) {
      return this.flip();
    }
    return this;
  }

  /** Direction is right of `normal`, matching left-normal convention of `InfiniteLine2`. */
  direction(): Vec2 {
    return new Vec2(this.normal.y, -this.normal.x);
  }

  /** Point on the line closest to the origin. */
  through(): Vec2 {
    return this.normal.scale(this.offset);
  }

  infiniteLine(): InfiniteLine2 {
    return new InfiniteLine2(this.through(), this.direction());
  }

  transform(matrix: Mat3): Hesse2 {
    return Hesse2.fromInfiniteLine(this.infiniteLine().transform(matrix));
  }

  aabb2(): Aabb2 {
    return this.infiniteLine().aabb2();
  }

  hash(): number {
    const angleHash = this.direction().anglePositive({ precision: Hesse2.HASH_ANGLE_PRECISION }).hash();
    const distanceHash = valueToHashableIntegerOfCustomBitwidth(
      this.offset,
      Hesse2.HASH_MIN,
      Hesse2.HASH_SCALE,
      Hesse2.HASH_OFFSET_BITWIDTH,
    );
    return distanceHash * 2 ** Hesse2.HASH_ANGLE_BITWIDTH + angleHash;
  }

  static fromHash(hash: number): Hesse2 {
    const angleBits = 2 ** Hesse2.HASH_ANGLE_BITWIDTH;
    const angleHash = hash % angleBits;
    const distanceHash = Math.floor(hash / angleBits);
    const angle = Angle.fromHash(angleHash);
    const theta = angle.radians();
    const distance = dehashValueOfCustomBitwidth(distanceHash, Hesse2.HASH_MIN, Hesse2.HASH_SCALE);
    // direction = (cos θ, sin θ) ⇒ left normal = (-sin θ, cos θ)
    return new Hesse2(new Vec2(-Math.sin(theta), Math.cos(theta)), distance);
  }

  toJson(): Hesse2Json {
    return {
      type: Hesse2.type,
      normal: this.normal.toJson(),
      offset: this.offset,
    };
  }
}

export type Hesse2Json = {
  type: typeof Hesse2.type;
  normal: Vec2Json;
  offset: number;
};
