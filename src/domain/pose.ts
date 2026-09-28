import { z } from 'zod';
import { transformedRectAabb, type Aabb, type Mat3Json } from './mat3';

/**
 * A plain 2D point. No `type` tag, unlike the boundary `Vec2`: a solved layout stores
 * thousands of these, and the tag would be most of each one.
 */
export const PointJsonSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export type PointJson = z.infer<typeof PointJsonSchema>;

/**
 * Where one tile sits, applied in a fixed order: **mirror → rotate → move**.
 *
 * - `mirror` flips the tile's own x axis (its length) about the tile centre.
 * - `rotation` then turns it counter-clockwise about the centre, in degrees.
 * - `position` is where the centre ends up.
 *
 * As a matrix:
 * `T(position) · R(rotation) · S(mirror ? −1 : 1, 1) · T(−length/2, −width/2)`.
 * A flip in y is `rotation + 180` with `mirror`. All three work about the centre, so
 * mirroring or turning a tile never moves its footprint's middle.
 */
export const PoseJsonSchema = z.object({
  position: PointJsonSchema,
  rotation: z.number(),
  mirror: z.boolean(),
});

export type PoseJson = z.infer<typeof PoseJsonSchema>;

type TileSize = { length: number; width: number };

/** Degrees to the nearest whole degree when that is within float noise of it. */
const SNAP_DEGREES = 1e-9;

/** cos/sin in degrees, exact at quarter turns so axis-aligned tiles carry no 6e-17 noise. */
function cosSinDeg(degrees: number): [number, number] {
  const turn = ((degrees % 360) + 360) % 360;
  if (turn === 0) return [1, 0];
  if (turn === 90) return [0, 1];
  if (turn === 180) return [-1, 0];
  if (turn === 270) return [0, -1];
  const r = (degrees * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

/** An angle in degrees in [0, 360), snapped to a whole degree when it is float noise away. */
export function normalizeDegrees(degrees: number): number {
  let d = ((degrees % 360) + 360) % 360;
  const whole = Math.round(d);
  if (Math.abs(d - whole) < SNAP_DEGREES) d = whole;
  return d === 360 ? 0 : d;
}

export function createPose(position: PointJson, rotation = 0, mirror = false): PoseJson {
  return { position: { x: position.x, y: position.y }, rotation, mirror };
}

/** The tile-local → world matrix of a pose, for a tile of `length × width`. */
export function poseToMat3(pose: PoseJson, tile: TileSize): Mat3Json {
  const [c, s] = cosSinDeg(pose.rotation);
  const m = pose.mirror ? -1 : 1;
  // Linear part R · S: columns are the images of local x and local y.
  const a = c * m;
  const b = s * m;
  const cc = -s;
  const d = c;
  const hx = tile.length / 2;
  const hy = tile.width / 2;
  const tx = pose.position.x - a * hx - cc * hy;
  const ty = pose.position.y - b * hx - d * hy;
  return { type: 'Mat3', elements: [a, b, 0, cc, d, 0, tx, ty, 1] };
}

/**
 * The pose of a rigid tile-local → world matrix — the inverse of `poseToMat3`.
 *
 * Only rotations and mirrors survive: a matrix with scale or shear (a skewed grid frame, say)
 * has no pose, and its linear part is read as if it were orthonormal.
 */
export function mat3ToPose(mat3: Mat3Json, tile: TileSize): PoseJson {
  const [a0, b0, , c, d, , tx, ty] = mat3.elements;
  const hx = tile.length / 2;
  const hy = tile.width / 2;
  const mirror = a0 * d - c * b0 < 0;
  // Undo the mirror on local x; what remains is a pure rotation whose first column is (cos, sin).
  const a = mirror ? -a0 : a0;
  const b = mirror ? -b0 : b0;
  return {
    position: { x: a0 * hx + c * hy + tx, y: b0 * hx + d * hy + ty },
    rotation: normalizeDegrees((Math.atan2(b, a) * 180) / Math.PI),
    mirror,
  };
}

/** World envelope of a tile at `pose`. */
export function poseAabb(pose: PoseJson, tile: TileSize): Aabb {
  return transformedRectAabb(poseToMat3(pose, tile), tile.length, tile.width);
}
