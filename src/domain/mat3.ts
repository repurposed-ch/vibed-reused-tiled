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

/** Counter-clockwise rotation about the local origin, in radians. */
export function rotationMat3(angle: number): Mat3Json {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    type: 'Mat3',
    elements: [c, s, 0, -s, c, 0, 0, 0, 1],
  };
}

/** Scale about the local origin. Negative factors mirror, which is intentional. */
export function scaleMat3(sx: number, sy: number): Mat3Json {
  return {
    type: 'Mat3',
    elements: [sx, 0, 0, 0, sy, 0, 0, 0, 1],
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

/** Apply a Mat3Json to a point, translation included. */
export function transformPointMat3(m: Mat3Json, x: number, y: number): { x: number; y: number } {
  const e = m.elements;
  return {
    x: e[0]! * x + e[3]! * y + e[6]!,
    y: e[1]! * x + e[4]! * y + e[7]!,
  };
}

export type Aabb = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * World envelope of a `width × height` rectangle placed by `mat3`.
 *
 * Reuse context: callers used to read `elements[6]/[7]` and add `tile.length` /
 * `tile.width` directly, which silently assumes the placement is axis-aligned and
 * unrotated. Rotated or mirrored placements need the transformed corners, so
 * every footprint and viewBox calculation goes through here.
 */
export function transformedRectAabb(m: Mat3Json, width: number, height: number): Aabb {
  const corners = [
    transformPointMat3(m, 0, 0),
    transformPointMat3(m, width, 0),
    transformPointMat3(m, width, height),
    transformPointMat3(m, 0, height),
  ];
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxX: Math.max(...corners.map((c) => c.x)),
    maxY: Math.max(...corners.map((c) => c.y)),
  };
}

/** World envelope of a tile placed by `mat3`, using its `length × width` footprint. */
export function placementAabb(
  m: Mat3Json,
  tile: { length: number; width: number },
): Aabb {
  return transformedRectAabb(m, tile.length, tile.width);
}

/** SVG matrix(a b c d e f) from column-major Mat3: [m00,m10,m20, m01,m11,m21, m02,m12,m22]. */
export function mat3ToSvgMatrix(m: Mat3Json): string {
  const e = m.elements;
  return `matrix(${e[0]} ${e[1]} ${e[3]} ${e[4]} ${e[6]} ${e[7]})`;
}
