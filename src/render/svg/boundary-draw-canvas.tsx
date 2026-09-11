import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  cyclePick,
  drawWindow,
  gridLines,
  isClosable,
  loopsBounds,
  nearestVertex,
  orientationOf,
  ORIENTATION_STROKE,
  pickLoopsAt,
  signedArea,
  snapToGrid,
  type DrawWindow,
  type Loop,
  type Point,
} from './boundary-draw-geometry';

/**
 * Direct-manipulation boundary editor on a metric grid.
 *
 * Every loop's orientation is its role: counter-clockwise loops are solid,
 * clockwise loops are holes. The loops are coloured that way so the direction a
 * shape was traced — which decides what gets tiled — is visible at a glance.
 *
 * Two tools. **Draw** places vertices, including inside existing polygons, which
 * is how a hole is drawn inside an outline. **Select** picks whole polygons: the
 * smallest one under the click first, and clicking the same spot again steps to
 * the next one underneath. Vertices can be dragged with either tool.
 *
 * Draws +Y up like the rest of the app. Vertices snap to the chosen resolution;
 * the drawn guides thin out when that resolution would flood the view, while
 * snapping still uses the true value.
 */

export type LoopSelection =
  | { kind: 'loop'; loop: number }
  | { kind: 'vertex'; loop: number; index: number };

export type BoundaryDrawCanvasProps = {
  loops: Loop[];
  resolution: number;
  tool: 'draw' | 'select';
  /** Which loop new vertices go to; -1 starts a fresh one. */
  activeLoop: number;
  selection: LoopSelection | null;
  onChange: (loops: Loop[]) => void;
  onActiveLoopChange: (index: number) => void;
  onSelect: (selection: LoopSelection | null) => void;
  onReverse: (loop: number) => void;
  onDeleteLoop: (loop: number) => void;
  heightPx?: number;
};

const FILL = { ccw: 'rgba(217,119,58,0.14)', cw: 'rgba(91,143,199,0.16)' } as const;
const FILL_SELECTED = { ccw: 'rgba(217,119,58,0.34)', cw: 'rgba(91,143,199,0.38)' } as const;
/** A loop still being drawn has no orientation yet, so it gets no role colour. */
const NEUTRAL = '#b5a89a';

export function BoundaryDrawCanvas({
  loops,
  resolution,
  tool,
  activeLoop,
  selection,
  onChange,
  onActiveLoopChange,
  onSelect,
  onReverse,
  onDeleteLoop,
  heightPx = 420,
}: BoundaryDrawCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<{ loop: number; index: number } | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  /** Where the previous select click landed, so a second click there cycles. */
  const lastPick = useRef<Point | null>(null);

  const selectedLoop = selection != null && selection.loop < loops.length ? selection.loop : null;

  /**
   * The view only ever grows, and only when the drawing leaves it.
   *
   * Recomputing from the drawing's bounds on every vertex made the grid rescale
   * under the cursor as you placed points — each click moved the canvas, so the
   * next one landed somewhere else. Holding the window steady and widening it
   * only when a point would fall outside keeps the grid still while you work.
   */
  const wanted = drawWindow(loopsBounds(loops), resolution);
  const held = useRef<DrawWindow | null>(null);
  const previous = held.current;
  const sameStep = previous?.resolution === wanted.resolution;
  const win: DrawWindow =
    previous == null ||
    !sameStep ||
    wanted.minX < previous.minX ||
    wanted.minY < previous.minY ||
    wanted.maxX > previous.maxX ||
    wanted.maxY > previous.maxY
      ? {
          // Widen to cover both, so an existing view is never cropped.
          ...wanted,
          minX: Math.min(wanted.minX, sameStep ? previous!.minX : wanted.minX),
          minY: Math.min(wanted.minY, sameStep ? previous!.minY : wanted.minY),
          maxX: Math.max(wanted.maxX, sameStep ? previous!.maxX : wanted.maxX),
          maxY: Math.max(wanted.maxY, sameStep ? previous!.maxY : wanted.maxY),
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

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const world = toWorld(event);
    if (!svg || !world) return;
    svg.setPointerCapture(event.pointerId);
    // Focus so R and Delete reach this canvas. The key handler is scoped to the
    // canvas rather than the window: the same page has a JSON textarea, where
    // Backspace has to keep meaning backspace.
    svg.focus({ preventScroll: true });

    const open = loops[activeLoop];
    const drawing = tool === 'draw' && activeLoop >= 0 && open != null;

    // While a loop is open only its own vertices are grab targets. Other loops'
    // vertices are exactly where a new point often has to land — a hole sharing a
    // corner with the outline — and grabbing them would make that impossible.
    let hit: { loop: number; index: number } | null;
    if (drawing) {
      const own = nearestVertex([open], world, grabTolerance);
      hit = own ? { loop: activeLoop, index: own.index } : null;
    } else {
      hit = nearestVertex(loops, world, grabTolerance);
    }

    if (hit) {
      // Clicking the first vertex of the loop being drawn closes it.
      if (drawing && hit.index === 0 && isClosable(open)) {
        onActiveLoopChange(-1);
        onSelect({ kind: 'loop', loop: activeLoop });
        return;
      }
      onSelect({ kind: 'vertex', loop: hit.loop, index: hit.index });
      setDragging(hit);
      return;
    }

    if (tool === 'select') {
      const candidates = pickLoopsAt(loops, world);
      const before = lastPick.current;
      const sameSpot =
        before != null && Math.hypot(world.x - before.x, world.y - before.y) <= grabTolerance;
      // A fresh spot takes the smallest polygon under the click; the same spot
      // again steps to the next one underneath.
      const next = sameSpot ? cyclePick(candidates, selectedLoop) : (candidates[0] ?? null);
      lastPick.current = world;
      onSelect(next == null ? null : { kind: 'loop', loop: next });
      return;
    }

    const point = snapToGrid(world, resolution);
    const next = loops.map((l) => [...l]);
    if (drawing) {
      next[activeLoop]!.push(point);
    } else {
      next.push([point]);
      onActiveLoopChange(next.length - 1);
    }
    onChange(next);
    onSelect(null);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const world = toWorld(event);
    if (!world) return;
    setHover(snapToGrid(world, resolution));
    if (!dragging) return;

    const next = loops.map((l) => [...l]);
    const target = next[dragging.loop];
    if (!target) return;
    target[dragging.index] = snapToGrid(world, resolution);
    onChange(next);
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (svg?.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    setDragging(null);
  };

  const onKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    // Leave browser shortcuts alone — Cmd/Ctrl+R must still reload the page.
    if (selectedLoop == null || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      onReverse(selectedLoop);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onDeleteLoop(selectedLoop);
    }
  };

  // Larger polygons first so smaller ones — the ones picked first — sit on top,
  // and the selection last so its highlight is never hidden.
  const order = loops
    .map((_, i) => i)
    .sort((a, b) => Math.abs(signedArea(loops[b]!)) - Math.abs(signedArea(loops[a]!)));
  if (selectedLoop != null) {
    order.splice(order.indexOf(selectedLoop), 1);
    order.push(selectedLoop);
  }

  const renderLoop = (i: number) => {
    const loop = loops[i]!;
    if (loop.length === 0) return null;
    const open = tool === 'draw' && i === activeLoop;
    const closed = !open && loop.length >= 3;
    const orientation = orientationOf(loop);
    const isSelected = selectedLoop === i;
    const stroke = closed ? ORIENTATION_STROKE[orientation] : NEUTRAL;
    const points = loop.map((v) => `${v.x},${-v.y}`).join(' ');

    return (
      <g key={i}>
        {loop.length >= 2 &&
          (closed ? (
            <polygon
              points={points}
              fill={isSelected ? FILL_SELECTED[orientation] : FILL[orientation]}
              stroke={stroke}
              strokeWidth={isSelected ? 3.5 : 2}
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <polyline
              points={points}
              fill="none"
              stroke={stroke}
              strokeWidth={2}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        {loop.map((v, index) => {
          const isSelectedVertex =
            selection?.kind === 'vertex' && selection.loop === i && selection.index === index;
          const isCloseTarget = open && index === 0 && isClosable(loop);
          return (
            <circle
              key={index}
              cx={v.x}
              cy={-v.y}
              r={(isSelectedVertex || isCloseTarget ? 7 : 5) * (spanX / 800)}
              fill={isCloseTarget ? '#6f8f6a' : isSelectedVertex ? '#f3ebe1' : stroke}
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
      tabIndex={0}
      viewBox={`${win.minX} ${-win.maxY} ${spanX} ${spanY}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        width: '100%',
        height: `${heightPx}px`,
        touchAction: 'none',
        userSelect: 'none',
        cursor: tool === 'select' ? 'default' : 'crosshair',
        background: '#1a1714',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKeyDown}
      role="application"
      aria-label="Boundary drawing. With a polygon selected, R reverses it and Delete removes it."
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

      {order.map(renderLoop)}

      {hover && tool === 'draw' && (
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
