import { useEffect, useMemo, useState } from 'react';
import { bakeMaterialTexture, textureCacheKey, type BakeTileInput } from '@/render/materials';

/**
 * Baked preview images, keyed by recipe.
 *
 * A gallery of cards re-bakes on every mount otherwise, and an editor re-bakes every time you
 * step back through a slider. Capped because each entry is a PNG data URL of a few tens of kB
 * and an editing session produces one per committed edit.
 */
const CACHE_LIMIT = 48;
const cache = new Map<string, string>();

function keyFor(input: BakeTileInput, size: number, primary: 'albedo' | 'lit'): string {
  return `${textureCacheKey(input, size)}|${primary}`;
}

function bake(input: BakeTileInput, size: number, primary: 'albedo' | 'lit', key: string): string | null {
  try {
    const { dataUrl } = bakeMaterialTexture(input, size, { primary });
    cache.set(key, dataUrl);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    return dataUrl;
  } catch {
    return null;
  }
}

/** The bake as a data URL, from cache when possible and off the paint path when not. */
export function useBakedUrl(
  input: BakeTileInput | null,
  size: number,
  primary: 'albedo' | 'lit' = 'albedo',
): string | null {
  const key = useMemo(() => (input ? keyFor(input, size, primary) : null), [input, size, primary]);
  const [url, setUrl] = useState<string | null>(() => (key ? (cache.get(key) ?? null) : null));

  useEffect(() => {
    if (!input || !key) {
      setUrl(null);
      return;
    }
    const hit = cache.get(key);
    if (hit) {
      setUrl(hit);
      return;
    }
    // A timeout rather than an animation frame: the latter never fires in a background tab,
    // which would leave a reopened gallery blank until it is looked at.
    const timer = window.setTimeout(() => setUrl(bake(input, size, primary, key)), 0);
    return () => window.clearTimeout(timer);
  }, [key, input, size, primary]);

  return url;
}
