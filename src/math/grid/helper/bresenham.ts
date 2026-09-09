import { GridCell2 } from '../core/grid-cell2';
import type { GridLine2 } from '../regions/grid-line2';

/** Integer Bresenham line in grid index space along a `GridLine2` segment. */
export function bresenhamLine(line: GridLine2): GridCell2[] {
  let { i, j } = line.from;
  const { i: endI, j: endJ } = line.to;
  const di = Math.abs(endI - i);
  const dj = Math.abs(endJ - j);
  const si = i < endI ? 1 : -1;
  const sj = j < endJ ? 1 : -1;
  let err = di - dj;
  const cells: GridCell2[] = [];

  for (;;) {
    cells.push(new GridCell2(i, j));
    if (i === endI && j === endJ) return cells;

    const e2 = 2 * err;
    if (e2 > -dj) {
      err -= dj;
      i += si;
    }
    if (e2 < di) {
      err += di;
      j += sj;
    }
  }
}
