import { useEffect, useMemo, useRef } from 'react';
import type { SdfNodeJson } from '@/domain/material';
import { evalSdfNode, toShade, type Vec2 } from '@/render/materials';

/**
 * Grayscale preview of a single SDF subtree.
 *
 * Evaluated on the CPU rather than through the GLSL bake: a tree view renders one of
 * these per node, and the bake keeps a shader program per distinct source string, so
 * baking every subtree would churn the program cache for no benefit. At 48px this is
 * ~2.3k samples, a fraction of a millisecond.
 */
export function SdfThumb({
  node,
  seed,
  period,
  size = 48,
  title,
}: {
  node: SdfNodeJson;
  seed: number;
  period: Vec2;
  size?: number;
  title?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Nodes are recreated on every draft edit, so identity alone would redraw the whole
  // tree on each keystroke. Keying on the serialised subtree redraws only what changed.
  const key = useMemo(() => JSON.stringify(node), [node]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const p: Vec2 = [((x + 0.5) / size) * period[0], ((y + 0.5) / size) * period[1]];
        let v = 0;
        try {
          v = Math.round(toShade(evalSdfNode(node, p, seed, period)) * 255);
        } catch {
          v = 0;
        }
        const i = (y * size + x) * 4;
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, seed, period[0], period[1], size]);

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      title={title}
      style={{
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        border: '1px solid #4a4036',
        imageRendering: 'pixelated',
        display: 'block',
      }}
    />
  );
}
