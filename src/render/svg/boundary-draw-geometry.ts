/**
 * Screen mapping and snapping for the boundary draw canvas.
 *
 * Metric, unlike the tile-grid canvas: a point here is metres in world space,
 * not a cell index, and the grid is whatever resolution the user picked. Kept
 * apart from the React component so the arithmetic is testable without a DOM.
 *
 * Everything is authored +Y up, matching the CAD convention the renderers use.
 */

export type Point = { x: number; y: number };

/** One closed ring of vertices. Three or more make a polygon. */
export type Loop = Point[];

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export type DrawWindow = Bounds & {
  resolution: number;
  /** Grid lines are drawn at this spacing; coarser than `resolution` when dense. */
  lineSpacing: number;
};

/** Below three vertices there is no polygon — `Polygon2` rejects it outright. */
export const MIN_LOOP_VERTICES = 3;

/** Beyond this many lines per axis the grid reads as a solid block, so it thins out. */
const MAX_GRID_LINES = 160;

const EPSILON = 1e-9;

/** Rounding near the origin yields -0, which stores and compares badly. */
function zero(n: number): number {
  return n === 0 ? 0 : n;
}

export function snapToGrid(point: Point, resolution: number): Point {
  if (!(resolution > EPSILON)) return { x: point.x, y: point.y };
  return {
    x: zero(Math.round(point.x / resolution) * resolution),
    y: zero(Math.round(point.y / resolution) * resolution),
  };
}

export function pointsEqual(a: Point, b: Point, tolerance = 1e-6): boolean {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

export function loopsBounds(loops: readonly Loop[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const loop of loops) {
    for (const v of loop) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }
  }

  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Visible area: the drawing, plus room around it to extend into, snapped out to
 * whole grid steps and never smaller than `minSpan`.
 *
 * `lineSpacing` protects the render. At 0.01 m across 20 m a full grid is 2000
 * lines per axis, which paints as a solid field and costs thousands of nodes, so
 * the spacing steps up to a multiple of the resolution once it gets that dense.
 * Snapping still uses the true resolution — only the drawn guides thin out.
 */
export function drawWindow(
  bounds: Bounds | null,
  resolution: number,
  minSpan = 6,
): DrawWindow {
  const step = resolution > EPSILON ? resolution : 0.1;
  const margin = Math.max(step * 4, minSpan / 6);

  const raw: Bounds = bounds
    ? {
        minX: bounds.minX - margin,
        minY: bounds.minY - margin,
        maxX: bounds.maxX + margin,
        maxY: bounds.maxY + margin,
      }
    : { minX: -margin, minY: -margin, maxX: minSpan, maxY: minSpan * 0.75 };

  // Always include the origin: every preset and the fill's own frame start there,
  // so losing sight of it makes a drawing hard to place.
  const withOrigin: Bounds = {
    minX: Math.min(raw.minX, 0),
    minY: Math.min(raw.minY, 0),
    maxX: Math.max(raw.maxX, 0),
    maxY: Math.max(raw.maxY, 0),
  };

  const snapped: Bounds = {
    minX: Math.floor(withOrigin.minX / step) * step,
    minY: Math.floor(withOrigin.minY / step) * step,
    maxX: Math.ceil(withOrigin.maxX / step) * step,
    maxY: Math.ceil(withOrigin.maxY / step) * step,
  };

  const spanX = Math.max(snapped.maxX - snapped.minX, step);
  const spanY = Math.max(snapped.maxY - snapped.minY, step);
  const lines = Math.max(spanX, spanY) / step;
  const factor = lines > MAX_GRID_LINES ? Math.ceil(lines / MAX_GRID_LINES) : 1;

  return { ...snapped, resolution: step, lineSpacing: step * factor };
}

/** Grid coordinates along one axis, inclusive of both ends. */
export function gridLines(from: number, to: number, spacing: number): number[] {
  if (!(spacing > EPSILON)) return [];
  const out: number[] = [];
  const start = Math.ceil(from / spacing - EPSILON);
  const end = Math.floor(to / spacing + EPSILON);
  for (let n = start; n <= end; n += 1) out.push(zero(n * spacing));
  return out;
}

export type VertexRef = { loop: number; index: number };

/** Nearest vertex within `tolerance` metres, or null. Used for grab and close. */
export function nearestVertex(
  loops: readonly Loop[],
  point: Point,
  tolerance: number,
): VertexRef | null {
  let best: VertexRef | null = null;
  let bestDistance = tolerance;

  loops.forEach((loop, loopIndex) => {
    loop.forEach((vertex, index) => {
      const distance = Math.hypot(vertex.x - point.x, vertex.y - point.y);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = { loop: loopIndex, index };
      }
    });
  });

  return best;
}

/** A loop is closable once clicking its first vertex would make a polygon. */
export function isClosable(loop: Loop): boolean {
  return loop.length >= MIN_LOOP_VERTICES;
}

/** Signed area; positive is counter-clockwise. Used to report winding. */
export function signedArea(loop: Loop): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** `Polygon2` JSON for a loop, or null when it has too few vertices to be one. */
export function loopToPolygonJson(loop: Loop): { type: string; vertices: unknown[] } | null {
  if (loop.length < MIN_LOOP_VERTICES) return null;
  return {
    type: 'Polygon2',
    vertices: loop.map((v) => ({ type: 'Vec2', x: v.x, y: v.y })),
  };
}

/** Vertices of a stored geometry blob, for the two shapes the app draws. */
export function polygonJsonToLoop(geometry: unknown): Loop {
  const g = geometry as { type?: string; vertices?: unknown; min?: Point; max?: Point };
  if (g?.type === 'Polygon2' && Array.isArray(g.vertices)) {
    return (g.vertices as Point[])
      .filter((v) => typeof v?.x === 'number' && typeof v?.y === 'number')
      .map((v) => ({ x: v.x, y: v.y }));
  }
  if (g?.type === 'Aabb2' && g.min && g.max) {
    return [
      { x: g.min.x, y: g.min.y },
      { x: g.max.x, y: g.min.y },
      { x: g.max.x, y: g.max.y },
      { x: g.min.x, y: g.max.y },
    ];
  }
  return [];
}
