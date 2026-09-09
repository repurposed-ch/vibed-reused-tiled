import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { Object3D } from 'three';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadGlb(root: Object3D, filename: string): Promise<void> {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(root, { binary: true });
  if (!(result instanceof ArrayBuffer)) {
    throw new Error('Expected binary GLB export');
  }
  downloadBlob(new Blob([result], { type: 'model/gltf-binary' }), filename);
}

/**
 * Browser-side USDZ conversion is limited; export GLB and a short AR readme zip-like pair.
 * For true USDZ on device, convert the GLB with Reality Converter / usd_from_gltf.
 */
export async function downloadUsdzPlaceholder(root: Object3D, basename: string): Promise<void> {
  await downloadGlb(root, `${basename}.glb`);
  const note = `AR / USDZ note
==============
A true USDZ file needs a converter (Apple Reality Converter, usd_from_gltf, or a cloud pipeline).
This export downloaded ${basename}.glb — convert that GLB to USDZ for Quick Look / AR.
`;
  downloadBlob(new Blob([note], { type: 'text/plain' }), `${basename}-usdz-readme.txt`);
}
