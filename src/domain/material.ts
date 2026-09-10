import { z } from 'zod';

/** Declarative seamless SDF / procedural graph (LLM- and UI-authorable). */
export type SdfNodeJson =
  | { op: 'circle'; radius: number; center?: [number, number] }
  | { op: 'box'; halfExtents: [number, number]; center?: [number, number] }
  | { op: 'ring'; radius: number; thickness: number; center?: [number, number] }
  | { op: 'line'; a: [number, number]; b: [number, number]; thickness: number }
  | { op: 'noise'; scale: number; octaves?: number }
  | { op: 'voronoi'; scale: number; edgeWidth?: number }
  | {
      op: 'brick';
      brickW: number;
      brickH: number;
      mortar: number;
      offset?: number;
    }
  | { op: 'union'; a: SdfNodeJson; b: SdfNodeJson }
  | { op: 'subtract'; a: SdfNodeJson; b: SdfNodeJson }
  | { op: 'intersect'; a: SdfNodeJson; b: SdfNodeJson }
  | { op: 'smoothUnion'; a: SdfNodeJson; b: SdfNodeJson; k: number }
  | { op: 'translate'; offset: [number, number]; child: SdfNodeJson }
  | { op: 'rotate'; angle: number; child: SdfNodeJson }
  | { op: 'scale'; factor: number | [number, number]; child: SdfNodeJson }
  | { op: 'repeat'; period: [number, number]; child: SdfNodeJson }
  | { op: 'mirror'; axis: 'x' | 'y' | 'xy'; child: SdfNodeJson }
  | { op: 'band'; child: SdfNodeJson; width: number; soft?: number }
  | { op: 'fill'; child: SdfNodeJson; soft?: number; invert?: boolean }
  | { op: 'mix'; a: SdfNodeJson; b: SdfNodeJson; t: number }
  | { op: 'mul'; a: SdfNodeJson; b: SdfNodeJson }
  | { op: 'add'; a: SdfNodeJson; b: SdfNodeJson };

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
    }),
    z.object({
      op: z.literal('voronoi'),
      scale: z.number().positive(),
      edgeWidth: z.number().positive().optional(),
    }),
    z.object({
      op: z.literal('brick'),
      brickW: z.number().positive(),
      brickH: z.number().positive(),
      mortar: z.number().nonnegative(),
      offset: z.number().optional(),
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
