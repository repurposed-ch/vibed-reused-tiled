import { describe, expect, it } from 'vitest';
import {
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Texture,
  type InstancedMesh,
  type Material,
} from 'three';
import type { PlacementJson } from '@/domain/instance';
import { multiplyMat3, scaleMat3, translationMat3 } from '@/domain/mat3';
import { createTileDefinition } from '@/domain/tile';
import {
  createTileInstanceGeometry,
  createTileInstancedMesh,
  createTileInstanceMaterial,
  INSTANCE_UV_ATTRIBUTE,
  writeTileInstances,
} from '@/render/r3f/tile-instanced-mesh';
import { buildTileInstances, type TileVariationSettings } from '@/render/r3f/tile-instances';
import { expandInstancedForExport } from './expand-instances';

const tile = createTileDefinition({ id: 'plain', length: 0.6, width: 0.3, thickness: 0.02 });

function scene(settings: TileVariationSettings) {
  // Same shape as the 3D view: a rotated root, a floor excluded from export, and the tile group.
  const root = new Group();
  root.rotation.set(-Math.PI / 2, 0, 0);
  const floor = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
  floor.userData = { export: false };
  root.add(floor);

  const exportRoot = new Group();
  root.add(exportRoot);

  const placements: PlacementJson[] = [];
  for (let i = 0; i < 12; i += 1) {
    const at = translationMat3((i % 4) * 0.6, Math.floor(i / 4) * 0.3);
    // Every third tile is mirrored, so the expansion must carry the mirror into the UVs.
    const mat3 = i % 3 === 0 ? multiplyMat3(at, multiplyMat3(translationMat3(0.6, 0), scaleMat3(-1, 1))) : at;
    placements.push({ id: crypto.randomUUID(), tileDefinitionId: tile.id, mat3 } as PlacementJson);
  }
  const data = buildTileInstances(placements, new Map([[tile.id, tile]]), settings).get(tile.id)!;

  const maps = { map: new Texture(), normalMap: new Texture(), roughnessMap: new Texture() };
  const material = createTileInstanceMaterial(maps);
  const geometry = createTileInstanceGeometry(tile.length, tile.width, tile.thickness, data.count);
  const mesh = createTileInstancedMesh(geometry, material, data.count, tile.id);
  writeTileInstances(mesh, data);
  exportRoot.add(mesh);

  const hidden = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
  hidden.visible = false;
  exportRoot.add(hidden);

  return { root, exportRoot, mesh, data, maps, material, geometry };
}

const ON: TileVariationSettings = { enabled: true, offset: 1, tint: 0.2, seed: 11 };

function meshes(group: Group): Mesh[] {
  return group.children.filter((c): c is Mesh => (c as Mesh).isMesh);
}

describe('expandInstancedForExport', () => {
  it('turns every instance into a plain mesh and drops excluded or hidden objects', () => {
    const { root, data } = scene(ON);
    const out = expandInstancedForExport(root);
    const list = meshes(out);
    expect(list.length).toBe(data.count);
    expect(list.some((m) => (m as unknown as InstancedMesh).isInstancedMesh)).toBe(false);
  });

  it('leaves no per-instance attribute behind, which glTF would reject', () => {
    const { exportRoot } = scene(ON);
    for (const m of meshes(expandInstancedForExport(exportRoot))) {
      expect(m.geometry.getAttribute(INSTANCE_UV_ATTRIBUTE)).toBeUndefined();
    }
  });

  it('bakes the shader uv formula into every vertex', () => {
    const { exportRoot, geometry, data } = scene(ON);
    const sourceUv = geometry.getAttribute('uv');
    meshes(expandInstancedForExport(exportRoot)).forEach((m, i) => {
      const [ou, ov, mirror] = [data.uvXform[i * 3]!, data.uvXform[i * 3 + 1]!, data.uvXform[i * 3 + 2]!];
      const uv = m.geometry.getAttribute('uv');
      for (let j = 0; j < uv.count; j += 1) {
        const u = sourceUv.getX(j);
        expect(uv.getX(j)).toBeCloseTo((mirror > 0.5 ? 1 - u : u) + ou, 6);
        expect(uv.getY(j)).toBeCloseTo(sourceUv.getY(j) + ov, 6);
      }
    });
  });

  it('writes world transforms in the world frame, with det > 0', () => {
    const { root, exportRoot, mesh } = scene(ON);
    root.updateMatrixWorld(true);
    const out = expandInstancedForExport(exportRoot, { frame: 'world' });
    const instance = new Matrix4();
    meshes(out).forEach((m, i) => {
      mesh.getMatrixAt(i, instance);
      const expected = exportRoot.matrixWorld.clone().multiply(instance);
      m.matrixWorld.elements.forEach((v, k) => expect(v).toBeCloseTo(expected.elements[k]!, 5));
      expect(m.matrixWorld.determinant()).toBeGreaterThan(0);
    });
  });

  it('writes root-local transforms without the parent rotation, as GLB always has', () => {
    const { exportRoot, mesh } = scene(ON);
    const out = expandInstancedForExport(exportRoot, { frame: 'root-local' });
    const instance = new Matrix4();
    meshes(out).forEach((m, i) => {
      mesh.getMatrixAt(i, instance);
      m.matrixWorld.elements.forEach((v, k) => expect(v).toBeCloseTo(instance.elements[k]!, 5));
    });
  });

  it('carries each tint on a shared material clone that keeps the same textures', () => {
    const { exportRoot, data, maps, material } = scene(ON);
    const list = meshes(expandInstancedForExport(exportRoot));
    list.forEach((m, i) => {
      const mat = m.material as MeshStandardMaterial;
      expect(mat.color.r).toBeCloseTo(data.tints![i]!, 6);
      expect(mat.map).toBe(maps.map);
      expect(mat.normalMap).toBe(maps.normalMap);
      expect(mat.roughnessMap).toBe(maps.roughnessMap);
    });
    const distinctMaterials = new Set(list.map((m) => m.material as Material));
    const distinctTints = new Set([...data.tints!]);
    expect(distinctMaterials.size).toBeLessThanOrEqual(distinctTints.size);
    expect(list.some((m) => m.material === material)).toBe(data.tints!.some((t) => t === 1));
  });

  it('shares index, position and normal with the live geometry', () => {
    const { exportRoot, geometry } = scene(ON);
    for (const m of meshes(expandInstancedForExport(exportRoot))) {
      expect(m.geometry.index).toBe(geometry.index);
      expect(m.geometry.getAttribute('position')).toBe(geometry.getAttribute('position'));
      expect(m.geometry.getAttribute('normal')).toBe(geometry.getAttribute('normal'));
    }
  });

  it('reuses one geometry per distinct uv transform', () => {
    const { exportRoot } = scene({ ...ON, enabled: false });
    const geometries = new Set(meshes(expandInstancedForExport(exportRoot)).map((m) => m.geometry));
    // With variation off only the mirror differs: mirrored and unmirrored.
    expect(geometries.size).toBe(2);
  });

  // GLB mode: GLTFExporter merges metal/roughness per material, so per-tint material clones
  // would duplicate that image once per tint step. Tint rides on COLOR_0 instead.
  it('carries tint as vertex colours on the shared material in vertexColor mode', () => {
    const { exportRoot, data, material } = scene(ON);
    const list = meshes(expandInstancedForExport(exportRoot, { tint: 'vertexColor' }));
    expect(new Set(list.map((m) => m.material)).size).toBe(1);
    expect(list[0]!.material).toBe(material);
    list.forEach((m, i) => {
      const color = m.geometry.getAttribute('color');
      expect(color).toBeDefined();
      expect(color.count).toBe(m.geometry.getAttribute('position').count);
      for (let j = 0; j < color.count; j += 1) {
        expect(color.getX(j)).toBeCloseTo(data.tints![i]!, 6);
        expect(color.getY(j)).toBeCloseTo(data.tints![i]!, 6);
        expect(color.getZ(j)).toBeCloseTo(data.tints![i]!, 6);
      }
    });
  });

  it('adds no colour attribute in material mode', () => {
    const { exportRoot } = scene(ON);
    for (const m of meshes(expandInstancedForExport(exportRoot, { tint: 'material' }))) {
      expect(m.geometry.getAttribute('color')).toBeUndefined();
    }
  });

  it('does not modify the live scene', () => {
    const { exportRoot, mesh } = scene(ON);
    const before = [...(mesh.instanceMatrix.array as Float32Array)];
    const children = exportRoot.children.length;
    expandInstancedForExport(exportRoot);
    expect([...(mesh.instanceMatrix.array as Float32Array)]).toEqual(before);
    expect(mesh.parent).toBe(exportRoot);
    expect(exportRoot.children.length).toBe(children);
    expect(mesh.geometry.getAttribute(INSTANCE_UV_ATTRIBUTE)).toBeDefined();
  });
});
