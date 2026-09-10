import type { IntVec2 } from '@/domain/tile-grid';

/**
 * Screen mapping for the tile-grid canvas.
 *
 * Kept apart from the React component so the coordinate math is unit-testable
 * without a DOM. The canvas draws +J upward (CAD convention, and the way the
 * schema indexes cells from the bottom left) while SVG y runs down, so every
 * mapping below carries that inversion.
 *
 * A ring of `pad` cells surrounds the extent so lattice vectors can be drawn
 * outside the pattern — which they must be, since a staircase repeat needs
 * generators that leave the pattern's own box. The ring is the interactive area
 * and nothing else feeds the window: the vectors deliberately do *not* stretch
 * it, because a long generator would otherwise shrink every cell to fit. The
 * axes are drawn unclipped on top instead, so a vector reaching past the ring is
 * still visible; growing the ring is what brings its tip back in reach.
 *
 * The window's origin goes into the viewBox and nowhere else, so `pad` cannot
 * desynchronise the drawing from the hit-testing.
 */

export type Extent = { iCount: number; jCount: number };

export type CanvasWindow = {
  minI: number;
  maxI: number;
  minJ: number;
  maxJ: number;
  /** Row count of the extent; every y mapping is relative to its top. */
  jCount: number;
};

export type Rect = { x: number; y: number; width: number; height: number };

export function canvasWindow(extent: Extent, pad: number): CanvasWindow {
  return {
    minI: -pad,
    maxI: extent.iCount + pad,
    minJ: -pad,
    maxJ: extent.jCount + pad,
    jCount: extent.jCount,
  };
}

export function viewBox(w: CanvasWindow): string {
  return `${w.minI} ${w.jCount - w.maxJ} ${w.maxI - w.minI} ${w.maxJ - w.minJ}`;
}

export function viewBoxSize(w: CanvasWindow): { width: number; height: number } {
  return { width: w.maxI - w.minI, height: w.maxJ - w.minJ };
}

/** Unit rect of cell (i, j) in svg user units. */
export function cellRect(w: CanvasWindow, i: number, j: number): Rect {
  return { x: i, y: w.jCount - 1 - j, width: 1, height: 1 };
}

/** Lattice corner (ci, cj) — the *vertex*, one more of them per axis than cells. */
export function cornerPoint(w: CanvasWindow, ci: number, cj: number): { x: number; y: number } {
  return { x: ci, y: w.jCount - cj };
}

/** `Math.round` and `Math.floor` both yield -0 near the origin, which compares unequal to 0. */
function zero(n: number): number {
  return n === 0 ? 0 : n;
}

/** Inverse of {@link cellRect}: which cell contains this svg point. */
export function pointToCell(w: CanvasWindow, x: number, y: number): IntVec2 {
  return { i: zero(Math.floor(x)), j: zero(w.jCount - 1 - Math.floor(y)) };
}

/**
 * Nearest lattice corner to an svg point.
 *
 * `jCount - y` is reduced before rounding rather than after: JS rounds .5 toward
 * +Infinity, so rounding first and subtracting biases snapping in opposite
 * directions above and below the axis.
 */
export function pointToCorner(w: CanvasWindow, x: number, y: number): IntVec2 {
  return { i: zero(Math.round(x)), j: zero(Math.round(w.jCount - y)) };
}

export function isInsideExtent(extent: Extent, i: number, j: number): boolean {
  return i >= 0 && j >= 0 && i < extent.iCount && j < extent.jCount;
}

/** Every cell of the window, ring included, top row first (svg draw order). */
export function windowCells(w: CanvasWindow): IntVec2[] {
  const cells: IntVec2[] = [];
  for (let j = w.maxJ - 1; j >= w.minJ; j -= 1) {
    for (let i = w.minI; i < w.maxI; i += 1) cells.push({ i, j });
  }
  return cells;
}

/** Every lattice corner of the window — inclusive on both ends, so cells + 1 per axis. */
export function windowCorners(w: CanvasWindow): IntVec2[] {
  const corners: IntVec2[] = [];
  for (let j = w.minJ; j <= w.maxJ; j += 1) {
    for (let i = w.minI; i <= w.maxI; i += 1) corners.push({ i, j });
  }
  return corners;
}

/** Normalise a two-corner drag into an origin plus a positive span. */
export function normaliseDrag(
  a: IntVec2,
  b: IntVec2,
): { i: number; j: number; iSpan: number; jSpan: number } {
  const i = Math.min(a.i, b.i);
  const j = Math.min(a.j, b.j);
  return {
    i,
    j,
    iSpan: Math.abs(a.i - b.i) + 1,
    jSpan: Math.abs(a.j - b.j) + 1,
  };
}

/**
 * Slide a fixed footprint so it sits fully inside the extent.
 *
 * The span is fixed by the tile's real size, so an origin near the edge is moved
 * rather than the footprint being trimmed — a trimmed footprint would claim
 * fewer cells than the tile actually covers and leave a gap the validators
 * cannot see.
 */
export function clampToExtent(
  extent: Extent,
  i: number,
  j: number,
  iSpan: number,
  jSpan: number,
): IntVec2 {
  return {
    i: Math.max(0, Math.min(i, extent.iCount - iSpan)),
    j: Math.max(0, Math.min(j, extent.jCount - jSpan)),
  };
}

/** Arrowhead triangle for a lattice vector, in svg units, pointing along the vector. */
export function arrowHead(
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return '';
  const ux = dx / len;
  const uy = dy / len;
  const bx = to.x - ux * size;
  const by = to.y - uy * size;
  const px = -uy * size * 0.45;
  const py = ux * size * 0.45;
  return `${to.x},${to.y} ${bx + px},${by + py} ${bx - px},${by - py}`;
}
