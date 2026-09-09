import { Aabb2 } from '../bounds/aabb2';
import { Epsilon } from '../core/epsilon';
import { Vec2 } from '../core/vec2';
import { InfiniteLine2 } from '../geometry/primitives/infinite-line2';
import { Polygon2 } from '../geometry/regions/polygon2';
import { TriMesh2 } from '../geometry/regions/tri-mesh2';
import { triangulateSources } from './constrained-delaunay';

export type Boolean2Clip = InfiniteLine2 | Polygon2;
export type Boolean2ClipInput = Boolean2Clip | readonly Boolean2Clip[];

export type Boolean2Options = {
  slack?: Epsilon;
  /** When true, the filtered CDT mesh is included alongside boundary polygons. */
  mesh?: boolean;
};

export type Boolean2Result = {
  polygons: Polygon2[];
  triMesh?: TriMesh2;
};

type ClipMode = 'intersect' | 'subtract';

/**
 * Planar boolean operations built from constrained Delaunay triangulation and
 * non-zero winding classification. Boundary loops are extracted from the kept triangles.
 */
export class Boolean2 {
  /** Union of one or more polygons (holes use clockwise winding). */
  static union(polygons: readonly Polygon2[], options: Boolean2Options = {}): Boolean2Result {
    if (polygons.length === 0) return emptyResult(options);

    return runBoolean({
      sources: polygons,
      keep: (point) => hasNonZeroWinding(polygons, point),
      options,
    });
  }

  /**
   * Intersection of subject polygons with one or more clip geometries.
   * Clip may be half-planes (`signedDistance <= 0`) and/or filled polygons.
   */
  static intersect(
    subject: readonly Polygon2[],
    clips: Boolean2ClipInput,
    options: Boolean2Options = {},
  ): Boolean2Result {
    return clipBoolean(subject, clips, options, 'intersect');
  }

  /**
   * Subtraction of clip geometry interiors from subject polygons.
   * Clip may be half-planes and/or filled polygons; any matching clip removes material.
   */
  static subtract(
    subject: readonly Polygon2[],
    clips: Boolean2ClipInput,
    options: Boolean2Options = {},
  ): Boolean2Result {
    return clipBoolean(subject, clips, options, 'subtract');
  }
}

export function asBoolean2ClipList(clips: Boolean2ClipInput): readonly Boolean2Clip[] {
  return Array.isArray(clips) ? clips : [clips as Boolean2Clip];
}

function clipBoolean(
  subject: readonly Polygon2[],
  clips: Boolean2ClipInput,
  options: Boolean2Options,
  mode: ClipMode,
): Boolean2Result {
  if (subject.length === 0) return emptyResult(options);

  const clipList = asBoolean2ClipList(clips);
  if (clipList.length === 0) return Boolean2.union(subject, options);

  const { halfPlanes, polygons: clipPolygons } = partitionClips(clipList);
  const slack = options.slack ?? Epsilon.preferIn;
  const sources = [...subject, ...clipPolygons];

  return runBoolean({
    sources,
    // Half-plane clips need a finite domain so infinite lines intersect geometry.
    bounds: halfPlanes.length > 0 ? workingBounds(sources) : undefined,
    clipLines: halfPlanes,
    keep: (point) => {
      if (!hasNonZeroWinding(subject, point)) return false;
      return mode === 'intersect'
        ? insideAllClips(point, halfPlanes, clipPolygons, slack)
        : outsideAllClips(point, halfPlanes, clipPolygons, slack);
    },
    options,
  });
}

function partitionClips(clips: readonly Boolean2Clip[]): {
  halfPlanes: InfiniteLine2[];
  polygons: Polygon2[];
} {
  const halfPlanes: InfiniteLine2[] = [];
  const polygons: Polygon2[] = [];
  for (const clip of clips) {
    if (clip instanceof InfiniteLine2) halfPlanes.push(clip);
    else polygons.push(clip);
  }
  return { halfPlanes, polygons };
}

function insideAllClips(
  point: Vec2,
  halfPlanes: readonly InfiniteLine2[],
  polygons: readonly Polygon2[],
  slack: Epsilon,
): boolean {
  return (
    halfPlanes.every((plane) => plane.signedDistance(point) <= slack.value) &&
    polygons.every((polygon) => polygon.containsPoint(point))
  );
}

function outsideAllClips(
  point: Vec2,
  halfPlanes: readonly InfiniteLine2[],
  polygons: readonly Polygon2[],
  slack: Epsilon,
): boolean {
  return (
    !halfPlanes.some((plane) => plane.signedDistance(point) <= slack.value) &&
    !polygons.some((polygon) => polygon.containsPoint(point))
  );
}

type BooleanRun = {
  sources: readonly Polygon2[];
  keep: (point: Vec2) => boolean;
  bounds?: Aabb2;
  clipLines?: readonly InfiniteLine2[];
  options: Boolean2Options;
};

function runBoolean(run: BooleanRun): Boolean2Result {
  const slack = run.options.slack ?? Epsilon.preferIn;
  const mesh = triangulateSources(
    [...run.sources, ...(run.bounds ? [run.bounds.polygon2()] : []), ...(run.clipLines ?? [])],
    slack,
  );
  const filtered = filterTriangles(mesh, run.keep);
  const polygons = filtered.boundaryLoopPolygons();
  return run.options.mesh ? { polygons, triMesh: filtered } : { polygons };
}

function emptyResult(options: Boolean2Options): Boolean2Result {
  return options.mesh ? { polygons: [], triMesh: TriMesh2.withoutCleanup([], []) } : { polygons: [] };
}

function filterTriangles(mesh: TriMesh2, keep: (point: Vec2) => boolean): TriMesh2 {
  const keptTriangles: [number, number, number][] = [];

  for (const triangle of mesh.triangles) {
    const a = mesh.vertices[triangle[0]!]!;
    const b = mesh.vertices[triangle[1]!]!;
    const c = mesh.vertices[triangle[2]!]!;
    if (
      keep(
        a
          .add(b)
          .add(c)
          .scale(1 / 3),
      )
    )
      keptTriangles.push(triangle);
  }

  return TriMesh2.withoutCleanup(
    mesh.vertices.map((vertex) => vertex.clone()),
    keptTriangles,
  );
}

/** Non-zero winding across subject polygons (CW loops act as holes). */
function hasNonZeroWinding(polygons: readonly Polygon2[], point: Vec2): boolean {
  let weight = 0;
  for (const polygon of polygons) weight += polygon.windingNumber(point);
  return weight !== 0;
}

function workingBounds(polygons: readonly Polygon2[]): Aabb2 {
  const aabb = Aabb2.union(...polygons.map((polygon) => polygon.aabb2()));
  const margin = Math.max(aabb.width(), aabb.height(), 1) * 0.1;
  return Aabb2.fromMinMax(
    new Vec2(aabb.min().x - margin, aabb.min().y - margin),
    new Vec2(aabb.max().x + margin, aabb.max().y + margin),
  );
}
