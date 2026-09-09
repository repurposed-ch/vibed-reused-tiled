import type { Epsilon } from '../../core/epsilon';
import { buildCluster, sortCopy } from './helpers';
import type { Cluster1D } from './types';

/** Grow clusters while the range (max − min) stays within `epsilon` (complete-linkage on the line). */
export function clusterByRange(values: readonly number[], epsilon: Epsilon): Cluster1D[] {
  epsilon.isPositive('clustering', 'range');
  if (values.length === 0) return [];

  const sorted = sortCopy(values);
  const clusters: Cluster1D[] = [];
  let members = [sorted[0]!];
  let clusterMin = sorted[0]!;

  for (let index = 1; index < sorted.length; index++) {
    const value = sorted[index]!;
    if (value - clusterMin > epsilon.value) {
      clusters.push(buildCluster(members));
      members = [value];
      clusterMin = value;
    } else {
      members.push(value);
    }
  }

  clusters.push(buildCluster(members));
  return clusters;
}
