import type { Mat3 } from '../../core/mat3';
import { partialSum } from '../../analysis/aggregation/partial-sum';
import { Aabb2 } from '../../bounds/aabb2';
import { Interval2 } from '../../bounds/interval2';
import { Epsilon } from '../../core/epsilon';
import { Vec2, type Vec2Json } from '../../core/vec2';
import { intersectionLines, type LineLike2IntersectionResult } from '../../operations/intersection/line2-like';
import { type LineLike2 } from '../kinds';
import { InfiniteLine2 } from './infinite-line2';

/** Finite line segment between two points. */
export class Line2 {
  static readonly type = 'Line2' as const;
  static readonly parameterInterval = Interval2.unit;

  constructor(
    public readonly from: Vec2,
    public readonly to: Vec2,
  ) {}

  length(): number {
    return this.from.distance(this.to);
  }

  direction(): Vec2 {
    return this.to.subtract(this.from);
  }

  evaluate(t: number): Vec2 {
    return this.infiniteLine().evaluate(t);
  }

  closestParameterForPoint(point: Vec2): number {
    return Line2.parameterInterval.clamp(this.infiniteLine().closestParameterForPoint(point));
  }

  closestPointForPoint(point: Vec2): Vec2 {
    return this.evaluate(this.closestParameterForPoint(point));
  }

  distanceToPoint(point: Vec2): number {
    return point.distance(this.closestPointForPoint(point));
  }

  parametricOffsetInterval(): Interval2 {
    if (this.direction().isZeroLength()) {
      throw new Error('Line2.parametricOffsetInterval cannot be used for a line of zero length');
    }
    const infiniteLine = this.infiniteLine();
    // it is guaranteed that either from or to are so close together that parametricOffset throws an error
    // or this `from`, along its direction, will be before `to`
    return new Interval2(infiniteLine.parametricOffset(this.from), infiniteLine.parametricOffset(this.to));
  }

  aabb2(): Aabb2 {
    return Aabb2.fromPoints(this.from, this.to);
  }

  intersect(other: LineLike2): LineLike2IntersectionResult {
    return intersectionLines(this, other);
  }

  transform(matrix: Mat3): Line2 {
    return new Line2(this.from.transform(matrix), this.to.transform(matrix));
  }

  infiniteLine(): InfiniteLine2 {
    return new InfiniteLine2(this.from, this.direction());
  }

  interval(): Interval2 {
    return Line2.parameterInterval;
  }

  /**
   * Partial sums of all the segment lengths. Always starts with 0, n+1 values.
   * @param segments
   * @returns
   */
  static lengthTable(segments: readonly Line2[]): number[] {
    return partialSum(
      segments.map((segment) => segment.length()),
      true,
    );
  }

  /**
   * Sample a chain of segments by arc length.
   * Lengths outside `[0, totalLength]` extrapolate along the first or last segment.
   */
  static evaluateAtLength(segments: readonly Line2[], length: number): Vec2 {
    if (segments.length === 0) {
      throw new Error('Line2.evaluateAtLength requires at least one segment');
    }

    const lengthTable = Line2.lengthTable(segments);
    const rawSegmentIndex = lengthTable.findIndex((cumulative) => cumulative > length);
    const segmentIndex = rawSegmentIndex < 0 ? segments.length - 1 : rawSegmentIndex ? rawSegmentIndex - 1 : 0;
    const segment = segments[segmentIndex]!;
    const segmentStartLength = lengthTable[segmentIndex]!;
    const segmentLength = segment.length();
    const segmentT = (length - segmentStartLength) / segmentLength;

    return segment.evaluate(segmentT);
  }

  /**
   * Closest points on a segment chain. `tParameters` use the index domain:
   * segment `i` contributes values in `[i, i + 1]`.
   *
   * @param additionalTolerance Extra slack beyond `Epsilon` when collecting near-ties,
   * so candidates slightly farther than the minimum distance can still be included.
   */
  static closestToPointForSegments(
    segments: readonly Line2[],
    point: Vec2,
    additionalTolerance = 0,
  ): {
    smallestDistance: number;
    tParameters: number[];
    points: Vec2[];
  } {
    if (segments.length === 0) {
      throw new Error('Line2.closestToPointForSegments requires at least one segment');
    }

    const candidates: {
      cumulativeT: number;
      closestPoint: Vec2;
      distance: number;
    }[] = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      const localT = segment.closestParameterForPoint(point);
      const cumulativeT = i + localT;
      const closestPoint = segment.evaluate(localT);

      candidates.push({
        cumulativeT,
        closestPoint,
        distance: point.distance(closestPoint),
      });
    }

    const smallestDistance = Math.min(...candidates.map((candidate) => candidate.distance));
    const threshold = smallestDistance + Epsilon.value + additionalTolerance;

    const closestCandidates = candidates.filter((candidate) => candidate.distance < threshold);

    return {
      smallestDistance,
      tParameters: closestCandidates.map((candidate) => candidate.cumulativeT),
      points: closestCandidates.map((candidate) => candidate.closestPoint),
    };
  }

  toJson(): Line2Json {
    return { type: Line2.type, from: this.from.toJson(), to: this.to.toJson() };
  }
}

export type Line2Json = {
  type: typeof Line2.type;
  from: Vec2Json;
  to: Vec2Json;
};
