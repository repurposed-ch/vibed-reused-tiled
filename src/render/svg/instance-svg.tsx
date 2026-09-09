import type { BoundaryConditionsJson } from '@/domain/boundaries';
import type { DesignInstanceJson } from '@/domain/instance';
import { mat3ToSvgMatrix } from '@/domain/mat3';
import type { TileDefinitionJson } from '@/domain/tile';
import { BoundaryPaths } from './boundary-svg';

export function InstanceSvg({
  instance,
  tiles,
  boundaries,
  scale = 70,
}: {
  instance: DesignInstanceJson;
  tiles: TileDefinitionJson[];
  boundaries: BoundaryConditionsJson;
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

  const width = (maxX + 0.4) * scale;
  const height = (maxY + 0.4) * scale;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`-0.2 -0.2 ${maxX + 0.4} ${maxY + 0.4}`}
      xmlns="http://www.w3.org/2000/svg"
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
              fill={t.color}
              stroke="#1a1714"
              strokeWidth={0.008}
            />
          </g>
        );
      })}
    </svg>
  );
}
