import { GridCell2 } from '../../grid/core/grid-cell2';
import { GridCell2Collection } from '../../grid/regions/grid-cell2-collection';
import { GridRectangle2 } from '../../grid/regions/grid-rectangle2';

/** Minimum partition of occupied cells into axis-aligned grid rectangles. */
export function decomposeOccupancyIntoRectangles(occupied: GridCell2Collection): GridRectangle2[] {
  if (occupied.size() === 0) {
    return [];
  }

  const candidates = enumerateFilledRectangles(occupied, GridRectangle2.fromVertices(occupied.toArray()));
  const covering = indexRectanglesByCell(candidates);

  return findMinimumPartition(occupied, covering);
}

function enumerateFilledRectangles(occupied: GridCell2Collection, extent: GridRectangle2): GridRectangle2[] {
  const { bottomLeft, topRight } = extent;
  const rectangles: GridRectangle2[] = [];

  for (let minI = bottomLeft.i; minI <= topRight.i; minI++) {
    for (let minJ = bottomLeft.j; minJ <= topRight.j; minJ++) {
      for (let maxI = minI; maxI <= topRight.i; maxI++) {
        for (let maxJ = minJ; maxJ <= topRight.j; maxJ++) {
          const rectangle = new GridRectangle2(new GridCell2(minI, minJ), new GridCell2(maxI, maxJ));
          if (isFullyOccupied(rectangle, occupied)) {
            rectangles.push(rectangle);
          }
        }
      }
    }
  }

  return rectangles;
}

function isFullyOccupied(rectangle: GridRectangle2, occupied: GridCell2Collection): boolean {
  for (const cell of rectangle.cells()) {
    if (!occupied.has(cell)) {
      return false;
    }
  }
  return true;
}

/** Map each cell hash to the candidate rectangles that cover it. */
function indexRectanglesByCell(rectangles: readonly GridRectangle2[]): Map<number, GridRectangle2[]> {
  const covering = new Map<number, GridRectangle2[]>();

  for (const rectangle of rectangles) {
    for (const cell of rectangle.cells()) {
      const list = covering.get(cell.hash()) ?? [];
      list.push(rectangle);
      covering.set(cell.hash(), list);
    }
  }

  return covering;
}

function findMinimumPartition(
  occupied: GridCell2Collection,
  covering: ReadonlyMap<number, readonly GridRectangle2[]>,
): GridRectangle2[] {
  let best: GridRectangle2[] | null = null;

  function search(remaining: GridCell2Collection, current: GridRectangle2[]): void {
    if (remaining.size() === 0) {
      if (!best || current.length < best.length) {
        best = [...current];
      }
      return;
    }

    if (best && current.length >= best.length) {
      return;
    }

    const seed = remaining.toArray()[0]!;
    for (const rectangle of covering.get(seed.hash()) ?? []) {
      if (!isFullyOccupied(rectangle, remaining)) {
        continue;
      }

      current.push(rectangle);
      search(remaining.subtract(rectangle.toCellCollection()), current);
      current.pop();
    }
  }

  search(occupied, []);
  return best ?? [];
}
