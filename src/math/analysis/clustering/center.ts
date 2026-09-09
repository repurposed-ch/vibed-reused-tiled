import type { Epsilon } from '../../core/epsilon';
import { buildCluster, sortCopy } from './helpers';
import type { Cluster1D } from './types';

/**
 * Merge values within ±`epsilon` of a running successive-average representative.
 * `Cluster1D.mean` is that final representative (matches historical `Epsilon.clusterSortedValues`).
 */
export function clusterByCenter(values: readonly number[], epsilon: Epsilon): Cluster1D[] {
  epsilon.isPositive('clustering', 'center');
  if (values.length === 0) return [];

  const sorted = sortCopy(values);
  const clusters: Cluster1D[] = [];
  let members = [sorted[0]!];
  let representative = sorted[0]!;

  for (let index = 1; index < sorted.length; index++) {
    const value = sorted[index]!;
    if (!epsilon.areEqual(value, representative)) {
      clusters.push(buildCluster(members, representative));
      members = [value];
      representative = value;
      continue;
    }

    members.push(value);
    representative = (representative + value) * 0.5;
  }

  clusters.push(buildCluster(members, representative));
  return clusters;
}
