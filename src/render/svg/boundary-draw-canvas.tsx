import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  cyclePick,
  fitView,
  gridLines,
  isClosable,
  lineSpacingFor,
  loopsBounds,
  nearestVertex,
  orientationOf,
  ORIENTATION_STROKE,
  panView,
  pickLoopsAt,
  signedArea,
  snapToGrid,
  viewBounds,
  worldAtPixel,
  zoomViewAt,
  type Loop,
  type Point,
  type View,
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
 * The view pans and zooms CAD-style, whichever tool is active: the wheel (and a
 * trackpad's scroll and pinch) zooms around the cursor, and a middle-button or
 * Space drag pans. The view is not stored; the page asks for a fit through
 * `fitKey`.
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
  /** Change it to reframe the view on the drawing. */
  fitKey: number;
  heightPx?: number;
};

const FILL = { ccw: 'rgba(217,119,58,0.14)', cw: 'rgba(91,143,199,0.16)' } as const;
const FILL_SELECTED = { ccw: 'rgba(217,119,58,0.34)', cw: 'rgba(91,143,199,0.38)' } as const;
/** A loop still being drawn has no orientation yet, so it gets no role colour. */
const NEUTRAL = '#b5a89a';

/** Grab radius in screen pixels, so vertices are as easy to hit at any zoom. */
const GRAB_PX = 8;
/** Wheel response per pixel of scroll. Pinch arrives as ctrl+wheel with much smaller deltas. */
const WHEEL_ZOOM = 0.0015;
const PINCH_ZOOM = 0.01;

type GestureLike = Event & { scale: number; clientX: number; clientY: number };

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

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
  fitKey,
  heightPx = 420,
}: BoundaryDrawCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<{ loop: number; index: number } | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  /** Where the previous select click landed, so a second click there cycles. */
  const lastPick = useRef<Point | null>(null);

  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  /** Last client position of an active pan. */
  const panFrom = useRef<{ x: number; y: number } | null>(null);
  const pointerInside = useRef(false);
  const fittedKey = useRef<number | null>(null);

  const selectedLoop = selection != null && selection.loop < loops.length ? selection.loop : null;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setSize((prev) =>
        prev?.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  // Fit once the canvas has a size, and again whenever the page bumps `fitKey`.
  // Edits do not refit: the view moving while you draw is what made clicks land
  // in the wrong place before.
  useEffect(() => {
    if (!size || fittedKey.current === fitKey) return;
    fittedKey.current = fitKey;
    setView(fitView(loopsBounds(loops), size.width, size.height, resolution));
  }, [size, fitKey, loops, resolution]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // Anchored from view state rather than the rendered viewBox, so a burst of
    // wheel events between renders still zooms about the right point.
    const zoomAt = (clientX: number, clientY: number, factor: number) => {
      const rect = svg.getBoundingClientRect();
      setView((prev) => {
        if (!prev) return prev;
        const anchor = worldAtPixel(
          prev,
          rect.width,
          rect.height,
          clientX - rect.left,
          clientY - rect.top,
        );
        return zoomViewAt(prev, anchor, factor);
      });
    };

    let gesturing = false;
    let lastScale = 1;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // Safari reports a pinch as gesture events; ignore any wheel echo of it.
      if (gesturing) return;
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? svg.clientHeight
            : 1;
      const k = event.ctrlKey ? PINCH_ZOOM : WHEEL_ZOOM;
      // Scrolling down (positive delta) zooms out.
      zoomAt(event.clientX, event.clientY, Math.exp(event.deltaY * unit * k));
    };
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gesturing = true;
      lastScale = (event as GestureLike).scale || 1;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as GestureLike;
      const ratio = gesture.scale / lastScale;
      lastScale = gesture.scale;
      // Fingers spreading (ratio above one) zoom in.
      if (ratio > 0) zoomAt(gesture.clientX, gesture.clientY, 1 / ratio);
    };
    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      gesturing = false;
    };

    // Not React's onWheel: that listener is passive, so it cannot keep the page
    // from scrolling underneath the zoom.
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('gesturestart', onGestureStart, { passive: false });
    svg.addEventListener('gesturechange', onGestureChange, { passive: false });
    svg.addEventListener('gestureend', onGestureEnd, { passive: false });
    return () => {
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('gesturestart', onGestureStart);
      svg.removeEventListener('gesturechange', onGestureChange);
      svg.removeEventListener('gestureend', onGestureEnd);
    };
  }, []);

  useEffect(() => {
    // On the window, because Space should work without first clicking the canvas
    // — but only with the pointer over it, and never while typing, so Space still
    // types a space in the JSON box on the same page.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isEditable(event.target)) return;
      if (!pointerInside.current && !panFrom.current) return;
      // Also stops the page scrolling and a focused button being pressed.
      event.preventDefault();
      setSpaceHeld(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      if (pointerInside.current && !isEditable(event.target)) event.preventDefault();
      setSpaceHeld(false);
    };
    const onBlur = () => setSpaceHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const widthPx = size?.width ?? 800;
  const heightOnScreen = size?.height ?? heightPx;
  // Before the first measurement there is no view yet; render a provisional fit.
  const active = view ?? fitView(loopsBounds(loops), widthPx, heightOnScreen, resolution);
  const bounds = viewBounds(active, widthPx, heightOnScreen);
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const lineSpacing = lineSpacingFor(Math.max(spanX, spanY), resolution);
  const mpp = active.metresPerPixel;

  const grabTolerance = GRAB_PX * mpp;

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
    if (!svg) return;

    // Panning comes first, so it never also adds a vertex or changes the selection.
    if (event.button === 1 || (event.button === 0 && spaceHeld)) {
      event.preventDefault();
      svg.setPointerCapture(event.pointerId);
      panFrom.current = { x: event.clientX, y: event.clientY };
      setPanning(true);
      setHover(null);
      return;
    }
    if (event.button !== 0) return;

    const world = toWorld(event);
    if (!world) return;
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
    const from = panFrom.current;
    if (from) {
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      panFrom.current = { x: event.clientX, y: event.clientY };
      setView((prev) => (prev ? panView(prev, dx, dy) : prev));
      return;
    }

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
    panFrom.current = null;
    setPanning(false);
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
              r={(isSelectedVertex || isCloseTarget ? 7 : 5) * mpp}
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

  const cursor = panning
    ? 'grabbing'
    : spaceHeld
      ? 'grab'
      : tool === 'select'
        ? 'default'
        : 'crosshair';

  return (
    <svg
      ref={svgRef}
      tabIndex={0}
      viewBox={`${bounds.minX} ${-bounds.maxY} ${spanX} ${spanY}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        width: '100%',
        height: `${heightPx}px`,
        touchAction: 'none',
        userSelect: 'none',
        cursor,
        background: '#1a1714',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onPointerEnter={() => {
        pointerInside.current = true;
      }}
      onPointerLeave={() => {
        pointerInside.current = false;
        setHover(null);
      }}
      // Middle-click autoscroll starts from mousedown, which pointerdown alone
      // does not cancel everywhere.
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onKeyDown={onKeyDown}
      role="application"
      aria-label="Boundary drawing. Scroll to zoom, middle-drag or Space-drag to pan. With a polygon selected, R reverses it and Delete removes it."
    >
      <g>
        {gridLines(bounds.minX, bounds.maxX, lineSpacing).map((x) => (
          <line
            key={`x${x}`}
            x1={x}
            y1={-bounds.minY}
            x2={x}
            y2={-bounds.maxY}
            stroke={x === 0 ? 'rgba(181,168,154,0.5)' : 'rgba(74,64,54,0.55)'}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {gridLines(bounds.minY, bounds.maxY, lineSpacing).map((y) => (
          <line
            key={`y${y}`}
            x1={bounds.minX}
            y1={-y}
            x2={bounds.maxX}
            y2={-y}
            stroke={y === 0 ? 'rgba(181,168,154,0.5)' : 'rgba(74,64,54,0.55)'}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>

      {order.map(renderLoop)}

      {hover && tool === 'draw' && !panning && !spaceHeld && (
        <circle
          cx={hover.x}
          cy={-hover.y}
          r={3 * mpp}
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
