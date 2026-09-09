// core principel of hashes in Vec2 are the idea that you can store numbers as integers in doubles upto 2 ** 53
// this works quite well for dataset with pair values, because this leaves 2 x 2 ** 26 > 2 * 67 million possible valuesf or both
import { Epsilon } from '../core/epsilon';

const HASH_SCALE_2 = 2 ** 26;
/** assumes that the numbers a and b are positive ints, smaller than 2**26 */

/**
 * Returns a double, representing the two numebrs, assumed to be positive ints, smaller than 2**26
 * important: values a and b are not checked for validity!
 */
export function hash2(a: number, b: number): number {
  return a * HASH_SCALE_2 + b;
}

/** helper method that forces a value to be within the range of 0 to 2**26 */
function valueToHashScale2Range(v: number, scale: number) {
  return ((Math.floor(v / scale) % HASH_SCALE_2) + HASH_SCALE_2) % HASH_SCALE_2;
}

/** Hashing two numbers with a scale factor, this is useful when you want to hash non-integer values */
export function hash2scale(a: number, b: number, scale: number = Epsilon.value): number {
  return hash2(valueToHashScale2Range(a, scale), valueToHashScale2Range(b, scale));
}

/** assumes that the hash is a positive int, smaller than 2**52, returns the two numbers it was constructed from */
export function dehash2(hash: number): [number, number] {
  return [Math.floor(hash / HASH_SCALE_2), hash % HASH_SCALE_2];
}

/** helper method that forces a value to be within the range of 0 to 2**26 */
export function valueToHashableIntegerOfCustomBitwidth(v: number, min: number, scale: number, bitwidth: number) {
  const hashScale = 2 ** bitwidth;
  return ((Math.floor((v - min) / scale) % hashScale) + hashScale) % hashScale;
}

export function dehashValueOfCustomBitwidth(hash: number, min: number, scale: number) {
  return hash * scale + min;
}
