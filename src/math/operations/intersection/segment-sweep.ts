import { Epsilon } from '../../core/epsilon';
import { Vec2 } from '../../core/vec2';
import { Line2 } from '../../geometry/primitives/line2';
import { intersectionLines } from './line2-like';

export type SegmentCrossing = {
  point: Vec2;
  /** Index into the input `segments` array. */
  i: number;
  /** Index into the input `segments` array. */
  j: number;
};

/**
 * Left-to-right sweep reporting all point intersections among finite segments.
 *
 * Segments are processed by ascending min-x. The active set holds every earlier
 * segment whose x-span still overlaps the current one, so each intersecting pair
 * is tested exactly once when the right-hand segment is opened.
 */
export function findSegmentCrossings(segments: readonly Line2[], slack: Epsilon = Epsilon.preferIn): SegmentCrossing[] {
  const ordered = segments
    .map((segment, index) => {
      const minX = Math.min(segment.from.x, segment.to.x);
      const maxX = Math.max(segment.from.x, segment.to.x);
      return { index, segment, minX, maxX };
    })
    .sort((a, b) => a.minX - b.minX || a.index - b.index);

  const active: typeof ordered = [];
  const crossings: SegmentCrossing[] = [];
  const seen = new Set<number>();

  for (const current of ordered) {
    // Drop segments that can no longer overlap current in x.
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i]!.maxX + slack.value < current.minX) {
        active.splice(i, 1);
      }
    }

    for (const prior of active) {
      const hit = intersectionLines(prior.segment, current.segment);
      if (!(hit instanceof Vec2)) continue;

      const lo = Math.min(prior.index, current.index);
      const hi = Math.max(prior.index, current.index);
      const key = lo * segments.length + hi;
      if (seen.has(key)) continue;
      seen.add(key);

      crossings.push({ point: hit.clone(), i: prior.index, j: current.index });
    }

    active.push(current);
  }

  return crossings;
}
