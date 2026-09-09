/**
 * Constrained Delaunay triangulation (CDT) for planar geometries.
 *
 * Pipeline:
 * 1. Pack input geometry into Steiner points + undirected constraint edges
 *    (`collectConstraintSources`): endpoints, segment×segment crossings, and
 *    infinite-line hits become vertices; carriers are split into non-crossing
 *    constraint segments along each chain.
 * 2. Triangulate with Bowyer-Watson, then enforce constraints by edge flips and
 *    restore the Delaunay property on every unlocked edge (`constrainedDelaunay`).
 *
 * Prefer `triangulateSources` when starting from polygons / polylines / lines.
 * Use `constrainedDelaunay` when points and constraint indices are already known
 * (e.g. Boolean2 after packing).
 */
import { Aabb2 } from '../bounds/aabb2';
import { Epsilon } from '../core/epsilon';
import { dehash2, hash2 } from '../hash/core';
import { Vec2 } from '../core/vec2';
import { Polyline2 } from '../geometry/curves/polyline2';
import { InfiniteLine2 } from '../geometry/primitives/infinite-line2';
import { Line2 } from '../geometry/primitives/line2';
import { Circle2 } from '../geometry/regions/circle2';
import { Polygon2 } from '../geometry/regions/polygon2';
import { TriMesh2 } from '../geometry/regions/tri-mesh2';
import { findSegmentCrossings } from './intersection/segment-sweep';
import { dedupVertices } from './spatial/dedup-vertices';

/** Undirected edge key — same `hash2` convention as TriMesh2. */
export type ConstraintEdge = number;
/** Either a packed `ConstraintEdge` or an unordered vertex-index pair. */
export type ConstraintEdgeInput = ConstraintEdge | readonly [number, number];

/** Canonical undirected key for the edge between vertex indices `a` and `b`. */
export function constraintEdge(a: number, b: number): ConstraintEdge {
  return a < b ? hash2(a, b) : hash2(b, a);
}

/** Sorted endpoint indices for a packed constraint edge. */
export function constraintEdgeEndpoints(edge: ConstraintEdge): [number, number] {
  const [x, y] = dehash2(edge);
  return x < y ? [x, y] : [y, x];
}

/** Geometry accepted by the packing / triangulation entry points. */
export type TriangulateGeometry = Polygon2 | Polyline2 | Line2 | InfiniteLine2 | Vec2;
export type TriangulateGeometries = readonly TriangulateGeometry[];

/** Points + constraint edges produced by packing input geometry. */
export type BuiltConstraintSources = {
  points: Vec2[];
  constraints: ConstraintEdge[];
  /** Same edges as `constraints`, expressed as concrete segments (debug / viz). */
  constraintSegments: { from: Vec2; to: Vec2 }[];
};

/** Slack-aware vertex index store used while packing geometry. */
type PointRegistry = {
  points: Vec2[];
  add: (point: Vec2) => number;
};

/** Hits collected along one constraint carrier (segment or infinite line). */
type HitChain = {
  hits: number[];
  origin: Vec2;
  direction: Vec2;
};

/**
 * Pack geometries into points + constraints:
 * seed chains → intersect carriers → emit split edges along each chain.
 * Finite segments contribute endpoints; infinite lines only contribute hits.
 */
export function collectConstraintSources(
  geometries: TriangulateGeometries,
  slack: Epsilon = Epsilon.preferIn,
): BuiltConstraintSources {
  const { segments, lines, steiner } = partitionGeometries(geometries);
  const registry = createPointRegistry(slack);
  const finite = segments.map((segment) =>
    seedChain(segment.from, segment.to.subtract(segment.from), registry, [segment.from, segment.to]),
  );
  const infinite = lines.map((line) => seedChain(line.through, line.direction, registry));
  const lineGeomHits = infinite.map(() => [] as number[]);

  for (const { point, i, j } of findSegmentCrossings(segments, slack)) {
    link(finite[i]!, finite[j]!, point, registry);
  }

  resolveInfiniteLineHits(segments, lines, finite, infinite, lineGeomHits, registry, slack);

  for (const point of steiner) registry.add(point);
  return emitConstraints([...finite, ...infinite], registry, slack);
}

/** Pack input geometries, then run constrained Delaunay on the result. */
export function triangulateSources(geometries: TriangulateGeometries, slack: Epsilon = Epsilon.preferIn): TriMesh2 {
  const { points, constraints } = collectConstraintSources(geometries, slack);
  return constrainedDelaunay(points, constraints, slack);
}

/** Split mixed geometry into finite segments, infinite lines, and free Steiner points. */
function partitionGeometries(geometries: TriangulateGeometries): {
  segments: Line2[];
  lines: InfiniteLine2[];
  steiner: Vec2[];
} {
  const segments: Line2[] = [];
  const lines: InfiniteLine2[] = [];
  const steiner: Vec2[] = [];

  for (const geometry of geometries) {
    if (geometry instanceof Polygon2) segments.push(...geometry.segments());
    else if (geometry instanceof Polyline2) segments.push(...geometry.segments());
    else if (geometry instanceof Line2) segments.push(new Line2(geometry.from.clone(), geometry.to.clone()));
    else if (geometry instanceof InfiniteLine2) lines.push(geometry);
    else if (geometry instanceof Vec2) steiner.push(geometry);
  }

  return { segments, lines, steiner };
}

/** Deduping vertex store: points within `slack` reuse the same index. */
function createPointRegistry(slack: Epsilon): PointRegistry {
  const points: Vec2[] = [];
  return {
    points,
    add(point: Vec2): number {
      const existing = points.findIndex((candidate) => candidate.distance(point) <= slack.value);
      if (existing >= 0) return existing;
      points.push(point.clone());
      return points.length - 1;
    },
  };
}

/**
 * Ordered hit list along a carrier ray (`origin` + `direction`).
 * Finite segments seed both endpoints; infinite lines start empty.
 */
function seedChain(origin: Vec2, direction: Vec2, registry: PointRegistry, endpoints: readonly Vec2[] = []): HitChain {
  return {
    hits: endpoints.map((point) => registry.add(point)),
    origin,
    direction,
  };
}

/** Register an intersection point and attach it to both participating chains. */
function link(a: HitChain, b: HitChain, point: Vec2, registry: PointRegistry): number {
  const id = registry.add(point);
  a.hits.push(id);
  b.hits.push(id);
  return id;
}

/** Narrow intersection results to a point (ignore overlaps / null). */
function asPoint(result: unknown): Vec2 | null {
  return result instanceof Vec2 ? result : null;
}

/**
 * Infinite lines only contribute vertices where they hit other geometry.
 * 1) segment × line → geometry hits (also recorded for span checks)
 * 2) line × line, only inside each line's geometry-hit span
 */
function resolveInfiniteLineHits(
  segments: readonly Line2[],
  lines: readonly InfiniteLine2[],
  finite: HitChain[],
  infinite: HitChain[],
  lineGeomHits: number[][],
  registry: PointRegistry,
  slack: Epsilon,
): void {
  for (let i = 0; i < segments.length; i++) {
    for (let j = 0; j < lines.length; j++) {
      const hit = asPoint(segments[i]!.intersect(lines[j]!));
      if (!hit) continue;
      lineGeomHits[j]!.push(link(finite[i]!, infinite[j]!, hit, registry));
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (lineGeomHits[i]!.length === 0) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (lineGeomHits[j]!.length === 0) continue;
      const hit = asPoint(lines[i]!.intersect(lines[j]!));
      if (!hit) continue;
      if (!withinHitSpan(lines[i]!, hit, lineGeomHits[i]!, registry.points, slack)) continue;
      if (!withinHitSpan(lines[j]!, hit, lineGeomHits[j]!, registry.points, slack)) continue;
      link(infinite[i]!, infinite[j]!, hit, registry);
    }
  }
}

/**
 * Sort each chain along its carrier and emit consecutive non-degenerate edges
 * as undirected constraints.
 */
function emitConstraints(chains: readonly HitChain[], registry: PointRegistry, slack: Epsilon): BuiltConstraintSources {
  const constraints: ConstraintEdge[] = [];
  const constraintSegments: { from: Vec2; to: Vec2 }[] = [];
  const seen = new Set<number>();

  for (const chain of chains) {
    const ids = [...new Set(chain.hits)];
    if (ids.length < 2) continue;

    ids.sort(
      (a, b) =>
        registry.points[a]!.subtract(chain.origin).dot(chain.direction) -
        registry.points[b]!.subtract(chain.origin).dot(chain.direction),
    );

    for (let i = 0; i < ids.length - 1; i++) {
      const u = ids[i]!;
      const v = ids[i + 1]!;
      if (u === v || registry.points[u]!.distance(registry.points[v]!) <= slack.value) continue;
      const key = constraintEdge(u, v);
      if (seen.has(key)) continue;
      seen.add(key);
      constraints.push(key);
      constraintSegments.push({ from: registry.points[u]!.clone(), to: registry.points[v]!.clone() });
    }
  }

  return { points: registry.points, constraints, constraintSegments };
}

/** True when `point` lies between the extreme geometry hits on `line` (with slack). */
function withinHitSpan(
  line: InfiniteLine2,
  point: Vec2,
  hitIndices: readonly number[],
  points: readonly Vec2[],
  slack: Epsilon,
): boolean {
  if (hitIndices.length === 0) return false;
  const dirLen = line.direction.length();
  if (dirLen < Epsilon.value) return false;

  const ts = hitIndices.map((index) => line.closestParameterForPoint(points[index]!));
  const t = line.closestParameterForPoint(point);
  const pad = slack.value / dirLen;
  return t >= Math.min(...ts) - pad && t <= Math.max(...ts) + pad;
}

/**
 * Constrained Delaunay triangulation of `points`.
 * Constraint indices refer to the input `points` array (before dedup).
 *
 * Steps: dedup → split crossing constraints → Bowyer-Watson → enforce
 * constraints by flips → legalize unlocked edges.
 */
export function constrainedDelaunay(
  points: readonly Vec2[],
  constraints: readonly ConstraintEdgeInput[] = [],
  slack: Epsilon = Epsilon.preferIn,
  gridSize?: number,
): TriMesh2 {
  if (points.length === 0) return TriMesh2.withoutCleanup([], []);

  const { vertices, remap } = dedupVertices([...points], slack, gridSize);
  const forced = splitAtCrossings(vertices, remapConstraints(constraints, remap, vertices.length));
  if (vertices.length < 3) {
    return TriMesh2.withoutCleanup(
      vertices.map((v) => v.clone()),
      [],
    );
  }

  const triangles = bowyerWatson(vertices);
  for (const edge of forced) {
    const [a, b] = constraintEdgeEndpoints(edge);
    enforce(vertices, triangles, a, b);
  }
  legalize(vertices, triangles, new Set(forced));

  return TriMesh2.withoutCleanup(
    vertices.map((v) => v.clone()),
    triangles.map((t) => [...t] as [number, number, number]),
  );
}

/** Map constraint endpoints through the dedup remap; drop collapsed / duplicate edges. */
function remapConstraints(constraints: readonly ConstraintEdgeInput[], remap: number[], n: number): ConstraintEdge[] {
  const seen = new Set<number>();
  const out: ConstraintEdge[] = [];
  for (const input of constraints) {
    const [ia, ib] = typeof input === 'number' ? constraintEdgeEndpoints(input) : input;
    if (ia < 0 || ib < 0 || ia >= remap.length || ib >= remap.length) throw new Error('Constraint index out of range');
    const a = remap[ia]!;
    const b = remap[ib]!;
    if (a === b) continue;
    if (a >= n || b >= n) throw new Error('Constraint index out of range');
    const key = constraintEdge(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Insert vertices at proper constraint crossings, then rewrite each constraint
 * as consecutive collinear sub-edges so the mesh never has crossing forced edges.
 */
function splitAtCrossings(vertices: Vec2[], constraints: readonly ConstraintEdge[]): ConstraintEdge[] {
  for (let i = 0; i < constraints.length; i++) {
    const [a, b] = constraintEdgeEndpoints(constraints[i]!);
    for (let j = i + 1; j < constraints.length; j++) {
      const [c, d] = constraintEdgeEndpoints(constraints[j]!);
      if (a === c || a === d || b === c || b === d) continue;
      if (!crosses(vertices[a]!, vertices[b]!, vertices[c]!, vertices[d]!)) continue;
      const hit = asPoint(new Line2(vertices[a]!, vertices[b]!).intersect(new Line2(vertices[c]!, vertices[d]!)));
      if (hit && !vertices.some((v) => v.distance(hit) < Epsilon.value)) vertices.push(hit.clone());
    }
  }

  const seen = new Set<number>();
  const out: ConstraintEdge[] = [];
  for (const edge of constraints) {
    const along = onSegment(vertices, ...constraintEdgeEndpoints(edge));
    for (let i = 0; i < along.length - 1; i++) {
      const key = constraintEdge(along[i]!, along[i + 1]!);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/**
 * Incremental Bowyer-Watson Delaunay: insert points into a super-triangle that
 * is discarded at the end. Resulting triangles use CCW winding.
 */
function bowyerWatson(vertices: readonly Vec2[]): [number, number, number][] {
  const box = Aabb2.fromPoints(...vertices);
  const d = Math.max(box.width(), box.height(), 1);
  const c = Vec2.center(box.min(), box.max());
  const s = vertices.length;
  const pts = [
    ...vertices,
    new Vec2(c.x - 20 * d, c.y - d),
    new Vec2(c.x, c.y + 20 * d),
    new Vec2(c.x + 20 * d, c.y - d),
  ];
  const tris: [number, number, number][] = [[s, s + 1, s + 2]];
  for (let i = 0; i < vertices.length; i++) insert(pts, tris, i);
  return tris.filter(([a, b, c]) => a < s && b < s && c < s);
}

/**
 * Insert vertex `p`: remove triangles whose circumcircle contains `p`, then
 * retriangulate the polygonal cavity from its boundary edges.
 */
function insert(vertices: readonly Vec2[], tris: [number, number, number][], p: number): void {
  const bad: number[] = [];
  for (let i = 0; i < tris.length; i++) {
    const [a, b, c] = tris[i]!;
    if (Circle2.inCircle(vertices[a]!, vertices[b]!, vertices[c]!, vertices[p]!)) bad.push(i);
  }
  const edges = edgeCounts(bad.map((i) => tris[i]!));
  for (let i = bad.length - 1; i >= 0; i--) tris.splice(bad[i]!, 1);
  for (const { a, b, count } of edges.values()) {
    if (count !== 1) continue;
    const t = orient(vertices, a, b, p);
    if (t) tris.push(t);
  }
}

/**
 * Ensure edge `a-b` appears in the mesh by repeatedly flipping mesh edges that
 * properly cross the constraint segment.
 */
function enforce(vertices: readonly Vec2[], tris: [number, number, number][], a: number, b: number): void {
  if (a === b) return;
  for (let g = 0; g < Math.max(64, tris.length * 8) && !hasEdge(tris, a, b); g++) {
    if (!crossing(vertices, tris, a, b).some(([u, v]) => flip(vertices, tris, u, v))) break;
  }
}

/**
 * Restore the empty-circumcircle property on unlocked edges after constraints
 * were forced. Locked (constraint) edges are never flipped.
 */
function legalize(vertices: readonly Vec2[], tris: [number, number, number][], locked: ReadonlySet<number>): void {
  for (let g = 0; g < Math.max(64, tris.length * 16); g++) {
    let moved = false;
    for (const [u, v] of [...edgeCounts(tris).values()].filter((e) => e.count === 2).map((e) => [e.a, e.b] as const)) {
      if (locked.has(constraintEdge(u, v))) continue;
      const pair = tris.filter((t) => hasTriEdge(t, u, v));
      if (pair.length !== 2) continue;
      const p = opposite(pair[0]!, u, v);
      const q = opposite(pair[1]!, u, v);
      if (p < 0 || q < 0) continue;
      const illegal =
        Circle2.inCircle(vertices[pair[0]![0]!]!, vertices[pair[0]![1]!]!, vertices[pair[0]![2]!]!, vertices[q]!) ||
        Circle2.inCircle(vertices[pair[1]![0]!]!, vertices[pair[1]![1]!]!, vertices[pair[1]![2]!]!, vertices[p]!);
      if (illegal && flip(vertices, tris, u, v)) {
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }
}

/**
 * Flip shared edge `u-v` of two adjacent triangles into the alternate diagonal
 * of their quad, when the quad is strictly convex.
 */
function flip(vertices: readonly Vec2[], tris: [number, number, number][], u: number, v: number): boolean {
  const idx: number[] = [];
  for (let i = 0; i < tris.length; i++) if (hasTriEdge(tris[i]!, u, v)) idx.push(i);
  if (idx.length !== 2) return false;
  const p = opposite(tris[idx[0]!]!, u, v);
  const q = opposite(tris[idx[1]!]!, u, v);
  if (p < 0 || q < 0 || !convex(vertices[u]!, vertices[p]!, vertices[v]!, vertices[q]!)) return false;
  const n0 = orient(vertices, u, p, q);
  const n1 = orient(vertices, v, q, p);
  if (!n0 || !n1) return false;
  tris[idx[0]!] = n0;
  tris[idx[1]!] = n1;
  return true;
}

/** Mesh edges that properly intersect the open segment `a-b`. */
function crossing(
  vertices: readonly Vec2[],
  tris: readonly [number, number, number][],
  a: number,
  b: number,
): [number, number][] {
  const seen = new Set<number>();
  const out: [number, number][] = [];
  for (const [i, j, k] of tris) {
    for (const [u, v] of [
      [i, j],
      [j, k],
      [k, i],
    ] as [number, number][]) {
      if (u === a || u === b || v === a || v === b) continue;
      const key = constraintEdge(u, v);
      if (seen.has(key) || !crosses(vertices[a]!, vertices[b]!, vertices[u]!, vertices[v]!)) continue;
      seen.add(key);
      out.push([u, v]);
    }
  }
  return out;
}

/** Count how many triangles use each undirected edge (1 = boundary of a cavity). */
function edgeCounts(tris: readonly [number, number, number][]): Map<number, { a: number; b: number; count: number }> {
  const map = new Map<number, { a: number; b: number; count: number }>();
  for (const [a, b, c] of tris) {
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as [number, number][]) {
      const key = constraintEdge(u, v);
      const cur = map.get(key);
      if (cur) cur.count++;
      else map.set(key, { a: u, b: v, count: 1 });
    }
  }
  return map;
}

function hasEdge(tris: readonly [number, number, number][], a: number, b: number): boolean {
  return tris.some((t) => hasTriEdge(t, a, b));
}

function hasTriEdge([i, j, k]: [number, number, number], a: number, b: number): boolean {
  return (
    (i === a && j === b) ||
    (j === a && k === b) ||
    (k === a && i === b) ||
    (i === b && j === a) ||
    (j === b && k === a) ||
    (k === b && i === a)
  );
}

function opposite(t: [number, number, number], a: number, b: number): number {
  return t.find((i) => i !== a && i !== b) ?? -1;
}

/** CCW triangle, or null if `a,b,c` are nearly collinear. */
function orient(vertices: readonly Vec2[], a: number, b: number, c: number): [number, number, number] | null {
  const o = Vec2.orient(vertices[a]!, vertices[b]!, vertices[c]!);
  if (Math.abs(o) < Epsilon.sq) return null;
  return o > 0 ? [a, b, c] : [a, c, b];
}

/** Strict convexity of quad `a-b-c-d` (all turns same sign). */
function convex(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const s = [Vec2.orient(a, b, c), Vec2.orient(b, c, d), Vec2.orient(c, d, a), Vec2.orient(d, a, b)];
  return s.every((v) => v > 0) || s.every((v) => v < 0);
}

/** Proper (non-endpoint, non-collinear) segment intersection. */
function crosses(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o1 = Vec2.orient(a, b, c);
  const o2 = Vec2.orient(a, b, d);
  const o3 = Vec2.orient(c, d, a);
  const o4 = Vec2.orient(c, d, b);
  return (
    Math.sign(o1) !== Math.sign(o2) &&
    Math.sign(o3) !== Math.sign(o4) &&
    Math.abs(o1) > Epsilon.sq &&
    Math.abs(o2) > Epsilon.sq &&
    Math.abs(o3) > Epsilon.sq &&
    Math.abs(o4) > Epsilon.sq
  );
}

/** Vertex indices lying on segment `a-b`, ordered from `a` to `b`. */
function onSegment(vertices: readonly Vec2[], a: number, b: number): number[] {
  const pa = vertices[a]!;
  const pb = vertices[b]!;
  const ab = pb.subtract(pa);
  const lenSq = ab.dot(ab);
  if (lenSq < Epsilon.sq) return [a];
  const along = [
    { i: a, t: 0 },
    { i: b, t: 1 },
  ];
  for (let i = 0; i < vertices.length; i++) {
    if (i === a || i === b) continue;
    const ap = vertices[i]!.subtract(pa);
    if (Math.abs(ap.crossProduct(ab)) > Epsilon.value * Math.sqrt(lenSq)) continue;
    const t = ap.dot(ab) / lenSq;
    if (t > Epsilon.value && t < 1 - Epsilon.value) along.push({ i, t });
  }
  along.sort((x, y) => x.t - y.t);
  return along.map((e) => e.i);
}
