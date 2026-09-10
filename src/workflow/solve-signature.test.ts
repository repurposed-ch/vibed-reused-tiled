import { describe, expect, it } from 'vitest';
import { createDefaultProject, type TilingProjectJson } from '@/domain/project';
import { estimateSolveCells, solveSignature } from '@/workflow/solve-signature';
import { findRapportModule, rapportToTileSchema } from '@/workflow/rapport';

function baseProject(): TilingProjectJson {
  return createDefaultProject();
}

describe('solveSignature', () => {
  it('ignores meta, so a persist stamp cannot retrigger a solve', () => {
    // Every write stamps meta.updatedAt. If that reached the signature, the
    // auto-solve would write an instance, see a changed project, and solve
    // again without end.
    const project = baseProject();
    const stamped: TilingProjectJson = {
      ...project,
      meta: { ...project.meta, updatedAt: new Date().toISOString() },
    };
    expect(solveSignature(stamped, 1)).toBe(solveSignature(project, 1));
  });

  it('ignores the instance, which is the solver own output', () => {
    const project = baseProject();
    const solved: TilingProjectJson = {
      ...project,
      instance: {
        type: 'DesignInstance',
        placements: [],
        meta: { seed: 9 },
      },
    };
    expect(solveSignature(solved, 1)).toBe(solveSignature(project, 1));
  });

  it('ignores a baked texture, which does not move a tile', () => {
    const project = baseProject();
    const baked: TilingProjectJson = {
      ...project,
      tileDefinitions: project.tileDefinitions.map((t, i) =>
        i === 0 ? { ...t, texture: 'data:image/png;base64,AAAA' } : t,
      ),
    };
    expect(solveSignature(baked, 1)).toBe(solveSignature(project, 1));
  });

  it('changes for every input the solver actually reads', () => {
    const project = baseProject();
    const base = solveSignature(project, 1);

    expect(solveSignature(project, 2)).not.toBe(base);

    const resized: TilingProjectJson = {
      ...project,
      tileDefinitions: project.tileDefinitions.map((t, i) =>
        i === 0 ? { ...t, length: t.length + 0.05 } : t,
      ),
    };
    expect(solveSignature(resized, 1)).not.toBe(base);

    const moved: TilingProjectJson = {
      ...project,
      boundaries: {
        ...project.boundaries,
        outers: [
          {
            type: 'Polygon2',
            vertices: [
              { type: 'Vec2', x: 0, y: 0 },
              { type: 'Vec2', x: 9, y: 0 },
              { type: 'Vec2', x: 9, y: 4 },
              { type: 'Vec2', x: 0, y: 4 },
            ],
          },
        ],
      },
    };
    expect(solveSignature(moved, 1)).not.toBe(base);

    const module = findRapportModule({
      tiles: project.tileDefinitions,
      targets: project.tileDefinitions.map((t) => ({ tileDefinitionId: t.id, areaShare: 50 })),
    });
    expect(module).not.toBeNull();
    if (!module) return;
    const withSchema: TilingProjectJson = { ...project, tileSchema: rapportToTileSchema(module) };
    expect(solveSignature(withSchema, 1)).not.toBe(base);
  });

  it('is stable for an unchanged project', () => {
    const project = baseProject();
    expect(solveSignature(project, 1)).toBe(solveSignature(project, 1));
  });
});

describe('estimateSolveCells', () => {
  it('is zero without a tile schema, since only the grid path scans cells', () => {
    expect(estimateSolveCells(baseProject())).toBe(0);
  });

  it('scales with boundary area over cell size', () => {
    const project = baseProject();
    const module = findRapportModule({
      tiles: project.tileDefinitions,
      targets: project.tileDefinitions.map((t) => ({ tileDefinitionId: t.id, areaShare: 50 })),
    });
    expect(module).not.toBeNull();
    if (!module) return;

    const schema = rapportToTileSchema(module);
    const cell = schema.tileGrids[0]!.cell;
    // The default boundary is 4 x 3 m.
    const coarse = estimateSolveCells({ ...project, tileSchema: schema });
    expect(coarse).toBeCloseTo(
      (Math.ceil(4 / cell.x) + 1) * (Math.ceil(3 / cell.y) + 1),
      0,
    );

    const fine = estimateSolveCells({
      ...project,
      tileSchema: {
        ...schema,
        tileGrids: [{ ...schema.tileGrids[0]!, cell: { x: cell.x / 4, y: cell.y / 4 } }],
      },
    });
    expect(fine).toBeGreaterThan(coarse * 10);
  });
});
