import { z } from 'zod';

/** Declarative seamless SDF / procedural graph (LLM- and UI-authorable). */
export type SdfNodeJson =
  | { op: 'circle'; radius: number; center?: [number, number] }
  | { op: 'box'; halfExtents: [number, number]; center?: [number, number] }
  | { op: 'ring'; radius: number; thickness: number; center?: [number, number] }
  | { op: 'line'; a: [number, number]; b: [number, number]; thickness: number }
  | {
      op: 'noise';
      scale: number;
      octaves?: number;
      variant?: 'fbm' | 'ridged' | 'turbulence' | 'billow';
    }
  | { op: 'voronoi'; scale: number; edgeWidth?: number }
  | {
      op: 'cells';
      scale: number;
      metric: 'f1' | 'f2f1' | 'id';
      jitter?: number;
      distance?: 'euclidean' | 'manhattan' | 'chebyshev';
    }
  | {
      op: 'brick';
      brickW: number;
      brickH: number;
      mortar: number;
      offset?: number;
    }
  | {
      op: 'truchet';
      scale: number;
      thickness: number;
      variant: 'arcs' | 'diagonals';
      soft?: number;
    }
  | { op: 'stripe'; axis: 'x' | 'y'; spacing: number; duty: number; soft?: number }
  | { op: 'checker'; scale: number }
  | {
      op: 'scratches';
      count: number;
      length: number;
      width: number;
      scale: number;
      angle?: number;
      spread?: number;
    }
  | { op: 'halftone'; child: SdfNodeJson; scale: number; angle?: number; soft?: number }
  | { op: 'union'; a: SdfNodeJson; b: SdfNodeJson }
  | { op: 'subtract'; a: SdfNodeJson; b: SdfNodeJson }
  | { op: 'intersect'; a: SdfNodeJson; b: SdfNodeJson }
  | { op: 'smoothUnion'; a: SdfNodeJson; b: SdfNodeJson; k: number }
  | { op: 'translate'; offset: [number, number]; child: SdfNodeJson }
  | { op: 'rotate'; angle: number; child: SdfNodeJson }
  | { op: 'scale'; factor: number | [number, number]; child: SdfNodeJson }
  | { op: 'repeat'; period: [number, number]; child: SdfNodeJson }
  | { op: 'mirror'; axis: 'x' | 'y' | 'xy'; child: SdfNodeJson }
  | {
      op: 'warp';
      child: SdfNodeJson;
      scale: number;
      amount: number;
      octaves?: number;
    }
  | { op: 'band'; child: SdfNodeJson; width: number; soft?: number }
  | { op: 'fill'; child: SdfNodeJson; soft?: number; invert?: boolean }
  | { op: 'curve'; child: SdfNodeJson; gamma: number }
  | { op: 'posterize'; child: SdfNodeJson; steps: number }
  | { op: 'threshold'; child: SdfNodeJson; level: number; soft?: number }
  | {
      op: 'remap';
      child: SdfNodeJson;
      inMin: number;
      inMax: number;
      outMin: number;
      outMax: number;
    }
  | { op: 'invert'; child: SdfNodeJson }
  | { op: 'mix'; a: SdfNodeJson; b: SdfNodeJson; t: number }
  | { op: 'mul'; a: SdfNodeJson; b: SdfNodeJson }
  | { op: 'add'; a: SdfNodeJson; b: SdfNodeJson }
  | { op: 'overlay'; a: SdfNodeJson; b: SdfNodeJson }
  | { op: 'screen'; a: SdfNodeJson; b: SdfNodeJson };

export type SdfOp = SdfNodeJson['op'];

/**
 * Single source of truth for the op list (used to build the LLM schema hint).
 * The `_opsCoverAllCases` witness below makes `tsc` fail if this drifts from the union.
 */
export const SDF_OPS = [
  'circle',
  'box',
  'ring',
  'line',
  'noise',
  'voronoi',
  'cells',
  'brick',
  'truchet',
  'stripe',
  'checker',
  'scratches',
  'halftone',
  'union',
  'subtract',
  'intersect',
  'smoothUnion',
  'translate',
  'rotate',
  'scale',
  'repeat',
  'mirror',
  'warp',
  'band',
  'fill',
  'curve',
  'posterize',
  'threshold',
  'remap',
  'invert',
  'mix',
  'mul',
  'add',
  'overlay',
  'screen',
] as const satisfies readonly SdfOp[];

/** Compile-time proof that SDF_OPS lists every member of the union. */
const _opsCoverAllCases: Record<SdfOp, true> = Object.fromEntries(
  SDF_OPS.map((o) => [o, true]),
) as Record<SdfOp, true>;
void _opsCoverAllCases;

const Vec2Schema = z.tuple([z.number(), z.number()]);

export const SdfNodeJsonSchema: z.ZodType<SdfNodeJson> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.object({
      op: z.literal('circle'),
      radius: z.number().positive(),
      center: Vec2Schema.optional(),
    }),
    z.object({
      op: z.literal('box'),
      halfExtents: Vec2Schema,
      center: Vec2Schema.optional(),
    }),
    z.object({
      op: z.literal('ring'),
      radius: z.number().positive(),
      thickness: z.number().positive(),
      center: Vec2Schema.optional(),
    }),
    z.object({
      op: z.literal('line'),
      a: Vec2Schema,
      b: Vec2Schema,
      thickness: z.number().positive(),
    }),
    z.object({
      op: z.literal('noise'),
      scale: z.number().positive(),
      octaves: z.number().int().min(1).max(8).optional(),
      variant: z.enum(['fbm', 'ridged', 'turbulence', 'billow']).optional(),
    }),
    z.object({
      op: z.literal('voronoi'),
      scale: z.number().positive(),
      edgeWidth: z.number().positive().optional(),
    }),
    z.object({
      op: z.literal('cells'),
      scale: z.number().positive(),
      metric: z.enum(['f1', 'f2f1', 'id']),
      /** >1 lets feature points escape their cell, so the 3x3 search may miss the nearest. */
      jitter: z.number().min(0).max(1).optional(),
      distance: z.enum(['euclidean', 'manhattan', 'chebyshev']).optional(),
    }),
    z.object({
      op: z.literal('brick'),
      brickW: z.number().positive(),
      brickH: z.number().positive(),
      mortar: z.number().nonnegative(),
      offset: z.number().optional(),
    }),
    z.object({
      op: z.literal('truchet'),
      scale: z.number().positive(),
      /** Cell units, not meters. Above 0.5 the strokes merge into a solid field. */
      thickness: z.number().positive().max(0.5),
      variant: z.enum(['arcs', 'diagonals']),
      soft: z.number().positive().optional(),
    }),
    z.object({
      op: z.literal('stripe'),
      axis: z.enum(['x', 'y']),
      /** Meters. Snapped to the nearest divisor of the tile period. */
      spacing: z.number().positive(),
      duty: z.number().min(0).max(1),
      soft: z.number().positive().max(0.5).optional(),
    }),
    z.object({
      op: z.literal('checker'),
      scale: z.number().positive(),
    }),
    z.object({
      op: z.literal('scratches'),
      count: z.number().int().min(1).max(6),
      length: z.number().positive(),
      width: z.number().positive(),
      scale: z.number().positive(),
      angle: z.number().optional(),
      spread: z.number().min(0).max(Math.PI * 2).optional(),
    }),
    z.object({
      op: z.literal('halftone'),
      child: SdfNodeJsonSchema,
      scale: z.number().positive(),
      /** Snapped to the nearest Gaussian-integer rotation; a free angle would seam. */
      angle: z.number().optional(),
      soft: z.number().positive().optional(),
    }),
    z.object({
      op: z.literal('union'),
      a: SdfNodeJsonSchema,
      b: SdfNodeJsonSchema,
    }),
    z.object({
      op: z.literal('subtract'),
      a: SdfNodeJsonSchema,
      b: SdfNodeJsonSchema,
    }),
    z.object({
      op: z.literal('intersect'),
      a: SdfNodeJsonSchema,
      b: SdfNodeJsonSchema,
    }),
    z.object({
      op: z.literal('smoothUnion'),
      a: SdfNodeJsonSchema,
      b: SdfNodeJsonSchema,
      k: z.number().positive(),
    }),
    z.object({
      op: z.literal('translate'),
      offset: Vec2Schema,
      child: SdfNodeJsonSchema,
    }),
    z.object({
      op: z.literal('rotate'),
      angle: z.number(),
      child: SdfNodeJsonSchema,
    }),
    z.object({
      op: z.literal('scale'),
      factor: z.union([z.number(), Vec2Schema]),
      child: SdfNodeJsonSchema,
    }),
    z.object({
      op: z.literal('repeat'),
      period: Vec2Schema,
      child: SdfNodeJsonSchema,
    }),
    z.object({
      op: z.literal('mirror'),
      axis: z.enum(['x', 'y', 'xy']),
      child: SdfNodeJsonSchema,
    }),
    z.object({
      op: z.literal('warp'),
      child: SdfNodeJsonSchema,
      scale: z.number().positive(),
      /** Meters. Keep below ~0.25x the child's feature size or bands visibly breathe. */
      amount: z.number(),
      octaves: z.number().int().min(1).max(8).optional(),
    }),
    z.object({
      op: z.literal('band'),
      child: SdfNodeJsonSchema,
      width: z.number().positive(),
      soft: z.number().positive().optional(),
    }),
    z.object({
      op: z.literal('fill'),
      child: SdfNodeJsonSchema,
      soft: z.number().positive().optional(),
      invert: z.boolean().optional(),
    }),
    z.object({
      op: z.literal('curve'),
      child: SdfNodeJsonSchema,
      gamma: z.number().positive(),
    }),
    z.object({
      op: z.literal('posterize'),
      child: SdfNodeJsonSchema,
      steps: z.number().int().min(2).max(64),
    }),
    z.object({
      op: z.literal('threshold'),
      child: SdfNodeJsonSchema,
      level: z.number().min(0).max(1),
      soft: z.number().positive().max(0.5).optional(),
    }),
    // No .refine() here: zod's discriminatedUnion rejects ZodEffects members.
    // A degenerate inMin == inMax is handled in remapRange(), which clamps to outMin.
    z.object({
      op: z.literal('remap'),
      child: SdfNodeJsonSchema,
      inMin: z.number().min(0).max(1),
      inMax: z.number().min(0).max(1),
      /** Out of 0..1 would be reinterpreted as a signed distance and hard-thresholded. */
      outMin: z.number().min(0).max(1),
      outMax: z.number().min(0).max(1),
    }),
    z.object({
      op: z.literal('invert'),
      child: SdfNodeJsonSchema,
    }),
    z.object({
      op: z.literal('mix'),
      a: SdfNodeJsonSchema,
      b: SdfNodeJsonSchema,
      t: z.number().min(0).max(1),
    }),
    z.object({
      op: z.literal('mul'),
      a: SdfNodeJsonSchema,
      b: SdfNodeJsonSchema,
    }),
    z.object({
      op: z.literal('add'),
      a: SdfNodeJsonSchema,
      b: SdfNodeJsonSchema,
    }),
    z.object({
      op: z.literal('overlay'),
      a: SdfNodeJsonSchema,
      b: SdfNodeJsonSchema,
    }),
    z.object({
      op: z.literal('screen'),
      a: SdfNodeJsonSchema,
      b: SdfNodeJsonSchema,
    }),
  ]),
);

export const MaterialDefinitionJsonSchema = z.object({
  type: z.literal('MaterialDefinition'),
  id: z.string().min(1),
  name: z.string().min(1),
  /** Noise / procedural seed (SDF state, not appearance). */
  seed: z.number(),
  sdf: SdfNodeJsonSchema,
});

export type MaterialDefinitionJson = z.infer<typeof MaterialDefinitionJsonSchema>;

export function createMaterialDefinition(
  partial?: Partial<Omit<MaterialDefinitionJson, 'type'>> & { id?: string },
): MaterialDefinitionJson {
  return {
    type: 'MaterialDefinition',
    id: partial?.id ?? crypto.randomUUID(),
    name: partial?.name ?? 'Material',
    seed: partial?.seed ?? 1,
    sdf: partial?.sdf ?? { op: 'noise', scale: 4, octaves: 3 },
  };
}
