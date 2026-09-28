import { z } from 'zod';
import { BoundaryConditionsJsonSchema, defaultBoundaries } from './boundaries';
import {
  createEmptyDesignFamily,
  createModulePlacement,
  DesignFamilyJsonSchema,
} from './design-family';
import { DesignInstanceJsonSchema } from './instance';
import { DEFAULT_JOINT_COLOR, defaultJoint, GROUT_MATERIAL_ID, ProjectJointJsonSchema } from './joint';
import { MaterialDefinitionJsonSchema, createMaterialDefinition } from './material';
import { defaultMaterials, groutMaterial, materialIdForLabel } from './material-presets';
import { coerceMat3Json, Mat3JsonSchema } from './mat3';
import { mat3ToPose } from './pose';
import { StockStateJsonSchema } from './stock';
import {
  createTileDefinition,
  TileDefinitionJsonSchema,
  DEFAULT_PALETTE_C,
  type TileColorJson,
} from './tile';
import {
  createMasterGrid,
  createTileGrid,
  createTileGridInstance,
  createTileSchema,
  TileSchemaJsonSchema,
} from './tile-grid';

export const TilingProjectJsonSchema = z.object({
  type: z.literal('TilingProject'),
  schemaVersion: z.literal(5),
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
  /** Grid description of the tiling; when present the solver fills from it. */
  tileSchema: TileSchemaJsonSchema.optional(),
  /**
   * Grout appearance. A function default, so parsed projects never share one object. The
   * migration normally supplies it; the default only covers input that skips migration.
   */
  joint: ProjectJointJsonSchema.default(() => defaultJoint()),
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
      // This runs on every load, not only on legacy data, so it must carry through every
      // field a current material has — anything dropped here is reset to its zod default
      // on each reload and an authored relief or roughness would silently vanish.
      const raw = m as Record<string, unknown>;
      return {
        type: 'MaterialDefinition',
        id: m.id,
        name: typeof m.name === 'string' ? m.name : 'Material',
        seed: typeof m.seed === 'number' ? m.seed : 1,
        sdf: m.sdf,
        ...(raw.relief !== undefined ? { relief: raw.relief } : {}),
        ...(raw.roughness !== undefined ? { roughness: raw.roughness } : {}),
      };
    }
    return createMaterialDefinition({
      id: typeof m.id === 'string' ? m.id : undefined,
      name: typeof m.name === 'string' ? m.name : 'Material',
      seed: typeof m.seed === 'number' ? m.seed : 1,
    });
  });
}

/**
 * Give a project a joint, and keep its material reference valid.
 *
 * This runs on every parse — including every edit — so it must be idempotent. The grout preset
 * is appended only when the project has no joint yet: keying it on "no material with that id"
 * instead would resurrect a grout material the user deleted, on the very next load. A joint
 * pointing at a missing material is repointed to the first material.
 */
function migrateJoint(
  root: Record<string, unknown>,
  materials: unknown[],
): { joint: unknown; materials: unknown[] } {
  const ids = materials
    .map((m) => (m && typeof m === 'object' ? (m as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string');

  const raw = root.joint;
  if (!raw || typeof raw !== 'object') {
    return {
      joint: defaultJoint(),
      materials: ids.includes(GROUT_MATERIAL_ID) ? materials : [...materials, groutMaterial()],
    };
  }

  const joint = { ...(raw as Record<string, unknown>) };
  if ((typeof joint.materialId !== 'string' || !ids.includes(joint.materialId)) && ids[0]) {
    joint.materialId = ids[0];
  }
  return { joint, materials };
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

/**
 * A v4 placement — `{ id, tileDefinitionId, <matrixKey>: Mat3 }` — as a pose. Entries already
 * posed pass through untouched, which keeps this idempotent. Returns null when the placement
 * cannot be posed: an unknown tile or an unreadable matrix.
 */
function poseLegacyPlacement(
  entry: unknown,
  matrixKey: 'mat3' | 'localMat3',
  sizes: ReadonlyMap<string, { length: number; width: number }>,
): UnknownRecord | null {
  if (!isRecord(entry)) return null;
  if (isRecord(entry.position)) return entry;
  const matrix = Mat3JsonSchema.safeParse(coerceMat3Json(entry[matrixKey]));
  const size =
    typeof entry.tileDefinitionId === 'string' ? sizes.get(entry.tileDefinitionId) : undefined;
  if (!matrix.success || !size) return null;
  const { [matrixKey]: _matrix, ...rest } = entry;
  return { ...rest, ...mat3ToPose(matrix.data, size) };
}

/**
 * v4 → v5: solved and module placements move from a matrix to a pose (see `PoseJsonSchema`),
 * and a module repeat from `offsetMat3` to a plain `offset`. Ids are not removed here; zod
 * strips the keys it no longer knows. Runs on every parse, so it must be idempotent.
 */
function migratePoses(
  root: UnknownRecord,
  tileDefinitions: unknown,
): Pick<UnknownRecord, 'designFamily' | 'instance'> {
  const sizes = new Map<string, { length: number; width: number }>();
  if (Array.isArray(tileDefinitions)) {
    for (const t of tileDefinitions) {
      if (!isRecord(t) || typeof t.id !== 'string') continue;
      if (typeof t.length === 'number' && typeof t.width === 'number') {
        sizes.set(t.id, { length: t.length, width: t.width });
      }
    }
  }

  const posed = (list: unknown, key: 'mat3' | 'localMat3') =>
    Array.isArray(list)
      ? list
          .map((p) => poseLegacyPlacement(p, key, sizes))
          .filter((p): p is UnknownRecord => p !== null)
      : list;

  let instance = root.instance;
  if (isRecord(instance)) {
    instance = { ...instance, placements: posed(instance.placements, 'mat3') };
  }

  let designFamily = root.designFamily;
  if (isRecord(designFamily) && Array.isArray(designFamily.modules)) {
    designFamily = {
      ...designFamily,
      modules: designFamily.modules.map((module) => {
        if (!isRecord(module)) return module;
        let repeat = module.repeat;
        if (isRecord(repeat) && !isRecord(repeat.offset)) {
          const offset = Mat3JsonSchema.safeParse(coerceMat3Json(repeat.offsetMat3));
          // Offsets were always pure translations; keep only that column.
          const x = offset.success ? offset.data.elements[6] : 0;
          const y = offset.success ? offset.data.elements[7] : 0;
          const { offsetMat3: _offsetMat3, ...rest } = repeat;
          repeat = { ...rest, offset: { x, y } };
        }
        return { ...module, placements: posed(module.placements, 'localMat3'), repeat };
      }),
    };
  }

  return { designFamily, instance };
}

function migrateProject(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const root = data as Record<string, unknown>;
  const version = root.schemaVersion;

  if ((version === 3 || version === 4 || version === 5) && Array.isArray(root.materials)) {
    // v3 → v4 added only the optional tileSchema and v4 → v5 only re-encodes placements, so
    // one branch normalises all three: strip deprecated periodMeters, pose placements and
    // stamp the current version.
    const withJoint = migrateJoint(root, migrateMaterials(root));
    return {
      ...root,
      schemaVersion: 5,
      materials: withJoint.materials,
      joint: withJoint.joint,
      tileDefinitions: Array.isArray(root.tileDefinitions)
        ? (root.tileDefinitions as LegacyTile[]).map((t) => ({
            ...t,
            color: migrateTileColor(t),
            colors: undefined,
          }))
        : root.tileDefinitions,
      ...migratePoses(root, root.tileDefinitions),
    };
  }

  // v1 / v2 → v5
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
      rhythm: t.rhythm,
    };
  });

  const withJoint = migrateJoint(root, materials);
  return {
    ...root,
    type: 'TilingProject',
    schemaVersion: 5,
    materials: withJoint.materials,
    joint: withJoint.joint,
    tileDefinitions,
    ...migratePoses(root, tileDefinitions),
  };
}

export function parseTilingProject(data: unknown): TilingProjectJson {
  return TilingProjectJsonSchema.parse(migrateProject(data));
}

export function createDefaultProject(): TilingProjectJson {
  const materials = defaultMaterials();
  const byName = (name: string) => materials.find((m) => m.name === name)!;

  /**
   * Formats and tiling from a hand-tuned project. Renamed by format — the author's names were
   * "Reuse A", "Reuse B", "2x3" and "Tile", which say nothing — and repointed to the materials
   * imported alongside them. Their colours, edge rhythms, corner rounding and thickness are
   * kept as authored.
   */
  const square600 = createTileDefinition({
    name: 'Square 600',
    length: 0.6,
    width: 0.6,
    thickness: 0.03,
    materialId: byName('arabescato').id,
    color: { mode: 'palette', colors: ['#f5f7d9', '#f5f7d9', '#f5f7d9'], c: [1, 1, 1] },
    rhythm: {
      south: { name: 'B', mirrored: true },
      east: { name: 'A', mirrored: false },
      north: { name: 'A', mirrored: true },
      west: { name: 'B', mirrored: false },
    },
    cornerRounding: 0.025,
  });
  const square200 = createTileDefinition({
    name: 'Square 200',
    length: 0.2,
    width: 0.2,
    thickness: 0.025,
    materialId: byName('worn terracotta').id,
    color: { mode: 'brightness', color: '#4517ee' },
    cornerRounding: 0.045,
  });
  const slab200x300 = createTileDefinition({
    name: 'Slab 200 x 300',
    length: 0.2,
    width: 0.3,
    thickness: 0.02,
    materialId: byName('worn terracotta').id,
    color: { mode: 'brightness', color: '#c4a574' },
    cornerRounding: 0.02,
  });
  const slab200x400 = createTileDefinition({
    name: 'Slab 200 x 400',
    length: 0.2,
    width: 0.4,
    thickness: 0.02,
    materialId: byName('flamed granite').id,
    color: { mode: 'palette', colors: ['#8e9bcc', '#9a9fb1', '#8a92b2'], c: [0.61, 0.55, 0.98] },
    rhythm: {
      south: { name: 'A', mirrored: false },
      east: { name: 'B', mirrored: false },
      north: { name: 'A', mirrored: true },
      west: { name: 'B', mirrored: true },
    },
    cornerRounding: 0,
  });
  const square125 = createTileDefinition({
    name: 'Square 125',
    length: 0.125,
    width: 0.125,
    thickness: 0.03,
    materialId: byName('arabescato').id,
    color: { mode: 'palette', colors: ['#c4a574', '#c4a574', '#c4a574'], c: [0.83, 0.68, 0.92] },
    cornerRounding: 0,
  });

  /**
   * A 6×6 repeat on a 130 mm cell: one 600 mm square in a 5×5 footprint, bordered on two
   * sides by 125 mm squares, so every repeat reads as a large slab framed by a strip of small
   * ones. The 5×5 footprint is 645 mm, so the square sits centred with widened joints.
   */
  const tileSchema = (() => {
    const grid = createTileGrid({
      name: 'Repeat',
      cell: { x: 0.13, y: 0.13 },
      joint: 0.005,
      extent: { iCount: 6, jCount: 6 },
      instances: [
        ...Array.from({ length: 6 }, (_, i) => createTileGridInstance(square125.id, i, 0)),
        ...Array.from({ length: 5 }, (_, j) => createTileGridInstance(square125.id, 0, j + 1)),
        createTileGridInstance(square600.id, 1, 1, 5, 5),
      ],
      fallbackTileDefinitionId: square125.id,
    });
    const master = createMasterGrid({
      name: 'Master',
      childId: grid.id,
      u: { i: 6, j: 0 },
      v: { i: 0, j: 6 },
    });
    return createTileSchema({
      tileGrids: [grid],
      masterGrids: [master],
      rootMasterGridId: master.id,
    });
  })();

  const normal = (tile: { id: string }, mean: number, stdDev: number) => ({
    tileDefinitionId: tile.id,
    kind: 'distribution' as const,
    distribution: 'normal' as const,
    params: { mean, stdDev },
  });

  return {
    type: 'TilingProject',
    schemaVersion: 5,
    meta: {
      name: 'Untitled tiling',
      updatedAt: new Date().toISOString(),
    },
    materials,
    tileDefinitions: [square600, square200, slab200x300, slab200x400, square125],
    stock: {
      type: 'StockState',
      entries: [
        {
          tileDefinitionId: square600.id,
          kind: 'distribution',
          distribution: 'uniform',
          params: { min: 360, max: 360 },
        },
        normal(square200, 240, 20),
        normal(slab200x300, 100, 2),
        normal(slab200x400, 1000, 2),
        normal(square125, 600, 20),
      ],
    },
    // Only drives the solve when the tile schema is removed.
    designFamily: (() => {
      const family = createEmptyDesignFamily();
      const module = family.modules[0]!;
      const gap = 0.005;
      module.placements = [
        createModulePlacement(square600.id, { x: square600.length / 2, y: square600.width / 2 }),
        createModulePlacement(square200.id, {
          x: square600.length + gap + square200.length / 2,
          y: square200.width / 2,
        }),
      ];
      module.repeat = {
        count: 3,
        offset: { x: square600.length + square200.length + 2 * gap, y: 0 },
      };
      return family;
    })(),
    boundaries: defaultBoundaries(),
    tileSchema,
    joint: { materialId: byName('worn terracotta').id, color: { ...DEFAULT_JOINT_COLOR }, depth: 0 },
  };
}

/**
 * Delete a material, repointing everything that used it — tiles and the joint — to the first
 * remaining material. A no-op when it is the last material.
 */
export function removeMaterial(project: TilingProjectJson, materialId: string): TilingProjectJson {
  const remaining = project.materials.filter((m) => m.id !== materialId);
  const fallback = remaining[0]?.id;
  if (!fallback) return project;
  return {
    ...project,
    materials: remaining,
    tileDefinitions: project.tileDefinitions.map((t) =>
      t.materialId === materialId ? { ...t, materialId: fallback } : t,
    ),
    joint:
      project.joint.materialId === materialId
        ? { ...project.joint, materialId: fallback }
        : project.joint,
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
export * from './joint';
export * from './material';
export * from './material-presets';
export * from './mat3';
export * from './pose';
export * from './stock';
export * from './tile';
export * from './tile-grid';
