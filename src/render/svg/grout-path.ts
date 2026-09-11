import type { PlacementBlock } from '@/domain/instance';
import { transformPointMat3 } from '@/domain/mat3';

function num(v: number): string {
  return String(Number(v.toFixed(6)));
}

/** The four world corners of a block. */
export function blockCorners(block: PlacementBlock): Array<{ x: number; y: number }> {
  return [
    [0, 0],
    [block.width, 0],
    [block.width, block.height],
    [0, block.height],
  ].map(([x, y]) => transformPointMat3(block.mat3, x!, y!));
}

/**
 * All grout blocks as one SVG path, in world space. One path rather than a rect per block:
 * separate shapes that merely touch leave anti-aliasing hairlines along every shared edge.
 */
export function groutPathD(blocks: readonly PlacementBlock[]): string {
  return blocks
    .map((block) => {
      const [first, ...rest] = blockCorners(block);
      return `M${num(first!.x)} ${num(first!.y)}${rest.map((p) => `L${num(p.x)} ${num(p.y)}`).join('')}Z`;
    })
    .join('');
}

/** World bounds of a set of blocks, or null when there are none. */
export function blocksBounds(
  blocks: readonly PlacementBlock[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (blocks.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const block of blocks) {
    for (const p of blockCorners(block)) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { minX, minY, maxX, maxY };
}
