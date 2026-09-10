import type { BoundaryConditionsJson } from '@/domain/boundaries';

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

/**
 * Boundary geometry in world coordinates.
 *
 * Drawn inside a `scale(1,-1)` group so world +Y runs up the screen (CAD
 * convention). Callers own that flip and the matching viewBox; anything with
 * glyphs in here has to counter-flip itself or it renders mirrored.
 */
export function BoundaryPaths({ boundaries }: { boundaries: BoundaryConditionsJson }) {
  return (
    <g>
      {boundaries.outers.map((g, i) => {
        const verts = asVerts(g as Record<string, unknown>);
        if (!verts.length) return null;
        const d = verts.map((v, idx) => `${idx === 0 ? 'M' : 'L'} ${v.x} ${v.y}`).join(' ') + ' Z';
        return (
          <path
            key={`o-${i}`}
            d={d}
            fill="rgba(217,119,58,0.15)"
            stroke="#d9773a"
            strokeWidth={0.03}
          />
        );
      })}
      {boundaries.holes.map((g, i) => {
        const verts = asVerts(g as Record<string, unknown>);
        if (!verts.length) return null;
        const d = verts.map((v, idx) => `${idx === 0 ? 'M' : 'L'} ${v.x} ${v.y}`).join(' ') + ' Z';
        return (
          <path key={`h-${i}`} d={d} fill="#1a1714" stroke="#b5a89a" strokeWidth={0.02} />
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
