import type { MaterialDefinitionJson } from '@/domain/material';
import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { bakeMaterialTexture, TEXTURE_SIZE } from './bake';

type CacheEntry = {
  texture: CanvasTexture;
  dataUrl: string;
  canvas: HTMLCanvasElement;
};

const cache = new Map<string, CacheEntry>();

export function materialRecipeHash(material: MaterialDefinitionJson): string {
  return JSON.stringify({
    id: material.id,
    seed: material.seed,
    periodMeters: material.periodMeters,
    sdf: material.sdf,
  });
}

export function textureCacheKey(
  material: MaterialDefinitionJson,
  colorHex: string,
  size = TEXTURE_SIZE,
): string {
  return `${material.id}|${materialRecipeHash(material)}|${colorHex.toLowerCase()}|${size}`;
}

export function getBakedTexture(
  material: MaterialDefinitionJson,
  colorHex: string,
  size = TEXTURE_SIZE,
): CacheEntry {
  const key = textureCacheKey(material, colorHex, size);
  const hit = cache.get(key);
  if (hit) return hit;

  const baked = bakeMaterialTexture(material, colorHex, size);
  const texture = new CanvasTexture(baked.canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;

  const entry: CacheEntry = {
    texture,
    dataUrl: baked.dataUrl,
    canvas: baked.canvas,
  };
  cache.set(key, entry);
  return entry;
}

export function getBakedDataUrl(
  material: MaterialDefinitionJson,
  colorHex: string,
  size = TEXTURE_SIZE,
): string {
  return getBakedTexture(material, colorHex, size).dataUrl;
}

export function setTextureRepeat(
  texture: Texture,
  tileLength: number,
  tileWidth: number,
  periodMeters: number,
): void {
  const p = periodMeters > 1e-9 ? periodMeters : 0.3;
  texture.repeat.set(tileLength / p, tileWidth / p);
  texture.needsUpdate = true;
}

export function clearTextureCache(): void {
  for (const entry of cache.values()) {
    entry.texture.dispose();
  }
  cache.clear();
}
