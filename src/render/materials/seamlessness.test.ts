import { describe, expect, it } from 'vitest';
import type { SdfNodeJson } from '@/domain/material';
import { defaultMaterials } from '@/domain/material-presets';
import { maxPeriodDelta, maxSeamDelta, type Vec2 } from './sdf-cpu';
import { seamlessnessReport, worstSeverity } from './seamlessness';

/** A deliberately non-square tile — the case that used to seam unconditionally. */
const TILE: Vec2 = [0.6, 0.3];
const SEED = 11;

/** Field values must agree exactly across the wrap; this is float64 slack, not tolerance. */
const EXACT = 1e-9;

const cases: Array<[string, SdfNodeJson]> = [
  ['noise fbm', { op: 'noise', scale: 6, octaves: 4 }],
  ['noise ridged', { op: 'noise', scale: 5, octaves: 4, variant: 'ridged' }],
  ['noise turbulence', { op: 'noise', scale: 7, octaves: 3, variant: 'turbulence' }],
  ['noise billow', { op: 'noise', scale: 4, octaves: 3, variant: 'billow' }],
  ['voronoi', { op: 'voronoi', scale: 5, edgeWidth: 0.08 }],
  ['cells f1', { op: 'cells', scale: 5, metric: 'f1' }],
  ['cells f2f1', { op: 'cells', scale: 6, metric: 'f2f1' }],
  ['cells id', { op: 'cells', scale: 4, metric: 'id' }],
  ['cells manhattan low jitter', { op: 'cells', scale: 5, metric: 'f1', jitter: 0.4, distance: 'manhattan' }],
  ['cells chebyshev', { op: 'cells', scale: 5, metric: 'f1', distance: 'chebyshev' }],
  ['brick', { op: 'brick', brickW: 0.15, brickH: 0.08, mortar: 0.012 }],
  ['truchet arcs', { op: 'truchet', scale: 6, thickness: 0.2, variant: 'arcs' }],
  ['truchet diagonals', { op: 'truchet', scale: 5, thickness: 0.2, variant: 'diagonals' }],
  ['stripe x', { op: 'stripe', axis: 'x', spacing: 0.07, duty: 0.5 }],
  ['stripe y', { op: 'stripe', axis: 'y', spacing: 0.04, duty: 0.3 }],
  ['checker', { op: 'checker', scale: 7 }],
  ['scratches', { op: 'scratches', count: 3, length: 0.05, width: 0.003, scale: 8 }],
  [
    'halftone',
    { op: 'halftone', scale: 10, angle: 0.45, child: { op: 'noise', scale: 3 } },
  ],
  [
    'warp over noise',
    { op: 'warp', scale: 3, amount: 0.12, child: { op: 'noise', scale: 8, octaves: 3 } },
  ],
  [
    'warp over cells',
    { op: 'warp', scale: 2, amount: 0.2, child: { op: 'cells', scale: 5, metric: 'f2f1' } },
  ],
  [
    'warp with amount larger than the tile',
    { op: 'warp', scale: 2, amount: 1.7, child: { op: 'noise', scale: 5 } },
  ],
  ['posterize', { op: 'posterize', steps: 5, child: { op: 'noise', scale: 4 } }],
  ['curve', { op: 'curve', gamma: 2.2, child: { op: 'noise', scale: 4 } }],
  ['threshold', { op: 'threshold', level: 0.5, soft: 0.01, child: { op: 'noise', scale: 4 } }],
  [
    'remap',
    { op: 'remap', inMin: 0.2, inMax: 0.8, outMin: 0, outMax: 1, child: { op: 'noise', scale: 4 } },
  ],
  ['invert', { op: 'invert', child: { op: 'noise', scale: 4 } }],
  [
    'overlay',
    { op: 'overlay', a: { op: 'noise', scale: 3 }, b: { op: 'cells', scale: 5, metric: 'f2f1' } },
  ],
  [
    'screen',
    { op: 'screen', a: { op: 'noise', scale: 3 }, b: { op: 'voronoi', scale: 4 } },
  ],
  ['rotate 180deg over noise', { op: 'rotate', angle: Math.PI, child: { op: 'noise', scale: 10 } }],
  ['scale 1/2 over noise', { op: 'scale', factor: 0.5, child: { op: 'noise', scale: 6 } }],
];

describe('seamlessness — field closes on the tile torus', () => {
  // Every case here is built from periodic primitives only, so it must satisfy the
  // strictly stronger global-periodicity property, not just edge continuity.
  it.each(cases)('%s', (_name, sdf) => {
    expect(maxPeriodDelta(sdf, SEED, TILE)).toBeLessThan(EXACT);
    expect(maxSeamDelta(sdf, SEED, TILE)).toBeLessThan(EXACT);
  });

  // Presets may contain local, deliberately non-periodic features (a lone circle well
  // inside the tile), so only the boundary property applies.
  it.each(defaultMaterials().map((m) => [m.name, m] as const))(
    'preset %s',
    (_name, material) => {
      expect(maxSeamDelta(material.sdf, material.seed, TILE)).toBeLessThan(EXACT);
    },
  );

  it('holds on a square tile too', () => {
    for (const [, sdf] of cases) {
      expect(maxPeriodDelta(sdf, SEED, [0.4, 0.4], 64)).toBeLessThan(EXACT);
    }
  });

  it('allows a 90deg rotate on a square tile but not a rectangular one', () => {
    const sdf: SdfNodeJson = { op: 'rotate', angle: Math.PI / 2, child: { op: 'noise', scale: 10 } };
    expect(maxPeriodDelta(sdf, SEED, [0.4, 0.4])).toBeLessThan(EXACT);
    expect(maxPeriodDelta(sdf, SEED, TILE)).toBeGreaterThan(0.01);
  });

  it('detects a genuinely non-seamless graph', () => {
    // An off-lattice rotation is the canonical way to break it.
    const bad: SdfNodeJson = { op: 'rotate', angle: 0.7, child: { op: 'noise', scale: 6 } };
    expect(maxSeamDelta(bad, SEED, TILE)).toBeGreaterThan(0.01);
  });

  it('detects a repeat period that does not divide the tile', () => {
    const bad: SdfNodeJson = {
      op: 'fill',
      soft: 0.01,
      child: { op: 'repeat', period: [0.07, 0.07], child: { op: 'circle', radius: 0.02 } },
    };
    expect(maxSeamDelta(bad, SEED, TILE)).toBeGreaterThan(0.01);
  });
});

describe('seamlessnessReport', () => {
  const tile = { length: 0.6, width: 0.3 };

  it('passes a clean graph', () => {
    const sdf: SdfNodeJson = { op: 'noise', scale: 10, octaves: 3 };
    expect(seamlessnessReport(sdf, tile)).toHaveLength(0);
  });

  it('flags an off-lattice rotate as an error', () => {
    const sdf: SdfNodeJson = { op: 'rotate', angle: 0.7, child: { op: 'noise', scale: 6 } };
    const issues = seamlessnessReport(sdf, tile);
    expect(worstSeverity(issues)).toBe('error');
    expect(issues[0]?.op).toBe('rotate');
  });

  it('accepts 0 and 180 degrees, and flags 90 on a rectangular tile', () => {
    for (const angle of [0, Math.PI, -Math.PI]) {
      const sdf: SdfNodeJson = { op: 'rotate', angle, child: { op: 'noise', scale: 10 } };
      expect(seamlessnessReport(sdf, tile)).toHaveLength(0);
    }

    const quarter: SdfNodeJson = {
      op: 'rotate',
      angle: Math.PI / 2,
      child: { op: 'noise', scale: 10 },
    };
    expect(worstSeverity(seamlessnessReport(quarter, tile))).toBe('error');
    expect(seamlessnessReport(quarter, { length: 0.4, width: 0.4 })).toHaveLength(0);
  });

  it('flags a scale factor that is not 1/integer', () => {
    const sdf: SdfNodeJson = { op: 'scale', factor: 1.5, child: { op: 'noise', scale: 10 } };
    expect(worstSeverity(seamlessnessReport(sdf, tile))).toBe('error');
    const ok: SdfNodeJson = { op: 'scale', factor: 0.25, child: { op: 'noise', scale: 10 } };
    expect(seamlessnessReport(ok, tile)).toHaveLength(0);
  });

  it('flags a repeat period that does not divide the tile', () => {
    const sdf: SdfNodeJson = {
      op: 'repeat',
      period: [0.07, 0.1],
      child: { op: 'circle', radius: 0.02 },
    };
    const issues = seamlessnessReport(sdf, tile);
    expect(issues.some((i) => i.op === 'repeat' && i.severity === 'error')).toBe(true);
  });

  it('warns that a root-level mirror is dead but not one under a repeat', () => {
    const dead: SdfNodeJson = { op: 'mirror', axis: 'x', child: { op: 'circle', radius: 0.05 } };
    expect(seamlessnessReport(dead, tile).some((i) => i.op === 'mirror')).toBe(true);

    const live: SdfNodeJson = {
      op: 'repeat',
      period: [0.15, 0.15],
      child: { op: 'mirror', axis: 'x', child: { op: 'circle', radius: 0.05 } },
    };
    expect(seamlessnessReport(live, tile).some((i) => i.op === 'mirror')).toBe(false);
  });

  it('reports scale snapping as info, not an error', () => {
    const sdf: SdfNodeJson = { op: 'noise', scale: 6 };
    const issues = seamlessnessReport(sdf, tile);
    expect(worstSeverity(issues)).toBe('info');
  });
});

describe('hard-edged fields are periodic even though adjacent texels differ', () => {
  // seamError() compares column 0 against column width-1, which are NOT wrap-equivalent.
  // On a piecewise-constant field that step is a legitimate chip boundary, so the pixel
  // metric false-alarms; maxSeamDelta compares p=0 against p=P and is exact.
  const hardEdged: Array<[string, SdfNodeJson]> = [
    ['cells id', { op: 'cells', scale: 9, metric: 'id' }],
    ['checker', { op: 'checker', scale: 7 }],
    ['posterize', { op: 'posterize', steps: 4, child: { op: 'noise', scale: 10 } }],
    ['truchet', { op: 'truchet', scale: 4, thickness: 0.28, variant: 'arcs' }],
  ];

  it.each(hardEdged)('%s closes exactly', (_name, sdf) => {
    expect(maxSeamDelta(sdf, SEED, TILE)).toBe(0);
  });
});
