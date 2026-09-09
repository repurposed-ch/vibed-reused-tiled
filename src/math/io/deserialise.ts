import { Aabb2, type Aabb2Json } from '../bounds/aabb2';
import { Interval2, type Interval2Json } from '../bounds/interval2';
import { Angle, type AngleJson } from '../core/angle';
import { Mat3, type Mat3Json } from '../core/mat3';
import { Vec2, type Vec2Json } from '../core/vec2';
import { Polyline2, type Polyline2Json } from '../geometry/curves/polyline2';
import { InfiniteLine2, type InfiniteLine2Json } from '../geometry/primitives/infinite-line2';
import { Hesse2, type Hesse2Json } from '../geometry/primitives/hesse2';
import { Line2, type Line2Json } from '../geometry/primitives/line2';
import { Ray2, type Ray2Json } from '../geometry/primitives/ray2';
import { Circle2, type Circle2Json } from '../geometry/regions/circle2';
import { Polygon2, type Polygon2Json } from '../geometry/regions/polygon2';
import { TriMesh2, type TriMesh2Json } from '../geometry/regions/tri-mesh2';
import { Frame2, type Frame2Json } from '../core/frame2';
import { GridCell2, type GridCell2Json } from '../grid/core/grid-cell2';
import { Axis, type AxisJson } from '../grid/core/grid-axis';
import { Grid2, type Grid2Json } from '../grid/core/grid2';
import { GridLine2, type GridLine2Json } from '../grid/regions/grid-line2';
import { GridPolyline2, type GridPolyline2Json } from '../grid/regions/grid-polyline2';
import { GridPolygon2, type GridPolygon2Json } from '../grid/regions/grid-polygon2';
import { GridRectangle2, type GridRectangle2Json } from '../grid/regions/grid-rectangle2';
import { GridCell2Collection, type CellCollectionJson } from '../grid/regions/grid-cell2-collection';
import { Epsilon, type EpsilonJson } from '../core/epsilon';

export type MathJson =
  | Vec2Json
  | Mat3Json
  | AngleJson
  | Line2Json
  | Ray2Json
  | InfiniteLine2Json
  | Hesse2Json
  | Polyline2Json
  | Polygon2Json
  | Interval2Json
  | Aabb2Json
  | TriMesh2Json
  | Circle2Json
  | GridCell2Json
  | Frame2Json
  | Grid2Json
  | GridLine2Json
  | GridPolyline2Json
  | GridPolygon2Json
  | GridRectangle2Json
  | CellCollectionJson
  | EpsilonJson;

export type MathValue =
  | Vec2
  | Mat3
  | Angle
  | Line2
  | Ray2
  | InfiniteLine2
  | Hesse2
  | Polyline2
  | Polygon2
  | Interval2
  | Aabb2
  | TriMesh2
  | Circle2
  | GridCell2
  | Frame2
  | Grid2
  | GridLine2
  | GridPolyline2
  | GridPolygon2
  | GridRectangle2
  | GridCell2Collection
  | Epsilon;

export class Deserialise {
  static fromJson(data: unknown): MathValue {
    if (typeof data !== 'object' || data === null || !('type' in data)) {
      throw new Error('Invalid JSON');
    }

    switch ((data as { type: string }).type) {
      case Vec2.type:
        return Deserialise.vec2(data);
      case Mat3.type:
        return Deserialise.mat3(data);
      case Angle.type:
        return Deserialise.angle(data);
      case Line2.type:
        return Deserialise.line2(data);
      case Ray2.type:
        return Deserialise.ray2(data);
      case InfiniteLine2.type:
        return Deserialise.infiniteLine2(data);
      case Hesse2.type:
        return Deserialise.Hesse2(data);
      case Polyline2.type:
        return Deserialise.polyline2(data);
      case Polygon2.type:
        return Deserialise.polygon2(data);
      case Interval2.type:
        return Deserialise.interval2(data);
      case Aabb2.type:
        return Deserialise.aabb2(data);
      case TriMesh2.type:
        return Deserialise.triMesh2(data);
      case Circle2.type:
        return Deserialise.circle2(data);
      case GridCell2.type:
        return Deserialise.gridCell2(data);
      case Frame2.type:
        return Deserialise.frame2(data);
      case Grid2.type:
        return Deserialise.grid2(data);
      case GridLine2.type:
        return Deserialise.gridLine2(data);
      case GridPolyline2.type:
        return Deserialise.gridPolyline2(data);
      case GridPolygon2.type:
        return Deserialise.gridPolygon2(data);
      case GridRectangle2.type:
        return Deserialise.gridRectangle2(data);
      case GridCell2Collection.type:
        return Deserialise.gridCell2Collection(data);
      case Epsilon.type:
        return Deserialise.epsilon(data);
      default:
        throw new Error(`Unknown type: ${(data as { type: string }).type}`);
    }
  }

  static deserialise(json: string): MathValue {
    return Deserialise.fromJson(JSON.parse(json));
  }

  static vec2(data: unknown): Vec2 {
    if (!isVec2Json(data)) {
      throw new Error('Invalid Vec2 JSON');
    }

    return new Vec2(data.x, data.y);
  }

  static mat3(data: unknown): Mat3 {
    if (!isMat3Json(data)) {
      throw new Error('Invalid Mat3 JSON');
    }

    const [m00, m10, m20, m01, m11, m21, m02, m12, m22] = data.elements;
    return new Mat3(m00, m01, m02, m10, m11, m12, m20, m21, m22);
  }

  static angle(data: unknown): Angle {
    if (!isAngleJson(data)) {
      throw new Error('Invalid Angle JSON');
    }

    return new Angle(data.value, data.domainKind, data.precision);
  }

  static line2(data: unknown): Line2 {
    if (!isLine2Json(data)) {
      throw new Error('Invalid Line2 JSON');
    }

    return new Line2(Deserialise.vec2(data.from), Deserialise.vec2(data.to));
  }

  static ray2(data: unknown): Ray2 {
    if (!isRay2Json(data)) {
      throw new Error('Invalid Ray2 JSON');
    }

    return new Ray2(Deserialise.vec2(data.start), Deserialise.vec2(data.direction));
  }

  static infiniteLine2(data: unknown): InfiniteLine2 {
    if (!isInfiniteLine2Json(data)) {
      throw new Error('Invalid InfiniteLine2 JSON');
    }

    return new InfiniteLine2(Deserialise.vec2(data.through), Deserialise.vec2(data.direction));
  }

  static Hesse2(data: unknown): Hesse2 {
    if (!isHesse2Json(data)) {
      throw new Error('Invalid Hesse2 JSON');
    }

    return new Hesse2(Deserialise.vec2(data.normal), data.offset);
  }

  static polyline2(data: unknown): Polyline2 {
    if (!isPolyline2Json(data)) {
      throw new Error('Invalid Polyline2 JSON');
    }

    return new Polyline2(data.vertices.map((v) => Deserialise.vec2(v)));
  }

  static polygon2(data: unknown): Polygon2 {
    if (!isPolygon2Json(data)) {
      throw new Error('Invalid Polygon2 JSON');
    }

    return new Polygon2(data.vertices.map((v) => Deserialise.vec2(v)));
  }

  static interval2(data: unknown): Interval2 {
    if (!isInterval2Json(data)) {
      throw new Error('Invalid Interval2 JSON');
    }

    return new Interval2(data.min, data.max);
  }

  static aabb2(data: unknown): Aabb2 {
    if (!isAabb2Json(data)) {
      throw new Error('Invalid Aabb2 JSON');
    }

    return new Aabb2(Deserialise.interval2(data.x), Deserialise.interval2(data.y));
  }

  static triMesh2(data: unknown): TriMesh2 {
    if (!isTriMesh2Json(data)) {
      throw new Error('Invalid TriMesh2 JSON');
    }

    return new TriMesh2(
      data.vertices.map((v) => Deserialise.vec2(v)),
      data.triangles.map(([a, b, c]) => [a, b, c]),
    );
  }

  static circle2(data: unknown): Circle2 {
    if (!isCircle2Json(data)) {
      throw new Error('Invalid Circle2 JSON');
    }

    return new Circle2(Deserialise.vec2(data.center), data.radius);
  }

  static gridCell2(data: unknown): GridCell2 {
    if (!isGridCell2Json(data)) {
      throw new Error('Invalid GridCell2 JSON');
    }

    return new GridCell2(data.i, data.j);
  }

  static frame2(data: unknown): Frame2 {
    if (!isFrame2Json(data)) {
      throw new Error('Invalid Frame2 JSON');
    }

    return new Frame2(Deserialise.vec2(data.origin), Deserialise.vec2(data.xAxis), Deserialise.vec2(data.yAxis));
  }

  static axis(data: unknown): Axis {
    if (!isAxisJson(data)) {
      throw new Error('Invalid Axis JSON');
    }

    const domain = data.domain ? Deserialise.interval2(data.domain) : null;

    switch (data.kind) {
      case 'unit':
        return Axis.unit(domain);
      case 'uniform':
        return Axis.uniform(data.size, domain);
      case 'custom':
        return Axis.custom(data.defaultSize, data.sizes as Record<number, number>, domain);
    }
  }

  static grid2(data: unknown): Grid2 {
    if (!isGrid2Json(data)) {
      throw new Error('Invalid Grid2 JSON');
    }

    return new Grid2({
      u: Deserialise.axis(data.u),
      v: Deserialise.axis(data.v),
    });
  }

  static gridLine2(data: unknown): GridLine2 {
    if (!isGridLine2Json(data)) {
      throw new Error('Invalid GridLine2 JSON');
    }

    return new GridLine2(Deserialise.gridCell2(data.from), Deserialise.gridCell2(data.to));
  }

  static gridPolyline2(data: unknown): GridPolyline2 {
    if (!isGridPolyline2Json(data)) {
      throw new Error('Invalid GridPolyline2 JSON');
    }

    return new GridPolyline2(data.vertices.map((v) => Deserialise.gridCell2(v)));
  }

  static gridPolygon2(data: unknown): GridPolygon2 {
    if (!isGridPolygon2Json(data)) {
      throw new Error('Invalid GridPolygon2 JSON');
    }

    return new GridPolygon2(data.vertices.map((v) => Deserialise.gridCell2(v)));
  }

  static gridRectangle2(data: unknown): GridRectangle2 {
    if (!isGridRectangle2Json(data)) {
      throw new Error('Invalid GridRectangle2 JSON');
    }

    return new GridRectangle2(Deserialise.gridCell2(data.bottomLeft), Deserialise.gridCell2(data.topRight));
  }

  static gridCell2Collection(data: unknown): GridCell2Collection {
    if (!isCellCollectionJson(data)) {
      throw new Error('Invalid CellCollection JSON');
    }

    return new GridCell2Collection(data.cells.map((cell) => Deserialise.gridCell2(cell)));
  }

  static epsilon(data: unknown): Epsilon {
    if (!isEpsilonJson(data)) {
      throw new Error('Invalid Epsilon JSON');
    }

    return Epsilon.custom(data.value);
  }
}

function isVec2Json(data: unknown): data is Vec2Json {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Vec2Json).type === Vec2.type &&
    typeof (data as Vec2Json).x === 'number' &&
    typeof (data as Vec2Json).y === 'number'
  );
}

function isMat3Json(data: unknown): data is Mat3Json {
  if (typeof data !== 'object' || data === null || (data as Mat3Json).type !== Mat3.type) {
    return false;
  }

  const elements = (data as Mat3Json).elements;
  return Array.isArray(elements) && elements.length === 9 && elements.every((n) => typeof n === 'number');
}

function isAngleJson(data: unknown): data is AngleJson {
  if (typeof data !== 'object' || data === null || (data as AngleJson).type !== Angle.type) {
    return false;
  }

  const angle = data as AngleJson;
  return (
    (typeof angle.value === 'number' &&
      typeof angle.precision === 'number' &&
      typeof angle.domainKind === 'string' &&
      angle.domainKind === 'tau') ||
    angle.domainKind === 'pi'
  );
}

function isLine2Json(data: unknown): data is Line2Json {
  return typeof data === 'object' && data !== null && (data as Line2Json).type === Line2.type;
}

function isRay2Json(data: unknown): data is Ray2Json {
  return typeof data === 'object' && data !== null && (data as Ray2Json).type === Ray2.type;
}

function isInfiniteLine2Json(data: unknown): data is InfiniteLine2Json {
  return typeof data === 'object' && data !== null && (data as InfiniteLine2Json).type === InfiniteLine2.type;
}

function isHesse2Json(data: unknown): data is Hesse2Json {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Hesse2Json).type === Hesse2.type &&
    typeof (data as Hesse2Json).offset === 'number'
  );
}

function isPolyline2Json(data: unknown): data is Polyline2Json {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Polyline2Json).type === Polyline2.type &&
    Array.isArray((data as Polyline2Json).vertices)
  );
}

function isPolygon2Json(data: unknown): data is Polygon2Json {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Polygon2Json).type === Polygon2.type &&
    Array.isArray((data as Polygon2Json).vertices)
  );
}

function isInterval2Json(data: unknown): data is Interval2Json {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Interval2Json).type === Interval2.type &&
    typeof (data as Interval2Json).min === 'number' &&
    typeof (data as Interval2Json).max === 'number'
  );
}

function isAabb2Json(data: unknown): data is Aabb2Json {
  if (typeof data !== 'object' || data === null || (data as Aabb2Json).type !== Aabb2.type) {
    return false;
  }

  const box = data as Aabb2Json;
  return isInterval2Json(box.x) && isInterval2Json(box.y);
}

function isTriangleIndices(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    typeof value[2] === 'number'
  );
}

function isTriMesh2Json(data: unknown): data is TriMesh2Json {
  if (typeof data !== 'object' || data === null || (data as TriMesh2Json).type !== TriMesh2.type) {
    return false;
  }

  const mesh = data as TriMesh2Json;
  return Array.isArray(mesh.vertices) && Array.isArray(mesh.triangles) && mesh.triangles.every(isTriangleIndices);
}

function isCircle2Json(data: unknown): data is Circle2Json {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Circle2Json).type === Circle2.type &&
    typeof (data as Circle2Json).radius === 'number'
  );
}

function isGridCell2Json(data: unknown): data is GridCell2Json {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as GridCell2Json).type === GridCell2.type &&
    typeof (data as GridCell2Json).i === 'number' &&
    typeof (data as GridCell2Json).j === 'number'
  );
}

function isFrame2Json(data: unknown): data is Frame2Json {
  return typeof data === 'object' && data !== null && (data as Frame2Json).type === Frame2.type;
}

function isAxisJson(data: unknown): data is AxisJson {
  if (typeof data !== 'object' || data === null || !('kind' in data)) {
    return false;
  }

  const axis = data as AxisJson;
  switch (axis.kind) {
    case 'unit':
      return axis.domain === undefined || isInterval2Json(axis.domain);
    case 'uniform':
      return typeof axis.size === 'number' && (axis.domain === undefined || isInterval2Json(axis.domain));
    case 'custom':
      return (
        typeof axis.defaultSize === 'number' &&
        typeof axis.sizes === 'object' &&
        axis.sizes !== null &&
        (axis.domain === undefined || isInterval2Json(axis.domain))
      );
    default:
      return false;
  }
}

function isGrid2Json(data: unknown): data is Grid2Json {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Grid2Json).type === Grid2.type &&
    typeof (data as Grid2Json).u === 'object' &&
    (data as Grid2Json).u !== null &&
    typeof (data as Grid2Json).v === 'object' &&
    (data as Grid2Json).v !== null
  );
}

function isGridLine2Json(data: unknown): data is GridLine2Json {
  return typeof data === 'object' && data !== null && (data as GridLine2Json).type === GridLine2.type;
}

function isGridPolyline2Json(data: unknown): data is GridPolyline2Json {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as GridPolyline2Json).type === GridPolyline2.type &&
    Array.isArray((data as GridPolyline2Json).vertices)
  );
}

function isGridPolygon2Json(data: unknown): data is GridPolygon2Json {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as GridPolygon2Json).type === GridPolygon2.type &&
    Array.isArray((data as GridPolygon2Json).vertices)
  );
}

function isGridRectangle2Json(data: unknown): data is GridRectangle2Json {
  return typeof data === 'object' && data !== null && (data as GridRectangle2Json).type === GridRectangle2.type;
}

function isCellCollectionJson(data: unknown): data is CellCollectionJson {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as CellCollectionJson).type === GridCell2Collection.type &&
    Array.isArray((data as CellCollectionJson).cells)
  );
}

function isEpsilonJson(data: unknown): data is EpsilonJson {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as EpsilonJson).type === Epsilon.type &&
    typeof (data as EpsilonJson).value === 'number'
  );
}
