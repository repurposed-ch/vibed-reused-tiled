import { z } from 'zod';

export const FacadeSideSchema = z.enum(['south', 'east', 'north', 'west']);
export type FacadeSide = z.infer<typeof FacadeSideSchema>;

export const RhythmSideJsonSchema = z.object({
  name: z.string().min(1),
  mirrored: z.boolean(),
});

export type RhythmSideJson = z.infer<typeof RhythmSideJsonSchema>;

export const TileDefinitionJsonSchema = z.object({
  type: z.literal('TileDefinition'),
  id: z.string().min(1),
  name: z.string().min(1),
  length: z.number().positive(),
  width: z.number().positive(),
  thickness: z.number().positive(),
  /** References `TilingProjectJson.materials[].id`. */
  materialId: z.string().min(1),
  /** Color swatches (hex). */
  colors: z.array(z.string().min(1)).min(1),
  /** Active swatch used for 2D fill and texture bake tint. */
  color: z.string().min(1),
  /** Optional cached 1024 bake (data URL); filled on save / explicit bake. */
  texture: z.string().min(1).optional(),
  rhythm: z
    .object({
      south: RhythmSideJsonSchema.optional(),
      east: RhythmSideJsonSchema.optional(),
      north: RhythmSideJsonSchema.optional(),
      west: RhythmSideJsonSchema.optional(),
    })
    .optional(),
});

export type TileDefinitionJson = z.infer<typeof TileDefinitionJsonSchema>;

export function createTileDefinition(
  partial?: Partial<Omit<TileDefinitionJson, 'type'>> & { id?: string },
): TileDefinitionJson {
  const color = partial?.color ?? '#c4a574';
  const colors = partial?.colors?.length ? partial.colors : [color];
  const active = colors.includes(color) ? color : colors[0]!;
  return {
    type: 'TileDefinition',
    id: partial?.id ?? crypto.randomUUID(),
    name: partial?.name ?? 'Tile',
    length: partial?.length ?? 0.6,
    width: partial?.width ?? 0.3,
    thickness: partial?.thickness ?? 0.02,
    materialId: partial?.materialId ?? 'material-ceramic',
    colors,
    color: active,
    texture: partial?.texture,
    rhythm: partial?.rhythm,
  };
}
