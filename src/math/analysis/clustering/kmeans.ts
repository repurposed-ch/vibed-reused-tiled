import type { Epsilon } from '../../core/epsilon';
import { buildCluster, requireK, sortCopy } from './helpers';
import type { Cluster1D } from './types';

export type KmeansOptions = {
  readonly k: number;
  readonly maxIterations?: number;
};

/** 1D Lloyd K-means; converges when max centroid shift ≤ `epsilon`. */
export function clusterByKmeans(values: readonly number[], epsilon: Epsilon, options: KmeansOptions): Cluster1D[] {
  epsilon.isPositive('clustering', 'kmeans');
  if (values.length === 0) return [];

  const sorted = sortCopy(values);
  const n = sorted.length;
  const k = options.k;
  requireK(k, n);

  const maxIterations = options.maxIterations ?? 100;
  const tolerance = epsilon.value;

  // Even quantile initialization
  const centroids: number[] = [];
  for (let c = 0; c < k; c++) {
    const t = (c + 0.5) / k;
    const index = Math.min(n - 1, Math.floor(t * n));
    centroids.push(sorted[index]!);
  }

  const assignment = new Int32Array(n);

  for (let iter = 0; iter < maxIterations; iter++) {
    for (let i = 0; i < n; i++) {
      const x = sorted[i]!;
      let best = 0;
      let bestDist = Math.abs(x - centroids[0]!);
      for (let c = 1; c < k; c++) {
        const dist = Math.abs(x - centroids[c]!);
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      assignment[i] = best;
    }

    const sums = new Float64Array(k);
    const counts = new Int32Array(k);
    for (let i = 0; i < n; i++) {
      const c = assignment[i]!;
      sums[c]! += sorted[i]!;
      counts[c]!++;
    }

    // Re-seed empty centroids at farthest point from existing non-empty means
    for (let c = 0; c < k; c++) {
      if (counts[c]! > 0) continue;
      let farthestIndex = 0;
      let farthestDist = -1;
      for (let i = 0; i < n; i++) {
        let minDist = Infinity;
        for (let d = 0; d < k; d++) {
          if (counts[d]! === 0 && d !== c) continue;
          const dist = Math.abs(sorted[i]! - centroids[d]!);
          if (dist < minDist) minDist = dist;
        }
        if (minDist > farthestDist) {
          farthestDist = minDist;
          farthestIndex = i;
        }
      }
      centroids[c] = sorted[farthestIndex]!;
      counts[c] = 1;
      sums[c] = sorted[farthestIndex]!;
    }

    let maxShift = 0;
    for (let c = 0; c < k; c++) {
      const next = sums[c]! / counts[c]!;
      maxShift = Math.max(maxShift, Math.abs(next - centroids[c]!));
      centroids[c] = next;
    }

    if (maxShift <= tolerance) break;
  }

  // Final assignment
  const buckets: number[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < n; i++) {
    const x = sorted[i]!;
    let best = 0;
    let bestDist = Math.abs(x - centroids[0]!);
    for (let c = 1; c < k; c++) {
      const dist = Math.abs(x - centroids[c]!);
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    buckets[best]!.push(x);
  }

  const clusters: Cluster1D[] = [];
  for (const members of buckets) {
    if (members.length > 0) clusters.push(buildCluster(members));
  }
  clusters.sort((a, b) => a.min - b.min);
  return clusters;
}
