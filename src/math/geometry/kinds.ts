import type { Aabb2 } from '../bounds/aabb2';
import type { Vec2 } from '../core/vec2';
import type { Polyline2 } from './curves/polyline2';
import { Hesse2 } from './primitives/hesse2';
import type { InfiniteLine2 } from './primitives/infinite-line2';
import type { Line2 } from './primitives/line2';
import type { Ray2 } from './primitives/ray2';
import type { Circle2 } from './regions/circle2';
import type { Polygon2 } from './regions/polygon2';
import type { TriMesh2 } from './regions/tri-mesh2';

/** Bounded interiors with signed distance. */
export type Region2 = Circle2 | Polygon2 | TriMesh2;

/** Contains2 container: a region, axis-aligned box, or half-plane. */
export type Container2 = Region2 | Aabb2 | InfiniteLine2;

/** Line Like Geoemtries */
export type LineLike2 = Hesse2 | InfiniteLine2 | Ray2 | Line2;

/** Contains2 guest geometry. Axis-aligned boxes are tested via `Contains2.aabbIn`. */
export type Geometry2 = Vec2 | LineLike2 | Polyline2 | Polygon2 | Circle2 | TriMesh2 | Aabb2;
