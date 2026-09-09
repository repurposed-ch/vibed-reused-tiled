import { z } from 'zod';

/** Column-major 3×3 homogeneous matrix (matches src/math/core/mat3.ts). */
export const Mat3JsonSchema = z.object({
  type: z.literal('Mat3'),
  elements: z.tuple([
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
  ]),
});

export type Mat3Json = z.infer<typeof Mat3JsonSchema>;

export function identityMat3(): Mat3Json {
  return {
    type: 'Mat3',
    elements: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  };
}

export function translationMat3(x: number, y: number): Mat3Json {
  return {
    type: 'Mat3',
    elements: [1, 0, 0, 0, 1, 0, x, y, 1],
  };
}

/** Accept Mat3 objects or bare 9-number arrays (common LLM mistake). */
export function coerceMat3Json(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 9 && value.every((n) => typeof n === 'number')) {
    return {
      type: 'Mat3',
      elements: value as Mat3Json['elements'],
    };
  }
  return value;
}

/** Multiply two column-major Mat3Json values: result = a * b. */
export function multiplyMat3(a: Mat3Json, b: Mat3Json): Mat3Json {
  const ae = a.elements;
  const be = b.elements;
  return {
    type: 'Mat3',
    elements: [
      ae[0]! * be[0]! + ae[3]! * be[1]! + ae[6]! * be[2]!,
      ae[1]! * be[0]! + ae[4]! * be[1]! + ae[7]! * be[2]!,
      ae[2]! * be[0]! + ae[5]! * be[1]! + ae[8]! * be[2]!,
      ae[0]! * be[3]! + ae[3]! * be[4]! + ae[6]! * be[5]!,
      ae[1]! * be[3]! + ae[4]! * be[4]! + ae[7]! * be[5]!,
      ae[2]! * be[3]! + ae[5]! * be[4]! + ae[8]! * be[5]!,
      ae[0]! * be[6]! + ae[3]! * be[7]! + ae[6]! * be[8]!,
      ae[1]! * be[6]! + ae[4]! * be[7]! + ae[7]! * be[8]!,
      ae[2]! * be[6]! + ae[5]! * be[7]! + ae[8]! * be[8]!,
    ],
  };
}

/** SVG matrix(a b c d e f) from column-major Mat3: [m00,m10,m20, m01,m11,m21, m02,m12,m22]. */
export function mat3ToSvgMatrix(m: Mat3Json): string {
  const e = m.elements;
  return `matrix(${e[0]} ${e[1]} ${e[3]} ${e[4]} ${e[6]} ${e[7]})`;
}
