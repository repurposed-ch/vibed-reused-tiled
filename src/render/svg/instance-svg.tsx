import type { BoundaryConditionsJson } from '@/domain/boundaries';
import { instanceBlocks, type DesignInstanceJson } from '@/domain/instance';
import type { ProjectJointJson } from '@/domain/joint';
import { mat3ToSvgMatrix, placementAabb } from '@/domain/mat3';
import { cornerRadiusMetres, tileDisplayColor, type TileDefinitionJson } from '@/domain/tile';
import { BoundaryPaths } from './boundary-svg';
import { blocksBounds, groutPathD } from './grout-path';

export function InstanceSvg({
  instance,
  tiles,
  boundaries,
  joint,
}: {
  instance: DesignInstanceJson;
  tiles: TileDefinitionJson[];
  boundaries: BoundaryConditionsJson;
  /** Grout appearance. When given, the joints are drawn under the tiles. */
  joint?: ProjectJointJson;
  /** @deprecated ignored — SVG is fluid to container width */
  scale?: number;
}) {
  const tileMap = new Map(tiles.map((t) => [t.id, t]));
  const blocks = joint ? instanceBlocks(instance, tileMap) : [];

  let maxX = 1;
  let maxY = 1;
  for (const pl of instance.placements) {
    const t = tileMap.get(pl.tileDefinitionId);
    if (!t) continue;
    // Size from the transformed corners: a rotated or mirrored placement spans a
    // different rectangle than translation plus length/width would suggest, and
    // measuring it that way clips it out of the viewBox.
    const aabb = placementAabb(pl.mat3, t);
    maxX = Math.max(maxX, aabb.maxX);
    maxY = Math.max(maxY, aabb.maxY);
  }
  // Grout blocks reach half a joint past the tiles.
  const groutBounds = blocksBounds(blocks);
  if (groutBounds) {
    maxX = Math.max(maxX, groutBounds.maxX);
    maxY = Math.max(maxY, groutBounds.maxY);
  }

  const vbW = maxX + 0.4;
  const vbH = maxY + 0.4;
  // World +Y up (CAD convention): content is flipped into svg y in [-maxY, 0],
  // so the viewBox starts there rather than at -0.2.
  const vbY = -maxY - 0.2;

  return (
    <svg
      className="fluid-svg"
      viewBox={`-0.2 ${vbY} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ aspectRatio: `${vbW} / ${vbH}` }}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Design instance"
    >
      <g transform="scale(1,-1)">
        <BoundaryPaths boundaries={boundaries} />
        {joint && blocks.length > 0 && (
          // One path for all grout: separate shapes that only touch leave hairline seams.
          <path d={groutPathD(blocks)} fill={tileDisplayColor(joint.color)} />
        )}
        {instance.placements.map((pl) => {
          const t = tileMap.get(pl.tileDefinitionId);
          if (!t) return null;
          const radius = cornerRadiusMetres(t);
          return (
            <g key={pl.id} transform={mat3ToSvgMatrix(pl.mat3)}>
              <rect
                x={0}
                y={0}
                width={t.length}
                height={t.width}
                rx={radius}
                ry={radius}
                fill={tileDisplayColor(t.color)}
                // A hairline, not a metric stroke: an 8 mm stroke centred on the tile edge
                // would cover an 8 mm joint entirely.
                stroke="rgba(26,23,20,0.45)"
                strokeWidth={0.75}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
