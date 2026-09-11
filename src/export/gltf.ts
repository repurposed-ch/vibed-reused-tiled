import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import type { MeshStandardMaterial, Object3D, Texture } from 'three';
import { Mesh } from 'three';
import { expandInstancedForExport } from './expand-instances';

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
 * Wait for an image-backed texture to finish loading. Canvas-backed textures are ready as-is:
 * both exporters read `texture.image` directly and never consult `needsUpdate`, so flagging it
 * would only force the live renderer to re-upload every shared baked texture on each export.
 */
function textureReady(texture: Texture | null | undefined): Promise<void> {
  if (!texture) return Promise.resolve();
  const img = texture.image as
    | HTMLCanvasElement
    | OffscreenCanvas
    | HTMLImageElement
    | ImageBitmap
    | undefined;
  if (!img) return Promise.resolve();
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) {
    if (img.complete) return Promise.resolve();
    return new Promise((resolve, reject) => {
      img.addEventListener('load', () => resolve(), { once: true });
      img.addEventListener('error', () => reject(new Error('Texture image failed to load')), {
        once: true,
      });
    });
  }
  return Promise.resolve();
}

/** Ensure every mesh texture is loaded before GLB / USDZ serialization. */
export async function ensureExportTexturesReady(root: Object3D): Promise<void> {
  const waits: Promise<void>[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of mats) {
      const std = material as MeshStandardMaterial | undefined;
      for (const texture of [std?.map, std?.normalMap, std?.roughnessMap]) {
        if (texture) waits.push(textureReady(texture));
      }
    }
  });
  await Promise.all(waits);
}

/*
 * EXPORT FRAMES — each format keeps the frame it has always had.
 *
 * GLTFExporter writes each node's LOCAL matrix, and the scene's floor rotation (-π/2 about x)
 * lives on the export root's parent, so GLB has always been written without it: tiles lie in
 * glTF's XY plane, which is vertical in a Y-up viewer. USDZExporter reads `matrixWorld`, so
 * USDZ has always included the rotation and lies flat. That GLB orientation is a pre-existing
 * issue affecting Android AR; it is preserved here rather than changed silently. Switching GLB
 * to `frame: 'world'` is the one-line fix.
 */

export async function exportGlbBlob(root: Object3D): Promise<Blob> {
  // Tint as COLOR_0 rather than per-tint material clones: GLTFExporter builds a merged
  // metal/roughness image per material, so clones would repeat that image once per tint step.
  const exportRoot = expandInstancedForExport(root, { frame: 'root-local', tint: 'vertexColor' });
  await ensureExportTexturesReady(exportRoot);
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(exportRoot, { binary: true });
  if (!(result instanceof ArrayBuffer)) {
    throw new Error('Expected binary GLB export');
  }
  return new Blob([result], { type: 'model/gltf-binary' });
}

export async function exportUsdzBlob(root: Object3D): Promise<Blob> {
  // USDZ multiplies a textured diffuse by the material colour and ignores vertex colours, so
  // tint stays on material clones here — USDZ also shares one image across those materials.
  const exportRoot = expandInstancedForExport(root, { frame: 'world', tint: 'material' });
  await ensureExportTexturesReady(exportRoot);
  const exporter = new USDZExporter();
  const result = await exporter.parseAsync(exportRoot, {
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
}

export async function downloadGlb(root: Object3D, filename: string): Promise<void> {
  downloadBlob(await exportGlbBlob(root), filename);
}

export async function downloadUsdz(root: Object3D, filename: string): Promise<void> {
  downloadBlob(await exportUsdzBlob(root), filename);
}

export { downloadBlob };
