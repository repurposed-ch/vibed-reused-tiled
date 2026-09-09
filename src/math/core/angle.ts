import { Interval2 } from '../bounds/interval2';
import { Vec2 } from './vec2';

export const TAU = 2 * Math.PI;

/** Degrees-per-bucket base; precision `1` → 360 buckets over a full turn. */
const MINIMAL_ANGLE_BUCKETS = 360;
const DEFAULT_ANGLE_PRECISION: AnglePrecisions = 1e-1;
const DEFAULT_HASH_PRECISION: AnglePrecisions = 1;

export type AnglePrecisions = 1 | 1e-1 | 1e-2 | 1e-3;
export type AngleDomainKind = 'tau' | 'pi';

export type AngleOptions = {
  /** Ignore direction sense; return unsigned angle in `[0, π]`. */
  ignoreSens?: boolean;
  precision?: AnglePrecisions;
};

/** Shape required to interpret an angle hash (not stored in the hash). */
export type AngleHashShape = {
  domainKind: AngleDomainKind;
  precision: AnglePrecisions;
};

const DefaultAngleShape = {
  domainKind: 'tau',
  precision: DEFAULT_ANGLE_PRECISION,
} as const;

/** Angle in radians with an explicit domain (`τ` or `π`) and hash precision. */
export class Angle {
  static readonly type = 'Angle' as const;
  static readonly tauDomain = new Interval2(0, TAU);
  static readonly piDomain = new Interval2(0, Math.PI);
  static readonly degreeScale = 180 / Math.PI;
  static readonly Pi = new Angle(Math.PI, 'tau', DEFAULT_ANGLE_PRECISION);
  static readonly Tau = new Angle(TAU, 'tau', DEFAULT_ANGLE_PRECISION);

  constructor(
    private readonly value: number,
    private readonly domainKind: AngleDomainKind,
    private readonly precision: AnglePrecisions,
  ) {}

  getPrecision(): AnglePrecisions {
    return this.precision;
  }

  degrees(): number {
    return this.value * Angle.degreeScale;
  }

  getDomainInDegrees(): Interval2 {
    return this.getDomain().scale(Angle.degreeScale);
  }

  getDomain(): Interval2 {
    return this.domainKind === 'pi' ? Angle.piDomain : Angle.tauDomain;
  }

  radians(): number {
    return this.value;
  }

  isTauDomain(): boolean {
    return this.domainKind === 'tau';
  }

  isPiDomain(): boolean {
    return this.domainKind === 'pi';
  }

  /** Bucket hash of the value only; pass the same shape to `fromHash`. */
  hash(): number {
    return Angle.getAngleHash(this.value, this.precision, this.domainKind);
  }

  /** Restore an angle from a hash; pass the same shape to `hash`.
   * Default shape is `{ domainKind: 'tau', precision: DEFAULT_ANGLE_PRECISION (.1) }`.
   */
  static fromHash(hash: number, shape: AngleHashShape = DefaultAngleShape): Angle {
    const radians = Angle.dehashAngle(hash, shape);
    return new Angle(radians, shape.domainKind, shape.precision);
  }

  static fromRadians(radians: number, precision: AnglePrecisions = DEFAULT_ANGLE_PRECISION): Angle {
    return new Angle(Angle.wrapToTau(radians), 'tau', precision);
  }

  static fromDegrees(degrees: number, precision: AnglePrecisions = DEFAULT_ANGLE_PRECISION): Angle {
    return Angle.fromRadians(degrees / Angle.degreeScale, precision);
  }

  static fromTwoVectors(from: Vec2, to: Vec2, options: AngleOptions = {}): Angle {
    const { ignoreSens = false, precision = DEFAULT_ANGLE_PRECISION } = options;
    if (from.isZeroLength() || to.isZeroLength()) {
      throw new Error('Angle.fromTwoVectors cannot be used with a zero-length vector');
    }

    const directed = Angle.wrapToTau(Math.atan2(to.y, to.x) - Math.atan2(from.y, from.x));
    if (ignoreSens) {
      return new Angle(Angle.foldToPi(directed), 'pi', precision);
    }
    return new Angle(directed, 'tau', precision);
  }

  static vectorWithX(v: Vec2, options: AngleOptions = DefaultAngleShape): Angle {
    return Angle.fromTwoVectors(Vec2.baseX(), v, options);
  }

  static fromPt3(a: Vec2, b: Vec2, c: Vec2, options: AngleOptions = {}): Angle {
    return Angle.fromTwoVectors(a.subtract(b), c.subtract(b), options);
  }

  static wrapToTau(radians: number): number {
    const r = radians % TAU;
    return r < 0 ? r + TAU : r;
  }

  static foldToPi(thetaInTau: number): number {
    return thetaInTau > Math.PI ? TAU - thetaInTau : thetaInTau;
  }

  static domainSpan(domain: AngleDomainKind): number {
    return domain === 'pi' ? Math.PI : TAU;
  }

  static getAngleBuckets(precision: AnglePrecisions, domain: AngleDomainKind = 'tau'): number {
    const fullCircle = MINIMAL_ANGLE_BUCKETS * Math.floor(1 / precision);
    return domain === 'pi' ? Math.floor(fullCircle / 2) : fullCircle;
  }

  static getBitWidthForPrecision(precision: AnglePrecisions, domain: AngleDomainKind = 'tau'): number {
    return Math.ceil(Math.log2(Angle.getAngleBuckets(precision, domain)));
  }

  /**
   * Quantize `angle` into a bucket. Half-bucket shift so values near common angles
   * share a bucket. Domain/precision are not encoded — pass the same shape to dehash.
   */
  static getAngleHash(
    angle: number,
    precision: AnglePrecisions = DEFAULT_HASH_PRECISION,
    domain: AngleDomainKind = 'tau',
  ): number {
    const buckets = Angle.getAngleBuckets(precision, domain);
    const span = Angle.domainSpan(domain);
    const wrapped = domain === 'tau' ? ((angle % span) + span) % span : Math.min(Math.max(angle, 0), span);
    const bucket = Math.floor((wrapped / span) * buckets + 0.5);
    return Math.min(bucket, buckets - 1);
  }

  static dehashAngle(hashValue: number, angleShape: AngleHashShape): number {
    const buckets = Angle.getAngleBuckets(angleShape.precision, angleShape.domainKind);
    const span = Angle.domainSpan(angleShape.domainKind);
    return (hashValue / buckets) * span;
  }

  toJson(): AngleJson {
    return {
      type: Angle.type,
      value: this.value,
      domainKind: this.domainKind,
      precision: this.precision,
    };
  }
}

export type AngleJson = {
  type: typeof Angle.type;
  value: number;
  domainKind: AngleDomainKind;
  precision: AnglePrecisions;
};
