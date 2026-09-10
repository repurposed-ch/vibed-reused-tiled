import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  drawWindow,
  type DrawWindow,
  gridLines,
  isClosable,
  loopsBounds,
  nearestVertex,
  snapToGrid,
  type Loop,
  type Point,
} from './boundary-draw-geometry';

/**
 * Direct-manipulation boundary editor on a metric grid.
 *
 * The boundary could previously only be authored as raw JSON or one of three
 * preset rectangles, which made the L-shapes and holes the fill was built for
 * effectively unreachable.
 *
 * Draws +Y up like the rest of the app, so what you draw here matches the 2D
 * view and the tile-schema canvas. Vertices snap to the chosen resolution; the
 * drawn guides thin out when that resolution would flood the view, while
 * snapping still uses the true value.
 */

export type BoundaryDrawCanvasProps = {
  outers: Loop[];
  holes: Loop[];
  resolution: number;
  mode: 'outer' | 'hole';
  /** Which loop new vertices go to; -1 starts a fresh one. */
  activeLoop: number;
  selected: { loop: number; index: number } | null;
  onChange: (next: { outers: Loop[]; holes: Loop[] }) => void;
  onActiveLoopChange: (index: number) => void;
  onSelect: (ref: { loop: number; index: number } | null) => void;
  heightPx?: number;
};

const OUTER_FILL = 'rgba(217,119,58,0.15)';
const OUTER_STROKE = '#d9773a';
const HOLE_FILL = 'rgba(26,23,20,0.85)';
const HOLE_STROKE = '#b5a89a';

export function BoundaryDrawCanvas({
  outers,
  holes,
  resolution,
  mode,
  activeLoop,
  selected,
  onChange,
  onActiveLoopChange,
  onSelect,
  heightPx = 420,
}: BoundaryDrawCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<{ loop: number; index: number } | null>(null);
  const [hover, setHover] = useState<Point | null>(null);

  const editing = mode === 'outer' ? outers : holes;

  /**
   * The view only ever grows, and only when the drawing leaves it.
   *
   * Recomputing from the drawing's bounds on every vertex made the grid rescale
   * under the cursor as you placed points — each click moved the canvas, so the
   * next one landed somewhere else. Holding the window steady and widening it
   * only when a point would fall outside keeps the grid still while you work.
   */
  const wanted = drawWindow(loopsBounds([...outers, ...holes]), resolution);
  const held = useRef<DrawWindow | null>(null);
  const previous = held.current;
  const win: DrawWindow =
    previous == null ||
    previous.resolution !== wanted.resolution ||
    wanted.minX < previous.minX ||
    wanted.minY < previous.minY ||
    wanted.maxX > previous.maxX ||
    wanted.maxY > previous.maxY
      ? {
          // Widen to cover both, so an existing view is never cropped.
          ...wanted,
          minX: Math.min(wanted.minX, previous?.resolution === wanted.resolution ? previous.minX : wanted.minX),
          minY: Math.min(wanted.minY, previous?.resolution === wanted.resolution ? previous.minY : wanted.minY),
          maxX: Math.max(wanted.maxX, previous?.resolution === wanted.resolution ? previous.maxX : wanted.maxX),
          maxY: Math.max(wanted.maxY, previous?.resolution === wanted.resolution ? previous.maxY : wanted.maxY),
        }
      : previous;
  held.current = win;

  const spanX = win.maxX - win.minX;
  const spanY = win.maxY - win.minY;

  // Snap tolerance in metres, generous enough to grab a vertex by eye.
  const grabTolerance = Math.max(resolution * 0.6, spanX / 80);

  const toWorld = (event: ReactPointerEvent): Point | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    // Recomputed per event: the panel above can reflow mid-drag.
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    // The group is flipped, so svg y is the negation of world y.
    return { x: p.x, y: -p.y };
  };

  const commit = (nextEditing: Loop[]) => {
    onChange(mode === 'outer' ? { outers: nextEditing, holes } : { outers, holes: nextEditing });
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const world = toWorld(event);
    if (!svg || !world) return;
    svg.setPointerCapture(event.pointerId);

    const hit = nearestVertex(editing, world, grabTolerance);
    if (hit) {
      // Clicking the first vertex of the loop being drawn closes it.
      if (hit.loop === activeLoop && hit.index === 0 && isClosable(editing[hit.loop] ?? [])) {
        onActiveLoopChange(-1);
        onSelect(null);
        return;
      }
      onSelect(hit);
      setDragging(hit);
      return;
    }

    const point = snapToGrid(world, resolution);
    const next = editing.map((loop) => [...loop]);
    if (activeLoop >= 0 && next[activeLoop]) {
      next[activeLoop]!.push(point);
    } else {
      next.push([point]);
      onActiveLoopChange(next.length - 1);
    }
    commit(next);
    onSelect(null);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const world = toWorld(event);
    if (!world) return;
    setHover(snapToGrid(world, resolution));
    if (!dragging) return;

    const next = editing.map((loop) => [...loop]);
    const loop = next[dragging.loop];
    if (!loop) return;
    loop[dragging.index] = snapToGrid(world, resolution);
    commit(next);
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (svg?.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    setDragging(null);
  };

  const renderLoop = (loop: Loop, key: string, isOuter: boolean, loopIndex: number) => {
    const open = mode === (isOuter ? 'outer' : 'hole') && loopIndex === activeLoop;
    const points = loop.map((v) => `${v.x},${-v.y}`).join(' ');
    if (loop.length === 0) return null;

    return (
      <g key={key}>
        {loop.length >= 2 &&
          (open ? (
            <polyline
              points={points}
              fill="none"
              stroke={isOuter ? OUTER_STROKE : HOLE_STROKE}
              strokeWidth={2}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <polygon
              points={points}
              fill={isOuter ? OUTER_FILL : HOLE_FILL}
              stroke={isOuter ? OUTER_STROKE : HOLE_STROKE}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        {loop.map((v, index) => {
          const isSelected =
            selected != null &&
            selected.loop === loopIndex &&
            selected.index === index &&
            mode === (isOuter ? 'outer' : 'hole');
          const isCloseTarget = open && index === 0 && isClosable(loop);
          return (
            <circle
              key={index}
              cx={v.x}
              cy={-v.y}
              r={(isSelected || isCloseTarget ? 7 : 5) * (spanX / 800)}
              fill={isCloseTarget ? '#6f8f6a' : isSelected ? '#f3ebe1' : isOuter ? OUTER_STROKE : HOLE_STROKE}
              stroke="#1a1714"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </g>
    );
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`${win.minX} ${-win.maxY} ${spanX} ${spanY}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        width: '100%',
        height: `${heightPx}px`,
        touchAction: 'none',
        userSelect: 'none',
        cursor: 'crosshair',
        background: '#1a1714',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onPointerLeave={() => setHover(null)}
      role="img"
      aria-label="Boundary drawing"
    >
      <g>
        {gridLines(win.minX, win.maxX, win.lineSpacing).map((x) => (
          <line
            key={`x${x}`}
            x1={x}
            y1={-win.minY}
            x2={x}
            y2={-win.maxY}
            stroke={x === 0 ? 'rgba(181,168,154,0.5)' : 'rgba(74,64,54,0.55)'}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {gridLines(win.minY, win.maxY, win.lineSpacing).map((y) => (
          <line
            key={`y${y}`}
            x1={win.minX}
            y1={-y}
            x2={win.maxX}
            y2={-y}
            stroke={y === 0 ? 'rgba(181,168,154,0.5)' : 'rgba(74,64,54,0.55)'}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>

      {outers.map((loop, i) => renderLoop(loop, `o${i}`, true, i))}
      {holes.map((loop, i) => renderLoop(loop, `h${i}`, false, i))}

      {hover && (
        <circle
          cx={hover.x}
          cy={-hover.y}
          r={3 * (spanX / 800)}
          fill="none"
          stroke="rgba(243,235,225,0.7)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
    </svg>
  );
}
