import {
  cornerRadiusMetres,
  hasCompleteRhythm,
  tileDisplayColor,
  type FacadeSide,
  type MaterialDefinitionJson,
  type TileDefinitionJson,
} from '@/domain/project';
import { bakeInputFromTile } from '@/render/materials';
import { useMemo } from 'react';
import { useBakedUrl } from './baked-url';

export const SIDES: FacadeSide[] = ['south', 'east', 'north', 'west'];

const MAX_PREVIEW_W = 160;
const MAX_PREVIEW_H = 100;

export function formatMeters(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2).replace(/\.?0+$/, '') : '—';
}

/** `0.60 × 0.30 × 0.02 m`, the line under every preview. */
export function tileDimensions(tile: TileDefinitionJson): string {
  return `${formatMeters(tile.length)}×${formatMeters(tile.width)}×${formatMeters(tile.thickness)} m`;
}

export function rhythmStatus(rhythm: TileDefinitionJson['rhythm']): 'none' | 'complete' | 'partial' {
  if (!rhythm) return 'none';
  const n = SIDES.filter((s) => rhythm[s] != null).length;
  if (n === 0) return 'none';
  if (n === 4) return 'complete';
  return 'partial';
}

/**
 * The tile drawn to scale, filled with its baked material and rounded to its corner radius.
 *
 * `aspect` frames the tile inside a fixed-ratio box instead of hugging it, so a row of cards
 * lines up whatever shape the tiles are.
 */
export function TilePreview({
  tile,
  material,
  showRhythm = true,
  aspect,
  maxWidth = 280,
  style,
}: {
  tile: TileDefinitionJson;
  material?: MaterialDefinitionJson;
  showRhythm?: boolean;
  aspect?: number;
  maxWidth?: number | string;
  style?: React.CSSProperties;
}) {
  const length = Math.max(tile.length, 1e-6);
  const width = Math.max(tile.width, 1e-6);
  const scale = Math.min(MAX_PREVIEW_W / length, MAX_PREVIEW_H / width);
  const w = length * scale;
  const h = width * scale;
  const pad = showRhythm ? 28 : 10;
  let vbW = w + pad * 2;
  let vbH = h + pad * 2;
  if (aspect) {
    vbW = Math.max(vbW, vbH * aspect);
    vbH = vbW / aspect;
  }
  const x0 = (vbW - w) / 2;
  const y0 = (vbH - h) / 2;
  const patternId = `tile-tex-${tile.id}`;
  const fallback = tileDisplayColor(tile.color);

  const input = useMemo(() => (material ? bakeInputFromTile(tile, material) : null), [tile, material]);
  const textureUrl = useBakedUrl(input, 256);

  return (
    <svg
      className="fluid-svg"
      viewBox={`0 0 ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ aspectRatio: `${vbW} / ${vbH}`, maxWidth, ...style }}
      role="img"
      aria-label={`Texture preview for ${tile.name}, ${tileDimensions(tile)}`}
    >
      <defs>
        {textureUrl && (
          <pattern id={patternId} patternUnits="userSpaceOnUse" x={x0} y={y0} width={w} height={h}>
            <image href={textureUrl} x={0} y={0} width={w} height={h} preserveAspectRatio="none" />
          </pattern>
        )}
      </defs>
      <rect
        x={x0}
        y={y0}
        width={w}
        height={h}
        rx={cornerRadiusMetres(tile) * scale}
        ry={cornerRadiusMetres(tile) * scale}
        fill={textureUrl ? `url(#${patternId})` : fallback}
        stroke="#f3ebe1"
        strokeWidth={1.5}
      />
      {showRhythm &&
        SIDES.map((side) => {
          const r = tile.rhythm?.[side];
          if (!r) return null;
          const label = `${r.name}${r.mirrored ? '′' : ''}`;
          const pos =
            side === 'south'
              ? { x: x0 + w / 2, y: y0 + h + 14 }
              : side === 'north'
                ? { x: x0 + w / 2, y: y0 - 10 }
                : side === 'east'
                  ? { x: x0 + w + 14, y: y0 + h / 2 }
                  : { x: x0 - 14, y: y0 + h / 2 };
          return (
            <text
              key={side}
              x={pos.x}
              y={pos.y}
              fill="#b5a89a"
              fontSize={11}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="Fragment Mono, monospace"
            >
              {label}
            </text>
          );
        })}
    </svg>
  );
}

/** `continuous UV` or `edged UV`, the other half of a tile's summary line. */
export function tileUvLabel(tile: TileDefinitionJson): string {
  return hasCompleteRhythm(tile.rhythm) ? 'edged UV' : 'continuous UV';
}
