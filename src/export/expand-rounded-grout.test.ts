import { describe, expect, it } from 'vitest';
import { Group, Mesh, Texture, type InstancedMesh } from 'three';
import type { DesignInstanceJson, PlacementJson } from '@/domain/instance';
import { translationMat3 } from '@/domain/mat3';
import { createTileDefinition } from '@/domain/tile';
import { buildGroutGeometry, createGroutMaterial, groutBlocks } from '@/render/r3f/grout-geometry';
import {
  createTileInstanceGeometry,
  createTileInstancedMesh,
  createTileInstanceMaterial,
  INSTANCE_UV_ATTRIBUTE,
  writeTileInstances,
} from '@/render/r3f/tile-instanced-mesh';
import { buildTileInstances } from '@/render/r3f/tile-instances';
import { expandInstancedForExport } from './expand-instances';

const tile = createTileDefinition({ id: 't', length: 0.6, width: 0.3, thickness: 0.02, cornerRounding: 0.1 });
const placements: PlacementJson[] = [0, 1, 2].map((i) => ({
  id: `p${i}`,
  tileDefinitionId: tile.id,
  mat3: translationMat3(i * 0.61, 0),
}));

function scene() {
  const exportRoot = new Group();
  const data = buildTileInstances(placements, new Map([[tile.id, tile]]), {
    enabled: true,
    offset: 1,
    tint: 0.1,
    seed: 2,
  }).get(tile.id)!;
  const maps = { map: new Texture(), normalMap: new Texture(), roughnessMap: new Texture() };
  const geometry = createTileInstanceGeometry(tile.length, tile.width, tile.thickness, data.count, 0.03);
  const mesh = createTileInstancedMesh(geometry, createTileInstanceMaterial(maps), data.count, tile.id);
  writeTileInstances(mesh, data);
  exportRoot.add(mesh);

  const instance: DesignInstanceJson = { type: 'DesignInstance', placements };
  const groutGeometry = buildGroutGeometry(groutBlocks(instance, new Map([[tile.id, tile]]), 0.0015));
  const groutMaterial = createGroutMaterial(maps);
  const grout = new Mesh(groutGeometry, groutMaterial);
  grout.name = 'grout';
  exportRoot.add(grout);
  return { exportRoot, geometry, groutGeometry, groutMaterial, count: data.count };
}

describe('export with rounded tiles and grout', () => {
  it('expands rounded tiles sharing index, position and normal', () => {
    const { exportRoot, geometry, count } = scene();
    const tiles = expandInstancedForExport(exportRoot).children.filter((c) => c.name !== 'grout') as Mesh[];
    expect(tiles).toHaveLength(count);
    expect(geometry.index).not.toBeNull();
    for (const m of tiles) {
      expect((m as unknown as InstancedMesh).isInstancedMesh).toBeFalsy();
      expect(m.geometry.index).toBe(geometry.index);
      expect(m.geometry.getAttribute('position')).toBe(geometry.getAttribute('position'));
      expect(m.geometry.getAttribute('normal')).toBe(geometry.getAttribute('normal'));
      expect(m.geometry.getAttribute(INSTANCE_UV_ATTRIBUTE)).toBeUndefined();
    }
  });

  it('carries the grout mesh through as a plain mesh with its own geometry and material', () => {
    const { exportRoot, groutGeometry, groutMaterial } = scene();
    const grout = expandInstancedForExport(exportRoot).children.find((c) => c.name === 'grout') as Mesh;
    expect(grout).toBeDefined();
    expect(grout.geometry).toBe(groutGeometry);
    expect(grout.material).toBe(groutMaterial);
    expect(Object.keys(grout.geometry.attributes).sort()).toEqual(['normal', 'position', 'uv']);
  });
});
