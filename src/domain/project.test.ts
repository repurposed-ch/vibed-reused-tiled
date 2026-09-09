import { describe, expect, it } from 'vitest';
import {
  createDefaultProject,
  parseTilingProject,
  projectFromJsonString,
  projectToJsonString,
} from '@/domain/project';
import { compileSdfExpression, buildBakeFragmentShader } from '@/render/materials/sdf-to-glsl';
import { mulberry32, sampleStock } from '@/workflow/sample-stock';
import { solveLayout } from '@/workflow/solve-layout';

describe('project schema', () => {
  it('round-trips the default project at schemaVersion 2', () => {
    const project = createDefaultProject();
    const again = parseTilingProject(JSON.parse(JSON.stringify(project)) as unknown);
    expect(again.schemaVersion).toBe(2);
    expect(again.materials.length).toBeGreaterThan(0);
    expect(again.tileDefinitions[0]?.materialId).toBeTruthy();
    expect(again.tileDefinitions[0]?.colors.length).toBeGreaterThan(0);
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
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.materials.some((m) => m.name === 'terracotta')).toBe(true);
    expect(migrated.tileDefinitions[0]?.colors).toEqual(['#b86b3c']);
    expect(migrated.tileDefinitions[0]?.materialId).toBeTruthy();
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
  it('compiles noise and mix nodes into fragment source', () => {
    const sdf = {
      op: 'mix' as const,
      t: 0.5,
      a: { op: 'noise' as const, scale: 4, octaves: 2 },
      b: { op: 'voronoi' as const, scale: 3 },
    };
    const expr = compileSdfExpression(sdf);
    expect(expr).toContain('fbm2');
    expect(expr).toContain('voronoiEdge');
    const frag = buildBakeFragmentShader(sdf);
    expect(frag).toContain('#version 300 es');
    expect(frag).toContain('float shadeRaw');
    expect(frag).toContain('uPeriod');
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
