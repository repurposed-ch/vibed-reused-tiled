import { Aabb2 } from '../bounds/aabb2';
import { Interval2 } from '../bounds/interval2';
import { Epsilon } from '../core/epsilon';
import { Vec2 } from '../core/vec2';
import { Polyline2 } from '../geometry/curves/polyline2';
import { InfiniteLine2 } from '../geometry/primitives/infinite-line2';
import { Line2 } from '../geometry/primitives/line2';
import { Ray2 } from '../geometry/primitives/ray2';
import { Circle2 } from '../geometry/regions/circle2';
import type { Container2, Geometry2 } from '../geometry/kinds';
import { Polygon2 } from '../geometry/regions/polygon2';
import { TriMesh2 } from '../geometry/regions/tri-mesh2';

export type { Container2, Geometry2, Region2 } from '../geometry/kinds';

/** One guest or many — `contains` accepts either form. */
export type Geometry2Input = Geometry2 | readonly Geometry2[];

/**
 * Region containment tests.
 *
 * `contains` accepts a single guest or an array. Returns true when every guest lies in the container.
 * An empty guest list is vacuously true.
 *
 * **`slack` (default `Epsilon.preferIn`)**
 * - `Epsilon.preferIn`: boundary / touching counts as inside.
 * - `Epsilon.preferOut`: strict interior only.
 * - `Epsilon.custom(n)`: custom tolerance (`|n| >= Epsilon.value`).
 */
export class Contains2 {
  static contains(container: Container2, guests: Geometry2Input, slack: Epsilon = Epsilon.preferIn): boolean {
    const list = asGuestList(guests);
    if (list.length === 0) {
      return true;
    }

    if (!aabbBroadPhaseContains(containerAabb(container), guestsAabb(list), slack)) {
      return false;
    }

    for (const guest of list) {
      if (!Contains2.containsGuest(container, guest, slack)) {
        return false;
      }
    }

    return true;
  }

  /** True when `box` lies entirely inside `container`. */
  static aabbIn(container: Container2, box: Aabb2, slack: Epsilon = Epsilon.preferIn): boolean {
    if (box.isInfinite()) {
      return false;
    }

    return Contains2.contains(container, box.polygon2(), slack);
  }

  static pointIn(container: Container2, point: Vec2, slack: Epsilon = Epsilon.preferIn): boolean {
    return pointInsideContainer(container, point, slack);
  }

  private static containsGuest(container: Container2, geometry: Geometry2, slack: Epsilon): boolean {
    if (geometry instanceof Vec2) {
      return Contains2.pointIn(container, geometry, slack);
    }
    if (geometry instanceof Line2) {
      return Contains2.lineIn(container, geometry, slack);
    }
    if (geometry instanceof Ray2) {
      return Contains2.rayIn(container, geometry, slack);
    }
    if (geometry instanceof InfiniteLine2) {
      return Contains2.infiniteLineIn(container, geometry, slack);
    }
    if (geometry instanceof Circle2) {
      return Contains2.circleIn(container, geometry, slack);
    }
    if (geometry instanceof Aabb2) {
      return Contains2.aabbIn(container, geometry, slack);
    }
    if (geometry instanceof Polyline2) {
      return Contains2.linesIn(container, geometry.segments(), slack);
    }
    if (geometry instanceof Polygon2) {
      return Contains2.linesIn(container, geometry.segments(), slack);
    }
    if (geometry instanceof TriMesh2) {
      return Contains2.triMeshIn(container, geometry, slack);
    }

    return false;
  }

  private static lineIn(container: Container2, line: Line2, slack: Epsilon): boolean {
    if (!Contains2.pointIn(container, line.from, slack) || !Contains2.pointIn(container, line.to, slack)) {
      return false;
    }

    if (isConvexContainer(container)) {
      return true;
    }

    if (container instanceof Polygon2 || container instanceof TriMesh2) {
      return segmentStaysIn(container, line.from, line.to, slack);
    }

    return true;
  }

  private static linesIn(container: Container2, segments: Iterable<Line2>, slack: Epsilon): boolean {
    for (const segment of segments) {
      if (!Contains2.lineIn(container, segment, slack)) {
        return false;
      }
    }
    return true;
  }

  private static circleIn(container: Container2, circle: Circle2, slack: Epsilon): boolean {
    if (container instanceof Circle2) {
      const gap = container.radius - circle.radius - circle.center.distance(container.center);
      return inside(gap, slack, true);
    }

    if (container instanceof InfiniteLine2) {
      return inside(container.signedDistance(circle.center) + circle.radius, slack);
    }

    if (container instanceof Polygon2 || container instanceof TriMesh2 || container instanceof Aabb2) {
      if (!Contains2.pointIn(container, circle.center, slack)) {
        const onBoundary =
          slack.value > 0 &&
          circle.radius <= Epsilon.value &&
          Contains2.pointIn(container, circle.center, Epsilon.preferIn);
        if (!onBoundary) {
          return false;
        }
      }

      return fitsClearance(clearanceAt(container, circle.center), circle.radius, slack);
    }

    return false;
  }

  private static rayIn(container: Container2, ray: Ray2, slack: Epsilon): boolean {
    if (container instanceof InfiniteLine2) {
      if (!Contains2.pointIn(container, ray.start, slack)) {
        return false;
      }

      const dirLen = container.direction.length();
      if (dirLen < Epsilon.value) {
        return Contains2.pointIn(container, ray.start, slack);
      }

      const slope = container.direction.crossProduct(ray.direction) / dirLen;
      const { value: signedSlack } = slack;
      if (signedSlack < 0) {
        return slope < signedSlack && container.signedDistance(ray.start) < signedSlack;
      }

      return slope <= signedSlack;
    }

    if (ray.direction.length() < Epsilon.value) {
      return Contains2.pointIn(container, ray.start, slack);
    }

    return false;
  }

  private static infiniteLineIn(container: Container2, line: InfiniteLine2, slack: Epsilon): boolean {
    if (!(container instanceof InfiniteLine2)) {
      return false;
    }

    const dirLen = container.direction.length();
    if (dirLen < Epsilon.value) {
      return false;
    }

    const slope = container.direction.crossProduct(line.direction) / dirLen;
    if (Math.abs(slope) > Epsilon.value) {
      return false;
    }

    return inside(container.signedDistance(line.through), slack);
  }

  private static triMeshIn(container: Container2, mesh: TriMesh2, slack: Epsilon): boolean {
    const loopPolygons = mesh.boundaryLoopPolygons();

    if (loopPolygons.length > 0) {
      for (const polygon of loopPolygons) {
        for (const vertex of polygon.vertices) {
          if (!inside(container.signedDistance(vertex), slack)) {
            return false;
          }
        }
      }

      if (!isConvexContainer(container)) {
        for (const polygon of loopPolygons) {
          for (const segment of polygon.segments()) {
            const mid = segment.from.add(segment.to).scale(0.5);
            if (!inside(container.signedDistance(mid), slack)) {
              return false;
            }
          }
        }
      }

      return true;
    }

    return mesh.vertices.every((vertex) => inside(container.signedDistance(vertex), slack));
  }
}

function pointInsideContainer(container: Container2, point: Vec2, slack: Epsilon): boolean {
  return inside(container.signedDistance(point), slack);
}

/** Guest mesh boundary from boundary loops; closed meshes fall back to triangle edges. */
function meshBoundarySegments(mesh: TriMesh2): Line2[] {
  const loops = mesh.boundaryLoops();
  if (loops.length > 0) {
    return loops.flatMap((loop) => [...loop.polygon.segments()]);
  }

  return mesh.triangles.flatMap(([i, j, k]) => {
    const a = mesh.vertices[i]!;
    const b = mesh.vertices[j]!;
    const c = mesh.vertices[k]!;
    return [new Line2(a, b), new Line2(b, c), new Line2(c, a)];
  });
}

function asGuestList(guests: Geometry2Input): readonly Geometry2[] {
  return Array.isArray(guests) ? guests : [guests as Geometry2];
}

function containerAabb(container: Container2): Aabb2 {
  if (container instanceof Aabb2) {
    return container;
  }

  return container.aabb2();
}

function guestAabb(geometry: Geometry2): Aabb2 {
  if (geometry instanceof Vec2) {
    return Aabb2.fromPoints(geometry);
  }

  return geometry.aabb2();
}

function guestsAabb(guests: readonly Geometry2[]): Aabb2 {
  return Aabb2.union(...guests.map(guestAabb));
}

/** Like `containsBox`, but a degenerate container axis does not reject (line-like bounds). */
function aabbBroadPhaseContains(container: Aabb2, guest: Aabb2, slack: Epsilon): boolean {
  return axisBroadPhaseContains(container.x, guest.x, slack) && axisBroadPhaseContains(container.y, guest.y, slack);
}

function axisBroadPhaseContains(container: Interval2, guest: Interval2, slack: Epsilon): boolean {
  if (!container.isFullyInfinite() && container.width() <= Epsilon.value) {
    return true;
  }

  return container.containsInterval(guest, slack);
}

function isConvexContainer(container: Container2): boolean {
  return container instanceof Circle2 || container instanceof InfiniteLine2 || container instanceof Aabb2;
}

/** True when `value` is inside relative to a zero boundary, honouring slack. */
function inside(value: number, slack: Epsilon, inverted = false): boolean {
  const { value: signedSlack } = slack;
  if (inverted) {
    return signedSlack < 0 ? value > -signedSlack : value >= -signedSlack;
  }

  return signedSlack < 0 ? value < signedSlack : value <= signedSlack;
}

function clearanceAt(container: Polygon2 | TriMesh2 | Aabb2, point: Vec2): number {
  if (container instanceof Aabb2) {
    return -container.signedDistance(point);
  }

  return container.distanceToPoint(point);
}

function fitsClearance(clearance: number, radius: number, slack: Epsilon): boolean {
  const { value: signedSlack } = slack;
  return signedSlack < 0 ? clearance + signedSlack > radius : clearance + signedSlack >= radius;
}

function segmentStaysIn(container: Polygon2 | TriMesh2, from: Vec2, to: Vec2, slack: Epsilon): boolean {
  const mid = from.add(to).scale(0.5);
  if (!pointInsideContainer(container, mid, slack)) {
    return false;
  }

  const boundary: Line2[] = container instanceof Polygon2 ? [...container.segments()] : meshBoundarySegments(container);

  for (const edge of boundary) {
    if (segmentsProperlyIntersect(from, to, edge.from, edge.to, slack)) {
      return slack.value > 0 && bothHitsNearEndpoints(from, to, edge.from, edge.to, slack);
    }
  }

  return true;
}

function bothHitsNearEndpoints(a: Vec2, b: Vec2, c: Vec2, d: Vec2, slack: Epsilon): boolean {
  const eps = Math.abs(slack.value);
  return a.distance(c) < eps || a.distance(d) < eps || b.distance(c) < eps || b.distance(d) < eps;
}

function segmentsProperlyIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2, slack: Epsilon): boolean {
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
