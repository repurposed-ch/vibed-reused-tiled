import type { DesignModuleJson } from '@/domain/design-family';
import { mat3ToSvgMatrix } from '@/domain/mat3';
import type { TileDefinitionJson } from '@/domain/tile';

export function ModulePreviewSvg({
  module,
  tiles,
  scale = 80,
}: {
  module: DesignModuleJson;
  tiles: TileDefinitionJson[];
  scale?: number;
}) {
  const tileMap = new Map(tiles.map((t) => [t.id, t]));
  let maxX = 1;
  let maxY = 1;
  for (const pl of module.placements) {
    const t = tileMap.get(pl.tileDefinitionId);
    if (!t) continue;
    const x = (pl.localMat3.elements[6] ?? 0) + t.length;
    const y = (pl.localMat3.elements[7] ?? 0) + t.width;
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const pad = 0.1;
  const width = (maxX + pad * 2) * scale;
  const height = (maxY + pad * 2) * scale;

  return (
    <svg width={width} height={height} viewBox={`${-pad} ${-pad} ${maxX + pad * 2} ${maxY + pad * 2}`}>
      {module.placements.map((pl) => {
        const t = tileMap.get(pl.tileDefinitionId);
        if (!t) return null;
        return (
          <g key={pl.id} transform={mat3ToSvgMatrix(pl.localMat3)}>
            <rect
              x={0}
              y={0}
              width={t.length}
              height={t.width}
              fill={t.color}
              stroke="#1a1714"
              strokeWidth={0.01}
            />
          </g>
        );
      })}
    </svg>
  );
}
