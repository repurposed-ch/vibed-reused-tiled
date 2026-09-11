import type { BoundaryConditionsJson } from '@/domain/boundaries';
import { resolveBoundaryRegion } from '@/workflow/boundary-region';
import { ORIENTATION_STROKE } from './boundary-draw-geometry';

type Vec = { x: number; y: number };

function asVerts(geom: Record<string, unknown>): Vec[] {
  if (geom.type === 'Polygon2' && Array.isArray(geom.vertices)) {
    return (geom.vertices as Vec[]).map((v) => ({ x: v.x, y: v.y }));
  }
  if (geom.type === 'Aabb2') {
    const min = geom.min as Vec | undefined;
    const max = geom.max as Vec | undefined;
    if (min && max) {
      return [
        { x: min.x, y: min.y },
        { x: max.x, y: min.y },
        { x: max.x, y: max.y },
        { x: min.x, y: max.y },
      ];
    }
  }
  return [];
}

function pathOf(verts: readonly Vec[]): string {
  return verts.map((v, idx) => `${idx === 0 ? 'M' : 'L'} ${v.x} ${v.y}`).join(' ') + ' Z';
}

/**
 * Boundary geometry in world coordinates.
 *
 * Drawn inside a `scale(1,-1)` group so world +Y runs up the screen (CAD
 * convention). Callers own that flip and the matching viewBox; anything with
 * glyphs in here has to counter-flip itself or it renders mirrored.
 */
export function BoundaryPaths({ boundaries }: { boundaries: BoundaryConditionsJson }) {
  // The shape that actually gets tiled, computed by the same boolean the fill
  // uses — so the preview can no longer disagree with the layout. Holes used to
  // be faked by painting them in the background colour, which double-darkened
  // overlapping outers and drew a dark blob for a hole outside every outer.
  const region = resolveBoundaryRegion(boundaries);
  // Even-odd across the result's loops: they never overlap, so this agrees with
  // the winding the boolean encodes and does not depend on loop orientation.
  const regionPath = region.polygons.map((p) => pathOf(p.vertices)).join(' ');

  return (
    <g>
      {regionPath && (
        <path
          d={regionPath}
          fill="rgba(217,119,58,0.28)"
          fillRule="evenodd"
          stroke={ORIENTATION_STROKE.ccw}
          strokeWidth={0.03}
        />
      )}

      {/* What was drawn, thin and dashed on top, so input and result can be
          compared and it is visible which shape caused what. Coloured by
          orientation — which is each loop's role — in the same colours as the
          draw canvas. Lists match orientation, so outers are the solid colour. */}
      {boundaries.outers.map((g, i) => {
        const verts = asVerts(g as Record<string, unknown>);
        if (!verts.length) return null;
        return (
          <path
            key={`o-${i}`}
            d={pathOf(verts)}
            fill="none"
            stroke={ORIENTATION_STROKE.ccw}
            strokeWidth={0.012}
            strokeDasharray="0.06 0.04"
          />
        );
      })}
      {boundaries.holes.map((g, i) => {
        const verts = asVerts(g as Record<string, unknown>);
        if (!verts.length) return null;
        return (
          <path
            key={`h-${i}`}
            d={pathOf(verts)}
            fill="none"
            stroke={ORIENTATION_STROKE.cw}
            strokeWidth={0.012}
            strokeDasharray="0.06 0.04"
          />
        );
      })}
      {boundaries.guides.map((guide) => {
        const g = guide.geometry as Record<string, unknown>;
        if (g.type === 'Line2') {
          const from = g.from as Vec;
          const to = g.to as Vec;
          return (
            <g key={guide.id}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="#6f8f6a"
                strokeWidth={0.04}
                strokeDasharray="0.08 0.06"
              />
              {/* Counter-flip so the label reads upright inside the flipped group.
                  +0.08 now sits above the line, since +Y is up. */}
              <text
                transform={`translate(${from.x} ${from.y + 0.08}) scale(1,-1)`}
                fill="#6f8f6a"
                fontSize={0.12}
              >
                {guide.name}
              </text>
            </g>
          );
        }
        return null;
      })}
    </g>
  );
}

export function BoundarySvg({
  boundaries,
}: {
  boundaries: BoundaryConditionsJson;
  /** @deprecated ignored — SVG is fluid to container width */
  scale?: number;
}) {
  let minX = 0;
  let minY = 0;
  let maxX = 1;
  let maxY = 1;
  for (const outer of boundaries.outers) {
    for (const v of asVerts(outer as Record<string, unknown>)) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }
  }
  const pad = 0.2;
  const vbW = maxX - minX + pad * 2;
  const vbH = maxY - minY + pad * 2;
  // Flipped content spans svg y in [-maxY, -minY], so the viewBox starts at -maxY.
  const vb = `${minX - pad} ${-maxY - pad} ${vbW} ${vbH}`;

  return (
    <svg
      className="fluid-svg"
      viewBox={vb}
      preserveAspectRatio="xMidYMid meet"
      style={{ aspectRatio: `${Math.max(vbW, 0.01)} / ${Math.max(vbH, 0.01)}` }}
      role="img"
      aria-label="Boundary preview"
    >
      <g transform="scale(1,-1)">
        <BoundaryPaths boundaries={boundaries} />
      </g>
    </svg>
  );
}
