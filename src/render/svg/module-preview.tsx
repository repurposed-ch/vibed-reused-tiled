import { mat3ToSvgMatrix, placementAabb } from '@/domain/mat3';
import { tileDisplayColor, type TileDefinitionJson } from '@/domain/tile';
import type { DesignModuleJson } from '@/domain/design-family';

export function ModulePreviewSvg({
  module,
  tiles,
}: {
  module: DesignModuleJson;
  tiles: TileDefinitionJson[];
  /** @deprecated ignored — SVG is fluid to container width */
  scale?: number;
}) {
  const tileMap = new Map(tiles.map((t) => [t.id, t]));
  let maxX = 1;
  let maxY = 1;
  for (const pl of module.placements) {
    const t = tileMap.get(pl.tileDefinitionId);
    if (!t) continue;
    // Transformed corners, so rotated and mirrored placements stay in frame.
    const aabb = placementAabb(pl.localMat3, t);
    maxX = Math.max(maxX, aabb.maxX);
    maxY = Math.max(maxY, aabb.maxY);
  }

  const pad = 0.1;
  const vbW = maxX + pad * 2;
  const vbH = maxY + pad * 2;
  // World +Y up (CAD convention); see instance-svg.
  const vbY = -maxY - pad;

  return (
    <svg
      className="fluid-svg"
      viewBox={`${-pad} ${vbY} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ aspectRatio: `${vbW} / ${vbH}` }}
      role="img"
      aria-label="Module preview"
    >
      <g transform="scale(1,-1)">
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
              fill={tileDisplayColor(t.color)}
              stroke="#1a1714"
              strokeWidth={0.01}
            />
          </g>
        );
      })}
      </g>
    </svg>
  );
}
