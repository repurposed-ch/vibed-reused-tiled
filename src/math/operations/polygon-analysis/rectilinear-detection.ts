import type { Epsilon } from '../../core/epsilon';
import type { Polygon2 } from '../../geometry/regions/polygon2';
import {
  DOUGLAS_PEUCKER_GRID_DEFAULTS,
  douglasPeucker,
  resolveDouglasPeuckerTolerances,
  type DouglasPeuckerTolerances,
} from '../douglas-peucker';
import { GridCell2 } from '../../grid/core/grid-cell2';
import { GridCell2Collection } from '../../grid/regions/grid-cell2-collection';
import { GridPolygon2 } from '../../grid/regions/grid-polygon2';
import { GridRectangle2 } from '../../grid/regions/grid-rectangle2';
import { buildGrid2FromWorldPolygons, type Grid2FromWorldResult } from './grid-from-world';
import {
  axisDirection,
  directionDelta,
  ensureAxisAlignedPolygonPath,
  isAxisAlignedPolygonPath,
} from './grid-polygon-path';
import { decomposeOccupancyIntoRectangles } from './rectangle-decomposition';

export type { Grid2FromWorldResult } from './grid-from-world';

export type RectilinearGridDetectionOptions = {
  /** When set, simplify each world polygon before grid construction. */
  simplify?: boolean | DouglasPeuckerTolerances;
};

export type RectilinearGridDetection = Grid2FromWorldResult & {
  /** One axis-aligned grid boundary per non-empty source polygon. */
  gridPolygons: GridPolygon2[];
  /** Minimum rectangle cover of the union of occupied cells. */
  rectangles: GridRectangle2[];
  sourcePolygons: Polygon2[];
};

/**
 * Build a shared rectilinear grid from one or more world polygons, occupy cells whose
 * centers lie in any polygon, trace a grid boundary per polygon, and decompose the
 * union occupancy into rectangles.
 */
export function detectRectilinearGridFromPolygons(
  polygons: readonly Polygon2[],
  coordinateEpsilon: Epsilon,
  options: RectilinearGridDetectionOptions = {},
): RectilinearGridDetection {
  coordinateEpsilon.isPositive('operations - polygon analysis', 'detectRectilinearGridFromPolygons');

  if (polygons.length === 0) {
    throw new Error('detectRectilinearGridFromPolygons requires at least one polygon');
  }

  const simplifyTolerances = resolveDouglasPeuckerTolerances(options.simplify);
  const sourcePolygons = polygons.map((polygon) =>
    simplifyTolerances ? douglasPeucker(polygon, simplifyTolerances) : polygon,
  );

  const { grid, extent } = buildGrid2FromWorldPolygons(sourcePolygons, coordinateEpsilon);
  const extentCells = extent.toCellCollection();

  const occupiedByPolygon = sourcePolygons.map((polygon) =>
    extentCells.filter((cell) => polygon.containsPoint(grid.cellWorldCenter(cell))),
  );
  const occupied =
    occupiedByPolygon.length === 1 ? occupiedByPolygon[0]! : GridCell2Collection.union(...occupiedByPolygon);

  const gridPolygons = occupiedByPolygon
    .filter((cells) => cells.size() > 0)
    .map((cells) => buildGridPolygon(cells, extent));
  const rectangles = decomposeOccupancyIntoRectangles(occupied);

  return {
    grid,
    extent,
    gridPolygons,
    rectangles,
    sourcePolygons,
  };
}

/** Convenience wrapper for a single footprint. */
export function detectRectilinearGridFromPolygon(
  polygon: Polygon2,
  coordinateEpsilon: Epsilon,
  options: RectilinearGridDetectionOptions = {},
): RectilinearGridDetection {
  return detectRectilinearGridFromPolygons([polygon], coordinateEpsilon, options);
}

function buildGridPolygon(occupied: GridCell2Collection, extent: GridRectangle2): GridPolygon2 {
  const start = findBoundaryStartCell(occupied, extent);
  if (!start) {
    throw new Error('Rectilinear polygon did not produce any occupied grid cells');
  }

  let vertices = traceAxisAlignedBoundaryCells(start, occupied, extent);
  if (vertices.length < 3) {
    return gridPolygonForBounds(GridRectangle2.fromVertices(occupied.toArray()));
  }

  vertices = ensureAxisAlignedPolygonPath(vertices);

  if (!isAxisAlignedPolygonPath(vertices)) {
    throw new Error('Grid polygon path contains non axis-aligned steps');
  }

  if (vertices.length < 3) {
    return gridPolygonForBounds(new GridRectangle2(vertices[0]!, vertices[0]!));
  }

  return new GridPolygon2(vertices);
}

function gridPolygonForBounds(bounds: GridRectangle2): GridPolygon2 {
  if (bounds.bottomLeft.equals(bounds.topRight)) {
    const cell = bounds.bottomLeft;
    return new GridPolygon2([cell, cell, cell]);
  }

  return bounds.gridPolygon();
}

function findBoundaryStartCell(occupied: GridCell2Collection, extent: GridRectangle2): GridCell2 | null {
  const cells = occupied.toArray().sort((a, b) => a.j - b.j || a.i - b.i);

  for (const cell of cells) {
    if (isBoundaryCell(cell, occupied, extent)) {
      return cell;
    }
  }

  return null;
}

function isBoundaryCell(cell: GridCell2, occupied: GridCell2Collection, extent: GridRectangle2): boolean {
  if (!occupied.has(cell)) {
    return false;
  }

  for (const neighbor of cell.neighbors(1, 'vonNeumann')) {
    if (!extent.contains(neighbor) || !occupied.has(neighbor)) {
      return true;
    }
  }

  return false;
}

function traceAxisAlignedBoundaryCells(
  start: GridCell2,
  occupied: GridCell2Collection,
  extent: GridRectangle2,
): GridCell2[] {
  const vertices: GridCell2[] = [start.clone()];
  let current = start;
  let previousDirection = 2;
  const guardLimit = occupied.size() * 4;

  for (let guard = 0; guard < guardLimit; guard++) {
    const next = nextAxisAlignedBoundaryCell(current, previousDirection, occupied, extent);
    if (!next) {
      break;
    }

    if (next.cell.equals(start) && vertices.length > 2) {
      break;
    }

    if (!vertices[vertices.length - 1]!.equals(next.cell)) {
      vertices.push(next.cell);
    }

    previousDirection = next.direction;
    current = next.cell;
  }

  return vertices;
}

function nextAxisAlignedBoundaryCell(
  current: GridCell2,
  previousDirection: number,
  occupied: GridCell2Collection,
  extent: GridRectangle2,
): { cell: GridCell2; direction: number } | null {
  for (let step = 0; step < 4; step++) {
    const direction = (previousDirection + 3 + step) % 4;
    const candidate = current.add(directionDelta(direction));

    if (!extent.contains(candidate) || !isBoundaryCell(candidate, occupied, extent)) {
      continue;
    }

    const directionFromCurrent = axisDirection(current, candidate);
    if (directionFromCurrent === null) {
      continue;
    }

    return { cell: candidate, direction: directionFromCurrent };
  }

  return null;
}

export { DOUGLAS_PEUCKER_GRID_DEFAULTS, isAxisAlignedPolygonPath };
