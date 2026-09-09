import type { Epsilon } from '../../core/epsilon';
import { buildCluster, sortCopy } from './helpers';
import type { Cluster1D } from './types';

/** Split sorted values into clusters when consecutive gap exceeds `epsilon`. */
export function clusterByGap(values: readonly number[], epsilon: Epsilon): Cluster1D[] {
  epsilon.isPositive('clustering', 'gap');
  if (values.length === 0) return [];

  const sorted = sortCopy(values);
  const clusters: Cluster1D[] = [];
  let members = [sorted[0]!];

  for (let index = 1; index < sorted.length; index++) {
    const value = sorted[index]!;
    const prev = sorted[index - 1]!;
    if (value - prev > epsilon.value) {
      clusters.push(buildCluster(members));
      members = [value];
    } else {
      members.push(value);
    }
  }

  clusters.push(buildCluster(members));
  return clusters;
}
