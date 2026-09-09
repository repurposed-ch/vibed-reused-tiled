import type { StockStateJson } from '@/domain/stock';

export type SampledStock = { tileDefinitionId: string; count: number };

export type Rng = () => number;

/** Deterministic mulberry32 PRNG from a 32-bit seed. */
export function mulberry32(seed: number): Rng {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function samplePoisson(lambda: number, rng: Rng): number {
  const L = Math.exp(-Math.max(0, lambda));
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng();
  } while (p > L);
  return k - 1;
}

function sampleNormal(mean: number, stdDev: number, rng: Rng): number {
  const u = 1 - rng();
  const v = 1 - rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + stdDev * z;
}

function sampleUniform(min: number, max: number, rng: Rng): number {
  return min + (max - min) * rng();
}

export function sampleStock(stock: StockStateJson, rng: Rng): SampledStock[] {
  return stock.entries.map((entry) => {
    if (entry.kind === 'exact') {
      return { tileDefinitionId: entry.tileDefinitionId, count: entry.count };
    }
    let count = 0;
    if (entry.distribution === 'poisson') {
      count = samplePoisson(entry.params.lambda ?? 0, rng);
    } else if (entry.distribution === 'normal') {
      count = sampleNormal(entry.params.mean ?? 0, entry.params.stdDev ?? 1, rng);
    } else {
      count = sampleUniform(entry.params.min ?? 0, entry.params.max ?? 0, rng);
    }
    return {
      tileDefinitionId: entry.tileDefinitionId,
      count: Math.max(0, Math.round(count)),
    };
  });
}
