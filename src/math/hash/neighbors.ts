import { dehash2, hash2 } from './core';

/** hash neighboring cells using Moore neighborhood - https://en.wikipedia.org/wiki/Moore_neighborhood */
export function mooreNeighborCellHashes(h: number, count = 1): number[] {
  const [gi, gj] = dehash2(h);
  const hashes: number[] = [];
  for (let di = -count; di <= count; di++) {
    for (let dj = -count; dj <= count; dj++) {
      if (di === 0 && dj === 0) continue;
      hashes.push(hash2(gi + di, gj + dj));
    }
  }
  return hashes;
}

/** hash neighboring cells using von Neumann neighborhood - https://en.wikipedia.org/wiki/Von_Neumann_neighborhood */
export function vonNeumannNeighborCellHashes(h: number, count = 1): number[] {
  const [gi, gj] = dehash2(h);
  const hashes: number[] = [];
  for (let di = -count; di <= count; di++) {
    const yCount = count - Math.abs(di);
    for (let dj = -yCount; dj <= yCount; dj++) {
      if (di === 0 && dj === 0) continue;
      hashes.push(hash2(gi + di, gj + dj));
    }
  }
  return hashes;
}
