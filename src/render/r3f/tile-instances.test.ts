import { describe, expect, it } from 'vitest';
import { BoxGeometry, Matrix3, Matrix4, Vector3 } from 'three';
import type { PlacementJson } from '@/domain/instance';
import {
  multiplyMat3,
  rotationMat3,
  scaleMat3,
  translationMat3,
  transformPointMat3,
  type Mat3Json,
} from '@/domain/mat3';
import type { MaterialDefinitionJson } from '@/domain/material';
import { defaultMaterials } from '@/domain/material-presets';
import { createTileDefinition, type TileDefinitionJson } from '@/domain/tile';
import {
  buildTileInstances,
  decomposePlacement,
  DEFAULT_TILE_VARIATION,
  materialAllowsOffset,
  MAX_TINT,
  normalizeTileVariation,
  TINT_STEP,
  variationFor,
  type TileVariationSettings,
} from './tile-instances';

const L = 0.6;
const W = 0.3;
const T = 0.02;
const tile: TileDefinitionJson = createTileDefinition({ id: 'plain', length: L, width: W, thickness: T });
const edged: TileDefinitionJson = createTileDefinition({
  id: 'edged',
  length: L,
  width: W,
  thickness: T,
  rhythm: {
    south: { name: 'A', mirrored: false },
    north: { name: 'A', mirrored: false },
    east: { name: 'B', mirrored: false },
    west: { name: 'B', mirrored: false },
  },
});

const ON: TileVariationSettings = { enabled: true, offset: 1, tint: 0.2, seed: 7 };
const OFF: TileVariationSettings = { ...ON, enabled: false };

/** Mirrors orientationMat3 in tile-grid-fill.ts, rebuilt from the exported mat3 helpers. */
function orientation(rotated: boolean, flipX: boolean, flipY: boolean): Mat3Json {
  const orient = rotated
    ? multiplyMat3(translationMat3(W, 0), rotationMat3(Math.PI / 2))
    : null;
  const w = rotated ? W : L;
  const h = rotated ? L : W;
  const mirror =
    flipX || flipY
      ? multiplyMat3(translationMat3(flipX ? w : 0, flipY ? h : 0), scaleMat3(flipX ? -1 : 1, flipY ? -1 : 1))
      : null;
  if (mirror && orient) return multiplyMat3(mirror, orient);
  return mirror ?? orient ?? translationMat3(0, 0);
}

/** Every flip × rotation case, under a rotated frame, a plain frame and a mirrored frame. */
function allCases(): Array<{ name: string; mat3: Mat3Json }> {
  const frames: Array<[string, Mat3Json]> = [
    ['plain', translationMat3(1.25, -0.4)],
    ['rotated', multiplyMat3(translationMat3(-2.1, 3.3), rotationMat3(0.73))],
    ['mirrored', multiplyMat3(translationMat3(0.5, 0.9), scaleMat3(-1, 1))],
  ];
  const out: Array<{ name: string; mat3: Mat3Json }> = [];
  for (const [frameName, frame] of frames) {
    for (const rotated of [false, true]) {
      for (const flipX of [false, true]) {
        for (const flipY of [false, true]) {
          out.push({
            name: `${frameName} rot=${rotated} fx=${flipX} fy=${flipY}`,
            mat3: multiplyMat3(frame, orientation(rotated, flipX, flipY)),
          });
        }
      }
    }
  }
  return out;
}

/** The Matrix4 the scene built for a plain Mesh before instancing. */
function legacyMatrix(mat3: Mat3Json): Matrix4 {
  const [m00, m10, , m01, m11, , m02, m12] = mat3.elements;
  const m = new Matrix4().set(m00, m01, 0, m02, m10, m11, 0, m12, 0, 0, 1, 0, 0, 0, 0, 1);
  return m.multiply(new Matrix4().makeTranslation(L / 2, W / 2, T / 2));
}

function det2(matrix: number[]): number {
  return matrix[0]! * matrix[5]! - matrix[4]! * matrix[1]!;
}

function placement(mat3: Mat3Json, tileDefinitionId = tile.id): PlacementJson {
  return { id: crypto.randomUUID(), tileDefinitionId, mat3 } as PlacementJson;
}

describe('decomposePlacement', () => {
  it.each(allCases().map((c) => [c.name, c] as const))('keeps det > 0: %s', (_n, { mat3 }) => {
    expect(det2(decomposePlacement(mat3, tile).matrix)).toBeGreaterThan(0);
  });

  it.each(allCases().map((c) => [c.name, c] as const))(
    'sets mirrorU exactly when the placement is mirrored: %s',
    (_n, { mat3 }) => {
      const e = mat3.elements;
      const mirrored = e[0] * e[4] - e[3] * e[1] < 0;
      expect(decomposePlacement(mat3, tile).mirrorU).toBe(mirrored ? 1 : 0);
    },
  );

  it.each(allCases().map((c) => [c.name, c] as const))(
    'occupies exactly the same box: %s',
    (_n, { mat3 }) => {
      const pose = decomposePlacement(mat3, tile);
      const instance = new Matrix4().fromArray(pose.matrix);
      const legacy = legacyMatrix(mat3);
      const key = (v: Vector3) => [v.x, v.y, v.z].map((n) => n.toFixed(9)).join(',');
      const fresh: string[] = [];
      const old: string[] = [];
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const corner = new Vector3((sx * L) / 2, (sy * W) / 2, (sz * T) / 2);
            fresh.push(key(corner.clone().applyMatrix4(instance)));
            old.push(key(corner.clone().applyMatrix4(legacy)));
          }
        }
      }
      expect(fresh.sort()).toEqual(old.sort());
    },
  );

  it('puts the centre where the old mesh centre was', () => {
    for (const { mat3 } of allCases()) {
      const c = transformPointMat3(mat3, L / 2, W / 2);
      const pose = decomposePlacement(mat3, tile);
      expect(pose.center[0]).toBeCloseTo(c.x, 12);
      expect(pose.center[1]).toBeCloseTo(c.y, 12);
    }
  });

  // The proof that mirrored tiles look exactly as they did before, as a test: every vertex of
  // the real BoxGeometry, on all six faces, gets the same UV through the new instance matrix
  // plus the shader's u-mirror as it got through the old mirrored mesh.
  it.each(allCases().map((c) => [c.name, c] as const))(
    'reproduces the old texture on every face: %s',
    (_n, { mat3 }) => {
      const box = new BoxGeometry(L, W, T);
      const pos = box.getAttribute('position');
      const nrm = box.getAttribute('normal');
      const uv = box.getAttribute('uv');

      const legacy = legacyMatrix(mat3);
      const legacyNormal = new Matrix3().getNormalMatrix(legacy);
      const pose = decomposePlacement(mat3, tile);
      const instance = new Matrix4().fromArray(pose.matrix);
      const instanceNormal = new Matrix3().getNormalMatrix(instance);

      const vertexKey = (p: Vector3, n: Vector3) =>
        [p.x, p.y, p.z, n.x, n.y, n.z].map((v) => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(6)).join(',');

      const legacyUv = new Map<string, [number, number]>();
      for (let j = 0; j < pos.count; j += 1) {
        const p = new Vector3().fromBufferAttribute(pos, j).applyMatrix4(legacy);
        const n = new Vector3().fromBufferAttribute(nrm, j).applyMatrix3(legacyNormal).normalize();
        legacyUv.set(vertexKey(p, n), [uv.getX(j), uv.getY(j)]);
      }

      let matched = 0;
      for (let j = 0; j < pos.count; j += 1) {
        const p = new Vector3().fromBufferAttribute(pos, j).applyMatrix4(instance);
        const n = new Vector3().fromBufferAttribute(nrm, j).applyMatrix3(instanceNormal).normalize();
        const expected = legacyUv.get(vertexKey(p, n));
        expect(expected, `no legacy vertex at ${vertexKey(p, n)}`).toBeDefined();
        const u = uv.getX(j);
        const shaderU = pose.mirrorU ? 1 - u : u;
        expect(shaderU).toBeCloseTo(expected![0], 9);
        expect(uv.getY(j)).toBeCloseTo(expected![1], 9);
        matched += 1;
      }
      expect(matched).toBe(24);
    },
  );
});

describe('variationFor', () => {
  const both = { offset: true, tint: true };

  it('is deterministic', () => {
    expect(variationFor('t', [0.3, 0.15], ON, both)).toEqual(variationFor('t', [0.3, 0.15], ON, both));
  });

  it('changes with the seed', () => {
    let differs = 0;
    for (let i = 0; i < 50; i += 1) {
      const c: [number, number] = [i * 0.3, i * 0.15];
      const a = variationFor('t', c, ON, both);
      const b = variationFor('t', c, { ...ON, seed: 8 }, both);
      if (a.offset[0] !== b.offset[0]) differs += 1;
    }
    expect(differs).toBeGreaterThan(40);
  });

  // Regression for the quantum: a half cell of 0.075 m puts a centre on an exact
  // half-millimetre, where millimetre rounding would let float noise flip the variation.
  it('ignores float noise, including on half-millimetre centres', () => {
    for (const c of [0.0375, 0.3375, 1.2, 0.15]) {
      const base = variationFor('t', [c, c], ON, both);
      expect(variationFor('t', [c + 1e-9, c - 1e-9], ON, both)).toEqual(base);
      expect(variationFor('t', [c - 1e-9, c + 1e-9], ON, both)).toEqual(base);
    }
  });

  it('keeps offsets inside [0, strength) and tints inside [1 - t, 1] on the rounding grid', () => {
    const settings = { ...ON, offset: 0.4, tint: 0.2 };
    for (let i = 0; i < 400; i += 1) {
      const v = variationFor('t', [i * 0.6, i * 0.3], settings, both);
      for (const o of v.offset) {
        expect(o).toBeGreaterThanOrEqual(0);
        expect(o).toBeLessThan(0.4);
      }
      expect(v.tint).toBeLessThanOrEqual(1);
      expect(v.tint).toBeGreaterThanOrEqual(1 - 0.2 - TINT_STEP / 2);
      expect(Number.isInteger(v.tint / TINT_STEP)).toBe(true);
    }
  });

  it('never brightens, so a tint always fits glTF baseColorFactor', () => {
    for (let i = 0; i < 400; i += 1) {
      expect(variationFor('t', [i, i * 2], { ...ON, tint: MAX_TINT }, both).tint).toBeLessThanOrEqual(1);
    }
  });

  it('keeps offsets identical when tint is toggled', () => {
    const c: [number, number] = [0.9, 0.45];
    const withTint = variationFor('t', c, ON, both);
    const noTint = variationFor('t', c, ON, { offset: true, tint: false });
    const zeroTint = variationFor('t', c, { ...ON, tint: 0 }, both);
    expect(noTint.offset).toEqual(withTint.offset);
    expect(zeroTint.offset).toEqual(withTint.offset);
    expect(noTint.tint).toBe(1);
  });

  it('gives no offset when offset is not allowed, but still tints', () => {
    const v = variationFor('t', [0.9, 0.45], ON, { offset: false, tint: true });
    expect(v.offset).toEqual([0, 0]);
    expect(v.tint).toBeLessThanOrEqual(1);
  });
});

describe('buildTileInstances', () => {
  const layout = (tileId = tile.id) =>
    [
      orientation(false, false, false),
      orientation(false, true, false),
      orientation(true, false, true),
      orientation(false, true, true),
    ].map((m, i) => placement(multiplyMat3(translationMat3(i * 0.6, 0), m), tileId));
  const tiles = new Map([
    [tile.id, tile],
    [edged.id, edged],
  ]);

  it('groups by tile type with the right buffer sizes', () => {
    const groups = buildTileInstances([...layout(), ...layout(edged.id)], tiles, ON);
    expect([...groups.keys()].sort()).toEqual(['edged', 'plain']);
    const g = groups.get(tile.id)!;
    expect(g.count).toBe(4);
    expect(g.matrices.length).toBe(64);
    expect(g.uvXform.length).toBe(12);
    expect(g.tints!.length).toBe(4);
  });

  it('skips placements of unknown tiles', () => {
    const groups = buildTileInstances([placement(translationMat3(0, 0), 'missing')], tiles, ON);
    expect(groups.size).toBe(0);
  });

  it('does not depend on placement ids or order', () => {
    const a = layout();
    const b = [...a].reverse().map((p) => ({ ...p, id: crypto.randomUUID() }));
    const byCentre = (list: PlacementJson[]) => {
      const g = buildTileInstances(list, tiles, ON).get(tile.id)!;
      const map = new Map<string, number[]>();
      for (let i = 0; i < g.count; i += 1) {
        const m = g.matrices.subarray(i * 16, i * 16 + 16);
        map.set(`${m[12]!.toFixed(4)},${m[13]!.toFixed(4)}`, [
          g.uvXform[i * 3]!,
          g.uvXform[i * 3 + 1]!,
          g.uvXform[i * 3 + 2]!,
          g.tints![i]!,
        ]);
      }
      return map;
    };
    expect(byCentre(b)).toEqual(byCentre(a));
  });

  it('never offsets or tints an edged tile, but still carries its mirror', () => {
    const g = buildTileInstances(layout(edged.id), tiles, ON).get(edged.id)!;
    expect(g.tints).toBeNull();
    for (let i = 0; i < g.count; i += 1) {
      expect(g.uvXform[i * 3]).toBe(0);
      expect(g.uvXform[i * 3 + 1]).toBe(0);
    }
    expect([...g.uvXform].filter((_, k) => k % 3 === 2)).toContain(1);
  });

  it('turns offset and tint off when disabled, but still carries mirrors', () => {
    const g = buildTileInstances(layout(), tiles, OFF).get(tile.id)!;
    expect(g.tints).toBeNull();
    expect([...g.uvXform].filter((_, k) => k % 3 !== 2).every((v) => v === 0)).toBe(true);
    expect([...g.uvXform].filter((_, k) => k % 3 === 2)).toEqual([0, 1, 1, 0]);
  });

  it('respects offsetAllowed per tile type', () => {
    const g = buildTileInstances(layout(), tiles, ON, () => false).get(tile.id)!;
    expect([...g.uvXform].filter((_, k) => k % 3 !== 2).every((v) => v === 0)).toBe(true);
    expect(g.tints).not.toBeNull();
  });

  it('writes only positive-determinant matrices', () => {
    for (const { mat3 } of allCases()) {
      const g = buildTileInstances([placement(mat3)], tiles, ON).get(tile.id)!;
      const m = [...g.matrices];
      expect(det2(m)).toBeGreaterThan(0);
    }
  });
});

describe('materialAllowsOffset', () => {
  it('allows every shipped preset', () => {
    for (const m of defaultMaterials()) expect(materialAllowsOffset(m, tile)).toBe(true);
  });

  it('refuses a material whose field is not periodic, so an offset would expose its seam', () => {
    const base = defaultMaterials()[0]!;
    const bad: MaterialDefinitionJson = {
      ...base,
      sdf: { op: 'rotate', angle: 0.7, child: { op: 'noise', scale: 10 } },
    };
    expect(materialAllowsOffset(bad, tile)).toBe(false);
  });

  it('allows a tile with no material', () => {
    expect(materialAllowsOffset(undefined, tile)).toBe(true);
  });
});

describe('normalizeTileVariation', () => {
  it('fills in a missing or partial stored value', () => {
    expect(normalizeTileVariation(undefined)).toEqual(DEFAULT_TILE_VARIATION);
    expect(normalizeTileVariation({ offset: 0.3 })).toEqual({ ...DEFAULT_TILE_VARIATION, offset: 0.3 });
  });

  it('clamps out-of-range values', () => {
    const v = normalizeTileVariation({ enabled: 'yes', offset: 5, tint: -1, seed: -3.7 });
    expect(v.enabled).toBe(DEFAULT_TILE_VARIATION.enabled);
    expect(v.offset).toBe(1);
    expect(v.tint).toBe(0);
    expect(Number.isInteger(v.seed) && v.seed >= 0).toBe(true);
  });
});
