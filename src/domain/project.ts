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
import {
  createTileDefinition,
  TileDefinitionJsonSchema,
  DEFAULT_PALETTE_C,
  type TileColorJson,
} from './tile';

export const TilingProjectJsonSchema = z.object({
  type: z.literal('TilingProject'),
  schemaVersion: z.literal(3),
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

type LegacyMaterial = {
  type?: string;
  id?: string;
  name?: string;
  seed?: number;
  periodMeters?: number;
  sdf?: unknown;
};

type LegacyTile = {
  type?: string;
  id?: string;
  name?: string;
  length?: number;
  width?: number;
  thickness?: number;
  material?: string;
  materialId?: string;
  color?: unknown;
  colors?: string[];
  texture?: string;
  rhythm?: unknown;
};

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function parsePaletteC(raw: unknown): [number, number, number] {
  if (Array.isArray(raw) && raw.length >= 3) {
    const x = typeof raw[0] === 'number' ? raw[0] : 1;
    const y = typeof raw[1] === 'number' ? raw[1] : 1;
    const z = typeof raw[2] === 'number' ? raw[2] : 1;
    return [x, y, z];
  }
  return [...DEFAULT_PALETTE_C];
}

function migrateTileColor(t: LegacyTile): TileColorJson {
  const c = t.color;
  if (c && typeof c === 'object' && c !== null && 'mode' in c) {
    const obj = c as Record<string, unknown>;
    if (obj.mode === 'brightness' && typeof obj.color === 'string') {
      return { mode: 'brightness', color: obj.color };
    }
    if (obj.mode === 'palette' && Array.isArray(obj.colors)) {
      const cols = obj.colors.filter((x): x is string => typeof x === 'string');
      if (cols.length >= 3) {
        return {
          mode: 'palette',
          colors: [cols[0]!, cols[1]!, cols[2]!],
          c: parsePaletteC(obj.c),
        };
      }
    }
  }

  const hex =
    typeof c === 'string' && c
      ? c
      : Array.isArray(t.colors) && t.colors[0]
        ? t.colors[0]
        : '#c4a574';

  if (Array.isArray(t.colors) && t.colors.length >= 3) {
    return {
      mode: 'palette',
      colors: [t.colors[0]!, t.colors[1]!, t.colors[2]!],
      c: [...DEFAULT_PALETTE_C],
    };
  }

  return { mode: 'brightness', color: hex };
}

function migrateMaterials(root: Record<string, unknown>): unknown[] {
  const presets = defaultMaterials();
  if (!Array.isArray(root.materials)) {
    return presets;
  }

  return (root.materials as LegacyMaterial[]).map((m) => {
    if (m && typeof m === 'object' && m.sdf && typeof m.id === 'string') {
      return {
        type: 'MaterialDefinition',
        id: m.id,
        name: typeof m.name === 'string' ? m.name : 'Material',
        seed: typeof m.seed === 'number' ? m.seed : 1,
        sdf: m.sdf,
      };
    }
    return createMaterialDefinition({
      id: typeof m.id === 'string' ? m.id : undefined,
      name: typeof m.name === 'string' ? m.name : 'Material',
      seed: typeof m.seed === 'number' ? m.seed : 1,
    });
  });
}

function migrateProject(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const root = data as Record<string, unknown>;
  const version = root.schemaVersion;

  if (version === 3 && Array.isArray(root.materials)) {
    // Strip deprecated periodMeters if present on materials
    return {
      ...root,
      materials: migrateMaterials(root),
      tileDefinitions: Array.isArray(root.tileDefinitions)
        ? (root.tileDefinitions as LegacyTile[]).map((t) => ({
            ...t,
            color: migrateTileColor(t),
            colors: undefined,
          }))
        : root.tileDefinitions,
    };
  }

  // v1 / v2 → v3
  const presets = defaultMaterials();
  const legacyTiles = Array.isArray(root.tileDefinitions)
    ? (root.tileDefinitions as LegacyTile[])
    : [];

  let materials: unknown[];
  if (Array.isArray(root.materials) && root.materials.length > 0) {
    materials = migrateMaterials(root);
  } else {
    const extraLabels = new Set<string>();
    for (const t of legacyTiles) {
      if (typeof t.material === 'string' && t.material.trim()) {
        const label = t.material.trim().toLowerCase();
        if (!presets.some((m) => m.name.toLowerCase() === label)) {
          extraLabels.add(t.material.trim());
        }
      }
    }
    materials = [
      ...presets,
      ...[...extraLabels].map((name) =>
        createMaterialDefinition({
          name,
          seed: hashString(name),
          sdf: { op: 'noise', scale: 5, octaves: 3 },
        }),
      ),
    ];
  }

  const materialList = materials as ReturnType<typeof defaultMaterials>;

  const tileDefinitions = legacyTiles.map((t) => {
    const materialId =
      typeof t.materialId === 'string' && t.materialId
        ? t.materialId
        : materialIdForLabel(typeof t.material === 'string' ? t.material : 'ceramic', materialList);

    return {
      type: 'TileDefinition',
      id: t.id ?? crypto.randomUUID(),
      name: t.name ?? 'Tile',
      length: typeof t.length === 'number' && t.length > 0 ? t.length : 0.6,
      width: typeof t.width === 'number' && t.width > 0 ? t.width : 0.3,
      thickness: typeof t.thickness === 'number' && t.thickness > 0 ? t.thickness : 0.02,
      materialId,
      color: migrateTileColor(t),
      texture: typeof t.texture === 'string' ? t.texture : undefined,
      rhythm: t.rhythm,
    };
  });

  return {
    ...root,
    type: 'TilingProject',
    schemaVersion: 3,
    materials,
    tileDefinitions,
  };
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
    color: {
      mode: 'palette',
      colors: ['#b86b3c', '#c47a4a', '#9a5528'],
      c: [1, 1, 1],
    },
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
    color: { mode: 'brightness', color: '#8a8f7a' },
    rhythm: {
      south: { name: 'C', mirrored: false },
      north: { name: 'C', mirrored: true },
      east: { name: 'C', mirrored: false },
      west: { name: 'C', mirrored: true },
    },
  });

  return {
    type: 'TilingProject',
    schemaVersion: 3,
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
