import { Vec2 } from './vec2';

/**
 * 3×3 matrix for 2D affine transforms in homogeneous coordinates.
 * Stored in column-major order: [m00, m10, m20, m01, m11, m21, m02, m12, m22].
 */
export class Mat3 {
  static readonly type = 'Mat3' as const;

  readonly elements: readonly [number, number, number, number, number, number, number, number, number];

  constructor(m00 = 1, m01 = 0, m02 = 0, m10 = 0, m11 = 1, m12 = 0, m20 = 0, m21 = 0, m22 = 1) {
    this.elements = [m00, m10, m20, m01, m11, m21, m02, m12, m22];
  }

  static identity(): Mat3 {
    return new Mat3();
  }

  static translation(x: number, y: number): Mat3 {
    return new Mat3(1, 0, x, 0, 1, y, 0, 0, 1);
  }

  static rotation(angle: number): Mat3 {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Mat3(c, -s, 0, s, c, 0, 0, 0, 1);
  }

  static scale(sx: number, sy = sx): Mat3 {
    return new Mat3(sx, 0, 0, 0, sy, 0, 0, 0, 1);
  }

  static fromValues(
    m00: number,
    m01: number,
    m02: number,
    m10: number,
    m11: number,
    m12: number,
    m20: number,
    m21: number,
    m22: number,
  ): Mat3 {
    return new Mat3(m00, m01, m02, m10, m11, m12, m20, m21, m22);
  }

  multiply(other: Mat3): Mat3 {
    const a = this.elements;
    const b = other.elements;

    return Mat3.fromValues(
      a[0]! * b[0]! + a[3]! * b[1]! + a[6]! * b[2]!,
      a[0]! * b[3]! + a[3]! * b[4]! + a[6]! * b[5]!,
      a[0]! * b[6]! + a[3]! * b[7]! + a[6]! * b[8]!,
      a[1]! * b[0]! + a[4]! * b[1]! + a[7]! * b[2]!,
      a[1]! * b[3]! + a[4]! * b[4]! + a[7]! * b[5]!,
      a[1]! * b[6]! + a[4]! * b[7]! + a[7]! * b[8]!,
      a[2]! * b[0]! + a[5]! * b[1]! + a[8]! * b[2]!,
      a[2]! * b[3]! + a[5]! * b[4]! + a[8]! * b[5]!,
      a[2]! * b[6]! + a[5]! * b[7]! + a[8]! * b[8]!,
    );
  }

  transformPoint(v: Vec2): Vec2 {
    const e = this.elements;
    return new Vec2(e[0]! * v.x + e[3]! * v.y + e[6]!, e[1]! * v.x + e[4]! * v.y + e[7]!);
  }

  toJson(): Mat3Json {
    return { type: Mat3.type, elements: [...this.elements] };
  }
}

export type Mat3Json = {
  type: typeof Mat3.type;
  elements: [number, number, number, number, number, number, number, number, number];
};
