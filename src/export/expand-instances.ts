import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  type InstancedMesh,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { INSTANCE_UV_ATTRIBUTE } from '@/render/r3f/tile-instanced-mesh';
import { TINT_STEP } from '@/render/r3f/tile-instances';

/**
 * Which frame the exported transforms are expressed in.
 *
 * - `world`: every object carries its full world transform. This is what USDZExporter has
 *   always seen, because it reads `matrixWorld`.
 * - `root-local`: transforms are relative to the root's parent, i.e. the frame GLTFExporter
 *   has always written, because it reads each node's local `matrix` and the scene's floor
 *   rotation lives on the export root's parent.
 */
export type ExportFrame = 'world' | 'root-local';

/**
 * How a per-instance tint is carried.
 *
 * - `material`: one material clone per rounded tint. Required for USDZ, which multiplies a
 *   textured diffuse by the material colour but ignores vertex colours.
 * - `vertexColor`: a `color` attribute (glTF COLOR_0, which multiplies base colour) on a single
 *   shared material. Required for a lean GLB: GLTFExporter builds a merged metal/roughness image
 *   per material, so material clones would duplicate the roughness image once per tint step.
 */
export type TintMode = 'material' | 'vertexColor';

export type ExpandOptions = {
  frame?: ExportFrame;
  tintStep?: number;
  tint?: TintMode;
};

/**
 * Build a detached, exporter-safe copy of `root` in which every InstancedMesh is expanded
 * into plain meshes. The live scene is not modified.
 *
 * Neither exporter understands this scene's instancing: GLTFExporter writes a required
 * EXT_mesh_gpu_instancing and would emit the per-instance UV attribute as an invalid
 * primitive attribute, and USDZExporter ignores instances entirely and writes one tile. So
 * each instance becomes a mesh whose UVs have the shader's offset and mirror baked in. Its tint
 * is carried per `TintMode`: as a material colour for USDZ, or as vertex colours for GLB.
 */
export function expandInstancedForExport(root: Object3D, options: ExpandOptions = {}): Group {
  const frame = options.frame ?? 'world';
  const tintStep = options.tintStep ?? TINT_STEP;
  const tintMode = options.tint ?? 'material';

  root.updateWorldMatrix(true, true);
  const frameInverse = new Matrix4();
  if (frame === 'root-local' && root.parent) {
    frameInverse.copy(root.parent.matrixWorld).invert();
  }

  const out = new Group();
  out.name = root.name;

  const geometryCache = new Map<string, BufferGeometry>();
  const materialCache = new Map<string, Material>();
  const instanceMatrix = new Matrix4();
  const transform = new Matrix4();

  const placeMesh = (mesh: Mesh, matrix: Matrix4) => {
    // Decompose rather than assign `.matrix`: GLTFExporter rebuilds the matrix from
    // position/quaternion/scale when matrixAutoUpdate is on.
    matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    out.add(mesh);
  };

  const variantGeometry = (
    source: BufferGeometry,
    offsetU: number,
    offsetV: number,
    mirror: boolean,
    vertexTint: number | null,
  ): BufferGeometry => {
    const key = `${source.uuid}|${mirror ? 1 : 0}|${offsetU}|${offsetV}|${vertexTint ?? '-'}`;
    const cached = geometryCache.get(key);
    if (cached) return cached;

    const geometry = new BufferGeometry();
    // Index, position and normal are shared by reference, so GLTFExporter writes them once per
    // tile type; only the uv buffer is new per variant.
    if (source.index) geometry.setIndex(source.index);
    for (const [name, attribute] of Object.entries(source.attributes)) {
      if (name === INSTANCE_UV_ATTRIBUTE || name === 'uv') continue;
      geometry.setAttribute(name, attribute);
    }
    const uv = source.getAttribute('uv');
    if (uv) {
      const baked = new Float32Array(uv.count * 2);
      for (let j = 0; j < uv.count; j += 1) {
        const u = uv.getX(j);
        // Same formula as the vertex shader patch, applied on every face.
        baked[j * 2] = (mirror ? 1 - u : u) + offsetU;
        baked[j * 2 + 1] = uv.getY(j) + offsetV;
      }
      geometry.setAttribute('uv', new BufferAttribute(baked, 2));
    }
    if (vertexTint !== null) {
      const position = source.getAttribute('position');
      geometry.setAttribute(
        'color',
        new BufferAttribute(new Float32Array(position.count * 3).fill(vertexTint), 3),
      );
    }
    geometryCache.set(key, geometry);
    return geometry;
  };

  const tintedMaterial = (source: Material, tint: number): Material => {
    if (tint === 1 || !('color' in source)) return source;
    const key = `${source.uuid}|${tint}`;
    const cached = materialCache.get(key);
    if (cached) return cached;
    // MeshStandardMaterial.copy shares map, normalMap and roughnessMap by reference.
    const clone = (source as MeshStandardMaterial).clone();
    clone.color.setScalar(tint);
    materialCache.set(key, clone);
    return clone;
  };

  const expandInstanced = (mesh: InstancedMesh) => {
    const uvXform = mesh.geometry.getAttribute(INSTANCE_UV_ATTRIBUTE);
    const sourceMaterial = mesh.material;
    for (let i = 0; i < mesh.count; i += 1) {
      mesh.getMatrixAt(i, instanceMatrix);
      transform.copy(frameInverse).multiply(mesh.matrixWorld).multiply(instanceMatrix);

      const offsetU = uvXform ? uvXform.getX(i) : 0;
      const offsetV = uvXform ? uvXform.getY(i) : 0;
      const mirror = uvXform ? uvXform.getZ(i) > 0.5 : false;

      const rawTint = mesh.instanceColor ? mesh.instanceColor.getX(i) : 1;
      const tint = Math.round(rawTint / tintStep) * tintStep;
      const byVertex = tintMode === 'vertexColor' && mesh.instanceColor !== null;

      const geometry = variantGeometry(mesh.geometry, offsetU, offsetV, mirror, byVertex ? tint : null);
      const material =
        Array.isArray(sourceMaterial) || byVertex
          ? sourceMaterial
          : tintedMaterial(sourceMaterial, tint);

      const instance = new Mesh(geometry, material);
      instance.name = mesh.name || String(mesh.userData.tileDefinitionId ?? 'tile');
      instance.userData = { tileDefinitionId: mesh.userData.tileDefinitionId };
      placeMesh(instance, transform);
    }
  };

  const visit = (object: Object3D) => {
    // Skips the whole subtree, replacing the old hide-then-restore of `export: false` objects.
    if (!object.visible || object.userData?.export === false) return;

    if ((object as InstancedMesh).isInstancedMesh) {
      expandInstanced(object as InstancedMesh);
    } else if ((object as Mesh).isMesh) {
      const source = object as Mesh;
      const copy = new Mesh(source.geometry, source.material);
      copy.name = source.name;
      copy.userData = { ...source.userData };
      placeMesh(copy, transform.copy(frameInverse).multiply(source.matrixWorld));
    }

    for (const child of object.children) visit(child);
  };

  visit(root);
  out.updateMatrixWorld(true);
  return out;
}
