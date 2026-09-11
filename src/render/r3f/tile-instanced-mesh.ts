import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardMaterial,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import { createTileBaseGeometry } from './rounded-slab-geometry';
import type { TileInstanceData } from './tile-instances';

/** Per-instance vec3: offset u, offset v, mirrorU (0 or 1). */
export const INSTANCE_UV_ATTRIBUTE = 'instanceUvXform';

/**
 * Constant program cache key. The default key is `onBeforeCompile.toString()`, which would
 * silently collide if two materials ever carried the same callback text with different
 * captured state. three still adds the instancing flag and every map define to the key.
 */
export const TILE_INSTANCE_PROGRAM_KEY = 'tile-instance-uv-v1';

const COMMON_ANCHOR = '#include <common>';
const UV_ANCHOR = '#include <uv_vertex>';

const DECLARATION_GLSL = /* glsl */ `
#ifdef USE_INSTANCING
	attribute vec3 ${INSTANCE_UV_ATTRIBUTE}; // xy = uv offset, z = 1.0 mirrors u
#endif
${COMMON_ANCHOR}`;

// Re-derives the three map UVs from one transformed uv, after three's own uv_vertex has run.
// A single offset drives albedo, normal and roughness, so relief never slides off colour.
// The transform stays in the vertex shader: the varying remains affine across a triangle, so
// the dFdx/dFdy tangent frame used for the normal map (no tangents on BoxGeometry) stays
// correct — a constant offset has zero derivative and a u-mirror flips T exactly.
const UV_GLSL = /* glsl */ `
${UV_ANCHOR}
#ifdef USE_INSTANCING
	vec2 tileUv = vec2( mix( uv.x, 1.0 - uv.x, ${INSTANCE_UV_ATTRIBUTE}.z ), uv.y ) + ${INSTANCE_UV_ATTRIBUTE}.xy;
	#ifdef USE_MAP
		vMapUv = ( mapTransform * vec3( tileUv, 1.0 ) ).xy;
	#endif
	#ifdef USE_NORMALMAP
		vNormalMapUv = ( normalMapTransform * vec3( tileUv, 1.0 ) ).xy;
	#endif
	#ifdef USE_ROUGHNESSMAP
		vRoughnessMapUv = ( roughnessMapTransform * vec3( tileUv, 1.0 ) ).xy;
	#endif
#endif`;

/** Inject the per-instance UV transform. Throws if a three upgrade moved the anchors. */
export function patchTileInstanceVertexShader(source: string): string {
  if (!source.includes(COMMON_ANCHOR) || !source.includes(UV_ANCHOR)) {
    throw new Error('three shader anchors changed: the tile instance UV patch cannot apply');
  }
  return source.replace(COMMON_ANCHOR, DECLARATION_GLSL).replace(UV_ANCHOR, UV_GLSL);
}

export type TileMaps = {
  map: Texture;
  normalMap: Texture;
  roughnessMap: Texture;
};

/** One material per tile type. Textures are borrowed from the texture cache, never owned. */
export function createTileInstanceMaterial(maps: TileMaps | null): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    // Stays at 1: three multiplies it into roughnessMap.g, so any other value scales the map.
    roughness: 1,
    metalness: 0,
    map: maps?.map ?? null,
    normalMap: maps?.normalMap ?? null,
    roughnessMap: maps?.roughnessMap ?? null,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = patchTileInstanceVertexShader(shader.vertexShader);
  };
  material.customProgramCacheKey = () => TILE_INSTANCE_PROGRAM_KEY;
  return material;
}

/**
 * A centred tile slab (instance matrices carry the centre) with room for `count` UV transforms:
 * a plain box, or a rounded slab when `cornerRadius` is set.
 */
export function createTileInstanceGeometry(
  length: number,
  width: number,
  thickness: number,
  count: number,
  cornerRadius = 0,
): BufferGeometry {
  const geometry = createTileBaseGeometry(length, width, thickness, cornerRadius);
  const uvXform = new InstancedBufferAttribute(new Float32Array(Math.max(count, 0) * 3), 3);
  uvXform.setUsage(DynamicDrawUsage);
  geometry.setAttribute(INSTANCE_UV_ATTRIBUTE, uvXform);
  return geometry;
}

export function createTileInstancedMesh(
  geometry: BufferGeometry,
  material: Material,
  count: number,
  tileDefinitionId: string,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  // Allocated up front and never nulled: three picks a different shader program depending on
  // whether instanceColor exists, so creating it lazily would force a rebuild on first tint.
  const colors = new InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
  colors.setUsage(DynamicDrawUsage);
  mesh.instanceColor = colors;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.tileDefinitionId = tileDefinitionId;
  return mesh;
}

/** Copy precomputed instance data into the mesh's GPU buffers. */
export function writeTileInstances(mesh: InstancedMesh, data: TileInstanceData): void {
  if (mesh.count !== data.count) {
    throw new Error(`instance count mismatch: mesh ${mesh.count}, data ${data.count}`);
  }

  (mesh.instanceMatrix.array as Float32Array).set(data.matrices);
  mesh.instanceMatrix.needsUpdate = true;

  const colors = mesh.instanceColor!.array as Float32Array;
  if (data.tints) {
    for (let i = 0; i < data.count; i += 1) {
      const t = data.tints[i]!;
      colors[i * 3] = t;
      colors[i * 3 + 1] = t;
      colors[i * 3 + 2] = t;
    }
  } else {
    colors.fill(1);
  }
  mesh.instanceColor!.needsUpdate = true;

  const uvXform = mesh.geometry.getAttribute(INSTANCE_UV_ATTRIBUTE) as InstancedBufferAttribute;
  (uvXform.array as Float32Array).set(data.uvXform);
  uvXform.needsUpdate = true;

  // Frustum culling and the shadow pass both use the bounding sphere, which three computes
  // once and never refreshes on its own — without this, moved tiles vanish.
  mesh.computeBoundingSphere();
  mesh.boundingBox = null;
}
