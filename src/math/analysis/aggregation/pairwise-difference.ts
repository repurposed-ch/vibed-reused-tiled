/** Consecutive first differences: `values[i+1] - values[i]` (empty when fewer than 2 values). */
export function pairwiseDifference(values: readonly number[]): number[] {
  if (values.length < 2) {
    return [];
  }

  const result: number[] = [];
  for (let i = 0; i < values.length - 1; i++) {
    result.push(values[i + 1]! - values[i]!);
  }
  return result;
}
