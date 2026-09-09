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
              <text x={from.x} y={from.y - 0.08} fill="#6f8f6a" fontSize={0.12}>
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
  scale = 60,
}: {
  boundaries: BoundaryConditionsJson;
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
  const vb = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
  const w = (maxX - minX + pad * 2) * scale;
  const h = (maxY - minY + pad * 2) * scale;

  return (
    <svg width={w} height={h} viewBox={vb}>
      <BoundaryPaths boundaries={boundaries} />
    </svg>
  );
}
