import { Angle } from '../core/angle';
import { Epsilon } from '../core/epsilon';
import { Vec2 } from '../core/vec2';
import { Polyline2 } from '../geometry/curves/polyline2';
import { Polygon2 } from '../geometry/regions/polygon2';

export type DouglasPeuckerTolerances = {
  /** Maximum perpendicular distance from the simplified chord (world units). */
  distance: Epsilon;
  /** Maximum deviation from a straight angle at a vertex. */
  angle: Angle;
};

/** Defaults suited to metre-scale building footprints: 1 cm distance, 2° angle. */
export const DOUGLAS_PEUCKER_DEFAULTS: DouglasPeuckerTolerances = {
  distance: Epsilon.custom(0.01),
  angle: Angle.fromDegrees(2),
};

/** Slightly looser preset for noisy survey vertices before grid fitting. */
export const DOUGLAS_PEUCKER_GRID_DEFAULTS: DouglasPeuckerTolerances = {
  distance: Epsilon.custom(0.05),
  angle: Angle.fromDegrees(5),
};

export function resolveDouglasPeuckerTolerances(
  input: boolean | DouglasPeuckerTolerances | undefined,
): DouglasPeuckerTolerances | undefined {
  if (input === undefined || input === false) {
    return undefined;
  }

  if (input === true) {
    return DOUGLAS_PEUCKER_DEFAULTS;
  }

  input.distance.isPositive('operations', 'resolveDouglasPeuckerTolerances');
  return input;
}

export function douglasPeucker<T extends Polygon2 | Polyline2>(
  curve: T,
  tolerances: DouglasPeuckerTolerances = DOUGLAS_PEUCKER_DEFAULTS,
): T {
  const simplified = douglasPeuckerVertices(curve.vertices, tolerances, curve instanceof Polygon2);
  return (curve instanceof Polygon2 ? new Polygon2(simplified) : new Polyline2(simplified)) as T;
}

/** Ramer-Douglas-Peucker simplification with distance and angle tolerances. */
export function douglasPeuckerVertices(
  vertices: readonly Vec2[],
  tolerances: DouglasPeuckerTolerances,
  closed: boolean,
): Vec2[] {
  tolerances.distance.isPositive('operations', 'douglasPeuckerVertices');

  if (vertices.length < 2) {
    return vertices.map((vertex) => vertex.clone());
  }

  if (closed && vertices.length < 3) {
    return vertices.map((vertex) => vertex.clone());
  }

  const simplified =
    closed && vertices.length >= 3
      ? simplifyClosedPolygon(vertices, tolerances)
      : simplifyOpenPolyline(vertices, tolerances);

  return simplified.map((vertex) => vertex.clone());
}

function simplifyClosedPolygon(vertices: readonly Vec2[], tolerances: DouglasPeuckerTolerances): Vec2[] {
  let best = simplifyOpenPolyline(vertices, tolerances);

  if (best.length >= 3) {
    return best;
  }

  // Rotate start point so simplification preserves at least three corners when possible.
  for (let offset = 1; offset < vertices.length; offset++) {
    const rotated = [...vertices.slice(offset), ...vertices.slice(0, offset)];
    const candidate = simplifyOpenPolyline(rotated, tolerances);
    if (candidate.length > best.length) {
      best = candidate;
    }
  }

  return best.length >= 3 ? best : vertices.map((vertex) => vertex.clone());
}

function simplifyOpenPolyline(vertices: readonly Vec2[], tolerances: DouglasPeuckerTolerances): Vec2[] {
  if (vertices.length < 2) {
    return vertices.map((vertex) => vertex.clone());
  }

  const simplified = douglasPeuckerRange(vertices, 0, vertices.length - 1, tolerances);
  return dedupeConsecutiveVertices(simplified);
}

function douglasPeuckerRange(
  vertices: readonly Vec2[],
  first: number,
  last: number,
  tolerances: DouglasPeuckerTolerances,
): Vec2[] {
  if (last <= first + 1) {
    return [vertices[first]!.clone(), ...(last > first ? [vertices[last]!.clone()] : [])];
  }

  let maxDistance = 0;
  let index = first + 1;

  for (let i = first + 1; i < last; i++) {
    const distance = perpendicularDistance(vertices[i]!, vertices[first]!, vertices[last]!);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }

  const flat = maxDistance <= tolerances.distance.value && segmentIsAngleFlat(vertices, first, last, tolerances.angle);

  if (flat) {
    return [vertices[first]!.clone(), vertices[last]!.clone()];
  }

  const left = douglasPeuckerRange(vertices, first, index, tolerances);
  const right = douglasPeuckerRange(vertices, index, last, tolerances);
  return [...left.slice(0, -1), ...right];
}

function segmentIsAngleFlat(vertices: readonly Vec2[], first: number, last: number, angleTolerance: Angle): boolean {
  for (let i = first + 1; i < last; i++) {
    if (!isCollinearWithSegment(vertices[i]!, vertices[first]!, vertices[last]!, angleTolerance)) {
      return false;
    }
  }

  return true;
}

/** True when the turn at `point` is within `angleTolerance` of a straight angle (π). */
function isCollinearWithSegment(point: Vec2, start: Vec2, end: Vec2, angleTolerance: Angle): boolean {
  if (start.subtract(point).isZeroLength() || end.subtract(point).isZeroLength()) {
    return true;
  }

  const turn = Angle.fromPt3(start, point, end, { ignoreSens: true });
  return Math.PI - turn.radians() <= angleTolerance.radians();
}

function perpendicularDistance(point: Vec2, lineStart: Vec2, lineEnd: Vec2): number {
  const line = lineEnd.subtract(lineStart);
  const lengthSquared = line.dot(line);

  if (lengthSquared < Epsilon.sq) {
    return point.distance(lineStart);
  }

  const t = clamp(point.subtract(lineStart).dot(line) / lengthSquared, 0, 1);
  const projection = lineStart.add(line.scale(t));
  return point.distance(projection);
}

function dedupeConsecutiveVertices(vertices: readonly Vec2[]): Vec2[] {
  const result: Vec2[] = [];

  for (const vertex of vertices) {
    const previous = result[result.length - 1];
    if (previous && previous.distance(vertex) <= Epsilon.value) {
      continue;
    }
    result.push(vertex.clone());
  }

  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
