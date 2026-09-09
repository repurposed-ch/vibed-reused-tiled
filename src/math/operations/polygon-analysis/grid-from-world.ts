import { pairwiseDifference } from '../../analysis/aggregation/pairwise-difference';
import { Frame2 } from '../../core/frame2';
import type { Epsilon } from '../../core/epsilon';
import { Vec2 } from '../../core/vec2';
import { Interval2 } from '../../bounds/interval2';
import type { Polygon2 } from '../../geometry/regions/polygon2';
import { Axis } from '../../grid/core/grid-axis';
import { GridCell2 } from '../../grid/core/grid-cell2';
import { Grid2 } from '../../grid/core/grid2';
import { GridRectangle2 } from '../../grid/regions/grid-rectangle2';

export type Grid2FromWorldResult = {
  grid: Grid2;
  /** Occupied index lattice covering columns `[0, columnCount)` and rows `[0, rowCount)`. */
  extent: GridRectangle2;
};

function mostCommonSpanSize(sizes: readonly number[], epsilon: Epsilon): number {
  if (sizes.length === 0) {
    throw new Error('buildGrid2FromWorldVertices requires at least one span');
  }

  const uniqueSizes = epsilon.clusterSortedValues([...sizes]);
  let bestSize = uniqueSizes[0]!;
  let bestCount = 0;

  for (const unique of uniqueSizes) {
    const count = sizes.filter((size) => epsilon.areEqual(size, unique)).length;

    if (count > bestCount || (count === bestCount && unique < bestSize)) {
      bestCount = count;
      bestSize = unique;
    }
  }

  return bestSize;
}

function axisFromSpans(spans: readonly number[], epsilon: Epsilon): Axis {
  const defaultSize = mostCommonSpanSize(spans, epsilon);
  const sizes: Record<number, number> = {};

  for (let index = 0; index < spans.length; index++) {
    const size = spans[index]!;
    if (!epsilon.areEqual(size, defaultSize)) {
      sizes[index] = size;
    }
  }

  const domain = new Interval2(0, spans.length - 1);
  return Object.keys(sizes).length === 0 ? Axis.uniform(defaultSize, domain) : Axis.custom(defaultSize, sizes, domain);
}

/** Build a rectilinear grid by clustering coordinates from one or more polygons. */
export function buildGrid2FromWorldPolygons(polygons: readonly Polygon2[], epsilon: Epsilon): Grid2FromWorldResult {
  if (polygons.length === 0) {
    throw new Error('buildGrid2FromWorldPolygons requires at least one polygon');
  }

  return buildGrid2FromWorldVertices(
    polygons.flatMap((polygon) => polygon.vertices),
    epsilon,
  );
}

export function buildGrid2FromWorldVertices(vertices: readonly Vec2[], epsilon: Epsilon): Grid2FromWorldResult {
  if (vertices.length === 0) {
    throw new Error('buildGrid2FromWorldVertices requires at least one vertex');
  }

  const xCoordinates = epsilon.clusterSortedValues(vertices.map((vertex) => vertex.x));
  const yCoordinates = epsilon.clusterSortedValues(vertices.map((vertex) => vertex.y));

  if (xCoordinates.length < 2 || yCoordinates.length < 2) {
    throw new Error('buildGrid2FromWorldVertices requires at least two distinct x and y coordinates');
  }

  const columnSpans = pairwiseDifference(xCoordinates);
  const rowSpans = pairwiseDifference(yCoordinates);
  const columnCount = columnSpans.length;
  const rowCount = rowSpans.length;

  const grid = new Grid2({
    u: axisFromSpans(columnSpans, epsilon),
    v: axisFromSpans(rowSpans, epsilon),
    frame: new Frame2(new Vec2(xCoordinates[0]!, yCoordinates[0]!)),
    epsilon,
  });

  return {
    grid,
    extent: new GridRectangle2(new GridCell2(0, 0), new GridCell2(columnCount - 1, rowCount - 1)),
  };
}
