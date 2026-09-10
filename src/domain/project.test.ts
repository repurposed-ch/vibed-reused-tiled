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

describe('project schema', () => {
  it('round-trips the default project at schemaVersion 3', () => {
    const project = createDefaultProject();
    const again = parseTilingProject(JSON.parse(JSON.stringify(project)) as unknown);
    expect(again.schemaVersion).toBe(3);
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
    expect(migrated.schemaVersion).toBe(3);
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
    expect(migrated.schemaVersion).toBe(3);
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
