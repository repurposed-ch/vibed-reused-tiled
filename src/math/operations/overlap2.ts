import { Aabb2 } from '../bounds/aabb2';
import { Interval2 } from '../bounds/interval2';
import { Epsilon } from '../core/epsilon';
import { Vec2 } from '../core/vec2';
import { Polyline2 } from '../geometry/curves/polyline2';
import { Hesse2 } from '../geometry/primitives/hesse2';
import { InfiniteLine2 } from '../geometry/primitives/infinite-line2';
import { Line2 } from '../geometry/primitives/line2';
import { Ray2 } from '../geometry/primitives/ray2';
import { Circle2 } from '../geometry/regions/circle2';
import type { Container2, Geometry2 } from '../geometry/kinds';
import { Polygon2 } from '../geometry/regions/polygon2';
import { TriMesh2 } from '../geometry/regions/tri-mesh2';
import { intersectionLines } from './intersection/line2-like';

export type { Geometry2 } from '../geometry/kinds';

type LineLike2 = InfiniteLine2 | Ray2 | Line2;

/**
 * True when `a` and `b` share at least one point.
 * Touching counts as overlap with `Epsilon.preferIn`; `Epsilon.preferOut` requires proper overlap.
 */
export class Overlap2 {
  static overlaps(a: Geometry2, b: Geometry2, slack: Epsilon = Epsilon.preferIn): boolean {
    if (!(a instanceof InfiniteLine2 || b instanceof InfiniteLine2)) {
      if (!aabbOverlap(geometryAabb(a), geometryAabb(b), slack)) {
        return false;
      }
    }

    return overlapPair(a, b, slack);
  }
}

function overlapPair(a: Geometry2, b: Geometry2, slack: Epsilon): boolean {
  if (a instanceof InfiniteLine2 && !(b instanceof InfiniteLine2)) {
    return overlapsHalfPlane(a, b, slack);
  }
  if (b instanceof InfiniteLine2 && !(a instanceof InfiniteLine2)) {
    return overlapsHalfPlane(b, a, slack);
  }

  if (a instanceof Vec2) {
    return overlapsPoint(a, b, slack);
  }
  if (b instanceof Vec2) {
    return overlapsPoint(b, a, slack);
  }

  if (isLineLike(a) && isLineLike(b)) {
    return overlapsLineLikes(a, b, slack);
  }

  if (isCurve(a) && isCurve(b)) {
    return overlapsCurves(a, b, slack);
  }

  if (a instanceof Circle2) {
    return overlapsCircle(a, b, slack);
  }
  if (b instanceof Circle2) {
    return overlapsCircle(b, a, slack);
  }

  if (a instanceof Aabb2) {
    return overlapsAabb(a, b, slack);
  }
  if (b instanceof Aabb2) {
    return overlapsAabb(b, a, slack);
  }

  return overlapsFilledRegions(a, b, slack);
}

function overlapsPoint(point: Vec2, other: Geometry2, slack: Epsilon): boolean {
  if (other instanceof Vec2) {
    return withinDistance(point.distance(other), slack);
  }

  if (other instanceof Line2 || other instanceof Polyline2 || other instanceof Ray2) {
    return withinDistance(other.distanceToPoint(point), slack);
  }

  if (other instanceof InfiniteLine2) {
    return withinDistance(other.distanceToPoint(point), slack);
  }

  if (other instanceof Circle2) {
    return withinSeparation(other.signedDistance(point), slack);
  }

  if (other instanceof Aabb2) {
    return pointInContainer(other, point, slack);
  }

  if (other instanceof Hesse2) {
    return withinDistance(other.distanceToPoint(point), slack);
  }

  return pointInContainer(other, point, slack);
}

function overlapsLineLikes(a: LineLike2, b: LineLike2, slack: Epsilon): boolean {
  const hit = intersectionLines(a, b);
  if (hit === null) {
    return false;
  }

  if (slack.value >= 0) {
    return true;
  }

  if (hit instanceof Vec2) {
    return false;
  }

  if (hit instanceof Line2) {
    return hit.length() > -slack.value;
  }

  return true;
}

function overlapsCurves(a: Line2 | Polyline2 | Ray2, b: Line2 | Polyline2 | Ray2, slack: Epsilon): boolean {
  for (const segmentA of segmentsOf(a)) {
    for (const segmentB of segmentsOf(b)) {
      if (overlapsSegments(segmentA, segmentB, slack)) {
        return true;
      }
    }
  }

  return false;
}

function overlapsSegments(a: Line2, b: Line2, slack: Epsilon): boolean {
  if (overlapsLineLikes(a, b, slack)) {
    return true;
  }

  if (segmentsCross(a.from, a.to, b.from, b.to, slack)) {
    return true;
  }

  return (
    withinDistance(a.distanceToPoint(b.from), slack) ||
    withinDistance(a.distanceToPoint(b.to), slack) ||
    withinDistance(b.distanceToPoint(a.from), slack) ||
    withinDistance(b.distanceToPoint(a.to), slack)
  );
}

function overlapsCircle(circle: Circle2, other: Geometry2, slack: Epsilon): boolean {
  if (other instanceof Circle2) {
    const gap = circle.center.distance(other.center) - circle.radius - other.radius;
    return withinSeparation(gap, slack);
  }

  if (other instanceof Line2) {
    return withinSeparation(other.distanceToPoint(circle.center) - circle.radius, slack);
  }

  if (other instanceof Polyline2) {
    for (const segment of other.segments()) {
      if (overlapsCircle(circle, segment, slack)) {
        return true;
      }
    }
    return false;
  }

  if (other instanceof Ray2) {
    return withinSeparation(other.distanceToPoint(circle.center) - circle.radius, slack);
  }

  if (other instanceof InfiniteLine2) {
    return withinSeparation(Math.abs(other.signedDistance(circle.center)) - circle.radius, slack);
  }

  if (other instanceof Aabb2) {
    return overlapsCircle(circle, other.polygon2(), slack);
  }

  for (const point of verticesOf(other)) {
    if (withinSeparation(circle.signedDistance(point), slack)) {
      return true;
    }
  }

  if (other instanceof Polygon2 || other instanceof TriMesh2) {
    if (pointInContainer(other, circle.center, slack)) {
      return true;
    }
  }

  for (const edge of edgesOf(other)) {
    if (overlapsCircle(circle, edge, slack)) {
      return true;
    }
  }

  return false;
}

function overlapsHalfPlane(plane: InfiniteLine2, other: Geometry2, slack: Epsilon): boolean {
  if (other instanceof Vec2) {
    return inside(plane.signedDistance(other), slack);
  }

  for (const point of verticesOf(other)) {
    if (inside(plane.signedDistance(point), slack)) {
      return true;
    }
  }

  for (const edge of edgesOf(other)) {
    if (overlapsLineLikes(plane, edge, slack)) {
      return true;
    }
  }

  if (other instanceof Circle2) {
    return withinSeparation(Math.abs(plane.signedDistance(other.center)) - other.radius, slack);
  }

  return false;
}

function overlapsAabb(box: Aabb2, other: Geometry2, slack: Epsilon): boolean {
  if (other instanceof Aabb2) {
    return aabbOverlap(box, other, slack);
  }

  if (other instanceof Circle2) {
    return overlapsCircle(other, box, slack);
  }

  for (const point of verticesOf(other)) {
    if (pointInContainer(box, point, slack)) {
      return true;
    }
  }

  for (const edge of edgesOf(other)) {
    if (overlapsAabbSegment(box, edge, slack)) {
      return true;
    }
  }

  return false;
}

function overlapsAabbSegment(box: Aabb2, segment: Line2, slack: Epsilon): boolean {
  if (pointInContainer(box, segment.from, slack) || pointInContainer(box, segment.to, slack)) {
    return true;
  }

  for (const edge of box.polygon2().segments()) {
    if (overlapsSegments(segment, edge, slack)) {
      return true;
    }
  }

  return false;
}

function overlapsFilledRegions(a: Geometry2, b: Geometry2, slack: Epsilon): boolean {
  for (const point of verticesOf(a)) {
    if (overlapsPoint(point, b, slack)) {
      return true;
    }
  }

  for (const point of verticesOf(b)) {
    if (overlapsPoint(point, a, slack)) {
      return true;
    }
  }

  for (const edgeA of edgesOf(a)) {
    for (const edgeB of edgesOf(b)) {
      if (overlapsSegments(edgeA, edgeB, slack)) {
        return true;
      }
    }
  }

  return false;
}

function isCurve(geometry: Geometry2): geometry is Line2 | Polyline2 | Ray2 {
  return geometry instanceof Line2 || geometry instanceof Polyline2 || geometry instanceof Ray2;
}

function isLineLike(geometry: Geometry2): geometry is LineLike2 {
  return geometry instanceof Line2 || geometry instanceof Ray2 || geometry instanceof InfiniteLine2;
}

function geometryAabb(geometry: Geometry2): Aabb2 {
  if (geometry instanceof Vec2) {
    return Aabb2.fromPoints(geometry);
  }

  if (geometry instanceof Aabb2) {
    return geometry;
  }

  return geometry.aabb2();
}

function aabbOverlap(a: Aabb2, b: Aabb2, slack: Epsilon): boolean {
  return intervalOverlap(a.x, b.x, slack) && intervalOverlap(a.y, b.y, slack);
}

function intervalOverlap(a: Interval2, b: Interval2, slack: Epsilon): boolean {
  const s = slack.value;
  if (s < 0) {
    return a.max > b.min - s && b.max > a.min - s;
  }

  return a.max + s >= b.min - s && b.max + s >= a.min - s;
}

function inside(value: number, slack: Epsilon): boolean {
  const s = slack.value;
  return s < 0 ? value < s : value <= s;
}

function withinSeparation(separation: number, slack: Epsilon): boolean {
  const s = slack.value;
  return s < 0 ? separation < s : separation <= s;
}

function withinDistance(distance: number, slack: Epsilon): boolean {
  const s = slack.value;
  return s < 0 ? distance < -s : distance <= s;
}

function pointInContainer(container: Container2, point: Vec2, slack: Epsilon): boolean {
  if (container instanceof TriMesh2) {
    return container.containsPoint(point, slack);
  }

  if (container instanceof Aabb2) {
    return container.x.contains(point.x, slack) && container.y.contains(point.y, slack);
  }

  return inside(container.signedDistance(point), slack);
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2, slack: Epsilon): boolean {
  const o1 = Vec2.orient(a, b, c);
  const o2 = Vec2.orient(a, b, d);
  const o3 = Vec2.orient(c, d, a);
  const o4 = Vec2.orient(c, d, b);
  const eps = slack.sq;

  return (
    Math.sign(o1) !== Math.sign(o2) &&
    Math.sign(o3) !== Math.sign(o4) &&
    Math.abs(o1) > eps &&
    Math.abs(o2) > eps &&
    Math.abs(o3) > eps &&
    Math.abs(o4) > eps
  );
}

function segmentsOf(curve: Line2 | Polyline2 | Ray2): Line2[] {
  if (curve instanceof Line2) {
    return [curve];
  }

  if (curve instanceof Polyline2) {
    return curve.segments();
  }

  return [curve.definitionLine()];
}

function verticesOf(geometry: Geometry2): Vec2[] {
  if (geometry instanceof Vec2) {
    return [geometry];
  }

  if (geometry instanceof Line2) {
    return [geometry.from, geometry.to];
  }

  if (geometry instanceof Polyline2 || geometry instanceof Polygon2) {
    return [...geometry.vertices];
  }

  if (geometry instanceof TriMesh2) {
    return [...geometry.vertices];
  }

  if (geometry instanceof Ray2) {
    return [geometry.start, geometry.evaluate(1)];
  }

  return [];
}

function edgesOf(geometry: Geometry2): Line2[] {
  if (geometry instanceof Line2) {
    return [geometry];
  }

  if (geometry instanceof Polyline2) {
    return geometry.segments();
  }

  if (geometry instanceof Polygon2) {
    return geometry.segments();
  }

  if (geometry instanceof TriMesh2) {
    const edges: Line2[] = [];
    for (const [i, j, k] of geometry.triangles) {
      const a = geometry.vertices[i]!;
      const b = geometry.vertices[j]!;
      const c = geometry.vertices[k]!;
      edges.push(new Line2(a, b), new Line2(b, c), new Line2(c, a));
    }
    return edges;
  }

  if (geometry instanceof Ray2) {
    return [geometry.definitionLine()];
  }

  return [];
}
