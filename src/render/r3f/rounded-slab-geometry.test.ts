import { describe, expect, it } from 'vitest';
import { BoxGeometry, Matrix3, Matrix4, Vector3, type BufferGeometry } from 'three';
import {
  multiplyMat3,
  rotationMat3,
  scaleMat3,
  translationMat3,
  type Mat3Json,
} from '@/domain/mat3';
import { createTileDefinition } from '@/domain/tile';
import {
  createRoundedSlabGeometry,
  createTileBaseGeometry,
  ROUNDED_SEGMENTS_PER_QUARTER,
  roundedRectOutline,
} from './rounded-slab-geometry';
import { decomposePlacement } from './tile-instances';

const L = 0.6;
const W = 0.3;
const T = 0.02;
const R = 0.03;
const geometry = createRoundedSlabGeometry(L, W, T, R);

type Vertex = { p: Vector3; n: Vector3; u: number; v: number };
function vertices(g: BufferGeometry): Vertex[] {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  return Array.from({ length: pos.count }, (_, i) => ({
    p: new Vector3().fromBufferAttribute(pos, i),
    n: new Vector3().fromBufferAttribute(nrm, i),
    u: uv.getX(i),
    v: uv.getY(i),
  }));
}
/** Attributes are float32: quantise keys well above float32 noise, well below vertex spacing. */
const key = (...values: number[]) => values.map((x) => (Math.abs(x) < 1e-5 ? 0 : x).toFixed(4)).join(',');
/** float32 precision for toBeCloseTo. */
const F32 = 6;

describe('createRoundedSlabGeometry', () => {
  const vs = vertices(geometry);

  it('fills the tile bounds exactly', () => {
    const box = geometry.boundingBox!;
    expect(box.min.x).toBeCloseTo(-L / 2, F32);
    expect(box.max.x).toBeCloseTo(L / 2, F32);
    expect(box.min.y).toBeCloseTo(-W / 2, F32);
    expect(box.max.y).toBeCloseTo(W / 2, F32);
    expect(box.min.z).toBeCloseTo(-T / 2, F32);
    expect(box.max.z).toBeCloseTo(T / 2, F32);
  });

  it('puts every wall vertex at the corner radius from its corner centre, with a radial normal', () => {
    for (const { p, n } of vs.filter((x) => Math.abs(x.n.z) < 1e-6)) {
      const cx = Math.sign(p.x) * (L / 2 - R);
      const cy = Math.sign(p.y) * (W / 2 - R);
      expect(Math.hypot(p.x - cx, p.y - cy)).toBeCloseTo(R, F32);
      expect(n.x).toBeCloseTo((p.x - cx) / R, 4);
      expect(n.y).toBeCloseTo((p.y - cy) / R, 4);
    }
  });

  it('uses planar UVs on every vertex', () => {
    for (const { p, u, v } of vs) {
      expect(u).toBeCloseTo(p.x / L + 0.5, F32);
      expect(v).toBeCloseTo(p.y / W + 0.5, F32);
    }
  });

  it('has unit normals, radial on the walls and ±z on the caps — a sharp crease at the rim', () => {
    for (const { n } of vs) expect(n.length()).toBeCloseTo(1, F32);
    const rimTop = vs.filter((x) => Math.abs(x.p.z - T / 2) < 1e-6 && Math.abs(Math.hypot(x.p.x, x.p.y)) > 0.01);
    expect(rimTop.some((x) => Math.abs(x.n.z - 1) < 1e-6)).toBe(true);
    expect(rimTop.some((x) => Math.abs(x.n.z) < 1e-6)).toBe(true);
  });

  // The property that keeps the instancing mirror trick exact for rounded tiles.
  it('is symmetric under x → −x with u → 1 − u', () => {
    const set = new Set(vs.map((x) => key(x.p.x, x.p.y, x.p.z, x.n.x, x.n.y, x.n.z, x.u, x.v)));
    for (const x of vs) {
      expect(set.has(key(-x.p.x, x.p.y, x.p.z, -x.n.x, x.n.y, x.n.z, 1 - x.u, x.v))).toBe(true);
    }
  });

  it('winds every triangle to face its vertex normals', () => {
    const index = geometry.getIndex()!;
    for (let t = 0; t < index.count; t += 3) {
      const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)].map((i) => vs[i]!);
      const face = new Vector3().subVectors(b!.p, a!.p).cross(new Vector3().subVectors(c!.p, a!.p));
      if (face.length() < 1e-12) continue;
      const avg = a!.n.clone().add(b!.n).add(c!.n);
      expect(face.dot(avg)).toBeGreaterThan(0);
    }
  });

  it('has the area of a rounded rectangle, within the chord error', () => {
    const index = geometry.getIndex()!;
    let area = 0;
    for (let t = 0; t < index.count; t += 3) {
      const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)].map((i) => vs[i]!);
      if (!(Math.abs(a!.n.z - 1) < 1e-6 && Math.abs(b!.n.z - 1) < 1e-6 && Math.abs(c!.n.z - 1) < 1e-6)) continue;
      area += new Vector3().subVectors(b!.p, a!.p).cross(new Vector3().subVectors(c!.p, a!.p)).length() / 2;
    }
    expect(Math.abs(area - (L * W - (4 - Math.PI) * R * R))).toBeLessThan(0.03 * R * R);
  });

  it('uses the plain box at zero radius, keeping square-tile parity untouched', () => {
    expect(createTileBaseGeometry(L, W, T, 0)).toBeInstanceOf(BoxGeometry);
    expect(createTileBaseGeometry(L, W, T, R)).not.toBeInstanceOf(BoxGeometry);
  });
});

describe('roundedRectOutline', () => {
  const n = ROUNDED_SEGMENTS_PER_QUARTER;

  it('is the four corners at zero radius and 4·(n + 1) points otherwise', () => {
    expect(roundedRectOutline(L, W, 0)).toHaveLength(4);
    expect(roundedRectOutline(L, W, 1e-7)).toHaveLength(4);
    expect(roundedRectOutline(L, W, R)).toHaveLength(4 * (n + 1));
  });

  it.each([0, R, W / 2])('winds counter-clockwise inside the tile, without repeated points: r = %s', (r) => {
    const ring = roundedRectOutline(L, W, r);
    let area = 0;
    ring.forEach((p, k) => {
      const q = ring[(k + 1) % ring.length]!;
      area += p.x * q.y - q.x * p.y;
      expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeGreaterThan(1e-12);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(L / 2 + 1e-12);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(W / 2 + 1e-12);
    });
    expect(area).toBeGreaterThan(0);
  });

  it('is exactly the ring the slab walls stand on', () => {
    const ring = roundedRectOutline(L, W, R);
    const top = vertices(geometry).slice(ring.length, 2 * ring.length);
    ring.forEach((p, k) => {
      expect(top[k]!.p.x).toBeCloseTo(p.x, F32);
      expect(top[k]!.p.y).toBeCloseTo(p.y, F32);
      expect(top[k]!.p.z).toBeCloseTo(T / 2, F32);
    });
  });
});

// ------------------------------------------------------------------ mirror instancing
/** Mirrors orientationMat3 in tile-grid-fill.ts, rebuilt from the exported mat3 helpers. */
function orientation(rotated: boolean, flipX: boolean, flipY: boolean): Mat3Json {
  const orient = rotated ? multiplyMat3(translationMat3(W, 0), rotationMat3(Math.PI / 2)) : null;
  const w = rotated ? W : L;
  const h = rotated ? L : W;
  const mirror =
    flipX || flipY
      ? multiplyMat3(translationMat3(flipX ? w : 0, flipY ? h : 0), scaleMat3(flipX ? -1 : 1, flipY ? -1 : 1))
      : null;
  if (mirror && orient) return multiplyMat3(mirror, orient);
  return mirror ?? orient ?? translationMat3(0, 0);
}

function cases(): Array<[string, Mat3Json]> {
  const frames: Array<[string, Mat3Json]> = [
    ['plain', translationMat3(1.25, -0.4)],
    ['rotated', multiplyMat3(translationMat3(-2.1, 3.3), rotationMat3(0.73))],
    ['mirrored', multiplyMat3(translationMat3(0.5, 0.9), scaleMat3(-1, 1))],
  ];
  const out: Array<[string, Mat3Json]> = [];
  for (const [name, frame] of frames)
    for (const rotated of [false, true])
      for (const fx of [false, true])
        for (const fy of [false, true])
          out.push([`${name} rot=${rotated} fx=${fx} fy=${fy}`, multiplyMat3(frame, orientation(rotated, fx, fy))]);
  return out;
}

describe('rounded tiles under instancing', () => {
  const tile = createTileDefinition({ length: L, width: W, thickness: T });

  // A plain mirrored mesh of the rounded slab, versus the positive-determinant instance plus the
  // shader's u-mirror: every vertex, on every face, must land in the same place with the same UV.
  it.each(cases())('shows the same texture as a plain mirrored mesh: %s', (_name, mat3) => {
    const [m00, m10, , m01, m11, , m02, m12] = mat3.elements;
    const legacy = new Matrix4()
      .set(m00, m01, 0, m02, m10, m11, 0, m12, 0, 0, 1, 0, 0, 0, 0, 1)
      .multiply(new Matrix4().makeTranslation(L / 2, W / 2, T / 2));
    const legacyNormal = new Matrix3().getNormalMatrix(legacy);
    const pose = decomposePlacement(mat3, tile);
    const instance = new Matrix4().fromArray(pose.matrix);
    const instanceNormal = new Matrix3().getNormalMatrix(instance);

    const vs = vertices(geometry);
    const legacyUv = new Map<string, [number, number]>();
    for (const x of vs) {
      const p = x.p.clone().applyMatrix4(legacy);
      const n = x.n.clone().applyMatrix3(legacyNormal).normalize();
      legacyUv.set(key(p.x, p.y, p.z, n.x, n.y, n.z), [x.u, x.v]);
    }
    let matched = 0;
    for (const x of vs) {
      const p = x.p.clone().applyMatrix4(instance);
      const n = x.n.clone().applyMatrix3(instanceNormal).normalize();
      const expected = legacyUv.get(key(p.x, p.y, p.z, n.x, n.y, n.z));
      expect(expected).toBeDefined();
      expect(pose.mirrorU ? 1 - x.u : x.u).toBeCloseTo(expected![0], F32);
      expect(x.v).toBeCloseTo(expected![1], F32);
      matched += 1;
    }
    expect(matched).toBe(vs.length);
  });
});
