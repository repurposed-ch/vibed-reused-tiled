import { Epsilon } from '../../core/epsilon';
import { mooreNeighborCellHashes } from '../../hash/neighbors';
import { Vec2 } from '../../core/vec2';

const DEFAULT_DEDUP_GRID_SIZE = 0.1;

export function dedupVertices(
  vertices: Vec2[],
  slack: Epsilon,
  gridSize: number = DEFAULT_DEDUP_GRID_SIZE,
): { vertices: Vec2[]; remap: number[] } {
  slack.isPositive('operations - spatial', 'dedupVertices');
  // for each vertex, find the nearest grid cell (i, j), compute hash and add to map
  const cellMap = new Map<number, number[]>();

  for (let i = 0; i < vertices.length; i++) {
    const hash = vertices[i]!.hash(gridSize);
    const bucket = cellMap.get(hash);
    if (bucket) bucket.push(i);
    else cellMap.set(hash, [i]);
  }

  // for all vertices in a cell check all the neighbouring cells, see whether vertices are within slack of each other
  // first hit in case of duplicate, always first entry is kept, keep track in map
  // on next comparison, the mapped vertex is checked (not the original one)
  const remap = new Array<number>(vertices.length);
  const deduped: Vec2[] = [];

  for (const [cellHash, indices] of cellMap) {
    const nearby = [cellHash, ...mooreNeighborCellHashes(cellHash)].flatMap((hash) => cellMap.get(hash) ?? []);

    for (const i of indices) {
      let matched = -1;

      for (const j of nearby) {
        if (remap[j] === undefined) continue;
        if (vertices[i]!.distance(deduped[remap[j]!]!) <= slack.value) {
          matched = remap[j]!;
          break;
        }
      }

      if (matched < 0) {
        matched = deduped.length;
        deduped.push(vertices[i]!.clone());
      }

      remap[i] = matched;
    }
  }

  return { vertices: deduped, remap };
}
