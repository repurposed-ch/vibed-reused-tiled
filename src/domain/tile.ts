import { z } from 'zod';

export const FacadeSideSchema = z.enum(['south', 'east', 'north', 'west']);
export type FacadeSide = z.infer<typeof FacadeSideSchema>;

export const RhythmSideJsonSchema = z.object({
  name: z.string().min(1),
  mirrored: z.boolean(),
});

export type RhythmSideJson = z.infer<typeof RhythmSideJsonSchema>;

export const DEFAULT_PALETTE_C: [number, number, number] = [1, 1, 1];

export const TileColorJsonSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('brightness'),
    color: z.string().min(1),
  }),
  z.object({
    mode: z.literal('palette'),
    /** Quilez a, b, d as hex */
    colors: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]),
    /** Quilez c (frequency) — editable floats, typically ~0..2 */
    c: z.tuple([z.number(), z.number(), z.number()]).default(DEFAULT_PALETTE_C),
  }),
]);

export type TileColorJson = z.infer<typeof TileColorJsonSchema>;

const RhythmObjectSchema = z
  .object({
    south: RhythmSideJsonSchema.optional(),
    east: RhythmSideJsonSchema.optional(),
    north: RhythmSideJsonSchema.optional(),
    west: RhythmSideJsonSchema.optional(),
  })
  .superRefine((rhythm, ctx) => {
    const sides = ['south', 'east', 'north', 'west'] as const;
    const present = sides.filter((s) => rhythm[s] != null);
    if (present.length === 0) return;
    if (present.length !== 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Rhythm must be omitted or set on all four sides (south, east, north, west) for edged textures',
      });
    }
  });

export const TileDefinitionJsonSchema = z.object({
  type: z.literal('TileDefinition'),
  id: z.string().min(1),
  name: z.string().min(1),
  length: z.number().positive(),
  width: z.number().positive(),
  thickness: z.number().positive(),
  /** References `TilingProjectJson.materials[].id`. */
  materialId: z.string().min(1),
  /** Brightness (1 hex) or Quilez palette (3 hex + c floats). */
  color: TileColorJsonSchema,
  /** Optional cached bake (data URL); filled on save / explicit bake. */
  texture: z.string().min(1).optional(),
  /** None → continuous UV; all four sides → edged UV. */
  rhythm: RhythmObjectSchema.optional(),
});

export type TileDefinitionJson = z.infer<typeof TileDefinitionJsonSchema>;

/** Flat hex used for 2D layout fill / UI chrome. */
export function tileDisplayColor(color: TileColorJson): string {
  return color.mode === 'brightness' ? color.color : color.colors[1];
}

export function hasCompleteRhythm(
  rhythm: TileDefinitionJson['rhythm'],
): rhythm is {
  south: RhythmSideJson;
  east: RhythmSideJson;
  north: RhythmSideJson;
  west: RhythmSideJson;
} {
  return Boolean(rhythm?.south && rhythm.east && rhythm.north && rhythm.west);
}

export function createTileDefinition(
  partial?: Partial<Omit<TileDefinitionJson, 'type'>> & { id?: string },
): TileDefinitionJson {
  const color: TileColorJson = partial?.color ?? {
    mode: 'brightness',
    color: '#c4a574',
  };
  return {
    type: 'TileDefinition',
    id: partial?.id ?? crypto.randomUUID(),
    name: partial?.name ?? 'Tile',
    length: partial?.length ?? 0.6,
    width: partial?.width ?? 0.3,
    thickness: partial?.thickness ?? 0.02,
    materialId: partial?.materialId ?? 'material-ceramic',
    color,
    texture: partial?.texture,
    rhythm: partial?.rhythm,
  };
}
