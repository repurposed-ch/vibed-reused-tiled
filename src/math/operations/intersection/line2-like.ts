import type { LineLike2 } from '../../geometry/kinds';
import { Interval2 } from '../../bounds/interval2';
import { Epsilon } from '../../core/epsilon';
import { Vec2 } from '../../core/vec2';
import { InfiniteLine2 } from '../../geometry/primitives/infinite-line2';
import { Line2 } from '../../geometry/primitives/line2';
import { Ray2 } from '../../geometry/primitives/ray2';

export type LineLike2IntersectionResult = LineLike2 | Vec2 | null;

export function intersectionLines(first: LineLike2, second: LineLike2): LineLike2IntersectionResult {
  const dir0 = first.infiniteLine().direction;
  const dir1 = second.infiniteLine().direction;

  if (dir0.parallel(dir1)) {
    return parallelIntersection(first, second);
  }

  const denom = dir0.crossProduct(dir1);
  const delta = second.infiniteLine().through.subtract(first.infiniteLine().through);
  const t0 = delta.crossProduct(dir1) / denom;
  const t1 = delta.crossProduct(dir0) / denom;

  if (!first.interval().contains(t0)) {
    return null;
  }

  if (!second.interval().contains(t1)) {
    return null;
  }

  return first.infiniteLine().evaluate(t0);
}

function parallelIntersection(first: LineLike2, second: LineLike2): LineLike2IntersectionResult {
  if (first.infiniteLine().distanceToPoint(second.infiniteLine().through) >= Epsilon.value) {
    return null;
  }

  const mappedSecond = mapIntervalOnto(second, first);
  const overlap = first.interval().intersect(mappedSecond);

  if (!overlap) {
    return null;
  }

  return geometryFromOverlap(first.infiniteLine(), overlap);
}

/** Maps `from`'s parameter interval into `onto`'s parameter space. */
function mapIntervalOnto(from: LineLike2, onto: LineLike2): Interval2 {
  const ontoDir = onto.infiniteLine().direction;
  const ontoDirLenSq = ontoDir.dot(ontoDir);
  const origin = onto.infiniteLine().closestParameterForPoint(from.infiniteLine().through);
  const scale = from.infiniteLine().direction.dot(ontoDir) / ontoDirLenSq;
  return from.interval().mapLinear(origin, scale);
}

function geometryFromOverlap(line: InfiniteLine2, overlap: Interval2): LineLike2IntersectionResult {
  if (overlap.isFullyInfinite()) {
    return new InfiniteLine2(line.through.clone(), line.direction.clone());
  }

  if (overlap.isInfinite()) {
    if (Number.isFinite(overlap.min)) {
      return new Ray2(line.evaluate(overlap.min), line.direction.clone());
    }

    if (Number.isFinite(overlap.max)) {
      return new Ray2(line.evaluate(overlap.max), line.direction.negate());
    }
  }

  const from = line.evaluate(overlap.min);
  const to = line.evaluate(overlap.max);

  if (from.distance(to) < Epsilon.value) {
    return from;
  }

  return new Line2(from, to);
}
