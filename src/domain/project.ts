import { z } from 'zod';
import { BoundaryConditionsJsonSchema, defaultBoundaries } from './boundaries';
import {
  createEmptyDesignFamily,
  createModulePlacement,
  DesignFamilyJsonSchema,
} from './design-family';
import { DesignInstanceJsonSchema } from './instance';
import { MaterialDefinitionJsonSchema, createMaterialDefinition } from './material';
import { defaultMaterials, materialIdForLabel } from './material-presets';
import { translationMat3 } from './mat3';
import { StockStateJsonSchema } from './stock';
import { createTileDefinition, TileDefinitionJsonSchema } from './tile';

export const TilingProjectJsonSchema = z.object({
  type: z.literal('TilingProject'),
  schemaVersion: z.literal(2),
  meta: z
    .object({
      name: z.string().optional(),
      updatedAt: z.string().optional(),
    })
    .optional(),
  materials: z.array(MaterialDefinitionJsonSchema),
  tileDefinitions: z.array(TileDefinitionJsonSchema),
  stock: StockStateJsonSchema,
  designFamily: DesignFamilyJsonSchema,
  boundaries: BoundaryConditionsJsonSchema,
  instance: DesignInstanceJsonSchema.optional(),
});

export type TilingProjectJson = z.infer<typeof TilingProjectJsonSchema>;

type LegacyTile = {
  type?: string;
  id?: string;
  name?: string;
  length?: number;
  width?: number;
  thickness?: number;
  material?: string;
  materialId?: string;
  color?: string;
  colors?: string[];
  texture?: string;
  rhythm?: unknown;
};

function migrateProject(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const root = data as Record<string, unknown>;
  const version = root.schemaVersion;

  if (version === 2 && Array.isArray(root.materials)) {
    return root;
  }

  const presets = defaultMaterials();
  const legacyTiles = Array.isArray(root.tileDefinitions)
    ? (root.tileDefinitions as LegacyTile[])
    : [];

  const extraLabels = new Set<string>();
  for (const t of legacyTiles) {
    if (typeof t.material === 'string' && t.material.trim()) {
      const label = t.material.trim().toLowerCase();
      if (!presets.some((m) => m.name.toLowerCase() === label)) {
        extraLabels.add(t.material.trim());
      }
    }
  }

  const materials = [
    ...presets,
    ...[...extraLabels].map((name) =>
      createMaterialDefinition({
        name,
        seed: hashString(name),
        periodMeters: 0.3,
        sdf: { op: 'noise', scale: 5, octaves: 3 },
      }),
    ),
  ];

  const tileDefinitions = legacyTiles.map((t) => {
    const color = typeof t.color === 'string' && t.color ? t.color : '#c4a574';
    const colors =
      Array.isArray(t.colors) && t.colors.length > 0
        ? t.colors.filter((c): c is string => typeof c === 'string' && c.length > 0)
        : [color];
    const materialId =
      typeof t.materialId === 'string' && t.materialId
        ? t.materialId
        : materialIdForLabel(typeof t.material === 'string' ? t.material : 'ceramic', materials);

    return {
      type: 'TileDefinition',
      id: t.id ?? crypto.randomUUID(),
      name: t.name ?? 'Tile',
      length: typeof t.length === 'number' && t.length > 0 ? t.length : 0.6,
      width: typeof t.width === 'number' && t.width > 0 ? t.width : 0.3,
      thickness: typeof t.thickness === 'number' && t.thickness > 0 ? t.thickness : 0.02,
      materialId,
      colors,
      color: colors.includes(color) ? color : colors[0],
      texture: typeof t.texture === 'string' ? t.texture : undefined,
      rhythm: t.rhythm,
    };
  });

  return {
    ...root,
    type: 'TilingProject',
    schemaVersion: 2,
    materials,
    tileDefinitions,
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function parseTilingProject(data: unknown): TilingProjectJson {
  return TilingProjectJsonSchema.parse(migrateProject(data));
}

export function createDefaultProject(): TilingProjectJson {
  const materials = defaultMaterials();
  const terracotta = materials.find((m) => m.name === 'terracotta')!;
  const stone = materials.find((m) => m.name === 'stone')!;

  const tileA = createTileDefinition({
    name: 'Reuse A',
    length: 0.6,
    width: 0.3,
    thickness: 0.02,
    materialId: terracotta.id,
    colors: ['#b86b3c', '#c47a4a', '#9a5528'],
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
    materialId: stone.id,
    colors: ['#8a8f7a', '#6f7464', '#a3a890'],
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
    schemaVersion: 2,
    meta: {
      name: 'Untitled tiling',
      updatedAt: new Date().toISOString(),
    },
    materials,
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
export * from './material';
export * from './material-presets';
export * from './mat3';
export * from './stock';
export * from './tile';
