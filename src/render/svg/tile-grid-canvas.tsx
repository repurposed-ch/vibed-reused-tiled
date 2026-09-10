import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { IntVec2 } from '@/domain/tile-grid';
import {
  arrowHead,
  canvasWindow,
  cellRect,
  cornerPoint,
  normaliseDrag,
  pointToCell,
  pointToCorner,
  viewBox,
  viewBoxSize,
  windowCells,
  windowCorners,
  type CanvasWindow,
  type Extent,
} from './tile-grid-geometry';

/**
 * Interactive cell grid with draggable lattice vectors.
 *
 * Used at every level of a tile schema, because every level's coordinate space
 * has the same shape: a rectangular block of slots, one slot per copy of the
 * child, with the level's lattice vectors measured in those slots. At the
 * innermost level a slot is one tile cell; above that it is one copy of the
 * child grid.
 *
 * The ring of cells around the block is the point of the component. Lattice
 * generators routinely leave the pattern's own box — a staircase repeat needs
 * them to — so the ring is a live click target, one cell deep by default and
 * growable, and the drawn window stretches further on its own to keep a vector
 * tip in view.
 */

export type CanvasMode = 'paint' | 'lattice';

export type CellFill = {
  fill: string;
  stroke?: string;
  label?: string;
};

export type TileGridCanvasProps = {
  extent: Extent;
  pad: number;
  u: IntVec2;
  v: IntVec2;
  mode: CanvasMode;
  /** Painted content per cell, block cells only. */
  cellFill?: (cell: IntVec2) => CellFill | null;
  /**
   * Cells inside the block that no occurrence claims. Drawn neutrally: a blank
   * is only a fault when the counts disagree, and in a sheared repeat it is
   * normal — a neighbouring copy covers it.
   */
  unclaimed?: IntVec2[];
  /** Draw the blanks as a fault, because the repeat does not add up. */
  unclaimedAreFaults?: boolean;
  /** Cells that overlap, or that two lattice copies would collide on. */
  conflicts?: IntVec2[];
  /** Footprint the next paint gesture will lay down, given a dragged rectangle. */
  resolveFootprint?: (drag: {
    i: number;
    j: number;
    iSpan: number;
    jSpan: number;
  }) => { i: number; j: number; iSpan: number; jSpan: number } | null;
  onPaint?: (rect: { i: number; j: number; iSpan: number; jSpan: number }) => void;
  onCellClick?: (cell: IntVec2) => void;
  onLatticeChange?: (which: 'u' | 'v', value: IntVec2) => void;
  /** Extra marks drawn in svg user units, on top of the cells. */
  overlay?: ReactNode;
  /** Pixels per cell. The canvas scrolls inside its frame rather than shrinking. */
  cellPx?: number;
};

const DEFAULT_CELL_PX = 34;

type Drag =
  | { kind: 'paint'; from: IntVec2; to: IntVec2 }
  | { kind: 'lattice'; which: 'u' | 'v'; value: IntVec2 };

function svgPoint(svg: SVGSVGElement, event: ReactPointerEvent): { x: number; y: number } | null {
  // Recomputed every event on purpose: the validation banner above the canvas
  // appears and disappears while the user drags, which reflows the page and
  // invalidates a CTM captured at pointerdown.
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
  return { x: point.x, y: point.y };
}

export function TileGridCanvas({
  extent,
  pad,
  u,
  v,
  mode,
  cellFill,
  unclaimed = [],
  unclaimedAreFaults = false,
  conflicts = [],
  resolveFootprint,
  onPaint,
  onCellClick,
  onLatticeChange,
  overlay,
  cellPx = DEFAULT_CELL_PX,
}: TileGridCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const win: CanvasWindow = canvasWindow(extent, pad);
  const size = viewBoxSize(win);
  const unclaimedKeys = new Set(unclaimed.map((c) => `${c.i}:${c.j}`));
  const conflictKeys = new Set(conflicts.map((c) => `${c.i}:${c.j}`));

  const originPoint = cornerPoint(win, 0, 0);
  const dragValue = drag?.kind === 'lattice' ? drag.value : null;
  const liveU = drag?.kind === 'lattice' && drag.which === 'u' ? dragValue! : u;
  const liveV = drag?.kind === 'lattice' && drag.which === 'v' ? dragValue! : v;
  const liveUPoint = cornerPoint(win, liveU.i, liveU.j);
  const liveVPoint = cornerPoint(win, liveV.i, liveV.j);

  const paintPreview =
    drag?.kind === 'paint' && resolveFootprint
      ? resolveFootprint(normaliseDrag(drag.from, drag.to))
      : null;

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const point = svgPoint(svg, event);
    if (!point) return;
    svg.setPointerCapture(event.pointerId);

    if (mode === 'lattice') {
      const corner = pointToCorner(win, point.x, point.y);
      // Grab whichever tip is nearer; ties go to u.
      const du = Math.abs(corner.i - u.i) + Math.abs(corner.j - u.j);
      const dv = Math.abs(corner.i - v.i) + Math.abs(corner.j - v.j);
      const which = du <= dv ? 'u' : 'v';
      setDrag({ kind: 'lattice', which, value: corner });
      return;
    }

    const cell = pointToCell(win, point.x, point.y);
    setDrag({ kind: 'paint', from: cell, to: cell });
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const svg = svgRef.current;
    if (!svg) return;
    const point = svgPoint(svg, event);
    if (!point) return;

    if (drag.kind === 'lattice') {
      setDrag({ ...drag, value: pointToCorner(win, point.x, point.y) });
      return;
    }
    setDrag({ ...drag, to: pointToCell(win, point.x, point.y) });
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (svg?.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (!drag) return;

    if (drag.kind === 'lattice') {
      // A zero vector is degenerate; leave the previous value alone.
      if (drag.value.i !== 0 || drag.value.j !== 0) onLatticeChange?.(drag.which, drag.value);
      setDrag(null);
      return;
    }

    const rect = normaliseDrag(drag.from, drag.to);
    // A press and release on one cell is a click: the caller decides whether
    // that means place or remove. Anything larger is always a paint.
    if (rect.iSpan === 1 && rect.jSpan === 1) onCellClick?.(drag.from);
    else onPaint?.(rect);
    setDrag(null);
  };

  const cancelDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (svg?.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    setDrag(null);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox(win)}
      preserveAspectRatio="xMidYMid meet"
      // Explicit pixel size beats the global `svg { width: 100% }` rule so cells
      // stay hittable on a large extent. `overflow: visible` lets an axis that
      // reaches past the ring keep drawing instead of being cut off at the grid
      // edge — the grid no longer resizes itself to contain the vectors.
      style={{
        width: `${size.width * cellPx}px`,
        maxWidth: 'none',
        height: `${size.height * cellPx}px`,
        overflow: 'visible',
        touchAction: 'none',
        userSelect: 'none',
        cursor: mode === 'lattice' ? 'crosshair' : 'cell',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={cancelDrag}
      onLostPointerCapture={cancelDrag}
      role="img"
      aria-label="Tile grid"
    >
      {/* Opaque backdrop: the frame behind this has its own 24px grid pattern,
          which would otherwise show through and read as a second, false grid. */}
      <rect
        x={win.minI}
        y={win.jCount - win.maxJ}
        width={size.width}
        height={size.height}
        fill="#1a1714"
      />

      {windowCells(win).map(({ i, j }) => {
        const rect = cellRect(win, i, j);
        const inside = i >= 0 && j >= 0 && i < extent.iCount && j < extent.jCount;
        const key = `${i}:${j}`;
        const painted = inside ? cellFill?.({ i, j }) ?? null : null;
        const isUnclaimed = inside && unclaimedKeys.has(key);
        const isConflict = conflictKeys.has(key);

        return (
          <g key={key}>
            <rect
              x={rect.x}
              y={rect.y}
              width={1}
              height={1}
              fill={
                painted?.fill ??
                (isUnclaimed
                  ? unclaimedAreFaults
                    ? 'rgba(196,92,92,0.18)'
                    : 'rgba(74,64,54,0.28)'
                  : inside
                    ? '#241f1a'
                    : 'rgba(74,64,54,0.18)')
              }
              stroke={painted?.stroke ?? (inside ? '#4a4036' : 'rgba(74,64,54,0.55)')}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              strokeDasharray={inside ? undefined : '3 3'}
            />
            {isUnclaimed && !painted && (
              <line
                x1={rect.x}
                y1={rect.y + 1}
                x2={rect.x + 1}
                y2={rect.y}
                stroke={unclaimedAreFaults ? '#c45c5c' : 'rgba(181,168,154,0.35)'}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {/* Conflicts sit on top rather than replacing the fill: a colliding
                cell is always a claimed one, so painting over it would hide
                which tile is involved — and the red would never be seen. */}
            {isConflict && (
              <rect
                x={rect.x}
                y={rect.y}
                width={1}
                height={1}
                fill="rgba(196,92,92,0.5)"
                stroke="#c45c5c"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
            {painted?.label && (
              <text
                x={rect.x + 0.5}
                y={rect.y + 0.5}
                fill="#1a1714"
                fontSize={0.32}
                textAnchor="middle"
                dominantBaseline="central"
                pointerEvents="none"
              >
                {painted.label}
              </text>
            )}
          </g>
        );
      })}

      {/* Block outline: one slot is one cell, the block is the whole rectangle. */}
      <rect
        x={0}
        y={win.jCount - extent.jCount}
        width={extent.iCount}
        height={extent.jCount}
        fill="none"
        stroke="#b5a89a"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />

      {paintPreview && (
        <rect
          x={paintPreview.i}
          y={win.jCount - paintPreview.j - paintPreview.jSpan}
          width={paintPreview.iSpan}
          height={paintPreview.jSpan}
          fill="rgba(217,119,58,0.3)"
          stroke="#d9773a"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}

      {/* Axes layer: drawn last so it sits over the cells, and only while the
          flag is on. It is intentionally allowed to leave the grid — a generator
          usually points outside the pattern, and clipping it would hide where it
          goes. */}
      {mode === 'lattice' && (
        <g pointerEvents="none">
          {/* The repeat parallelogram: where one copy of the block lands. */}
          <polygon
            points={`${originPoint.x},${originPoint.y} ${liveUPoint.x},${liveUPoint.y} ${
              cornerPoint(win, liveU.i + liveV.i, liveU.j + liveV.j).x
            },${cornerPoint(win, liveU.i + liveV.i, liveU.j + liveV.j).y} ${liveVPoint.x},${liveVPoint.y}`}
            fill="rgba(217,119,58,0.1)"
            stroke="rgba(181,168,154,0.6)"
            strokeWidth={1}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
          {windowCorners(win).map(({ i, j }) => {
            const point = cornerPoint(win, i, j);
            return (
              <circle
                key={`c-${i}:${j}`}
                cx={point.x}
                cy={point.y}
                r={0.06}
                fill="rgba(181,168,154,0.45)"
              />
            );
          })}
          <LatticeArrow from={originPoint} to={liveUPoint} color="#d9773a" label="u" />
          <LatticeArrow from={originPoint} to={liveVPoint} color="#6f8f6a" label="v" />
        </g>
      )}

      {overlay}
    </svg>
  );
}

/**
 * Arrowheads are drawn as explicit polygons rather than `<marker>`: marker ids
 * are document-global and several of these canvases render at once for a nested
 * schema, so the ids would collide.
 */
function LatticeArrow({
  from,
  to,
  color,
  label,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  color: string;
  label: string;
}) {
  const head = arrowHead(from, to, 0.4);
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  return (
    <g>
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={color}
        strokeWidth={2.5}
        vectorEffect="non-scaling-stroke"
      />
      {head && <polygon points={head} fill={color} />}
      <circle cx={to.x} cy={to.y} r={0.18} fill={color} fillOpacity={0.35} stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <text x={midX + 0.18} y={midY - 0.18} fill={color} fontSize={0.4} fontWeight={600}>
        {label}
      </text>
    </g>
  );
}
