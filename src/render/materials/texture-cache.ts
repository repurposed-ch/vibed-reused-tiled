import type { MaterialDefinitionJson } from '@/domain/material';
import {
  hasCompleteRhythm,
  type TileColorJson,
  type TileDefinitionJson,
} from '@/domain/tile';
import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { bakeMaterialTexture, TEXTURE_SIZE, type BakeTileInput } from './bake';

type CacheEntry = {
  texture: CanvasTexture;
  dataUrl: string;
  canvas: HTMLCanvasElement;
  edged: boolean;
};

const cache = new Map<string, CacheEntry>();

export function materialRecipeHash(material: MaterialDefinitionJson): string {
  return JSON.stringify({
    id: material.id,
    seed: material.seed,
    sdf: material.sdf,
  });
}

export function textureCacheKey(input: BakeTileInput, size = TEXTURE_SIZE): string {
  return JSON.stringify({
    material: materialRecipeHash(input.material),
    color: input.color,
    length: input.length,
    width: input.width,
    rhythm: input.rhythm ?? null,
    size,
  });
}

export function getBakedTexture(input: BakeTileInput, size = TEXTURE_SIZE): CacheEntry {
  const key = textureCacheKey(input, size);
  const hit = cache.get(key);
  if (hit) return hit;

  const baked = bakeMaterialTexture(input, size);
  const texture = new CanvasTexture(baked.canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;

  const entry: CacheEntry = {
    texture,
    dataUrl: baked.dataUrl,
    canvas: baked.canvas,
    edged: baked.edged,
  };
  cache.set(key, entry);
  return entry;
}

export function getBakedDataUrl(input: BakeTileInput, size = TEXTURE_SIZE): string {
  return getBakedTexture(input, size).dataUrl;
}

export function bakeInputFromTile(
  tile: TileDefinitionJson,
  material: MaterialDefinitionJson,
): BakeTileInput {
  return {
    material,
    color: tile.color,
    length: tile.length,
    width: tile.width,
    rhythm: tile.rhythm,
  };
}

/** Continuous tiles repeat by aspect; edged bakes are one tile face (repeat 1,1). */
export function setTextureRepeatForTile(
  texture: Texture,
  tile: Pick<TileDefinitionJson, 'length' | 'width' | 'rhythm'>,
): void {
  if (hasCompleteRhythm(tile.rhythm)) {
    texture.repeat.set(1, 1);
  } else {
    texture.repeat.set(1, 1);
  }
  texture.needsUpdate = true;
}

/** @deprecated use setTextureRepeatForTile */
export function setTextureRepeat(
  texture: Texture,
  tileLength: number,
  tileWidth: number,
  _periodMeters?: number,
): void {
  void tileLength;
  void tileWidth;
  texture.repeat.set(1, 1);
  texture.needsUpdate = true;
}

export function clearTextureCache(): void {
  for (const entry of cache.values()) {
    entry.texture.dispose();
  }
  cache.clear();
}

export type { TileColorJson };
