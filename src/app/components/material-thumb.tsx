import { useEffect, useMemo, useState } from 'react';
import { tileDisplayColor, type MaterialDefinitionJson, type TilingProjectJson } from '@/domain/project';
import { bakeMaterialTexture, textureCacheKey, type BakeTileInput } from '@/render/materials';

/**
 * Baked preview images, keyed by recipe.
 *
 * A grid of cards re-bakes on every mount otherwise, and the editor's preview re-bakes
 * every time you step back through a slider. Capped because each entry is a PNG data URL
 * of a few tens of kB and an editing session produces one per committed draft.
 */
const CACHE_LIMIT = 48;
const urlCache = new Map<string, string>();

function cacheKey(input: BakeTileInput, size: number, lit: boolean): string {
  return `${textureCacheKey(input, size)}|${lit ? 'lit' : 'albedo'}`;
}

function bake(input: BakeTileInput, size: number, lit: boolean, key: string): string | null {
  try {
    const { dataUrl } = bakeMaterialTexture(input, size, { primary: lit ? 'lit' : 'albedo' });
    urlCache.set(key, dataUrl);
    if (urlCache.size > CACHE_LIMIT) urlCache.delete(urlCache.keys().next().value!);
    return dataUrl;
  } catch {
    return null;
  }
}

/**
 * What a material should be previewed as: the colour and shape of the first tile that
 * uses it, the joint's colour for the joint material, and a neutral tile otherwise.
 *
 * A non-square tile is the case that used to seam unconditionally, so it is the one worth
 * showing.
 */
export function materialPreviewContext(
  project: TilingProjectJson,
  material: MaterialDefinitionJson,
): { colorHex: string; length: number; width: number } {
  const tile = project.tileDefinitions.find((t) => t.materialId === material.id);
  if (tile) return { colorHex: tileDisplayColor(tile.color), length: tile.length, width: tile.width };
  if (project.joint.materialId === material.id) {
    return { colorHex: tileDisplayColor(project.joint.color), length: 0.5, width: 0.5 };
  }
  return { colorHex: '#c4a574', length: 0.6, width: 0.3 };
}

/** How a material is used, for the card's second line. */
export function materialUsage(project: TilingProjectJson, material: MaterialDefinitionJson): string {
  const tiles = project.tileDefinitions.filter((t) => t.materialId === material.id).length;
  const parts: string[] = [];
  if (tiles > 0) parts.push(`${tiles} tile${tiles === 1 ? '' : 's'}`);
  if (project.joint.materialId === material.id) parts.push('joint');
  return parts.length > 0 ? parts.join(' · ') : 'unused';
}

/** The material baked to an image, at the colour and tile shape it is used at. */
export function MaterialThumb({
  material,
  colorHex,
  length,
  width,
  lit = false,
  size = 160,
  alt,
  style,
}: {
  material: MaterialDefinitionJson;
  colorHex: string;
  length: number;
  width: number;
  /** Shade the albedo with the normal derived from the same field, so relief is visible. */
  lit?: boolean;
  /** Bake resolution in pixels; the image is displayed at whatever size CSS gives it. */
  size?: number;
  alt: string;
  style?: React.CSSProperties;
}) {
  const input = useMemo(
    (): BakeTileInput => ({ material, color: { mode: 'brightness', color: colorHex }, length, width }),
    [material, colorHex, length, width],
  );
  const key = useMemo(() => cacheKey(input, size, lit), [input, size, lit]);
  const [url, setUrl] = useState<string | null>(() => urlCache.get(key) ?? null);

  useEffect(() => {
    const hit = urlCache.get(key);
    if (hit) {
      setUrl(hit);
      return;
    }
    // Off the paint path: a grid of cards would otherwise bake them all before first paint.
    // A timeout rather than an animation frame — the latter never fires in a background
    // tab, which would leave a reopened gallery blank until it is looked at.
    const timer = window.setTimeout(() => setUrl(bake(input, size, lit, key)), 0);
    return () => window.clearTimeout(timer);
  }, [key, input, size, lit]);

  if (!url) return <div className="material-thumb" style={{ ...style, background: colorHex }} />;
  return <img className="material-thumb" src={url} alt={alt} style={style} />;
}
