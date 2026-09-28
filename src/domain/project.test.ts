import { describe, expect, it } from 'vitest';
import {
  createDefaultProject,
  parseTilingProject,
  poseAabb,
  poseToMat3,
  translationMat3,
  projectFromJsonString,
  projectToJsonString,
  TileDefinitionJsonSchema,
} from '@/domain/project';
import { buildBakeFragmentShader, compileSdfExpression } from '@/render/materials/sdf-to-glsl';
import { mulberry32, sampleStock } from '@/workflow/sample-stock';
import { solveLayout } from '@/workflow/solve-layout';
import { findRapportModule, rapportToTileSchema } from '@/workflow/rapport';
import { resolveSchema } from '@/workflow/tile-grid-lattice';

describe('project schema', () => {
  it('round-trips the default project at schemaVersion 5', () => {
    const project = createDefaultProject();
    const again = parseTilingProject(JSON.parse(JSON.stringify(project)) as unknown);
    expect(again.schemaVersion).toBe(5);
    expect(again.materials.length).toBeGreaterThan(0);
    expect(again.materials[0]).not.toHaveProperty('periodMeters');
    expect(again.tileDefinitions[0]?.materialId).toBeTruthy();
    expect(again.tileDefinitions[0]?.color.mode).toMatch(/brightness|palette/);
  });

  it('migrates legacy v1 projects with freeform material strings', () => {
    const legacy = {
      type: 'TilingProject',
      schemaVersion: 1,
      tileDefinitions: [
        {
          type: 'TileDefinition',
          id: 't1',
          name: 'Old',
          length: 0.5,
          width: 0.5,
          thickness: 0.02,
          material: 'terracotta',
          color: '#b86b3c',
        },
      ],
      stock: { type: 'StockState', entries: [] },
      designFamily: {
        type: 'DesignFamily',
        id: 'f1',
        name: 'F',
        modules: [
          {
            type: 'DesignModule',
            id: 'm1',
            name: 'Module A',
            placements: [],
          },
        ],
        primaryModuleIds: ['m1'],
        constraints: [],
      },
      boundaries: {
        type: 'BoundaryConditions',
        outers: [
          {
            type: 'Polygon2',
            vertices: [
              { type: 'Vec2', x: 0, y: 0 },
              { type: 'Vec2', x: 1, y: 0 },
              { type: 'Vec2', x: 1, y: 1 },
              { type: 'Vec2', x: 0, y: 1 },
            ],
          },
        ],
        holes: [],
        guides: [],
      },
    };
    const migrated = parseTilingProject(legacy);
    expect(migrated.schemaVersion).toBe(5);
    expect(migrated.materials.some((m) => m.name === 'terracotta')).toBe(true);
    expect(migrated.tileDefinitions[0]?.color).toEqual({
      mode: 'brightness',
      color: '#b86b3c',
    });
  });

  it('migrates v2 colors[] into TileColorJson', () => {
    const v2 = {
      ...createDefaultProject(),
      schemaVersion: 2,
      materials: [
        {
          type: 'MaterialDefinition',
          id: 'm1',
          name: 'stone',
          seed: 1,
          periodMeters: 0.3,
          sdf: { op: 'noise', scale: 4 },
        },
      ],
      tileDefinitions: [
        {
          type: 'TileDefinition',
          id: 't1',
          name: 'T',
          length: 0.4,
          width: 0.4,
          thickness: 0.02,
          materialId: 'm1',
          colors: ['#111111', '#222222', '#333333'],
          color: '#111111',
        },
      ],
    };
    const migrated = parseTilingProject(v2);
    expect(migrated.schemaVersion).toBe(5);
    expect(migrated.materials[0]).not.toHaveProperty('periodMeters');
    expect(migrated.tileDefinitions[0]?.color).toEqual({
      mode: 'palette',
      colors: ['#111111', '#222222', '#333333'],
      c: [1, 1, 1],
    });
  });

  it('defaults missing palette c to [1,1,1]', () => {
    const migrated = parseTilingProject({
      ...createDefaultProject(),
      tileDefinitions: [
        {
          type: 'TileDefinition',
          id: 't1',
          name: 'T',
          length: 0.4,
          width: 0.4,
          thickness: 0.02,
          materialId: createDefaultProject().materials[0]!.id,
          color: {
            mode: 'palette',
            colors: ['#aa0000', '#00aa00', '#0000aa'],
          },
        },
      ],
    });
    expect(migrated.tileDefinitions[0]?.color).toEqual({
      mode: 'palette',
      colors: ['#aa0000', '#00aa00', '#0000aa'],
      c: [1, 1, 1],
    });
  });

  it('rejects partial rhythm on tiles', () => {
    expect(() =>
      TileDefinitionJsonSchema.parse({
        type: 'TileDefinition',
        id: 't',
        name: 'T',
        length: 0.3,
        width: 0.3,
        thickness: 0.02,
        materialId: 'm',
        color: { mode: 'brightness', color: '#fff' },
        rhythm: { south: { name: 'A', mirrored: false } },
      }),
    ).toThrow();
  });

  it('serializes materials in project JSON', () => {
    const project = createDefaultProject();
    const text = projectToJsonString(project);
    const again = projectFromJsonString(text);
    expect(again.materials.map((m) => m.name)).toEqual(
      expect.arrayContaining(['terracotta', 'stone', 'ceramic']),
    );
  });
});

describe('sdf → glsl', () => {
  it('compiles noise/mix and includes Quilez palette in bake shader', () => {
    const sdf = {
      op: 'mix' as const,
      t: 0.5,
      a: { op: 'noise' as const, scale: 4, octaves: 2 },
      b: { op: 'voronoi' as const, scale: 3 },
    };
    const expr = compileSdfExpression(sdf);
    expect(expr).toContain('fbm2');
    expect(expr).toContain('voronoiEdge');
    expect(expr).toContain('seed');
    const frag = buildBakeFragmentShader(sdf);
    expect(frag).toContain('#version 300 es');
    expect(frag).toContain('iqPalette');
    expect(frag).toContain('uPalC');
    expect(frag).toContain('shadeEdged');
    expect(frag).toContain('uColorMode');
  });
});

describe('workflow', () => {
  it('samples stock and produces placements', () => {
    const project = createDefaultProject();
    const sampled = sampleStock(project.stock, mulberry32(7));
    expect(sampled.every((s) => s.count >= 0)).toBe(true);
    const instance = solveLayout({
      tileDefinitions: project.tileDefinitions,
      designFamily: project.designFamily,
      boundaries: project.boundaries,
      sampledStock: sampled,
      seed: 7,
    });
    expect(instance.placements.length).toBeGreaterThan(0);
  });
});

describe('tile schema persistence', () => {
  it('ships a default tile schema that fills the default boundary', () => {
    const project = createDefaultProject();
    const schema = project.tileSchema!;
    expect(schema).toBeDefined();

    // Every tile the schema names, fallback included, is one the project defines.
    const ids = new Set(project.tileDefinitions.map((t) => t.id));
    for (const grid of schema.tileGrids) {
      expect(ids.has(grid.fallbackTileDefinitionId)).toBe(true);
      expect(grid.instances.every((i) => ids.has(i.tileDefinitionId))).toBe(true);
    }
    expect(() => resolveSchema(schema)).not.toThrow();

    const instance = solveLayout({
      tileDefinitions: project.tileDefinitions,
      designFamily: project.designFamily,
      boundaries: project.boundaries,
      sampledStock: sampleStock(project.stock, mulberry32(7)),
      seed: 7,
      tileSchema: schema,
    });
    const stats = instance.meta?.solverStats;
    expect(instance.placements.length).toBeGreaterThan(0);
    expect(stats?.stockShortfall).toBe(0);
    expect(stats?.oversizedTiles).toBe(0);
  });

  it('migrates a v3 project forward and leaves it without a tile schema', () => {
    const v3 = { ...createDefaultProject(), schemaVersion: 3, tileSchema: undefined };
    const migrated = parseTilingProject(JSON.parse(JSON.stringify(v3)) as unknown);
    expect(migrated.schemaVersion).toBe(5);
    expect(migrated.tileSchema).toBeUndefined();
  });

  it('round-trips a tile schema through the project document', () => {
    const project = createDefaultProject();
    // Two formats that share a 0.1 m unit. Not every tile in the sample project: it also ships
    // 600 and 125 mm squares, which share only a 25 mm unit with the 200 mm formats.
    const rapportTiles = project.tileDefinitions.filter((t) =>
      ['Square 200', 'Slab 200 x 300'].includes(t.name),
    );
    expect(rapportTiles).toHaveLength(2);
    const module = findRapportModule({
      tiles: rapportTiles,
      targets: rapportTiles.map((t) => ({ tileDefinitionId: t.id, areaShare: 50 })),
    });
    expect(module).not.toBeNull();
    if (!module) return;

    const withSchema = { ...project, tileSchema: rapportToTileSchema(module) };
    const again = projectFromJsonString(projectToJsonString(withSchema));

    expect(again.tileSchema?.type).toBe('TileSchema');
    expect(again.tileSchema?.tileGrids).toHaveLength(1);
    expect(again.tileSchema?.masterGrids).toHaveLength(1);
    expect(again.tileSchema?.rootMasterGridId).toBe(withSchema.tileSchema.masterGrids[0]?.id);
    // The persisted schema still resolves to an exact cover after the round trip.
    expect(() => resolveSchema(again.tileSchema!)).not.toThrow();
  });

  it('solves from the tile schema when the project carries one', () => {
    const project = createDefaultProject();
    // Two formats that share a 0.1 m unit. Not every tile in the sample project: it also ships
    // 600 and 125 mm squares, which share only a 25 mm unit with the 200 mm formats.
    const rapportTiles = project.tileDefinitions.filter((t) =>
      ['Square 200', 'Slab 200 x 300'].includes(t.name),
    );
    expect(rapportTiles).toHaveLength(2);
    const module = findRapportModule({
      tiles: rapportTiles,
      targets: rapportTiles.map((t) => ({ tileDefinitionId: t.id, areaShare: 50 })),
    });
    expect(module).not.toBeNull();
    if (!module) return;

    const sampled = sampleStock(project.stock, mulberry32(7));
    const instance = solveLayout({
      tileDefinitions: project.tileDefinitions,
      designFamily: project.designFamily,
      boundaries: project.boundaries,
      sampledStock: sampled,
      seed: 7,
      tileSchema: rapportToTileSchema(module),
    });

    expect(instance.placements.length).toBeGreaterThan(0);
    // The grid path reports cell-level statistics the module packer never has.
    expect(instance.meta?.solverStats?.cells).toBeGreaterThan(0);
    expect(instance.meta?.solverStats?.placementCount).toBe(instance.placements.length);
    // Every placement names a tile the project actually defines.
    const ids = new Set(project.tileDefinitions.map((t) => t.id));
    expect(instance.placements.every((p) => ids.has(p.tileDefinitionId))).toBe(true);
  });
});

describe('v4 → v5 placement poses', () => {
  /** The default project, solved, written back out the way v4 stored it. */
  function v4Project() {
    const project = createDefaultProject();
    const instance = solveLayout({
      tileDefinitions: project.tileDefinitions,
      designFamily: project.designFamily,
      boundaries: project.boundaries,
      sampledStock: sampleStock(project.stock, mulberry32(7)),
      seed: 7,
      tileSchema: project.tileSchema,
    });
    const tiles = new Map(project.tileDefinitions.map((t) => [t.id, t]));
    const module = project.designFamily.modules[0]!;
    const legacy = {
      ...project,
      schemaVersion: 4,
      instance: {
        ...instance,
        placements: instance.placements.map(({ position, rotation, mirror, ...rest }, n) => ({
          ...rest,
          id: `p${n}`,
          moduleId: 'm',
          mat3: poseToMat3({ position, rotation, mirror }, tiles.get(rest.tileDefinitionId)!),
        })),
      },
      designFamily: {
        ...project.designFamily,
        modules: [
          {
            ...module,
            placements: module.placements.map(({ position, rotation, mirror, ...rest }, n) => ({
              ...rest,
              id: `mp${n}`,
              role: 'x',
              localMat3: poseToMat3({ position, rotation, mirror }, tiles.get(rest.tileDefinitionId)!),
            })),
            repeat: { count: 3, offsetMat3: translationMat3(module.repeat!.offset.x, module.repeat!.offset.y) },
          },
        ],
      },
    };
    return { project: { ...project, instance }, legacy, tiles };
  }

  it('turns matrices into poses with the same footprint, and drops the ids', () => {
    const { project, legacy, tiles } = v4Project();
    const migrated = parseTilingProject(JSON.parse(JSON.stringify(legacy)) as unknown);

    expect(migrated.schemaVersion).toBe(5);
    const before = project.instance.placements;
    const after = migrated.instance!.placements;
    expect(after).toHaveLength(before.length);
    after.forEach((p, i) => {
      const tile = tiles.get(p.tileDefinitionId)!;
      const a = poseAabb(p, tile);
      const b = poseAabb(before[i]!, tile);
      expect(a.minX).toBeCloseTo(b.minX, 9);
      expect(a.minY).toBeCloseTo(b.minY, 9);
      expect(a.maxX).toBeCloseTo(b.maxX, 9);
      expect(a.maxY).toBeCloseTo(b.maxY, 9);
      expect(p.mirror).toBe(before[i]!.mirror);
      expect(p).not.toHaveProperty('id');
      expect(p).not.toHaveProperty('mat3');
      expect(p).not.toHaveProperty('moduleId');
    });

    const module = migrated.designFamily.modules[0]!;
    expect(module.repeat?.offset).toEqual(project.designFamily.modules[0]!.repeat!.offset);
    for (const [i, pl] of module.placements.entries()) {
      expect(pl).not.toHaveProperty('id');
      expect(pl).not.toHaveProperty('localMat3');
      expect(pl.position.x).toBeCloseTo(project.designFamily.modules[0]!.placements[i]!.position.x, 12);
    }
    for (const instance of migrated.tileSchema!.tileGrids[0]!.instances) {
      expect(instance).not.toHaveProperty('id');
    }
  });

  it('is a no-op on a second pass', () => {
    const { legacy } = v4Project();
    const once = parseTilingProject(JSON.parse(JSON.stringify(legacy)) as unknown);
    const twice = parseTilingProject(JSON.parse(JSON.stringify(once)) as unknown);
    expect(twice).toEqual(once);
  });
});
