import type { Epsilon } from '../../core/epsilon';
import { buildCluster, sortCopy } from './helpers';
import type { Cluster1D } from './types';

export type DbscanOptions = {
  readonly minPoints?: number;
};

/**
 * 1D DBSCAN. Dense clusters are returned; isolated points are written to the
 * caller-provided `noise` array (cleared at the start of the call).
 */
export function clusterByDbscan(
  values: readonly number[],
  epsilon: Epsilon,
  noise: number[],
  options?: DbscanOptions,
): Cluster1D[] {
  epsilon.isPositive('clustering', 'dbscan');
  noise.length = 0;

  if (values.length === 0) return [];

  const minPoints = options?.minPoints ?? 2;
  if (!Number.isInteger(minPoints) || minPoints < 1) {
    throw new Error(`minPoints must be an integer >= 1, got ${minPoints}`);
  }

  const sorted = sortCopy(values);
  const n = sorted.length;
  const radius = epsilon.value;

  const neighbors: number[][] = new Array(n);
  let left = 0;
  let right = 0;
  for (let i = 0; i < n; i++) {
    const xi = sorted[i]!;
    while (xi - sorted[left]! > radius) left++;
    if (right < i) right = i;
    while (right + 1 < n && sorted[right + 1]! - xi <= radius) right++;
    const window: number[] = [];
    for (let j = left; j <= right; j++) window.push(j);
    neighbors[i] = window;
  }

  const UNVISITED = 0;
  const NOISE = -1;
  const labels = new Int32Array(n);
  let clusterId = 0;

  for (let i = 0; i < n; i++) {
    if (labels[i] !== UNVISITED) continue;

    const neigh = neighbors[i]!;
    if (neigh.length < minPoints) {
      labels[i] = NOISE;
      continue;
    }

    clusterId++;
    labels[i] = clusterId;

    const seed = neigh.slice();
    const inSeed = new Set(seed);

    for (let s = 0; s < seed.length; s++) {
      const q = seed[s]!;

      if (labels[q] === NOISE) {
        labels[q] = clusterId;
      }
      if (labels[q] !== UNVISITED) continue;

      labels[q] = clusterId;
      const qNeigh = neighbors[q]!;
      if (qNeigh.length >= minPoints) {
        for (const r of qNeigh) {
          if (!inSeed.has(r)) {
            inSeed.add(r);
            seed.push(r);
          }
        }
      }
    }
  }

  const buckets = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const label = labels[i]!;
    if (label === NOISE || label === UNVISITED) {
      noise.push(sorted[i]!);
      continue;
    }
    let bucket = buckets.get(label);
    if (!bucket) {
      bucket = [];
      buckets.set(label, bucket);
    }
    bucket.push(sorted[i]!);
  }

  const clusters: Cluster1D[] = [];
  for (const members of buckets.values()) {
    clusters.push(buildCluster(members));
  }
  clusters.sort((a, b) => a.min - b.min);
  return clusters;
}
