import { z } from 'zod';
import { identityMat3, translationMat3 } from './mat3';
import { createPose, PointJsonSchema, PoseJsonSchema, type PointJson } from './pose';

/** One tile of a module, posed in module-local space (see `PoseJsonSchema`). */
export const ModulePlacementJsonSchema = PoseJsonSchema.extend({
  tileDefinitionId: z.string().min(1),
});

export const ModuleRepeatJsonSchema = z.object({
  count: z.number().int().positive(),
  /** Shift between successive copies of the module. */
  offset: PointJsonSchema,
});

export const DesignModuleJsonSchema = z.object({
  type: z.literal('DesignModule'),
  id: z.string().min(1),
  name: z.string().min(1),
  placements: z.array(ModulePlacementJsonSchema),
  repeat: ModuleRepeatJsonSchema.optional(),
  anchor: z.enum(['origin', 'centroid', 'bboxMin']).optional(),
});

export const ConstraintKindSchema = z.enum([
  'rhythmMatch',
  'adjacencyPrefer',
  'materialAlternate',
  'gapTolerance',
]);

export const SoftConstraintJsonSchema = z.object({
  id: z.string().min(1),
  kind: ConstraintKindSchema,
  weight: z.number(),
  params: z.record(z.string(), z.unknown()),
});

export const DesignFamilyJsonSchema = z.object({
  type: z.literal('DesignFamily'),
  id: z.string().min(1),
  name: z.string().min(1),
  modules: z.array(DesignModuleJsonSchema),
  primaryModuleIds: z.array(z.string()),
  constraints: z.array(SoftConstraintJsonSchema),
});

export type ModulePlacementJson = z.infer<typeof ModulePlacementJsonSchema>;
export type ModuleRepeatJson = z.infer<typeof ModuleRepeatJsonSchema>;
export type DesignModuleJson = z.infer<typeof DesignModuleJsonSchema>;
export type SoftConstraintJson = z.infer<typeof SoftConstraintJsonSchema>;
export type DesignFamilyJson = z.infer<typeof DesignFamilyJsonSchema>;
export type ConstraintKind = z.infer<typeof ConstraintKindSchema>;

export function createEmptyDesignFamily(): DesignFamilyJson {
  const moduleId = crypto.randomUUID();
  return {
    type: 'DesignFamily',
    id: crypto.randomUUID(),
    name: 'Family',
    modules: [
      {
        type: 'DesignModule',
        id: moduleId,
        name: 'Module A',
        placements: [],
        anchor: 'origin',
      },
    ],
    primaryModuleIds: [moduleId],
    constraints: [
      {
        id: crypto.randomUUID(),
        kind: 'rhythmMatch',
        weight: 1,
        params: {},
      },
      {
        id: crypto.randomUUID(),
        kind: 'gapTolerance',
        weight: 0.5,
        params: { maxGap: 0.005 },
      },
    ],
  };
}

/** A module placement with its tile centred on `position`. */
export function createModulePlacement(
  tileDefinitionId: string,
  position: PointJson,
  rotation = 0,
  mirror = false,
): ModulePlacementJson {
  return { tileDefinitionId, ...createPose(position, rotation, mirror) };
}

export { identityMat3, translationMat3 };
