import { useMemo } from 'react';
import { tileDisplayColor, type MaterialDefinitionJson, type TilingProjectJson } from '@/domain/project';
import type { BakeTileInput } from '@/render/materials';
import { useBakedUrl } from './baked-url';

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
  const url = useBakedUrl(input, size, lit ? 'lit' : 'albedo');

  if (!url) return <div className="material-thumb" style={{ ...style, background: colorHex }} />;
  return <img className="material-thumb" src={url} alt={alt} style={style} />;
}
