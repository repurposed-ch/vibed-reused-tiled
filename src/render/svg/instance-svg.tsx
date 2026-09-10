import type { BoundaryConditionsJson } from '@/domain/boundaries';
import type { DesignInstanceJson } from '@/domain/instance';
import { mat3ToSvgMatrix } from '@/domain/mat3';
import { tileDisplayColor, type TileDefinitionJson } from '@/domain/tile';
import { BoundaryPaths } from './boundary-svg';

export function InstanceSvg({
  instance,
  tiles,
  boundaries,
}: {
  instance: DesignInstanceJson;
  tiles: TileDefinitionJson[];
  boundaries: BoundaryConditionsJson;
  /** @deprecated ignored — SVG is fluid to container width */
  scale?: number;
}) {
  const tileMap = new Map(tiles.map((t) => [t.id, t]));
  let maxX = 1;
  let maxY = 1;
  for (const pl of instance.placements) {
    const t = tileMap.get(pl.tileDefinitionId);
    if (!t) continue;
    maxX = Math.max(maxX, (pl.mat3.elements[6] ?? 0) + t.length);
    maxY = Math.max(maxY, (pl.mat3.elements[7] ?? 0) + t.width);
  }

  const vbW = maxX + 0.4;
  const vbH = maxY + 0.4;

  return (
    <svg
      className="fluid-svg"
      viewBox={`-0.2 -0.2 ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ aspectRatio: `${vbW} / ${vbH}` }}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Design instance"
    >
      <BoundaryPaths boundaries={boundaries} />
      {instance.placements.map((pl) => {
        const t = tileMap.get(pl.tileDefinitionId);
        if (!t) return null;
        return (
          <g key={pl.id} transform={mat3ToSvgMatrix(pl.mat3)}>
            <rect
              x={0}
              y={0}
              width={t.length}
              height={t.width}
              fill={tileDisplayColor(t.color)}
              stroke="#1a1714"
              strokeWidth={0.008}
            />
          </g>
        );
      })}
    </svg>
  );
}
