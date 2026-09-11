import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RELIEF,
  DEFAULT_ROUGHNESS,
  MaterialDefinitionJsonSchema,
  type SdfNodeJson,
} from '@/domain/material';
import { defaultMaterials } from '@/domain/material-presets';
import { createDefaultProject, parseTilingProject } from '@/domain/project';
import { roughnessAt, surfaceNormalAt, type Vec2 } from './sdf-cpu';
import { materialRecipeHash } from './texture-cache';

const TILE: Vec2 = [0.6, 0.3];
const TEXEL = 1 / 1024;
const SEED = 11;

/** Always 1 — a disc far larger than the tile. */
const FLAT: SdfNodeJson = { op: 'fill', soft: 0.01, child: { op: 'circle', radius: 10 } };

/**
 * One band across the tile with maximal softness: shade rises over uv.x 0..0.5 and falls
 * over 0.5..1, and does not vary in y at all — a ramp whose gradient sign is known.
 */
const RAMP_X: SdfNodeJson = { op: 'stripe', axis: 'x', spacing: 0.6, duty: 0.5, soft: 0.5 };

describe('surface normal', () => {
  it('is straight up on a constant field', () => {
    const n = surfaceNormalAt(FLAT, [0.37, 0.61], SEED, TILE, 0.004, TEXEL);
    expect(n[0]).toBeCloseTo(0, 12);
    expect(n[1]).toBeCloseTo(0, 12);
    expect(n[2]).toBeCloseTo(1, 12);
  });

  it('is straight up for any field when relief is zero', () => {
    const noise: SdfNodeJson = { op: 'noise', scale: 10, octaves: 4 };
    const n = surfaceNormalAt(noise, [0.2, 0.4], SEED, TILE, 0, TEXEL);
    expect(n[0]).toBeCloseTo(0, 12);
    expect(n[1]).toBeCloseTo(0, 12);
    expect(n[2]).toBeCloseTo(1, 12);
  });

  // Pins the sign convention in a test rather than a comment: the normal leans AWAY from
  // the uphill direction, so a field rising in +x gives a negative x component.
  it('leans away from the uphill direction', () => {
    const rising = surfaceNormalAt(RAMP_X, [0.25, 0.5], SEED, TILE, 0.002, TEXEL);
    const falling = surfaceNormalAt(RAMP_X, [0.75, 0.5], SEED, TILE, 0.002, TEXEL);
    expect(rising[0]).toBeLessThan(0);
    expect(falling[0]).toBeGreaterThan(0);
    expect(rising[1]).toBeCloseTo(0, 12);
    expect(falling[1]).toBeCloseTo(0, 12);
  });

  it('engraves with negative relief: the lean reverses, so bright areas sink', () => {
    const raised = surfaceNormalAt(RAMP_X, [0.25, 0.5], SEED, TILE, 0.002, TEXEL);
    const engraved = surfaceNormalAt(RAMP_X, [0.25, 0.5], SEED, TILE, -0.002, TEXEL);
    expect(engraved[0]).toBeCloseTo(-raised[0], 12);
    expect(engraved[2]).toBeCloseTo(raised[2], 12);
  });

  it('tilts further with more relief', () => {
    const shallow = surfaceNormalAt(RAMP_X, [0.25, 0.5], SEED, TILE, 0.001, TEXEL);
    const deep = surfaceNormalAt(RAMP_X, [0.25, 0.5], SEED, TILE, 0.004, TEXEL);
    expect(Math.abs(deep[0])).toBeGreaterThan(Math.abs(shallow[0]));
    expect(deep[2]).toBeLessThan(shallow[2]);
  });

  it('is always a unit vector', () => {
    for (const m of defaultMaterials()) {
      const n = surfaceNormalAt(m.sdf, [0.31, 0.47], m.seed, TILE, 0.005, TEXEL);
      expect(Math.hypot(...n)).toBeCloseTo(1, 12);
    }
  });

  // The -h tap at uv = 0 must wrap to the far edge, not clamp. If it clamped, the normal at
  // the left edge would differ from the normal at the right edge and the map would seam.
  it.each(defaultMaterials().map((m) => [m.name, m] as const))(
    'normal map closes across the tile wrap: %s',
    (_name, m) => {
      let worst = 0;
      for (let i = 0; i < 64; i += 1) {
        const t = (i + 0.5) / 64;
        const pairs: Array<[Vec2, Vec2]> = [
          [[0, t], [1, t]],
          [[t, 0], [t, 1]],
        ];
        for (const [a, b] of pairs) {
          const na = surfaceNormalAt(m.sdf, a, m.seed, TILE, m.relief, TEXEL);
          const nb = surfaceNormalAt(m.sdf, b, m.seed, TILE, m.relief, TEXEL);
          worst = Math.max(worst, ...na.map((v, k) => Math.abs(v - nb[k]!)));
        }
      }
      expect(worst).toBeLessThan(1e-7);
    },
  );
});

describe('roughness', () => {
  it.each(defaultMaterials().map((m) => [m.name, m] as const))(
    'stays inside 0..1: %s',
    (_name, m) => {
      for (let i = 0; i < 48; i += 1) {
        const r = roughnessAt(m.sdf, [(i * 0.137) % 1, (i * 0.291) % 1], m.seed, TILE, m.roughness);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(1);
      }
    },
  );

  it('maps field 0 to the first value and field 1 to the second', () => {
    expect(roughnessAt(FLAT, [0.5, 0.5], SEED, TILE, [0.9, 0.2])).toBeCloseTo(0.2, 12);
    const zero: SdfNodeJson = { op: 'invert', child: FLAT };
    expect(roughnessAt(zero, [0.5, 0.5], SEED, TILE, [0.9, 0.2])).toBeCloseTo(0.9, 12);
  });

  it('accepts a reversed range', () => {
    const noise: SdfNodeJson = { op: 'noise', scale: 10, octaves: 3 };
    const uv: Vec2 = [0.43, 0.18];
    const up = roughnessAt(noise, uv, SEED, TILE, [0.2, 0.8]);
    const down = roughnessAt(noise, uv, SEED, TILE, [0.8, 0.2]);
    expect(up + down).toBeCloseTo(1, 12);
  });
});

describe('material surface fields', () => {
  it('defaults relief and roughness on a material stored before they existed', () => {
    const legacy = {
      type: 'MaterialDefinition',
      id: 'm-old',
      name: 'old',
      seed: 3,
      sdf: { op: 'noise', scale: 10 },
    };
    const parsed = MaterialDefinitionJsonSchema.parse(legacy);
    expect(parsed.relief).toBe(DEFAULT_RELIEF);
    expect(parsed.roughness).toEqual(DEFAULT_ROUGHNESS);
  });

  it('rejects out-of-range values', () => {
    const base = defaultMaterials()[0]!;
    expect(MaterialDefinitionJsonSchema.safeParse({ ...base, relief: -1 }).success).toBe(false);
    expect(MaterialDefinitionJsonSchema.safeParse({ ...base, relief: -0.002 }).success).toBe(true);
    expect(MaterialDefinitionJsonSchema.safeParse({ ...base, relief: 1 }).success).toBe(false);
    expect(MaterialDefinitionJsonSchema.safeParse({ ...base, roughness: [0.5, 1.5] }).success).toBe(false);
  });

  // Regression: migrateMaterials runs on EVERY load and used to rebuild each material from
  // only type/id/name/seed/sdf, so an authored relief was reset to the default on reload.
  it('keeps an authored relief and roughness through repeated reloads', () => {
    const project = createDefaultProject();
    project.materials[0] = { ...project.materials[0]!, relief: 0.004, roughness: [0.3, 0.1] };
    const once = parseTilingProject(JSON.parse(JSON.stringify(project)) as unknown);
    const twice = parseTilingProject(JSON.parse(JSON.stringify(once)) as unknown);
    expect(twice.materials[0]!.relief).toBe(0.004);
    expect(twice.materials[0]!.roughness).toEqual([0.3, 0.1]);
  });

  // Regression: a field missing from the hash returns a stale cached bake after an edit.
  it('changes the texture cache key when relief or roughness changes', () => {
    const base = defaultMaterials()[0]!;
    const hash = materialRecipeHash(base);
    expect(materialRecipeHash({ ...base, relief: base.relief + 0.001 })).not.toBe(hash);
    expect(materialRecipeHash({ ...base, roughness: [0.1, 0.2] })).not.toBe(hash);
  });
});
