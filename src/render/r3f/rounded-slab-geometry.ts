import { BoxGeometry, BufferGeometry, Float32BufferAttribute } from 'three';

export const ROUNDED_SEGMENTS_PER_QUARTER = 8;

/** Radii below this are treated as square corners. */
const MIN_RADIUS = 1e-6;

export type OutlinePoint = { x: number; y: number; nx: number; ny: number };

/**
 * The plan outline of a centred rounded rectangle, as four counter-clockwise corner arcs of
 * `segments + 1` points each, starting in the +x +y quadrant. The first and last point of each
 * arc are its tangent points on the straight sides; `nx, ny` is the outward radial normal.
 *
 * The one source of the rounded outline: the tile slab's walls and the holes grout leaves for
 * the tiles both come from here, so they coincide exactly.
 *
 * At a radius of `MIN_RADIUS` or less the radius is 0 and each "arc" is its single corner point.
 */
export function roundedRectQuarters(
  length: number,
  width: number,
  radius: number,
  segments = ROUNDED_SEGMENTS_PER_QUARTER,
): { radius: number; quarters: OutlinePoint[][] } {
  const r = Math.min(Math.max(radius, 0), Math.min(length, width) / 2 - MIN_RADIUS);
  const hx = length / 2;
  const hy = width / 2;
  const signs: Array<[number, number]> = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];
  if (!(r > MIN_RADIUS)) {
    return {
      radius: 0,
      quarters: signs.map(([sx, sy]) => [{ x: sx * hx, y: sy * hy, nx: sx * Math.SQRT1_2, ny: sy * Math.SQRT1_2 }]),
    };
  }
  const n = Math.max(1, Math.floor(segments));

  // Corner centres in counter-clockwise order, starting in the +x +y quadrant.
  const centres: Array<[number, number]> = [
    [hx - r, hy - r],
    [-(hx - r), hy - r],
    [-(hx - r), -(hy - r)],
    [hx - r, -(hy - r)],
  ];
  const quarters = centres.map(([cx, cy], q) => {
    const arc: OutlinePoint[] = [];
    for (let k = 0; k <= n; k += 1) {
      const angle = ((q + k / n) * Math.PI) / 2;
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);
      arc.push({ x: cx + r * nx, y: cy + r * ny, nx, ny });
    }
    return arc;
  });
  return { radius: r, quarters };
}

/** `roundedRectQuarters` as one counter-clockwise ring, without consecutive duplicates. */
export function roundedRectOutline(
  length: number,
  width: number,
  radius: number,
  segments = ROUNDED_SEGMENTS_PER_QUARTER,
): OutlinePoint[] {
  const ring: OutlinePoint[] = [];
  for (const p of roundedRectQuarters(length, width, radius, segments).quarters.flat()) {
    const last = ring[ring.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) <= 1e-12) continue;
    ring.push(p);
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 1 && first && last && Math.hypot(first.x - last.x, first.y - last.y) <= 1e-12) ring.pop();
  return ring;
}

/**
 * A centred tile slab with rounded plan-view corners.
 *
 * - **Walls** follow a ring of `4 · (segments + 1)` points going counter-clockwise, with
 *   radial normals, so the corner arcs shade smoothly. The end of one arc and the start of the
 *   next share a tangent, so the straight edges need no extra vertices.
 * - **Caps** duplicate the ring with ±z normals and fan from a centre vertex. The duplication
 *   is what gives a sharp crease at the top edge instead of a rounded-looking rim.
 * - **UVs are planar on every vertex**, `u = x/L + 0.5`, `v = y/W + 0.5`.
 *
 * Planar UVs are what keep the instancing mirror trick exact: `decomposePlacement` renders a
 * mirrored placement as this geometry with its x axis negated and u mirrored in the shader,
 * which is only correct for geometry that is symmetric under x → −x with u → 1 − u. This slab
 * is — corner 0 maps onto corner 1 and 3 onto 2 — and a planar u is linear in x.
 */
export function createRoundedSlabGeometry(
  length: number,
  width: number,
  thickness: number,
  radius: number,
  segments = ROUNDED_SEGMENTS_PER_QUARTER,
): BufferGeometry {
  const hz = thickness / 2;
  const ring = roundedRectOutline(length, width, radius, segments);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const vertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(x / length + 0.5, y / width + 0.5);
    return positions.length / 3 - 1;
  };

  const count = ring.length;

  // Walls: bottom and top rings with radial normals.
  const bottom = ring.map((p) => vertex(p.x, p.y, -hz, p.nx, p.ny, 0));
  const top = ring.map((p) => vertex(p.x, p.y, hz, p.nx, p.ny, 0));
  for (let k = 0; k < count; k += 1) {
    const next = (k + 1) % count;
    // For a counter-clockwise ring, (b_k, b_next, t_next) faces outward.
    indices.push(bottom[k]!, bottom[next]!, top[next]!);
    indices.push(bottom[k]!, top[next]!, top[k]!);
  }

  // Top cap: fan from the centre, counter-clockwise from +z.
  const topCentre = vertex(0, 0, hz, 0, 0, 1);
  const topRing = ring.map((p) => vertex(p.x, p.y, hz, 0, 0, 1));
  for (let k = 0; k < count; k += 1) {
    indices.push(topCentre, topRing[k]!, topRing[(k + 1) % count]!);
  }

  // Bottom cap: the same fan, wound the other way.
  const bottomCentre = vertex(0, 0, -hz, 0, 0, -1);
  const bottomRing = ring.map((p) => vertex(p.x, p.y, -hz, 0, 0, -1));
  for (let k = 0; k < count; k += 1) {
    indices.push(bottomCentre, bottomRing[(k + 1) % count]!, bottomRing[k]!);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The tile's base geometry: the plain box at zero radius, so the pixel parity already verified
 * for square tiles is untouched, and the rounded slab otherwise.
 */
export function createTileBaseGeometry(
  length: number,
  width: number,
  thickness: number,
  radius: number,
): BufferGeometry {
  if (!(radius > MIN_RADIUS)) return new BoxGeometry(length, width, thickness);
  return createRoundedSlabGeometry(length, width, thickness, radius);
}
