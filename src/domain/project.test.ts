import { describe, expect, it } from 'vitest';
import {
  createDefaultProject,
  parseTilingProject,
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
  it('round-trips the default project at schemaVersion 4', () => {
    const project = createDefaultProject();
    const again = parseTilingProject(JSON.parse(JSON.stringify(project)) as unknown);
    expect(again.schemaVersion).toBe(4);
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
    expect(migrated.schemaVersion).toBe(4);
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
    expect(migrated.schemaVersion).toBe(4);
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
  it('migrates a v3 project forward and leaves it without a tile schema', () => {
    const v3 = { ...createDefaultProject(), schemaVersion: 3, tileSchema: undefined };
    const migrated = parseTilingProject(JSON.parse(JSON.stringify(v3)) as unknown);
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.tileSchema).toBeUndefined();
  });

  it('round-trips a tile schema through the project document', () => {
    const project = createDefaultProject();
    const module = findRapportModule({
      tiles: project.tileDefinitions,
      targets: project.tileDefinitions.map((t) => ({
        tileDefinitionId: t.id,
        areaShare: 50,
      })),
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
    const module = findRapportModule({
      tiles: project.tileDefinitions,
      targets: project.tileDefinitions.map((t) => ({
        tileDefinitionId: t.id,
        areaShare: 50,
      })),
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
