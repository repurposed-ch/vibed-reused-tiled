import type { GridCell2Collection } from './grid-cell2-collection';
import type { GridLine2 } from './grid-line2';
import type { GridPolygon2 } from './grid-polygon2';
import type { GridPolyline2 } from './grid-polyline2';
import type { GridRectangle2 } from './grid-rectangle2';

export type GridGeometry2 = GridLine2 | GridPolyline2 | GridPolygon2 | GridRectangle2 | GridCell2Collection;
