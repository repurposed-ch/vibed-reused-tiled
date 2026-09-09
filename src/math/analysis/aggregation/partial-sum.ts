/** Inclusive prefix sums of `values`. When `startAtZero`, result begins with `0` (length `n+1`). */
export function partialSum(values: readonly number[], startAtZero: boolean = false): number[] {
  if (values.length === 0) {
    return startAtZero ? [0] : [];
  }

  const result: number[] = startAtZero ? [0] : [];
  let sum = 0;
  for (const value of values) {
    sum += value;
    result.push(sum);
  }
  return result;
}
