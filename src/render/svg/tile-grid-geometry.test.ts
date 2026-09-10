import { describe, expect, it } from 'vitest';
import {
  canvasWindow,
  cellRect,
  clampToExtent,
  cornerPoint,
  normaliseDrag,
  pointToCell,
  pointToCorner,
  viewBox,
  windowCells,
  windowCorners,
} from '@/render/svg/tile-grid-geometry';

// Deliberately non-square: a square extent hides every jCount-vs-jCount-1 slip.
const extent = { iCount: 4, jCount: 2 };
const u = { i: 4, j: 0 };
const v = { i: 0, j: 2 };

describe('canvasWindow', () => {
  it('surrounds the block with the requested ring', () => {
    const w = canvasWindow(extent, 1, u, v);
    expect(w).toEqual({ minI: -1, maxI: 5, minJ: -1, maxJ: 3, jCount: 2 });
    expect(viewBox(w)).toBe('-1 -1 6 4');
  });

  it('stretches to contain a vector that leaves the ring', () => {
    // The staircase generators: v reaches three cells past a 4-wide block.
    const w = canvasWindow({ iCount: 4, jCount: 7 }, 1, { i: 4, j: 4 }, { i: 7, j: 1 });
    expect(w.maxI).toBe(11); // u + v = (11, 5)
    expect(w.maxJ).toBe(8);
    expect(w.minI).toBe(-1);
  });

  it('grows on the side a negative vector needs, not symmetrically', () => {
    const w = canvasWindow(extent, 1, { i: -6, j: 0 }, v);
    expect(w.minI).toBe(-6);
    expect(w.maxI).toBe(5);
  });
});

describe('cell and corner mapping', () => {
  const w = canvasWindow(extent, 1, u, v);

  it('puts the top row at the top of the viewBox', () => {
    expect(cellRect(w, 0, extent.jCount - 1)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(cellRect(w, 0, 0)).toEqual({ x: 0, y: 1, width: 1, height: 1 });
    expect(cellRect(w, 0, -1)).toEqual({ x: 0, y: 2, width: 1, height: 1 });
  });

  it('lines a cell up with the corners that bound it', () => {
    const rect = cellRect(w, 2, 0);
    // Corner (i, j) is the cell's bottom-left; (i, j+1) is its top-left.
    expect(cornerPoint(w, 2, 0)).toEqual({ x: rect.x, y: rect.y + 1 });
    expect(cornerPoint(w, 2, 1)).toEqual({ x: rect.x, y: rect.y });
  });

  it('round-trips every cell in the window through its centre', () => {
    for (const cell of windowCells(w)) {
      const rect = cellRect(w, cell.i, cell.j);
      expect(pointToCell(w, rect.x + 0.5, rect.y + 0.5)).toEqual(cell);
    }
  });

  it('round-trips every corner in the window', () => {
    for (const corner of windowCorners(w)) {
      const point = cornerPoint(w, corner.i, corner.j);
      expect(pointToCorner(w, point.x, point.y)).toEqual(corner);
    }
  });

  it('has one more corner than cell along each axis', () => {
    const cols = w.maxI - w.minI;
    const rows = w.maxJ - w.minJ;
    expect(windowCells(w)).toHaveLength(cols * rows);
    expect(windowCorners(w)).toHaveLength((cols + 1) * (rows + 1));
  });

  it('snaps a half-way point the same way above and below the axis', () => {
    // jCount - y is reduced before rounding; rounding y first would bias these
    // in opposite directions, since JS rounds .5 toward +Infinity.
    expect(pointToCorner(w, 0, 1.5).j).toBe(1);
    expect(pointToCorner(w, 0, 2.5).j).toBe(0);
    expect(pointToCorner(w, 0, 2).j).toBe(0);
  });

  it('assigns the exact top edge of a cell to that cell, not the one above', () => {
    const rect = cellRect(w, 1, 1);
    expect(pointToCell(w, rect.x, rect.y)).toEqual({ i: 1, j: 1 });
  });
});

describe('normaliseDrag', () => {
  it('is direction-independent and inclusive of both ends', () => {
    const forward = normaliseDrag({ i: 1, j: 1 }, { i: 3, j: 2 });
    const backward = normaliseDrag({ i: 3, j: 2 }, { i: 1, j: 1 });
    expect(forward).toEqual({ i: 1, j: 1, iSpan: 3, jSpan: 2 });
    expect(backward).toEqual(forward);
  });

  it('treats a press and release on one cell as a 1×1', () => {
    expect(normaliseDrag({ i: 2, j: 2 }, { i: 2, j: 2 })).toEqual({
      i: 2,
      j: 2,
      iSpan: 1,
      jSpan: 1,
    });
  });
});

describe('clampToExtent', () => {
  it('slides a footprint inside rather than shrinking it', () => {
    expect(clampToExtent(extent, 3, 0, 3, 1)).toEqual({ i: 1, j: 0 });
    expect(clampToExtent(extent, -2, -2, 2, 2)).toEqual({ i: 0, j: 0 });
  });

  it('leaves a footprint that already fits alone', () => {
    expect(clampToExtent(extent, 1, 0, 2, 2)).toEqual({ i: 1, j: 0 });
  });
});
