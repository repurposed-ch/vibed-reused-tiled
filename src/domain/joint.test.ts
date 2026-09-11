import { describe, expect, it } from 'vitest';
import {
  createDefaultProject,
  createTileDefinition,
  DEFAULT_JOINT_DEPTH,
  GROUT_MATERIAL_ID,
  parseTilingProject,
  placementBlock,
  instanceBlocks,
  FALLBACK_GROUT_MARGIN,
  removeMaterial,
  TileDefinitionJsonSchema,
  translationMat3,
  multiplyMat3,
  rotationMat3,
  transformPointMat3,
  type DesignInstanceJson,
  type TilingProjectJson,
} from './project';
import { solveSignature } from '@/workflow/solve-signature';

const reload = (project: unknown) => parseTilingProject(JSON.parse(JSON.stringify(project)) as unknown);
const groutCount = (p: TilingProjectJson) => p.materials.filter((m) => m.id === GROUT_MATERIAL_ID).length;

/** A project as stored before joints existed: no joint, no grout material. */
function legacyProject(): Record<string, unknown> {
  const project = JSON.parse(JSON.stringify(createDefaultProject())) as Record<string, unknown>;
  delete project.joint;
  project.materials = (project.materials as Array<{ id: string }>).filter((m) => m.id !== GROUT_MATERIAL_ID);
  return project;
}

describe('joint migration', () => {
  it('gives an old project a default joint and exactly one grout material', () => {
    const parsed = parseTilingProject(legacyProject());
    expect(parsed.joint.materialId).toBe(GROUT_MATERIAL_ID);
    expect(parsed.joint.depth).toBe(DEFAULT_JOINT_DEPTH);
    expect(groutCount(parsed)).toBe(1);
  });

  // It runs on every parse, including every edit, so it must be idempotent.
  it('changes nothing when parsed again', () => {
    const once = parseTilingProject(legacyProject());
    const twice = reload(reload(once));
    expect(twice.materials.map((m) => m.id)).toEqual(once.materials.map((m) => m.id));
    expect(twice.joint).toEqual(once.joint);
  });

  it('leaves an existing joint and its material untouched', () => {
    const project = createDefaultProject();
    project.joint = { materialId: 'material-stone', color: { mode: 'brightness', color: '#223344' }, depth: 0.004 };
    project.materials = project.materials.map((m) =>
      m.id === 'material-stone' ? { ...m, relief: 0.003, roughness: [0.2, 0.4] } : m,
    );
    const parsed = reload(project);
    expect(parsed.joint).toEqual(project.joint);
    const stone = parsed.materials.find((m) => m.id === 'material-stone')!;
    expect(stone.relief).toBe(0.003);
    expect(stone.roughness).toEqual([0.2, 0.4]);
  });

  it('does not resurrect a grout material the user deleted', () => {
    const project = removeMaterial(createDefaultProject(), GROUT_MATERIAL_ID);
    const parsed = reload(reload(project));
    expect(groutCount(parsed)).toBe(0);
    expect(parsed.materials.some((m) => m.id === parsed.joint.materialId)).toBe(true);
  });

  it('repoints a joint whose material no longer exists', () => {
    const project = JSON.parse(JSON.stringify(createDefaultProject())) as TilingProjectJson;
    project.joint.materialId = 'material-gone';
    const parsed = reload(project);
    expect(parsed.joint.materialId).toBe(parsed.materials[0]!.id);
  });
});

describe('removeMaterial', () => {
  it('repoints tiles and the joint to the first remaining material', () => {
    const project = createDefaultProject();
    project.tileDefinitions[0] = { ...project.tileDefinitions[0]!, materialId: GROUT_MATERIAL_ID };
    const next = removeMaterial(project, GROUT_MATERIAL_ID);
    const fallback = next.materials[0]!.id;
    expect(next.materials.some((m) => m.id === GROUT_MATERIAL_ID)).toBe(false);
    expect(next.tileDefinitions[0]!.materialId).toBe(fallback);
    expect(next.joint.materialId).toBe(fallback);
  });

  it('refuses to remove the last material', () => {
    const project = createDefaultProject();
    project.materials = [project.materials[0]!];
    expect(removeMaterial(project, project.materials[0]!.id)).toBe(project);
  });
});

describe('corner rounding', () => {
  it('round-trips and defaults to zero', () => {
    const project = createDefaultProject();
    project.tileDefinitions[0] = { ...project.tileDefinitions[0]!, cornerRounding: 0.05 };
    expect(reload(project).tileDefinitions[0]!.cornerRounding).toBe(0.05);
    expect(createTileDefinition().cornerRounding).toBe(0);
  });

  it('rejects more than 10%', () => {
    const t = createTileDefinition();
    expect(TileDefinitionJsonSchema.safeParse({ ...t, cornerRounding: 0.2 }).success).toBe(false);
    expect(TileDefinitionJsonSchema.safeParse({ ...t, cornerRounding: 0.1 }).success).toBe(true);
  });
});

describe('solve signature', () => {
  it('ignores rounding and the joint appearance, which never move a tile', () => {
    const project = createDefaultProject();
    const before = solveSignature(project, 1);
    const rounded = { ...project, tileDefinitions: project.tileDefinitions.map((t) => ({ ...t, cornerRounding: 0.08 })) };
    const recoloured = { ...project, joint: { ...project.joint, depth: 0.005, color: { mode: 'brightness' as const, color: '#000000' } } };
    expect(solveSignature(rounded, 1)).toBe(before);
    expect(solveSignature(recoloured, 1)).toBe(before);
  });
});

describe('placementBlock', () => {
  const tile = createTileDefinition({ id: 't', length: 0.29, width: 0.14 });

  it('is the full cell block when the placement came from a grid', () => {
    const frame = multiplyMat3(translationMat3(1, 2), rotationMat3(0.4));
    const grid = { frame, cell: { x: 0.15, y: 0.15 }, joint: 0.01 };
    const block = placementBlock(
      { id: 'p', tileDefinitionId: 't', mat3: translationMat3(0, 0), cell: { i: 3, j: -1, iSpan: 2, jSpan: 1 } },
      tile,
      grid,
    );
    expect(block.gridAligned).toBe(true);
    expect(block.width).toBeCloseTo(0.3, 12);
    expect(block.height).toBeCloseTo(0.15, 12);
    const expected = transformPointMat3(frame, 0.45, -0.15);
    const origin = transformPointMat3(block.mat3, 0, 0);
    expect(origin.x).toBeCloseTo(expected.x, 12);
    expect(origin.y).toBeCloseTo(expected.y, 12);
  });

  it('falls back to the tile bounds plus a margin without a grid', () => {
    const block = placementBlock({ id: 'p', tileDefinitionId: 't', mat3: translationMat3(2, 3) }, tile);
    expect(block.gridAligned).toBe(false);
    expect(block.width).toBeCloseTo(0.29 + 2 * FALLBACK_GROUT_MARGIN, 12);
    expect(transformPointMat3(block.mat3, 0, 0).x).toBeCloseTo(2 - FALLBACK_GROUT_MARGIN, 12);
  });

  it('skips placements of unknown tiles', () => {
    const instance: DesignInstanceJson = {
      type: 'DesignInstance',
      placements: [
        { id: 'a', tileDefinitionId: 't', mat3: translationMat3(0, 0) },
        { id: 'b', tileDefinitionId: 'missing', mat3: translationMat3(1, 0) },
      ],
    };
    expect(instanceBlocks(instance, new Map([['t', tile]]))).toHaveLength(1);
  });
});
