import { describe, expect, it } from 'vitest';
import { ShaderLib, Texture, Vector3, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three';
import type { PlacementJson } from '@/domain/instance';
import { translationMat3 } from '@/domain/mat3';
import { createTileDefinition } from '@/domain/tile';
import { buildTileInstances } from './tile-instances';
import {
  createTileInstanceGeometry,
  createTileInstancedMesh,
  createTileInstanceMaterial,
  INSTANCE_UV_ATTRIBUTE,
  patchTileInstanceVertexShader,
  TILE_INSTANCE_PROGRAM_KEY,
  writeTileInstances,
} from './tile-instanced-mesh';

const tile = createTileDefinition({ id: 'plain', length: 0.6, width: 0.3, thickness: 0.02 });

describe('patchTileInstanceVertexShader', () => {
  const source = ShaderLib.standard.vertexShader;
  const patched = patchTileInstanceVertexShader(source);

  it('declares the per-instance attribute before the common chunk', () => {
    const declaration = patched.indexOf(`attribute vec3 ${INSTANCE_UV_ATTRIBUTE}`);
    expect(declaration).toBeGreaterThanOrEqual(0);
    expect(declaration).toBeLessThan(patched.indexOf('#include <common>'));
  });

  it('re-derives all three map uvs after uv_vertex', () => {
    const after = patched.slice(patched.indexOf('#include <uv_vertex>'));
    for (const varying of ['vMapUv', 'vNormalMapUv', 'vRoughnessMapUv']) {
      expect(after).toMatch(new RegExp(`${varying} = \\( \\w+Transform \\* vec3\\( tileUv, 1\\.0 \\) \\)\\.xy`));
    }
  });

  it('applies each anchor exactly once', () => {
    expect(patched.split('#include <common>').length).toBe(2);
    expect(patched.split('#include <uv_vertex>').length).toBe(2);
  });

  // If a three upgrade moves the anchors, fail loudly rather than render un-offset tiles.
  it('throws when the anchors are missing', () => {
    expect(() => patchTileInstanceVertexShader('void main() {}')).toThrow(/anchors/);
  });
});

describe('createTileInstanceMaterial', () => {
  it('uses a constant program cache key', () => {
    expect(createTileInstanceMaterial(null).customProgramCacheKey()).toBe(TILE_INSTANCE_PROGRAM_KEY);
  });

  it('patches the vertex shader through onBeforeCompile', () => {
    const material = createTileInstanceMaterial(null);
    const shader = {
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: '',
      uniforms: {},
    } as unknown as WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, undefined as unknown as WebGLRenderer);
    expect(shader.vertexShader).toContain(INSTANCE_UV_ATTRIBUTE);
  });

  it('borrows the maps rather than owning copies', () => {
    const maps = { map: new Texture(), normalMap: new Texture(), roughnessMap: new Texture() };
    const material = createTileInstanceMaterial(maps);
    expect(material.map).toBe(maps.map);
    expect(material.normalMap).toBe(maps.normalMap);
    expect(material.roughnessMap).toBe(maps.roughnessMap);
    expect(material.roughness).toBe(1);
  });
});

describe('instanced mesh', () => {
  const placements: PlacementJson[] = [
    [0, 0],
    [3, 0],
    [0, 5],
  ].map(([x, y]) => ({ id: crypto.randomUUID(), tileDefinitionId: tile.id, mat3: translationMat3(x!, y!) }) as PlacementJson);
  const settings = { enabled: true, offset: 1, tint: 0.2, seed: 3 };
  const data = buildTileInstances(placements, new Map([[tile.id, tile]]), settings).get(tile.id)!;

  const build = () => {
    const geometry = createTileInstanceGeometry(tile.length, tile.width, tile.thickness, data.count);
    return createTileInstancedMesh(geometry, createTileInstanceMaterial(null), data.count, tile.id);
  };

  // Allocated up front: whether instanceColor exists selects a different shader program.
  it('starts with an all-ones instanceColor and a sized uv attribute', () => {
    const mesh = build();
    expect(mesh.instanceColor).not.toBeNull();
    expect([...(mesh.instanceColor!.array as Float32Array)].every((v) => v === 1)).toBe(true);
    expect(mesh.geometry.getAttribute(INSTANCE_UV_ATTRIBUTE).count).toBe(data.count);
  });

  it('writes matrices, uv transforms and tints', () => {
    const mesh = build();
    writeTileInstances(mesh, data);
    expect([...(mesh.instanceMatrix.array as Float32Array)]).toEqual([...data.matrices]);
    expect([...(mesh.geometry.getAttribute(INSTANCE_UV_ATTRIBUTE).array as Float32Array)]).toEqual([
      ...data.uvXform,
    ]);
    for (let i = 0; i < data.count; i += 1) {
      expect(mesh.instanceColor!.getX(i)).toBeCloseTo(data.tints![i]!, 6);
    }
  });

  it('resets tints to one when the data has none', () => {
    const mesh = build();
    writeTileInstances(mesh, data);
    writeTileInstances(mesh, { ...data, tints: null });
    expect([...(mesh.instanceColor!.array as Float32Array)].every((v) => v === 1)).toBe(true);
  });

  it('refreshes the bounding sphere so moved tiles are not culled', () => {
    const mesh = build();
    writeTileInstances(mesh, data);
    for (let i = 0; i < data.count; i += 1) {
      const m = data.matrices.subarray(i * 16, i * 16 + 16);
      expect(mesh.boundingSphere!.containsPoint(new Vector3(m[12], m[13], m[14]))).toBe(true);
    }
  });

  it('refuses data for a different instance count', () => {
    const mesh = build();
    expect(() => writeTileInstances(mesh, { ...data, count: data.count + 1 })).toThrow(/count/);
  });
});
