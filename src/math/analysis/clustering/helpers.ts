import type { Cluster1D } from './types';

export function sortCopy(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

export function buildCluster(members: readonly number[], meanOverride?: number): Cluster1D {
  if (members.length === 0) {
    throw new Error('Cluster1D requires at least one member');
  }

  const sorted = sortCopy(members);
  let sum = 0;
  for (const value of sorted) sum += value;

  return {
    members: sorted,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: meanOverride ?? sum / sorted.length,
  };
}

export function requireK(k: number, n: number): void {
  if (!Number.isInteger(k) || k < 1 || k > n) {
    throw new Error(`k must be an integer in [1, ${n}], got ${k}`);
  }
}
