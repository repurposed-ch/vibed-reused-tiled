import { z } from 'zod';
import { BoundaryConditionsJsonSchema, defaultBoundaries } from './boundaries';
import {
  createEmptyDesignFamily,
  createModulePlacement,
  DesignFamilyJsonSchema,
} from './design-family';
import { DesignInstanceJsonSchema } from './instance';
import { translationMat3 } from './mat3';
import { StockStateJsonSchema } from './stock';
import { createTileDefinition, TileDefinitionJsonSchema } from './tile';

export const TilingProjectJsonSchema = z.object({
  type: z.literal('TilingProject'),
  schemaVersion: z.literal(1),
  meta: z
    .object({
      name: z.string().optional(),
      updatedAt: z.string().optional(),
    })
    .optional(),
  tileDefinitions: z.array(TileDefinitionJsonSchema),
  stock: StockStateJsonSchema,
  designFamily: DesignFamilyJsonSchema,
  boundaries: BoundaryConditionsJsonSchema,
  instance: DesignInstanceJsonSchema.optional(),
});

export type TilingProjectJson = z.infer<typeof TilingProjectJsonSchema>;

export function parseTilingProject(data: unknown): TilingProjectJson {
  return TilingProjectJsonSchema.parse(data);
}

export function createDefaultProject(): TilingProjectJson {
  const tileA = createTileDefinition({
    name: 'Reuse A',
    length: 0.6,
    width: 0.3,
    thickness: 0.02,
    material: 'terracotta',
    color: '#b86b3c',
    rhythm: {
      south: { name: 'A', mirrored: false },
      north: { name: 'A', mirrored: true },
      east: { name: 'B', mirrored: false },
      west: { name: 'B', mirrored: true },
    },
  });
  const tileB = createTileDefinition({
    name: 'Reuse B',
    length: 0.4,
    width: 0.4,
    thickness: 0.025,
    material: 'stone',
    color: '#8a8f7a',
    rhythm: {
      south: { name: 'C', mirrored: false },
      north: { name: 'C', mirrored: true },
      east: { name: 'C', mirrored: false },
      west: { name: 'C', mirrored: true },
    },
  });

  return {
    type: 'TilingProject',
    schemaVersion: 1,
    meta: {
      name: 'Untitled tiling',
      updatedAt: new Date().toISOString(),
    },
    tileDefinitions: [tileA, tileB],
    stock: {
      type: 'StockState',
      entries: [
        { tileDefinitionId: tileA.id, kind: 'exact', count: 40 },
        {
          tileDefinitionId: tileB.id,
          kind: 'distribution',
          distribution: 'normal',
          params: { mean: 20, stdDev: 4 },
        },
      ],
    },
    designFamily: (() => {
      const family = createEmptyDesignFamily();
      const module = family.modules[0]!;
      module.placements = [
        createModulePlacement(tileA.id, 0, 0),
        { ...createModulePlacement(tileB.id, tileA.length + 0.002, 0) },
      ];
      module.repeat = {
        count: 3,
        offsetMat3: translationMat3(tileA.length + tileB.length + 0.004, 0),
      };
      return family;
    })(),
    boundaries: defaultBoundaries(),
  };
}

export function projectToJsonString(project: TilingProjectJson): string {
  return JSON.stringify(project, null, 2);
}

export function projectFromJsonString(text: string): TilingProjectJson {
  return parseTilingProject(JSON.parse(text) as unknown);
}

export * from './boundaries';
export * from './design-family';
export * from './instance';
export * from './mat3';
export * from './stock';
export * from './tile';
