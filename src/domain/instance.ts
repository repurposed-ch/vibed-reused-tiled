import { z } from 'zod';
import { Mat3JsonSchema } from './mat3';

export const PlacementJsonSchema = z.object({
  id: z.string().min(1),
  tileDefinitionId: z.string().min(1),
  mat3: Mat3JsonSchema,
  moduleId: z.string().optional(),
});

export const DesignInstanceJsonSchema = z.object({
  type: z.literal('DesignInstance'),
  placements: z.array(PlacementJsonSchema),
  meta: z
    .object({
      seed: z.number().optional(),
      sampledStock: z
        .array(
          z.object({
            tileDefinitionId: z.string(),
            count: z.number(),
          }),
        )
        .optional(),
      unmetConstraintIds: z.array(z.string()).optional(),
      solverStats: z.record(z.string(), z.number()).optional(),
    })
    .optional(),
});

export type PlacementJson = z.infer<typeof PlacementJsonSchema>;
export type DesignInstanceJson = z.infer<typeof DesignInstanceJsonSchema>;
