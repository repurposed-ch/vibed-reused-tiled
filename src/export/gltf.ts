import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import type { Material, Object3D } from 'three';
import { Mesh } from 'three';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toArrayBufferLike(result: ArrayBuffer | Uint8Array): BlobPart {
  return result instanceof Uint8Array ? result : new Uint8Array(result);
}

/**
 * Hide helpers marked `userData.export === false`, refresh world matrices,
 * and snapshot mesh material sides so exporters cannot leave the live scene mutated.
 */
function withExportSafeRoot<T>(root: Object3D, run: () => Promise<T>): Promise<T> {
  const hidden: Object3D[] = [];
  const sideSnapshots: Array<{ material: Material; side: Material['side'] }> = [];

  root.traverse((obj) => {
    if (obj.userData?.export === false && obj.visible) {
      obj.visible = false;
      hidden.push(obj);
    }
    if (obj instanceof Mesh) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of mats) {
        if (material) sideSnapshots.push({ material, side: material.side });
      }
    }
  });

  root.updateMatrixWorld(true);

  return run().finally(() => {
    for (const obj of hidden) obj.visible = true;
    for (const { material, side } of sideSnapshots) material.side = side;
  });
}

export async function exportGlbBlob(root: Object3D): Promise<Blob> {
  return withExportSafeRoot(root, async () => {
    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(root, { binary: true });
    if (!(result instanceof ArrayBuffer)) {
      throw new Error('Expected binary GLB export');
    }
    return new Blob([result], { type: 'model/gltf-binary' });
  });
}

export async function exportUsdzBlob(root: Object3D): Promise<Blob> {
  return withExportSafeRoot(root, async () => {
    const exporter = new USDZExporter();
    const result = await exporter.parseAsync(root, {
      quickLookCompatible: true,
      includeAnchoringProperties: true,
      ar: {
        anchoring: { type: 'plane' },
        planeAnchoring: { alignment: 'horizontal' },
      },
    });
    return new Blob([toArrayBufferLike(result as ArrayBuffer | Uint8Array)], {
      type: 'model/vnd.usdz+zip',
    });
  });
}

export async function downloadGlb(root: Object3D, filename: string): Promise<void> {
  downloadBlob(await exportGlbBlob(root), filename);
}

export async function downloadUsdz(root: Object3D, filename: string): Promise<void> {
  downloadBlob(await exportUsdzBlob(root), filename);
}

export { downloadBlob };
