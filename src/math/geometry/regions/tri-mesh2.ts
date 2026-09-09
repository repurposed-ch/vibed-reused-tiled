import { Aabb2 } from '../../bounds/aabb2';
import { Epsilon } from '../../core/epsilon';
import { dehash2, hash2 } from '../../hash/core';
import { Vec2, type Vec2Json } from '../../core/vec2';
import { dedupVertices } from '../../operations/spatial/dedup-vertices';
import { Line2 } from '../primitives/line2';
import { Polygon2 } from './polygon2';

export type BoundaryLoop2 = {
  polygon: Polygon2;
  /** Positive for counter-clockwise, negative for clockwise. */
  signedArea: number;
};

export class TriMesh2 {
  static readonly type = 'TriMesh2' as const;
  public vertices: Vec2[];
  public triangles: [number, number, number][];

  private boundaryLoopsCache: BoundaryLoop2[] | null = null;
  private boundaryLoopPolygonsCache: Polygon2[] | null = null;

  /**
   * Constructs a new tri-mesh from the given vertices and triangles.
   * Will deduplicate vertices and remove degenerate triangles on creation.
   * @param vertices - The vertices of the mesh.
   * @param triangles - The triangles of the mesh.
   * @param slack - The slack value for merging vertices - should be positive.
   * @param gridSize - The size of the grid cells.
   */
  constructor(
    vertices: Vec2[],
    triangles: [number, number, number][],
    slack: Epsilon = Epsilon.preferIn,
    gridSize?: number,
  ) {
    slack.isPositive(TriMesh2.type, 'constructor');
    const reducedResult = TriMesh2.reduceVertices(vertices, triangles, slack, gridSize);
    const cleanedTriangles = TriMesh2.removeDegenerateTriangles(
      reducedResult.newVertices,
      reducedResult.newTriangles,
      slack,
    );
    const unusedResult = TriMesh2.removeUnusedVertices(reducedResult.newVertices, cleanedTriangles);
    this.vertices = unusedResult.newVertices;
    this.triangles = unusedResult.newTriangles;
  }

  /** reduce duplicate vertices */
  private static reduceVertices(
    vertices: Vec2[],
    triangles: [number, number, number][],
    slack: Epsilon,
    gridSize?: number,
  ): { newVertices: Vec2[]; newTriangles: [number, number, number][] } {
    const { vertices: newVertices, remap } = dedupVertices(vertices, slack, gridSize);

    // reduce the vertex indices and map skipped indices
    // replace the triangle indices
    const newTriangles = triangles.map(([a, b, c]) => [remap[a]!, remap[b]!, remap[c]!] as [number, number, number]);

    return { newVertices, newTriangles };
  }

  /** remove degenerate triangles */
  private static removeDegenerateTriangles(
    vertices: Vec2[],
    triangles: [number, number, number][],
    slack: Epsilon,
  ): [number, number, number][] {
    const cleaned: [number, number, number][] = [];

    for (const [i, j, k] of triangles) {
      // for each triangle, remove if there are duplicate vertex indices
      if (i === j || j === k || k === i) continue;

      const a = vertices[i]!;
      const b = vertices[j]!;
      const c = vertices[k]!;

      const orient = Vec2.orient(a, b, c);
      if (Math.abs(orient) < Epsilon.sq) continue;

      // for each triangle, remove if the triangle area is less than slack.value * longest triangle edge length
      const maxEdge = Math.max(a.distance(b), b.distance(c), c.distance(a));
      if (Math.abs(orient) < slack.value * maxEdge) continue;

      // conform to CCW orientation
      cleaned.push(orient > 0 ? [i, j, k] : [i, k, j]);
    }

    return cleaned;
  }

  /** remove unused vertices */
  private static removeUnusedVertices(
    vertices: Vec2[],
    triangles: [number, number, number][],
  ): { newVertices: Vec2[]; newTriangles: [number, number, number][] } {
    if (triangles.length === 0) {
      return { newVertices: vertices.map((vertex) => vertex.clone()), newTriangles: [] };
    }

    const used = new Set<number>();
    triangles.forEach((face) => face.forEach((index) => used.add(index)));

    const remap = new Map<number, number>();
    const newVertices: Vec2[] = [];

    for (let index = 0; index < vertices.length; index++) {
      if (!used.has(index)) continue;
      remap.set(index, newVertices.length);
      newVertices.push(vertices[index]!.clone());
    }

    const newTriangles = triangles.map(
      ([i, j, k]) => [remap.get(i)!, remap.get(j)!, remap.get(k)!] as [number, number, number],
    );

    return { newVertices, newTriangles };
  }

  /**
   * True when `point` lies in the mesh region.
   * Uses even-odd over boundary loops when the mesh has a boundary; otherwise tests triangle union.
   * @param slack Boundary slack; defaults to `Epsilon.preferIn`.
   */
  containsPoint(point: Vec2, slack: Epsilon = Epsilon.preferIn): boolean {
    const loopPolygons = this.boundaryLoopPolygons();
    if (loopPolygons.length > 0) {
      return Polygon2.isPointInside(loopPolygons, point, slack);
    }

    for (const [i, j, k] of this.triangles) {
      if (triangleContainsPoint(this.vertices[i]!, this.vertices[j]!, this.vertices[k]!, point, slack)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Negative inside, positive outside, zero on the boundary.
   * Uses even-odd over boundary loops when the mesh has a boundary.
   */
  signedDistance(point: Vec2): number {
    const loopPolygons = this.boundaryLoopPolygons();
    if (loopPolygons.length > 0) {
      return Polygon2.signedDistanceFromLoops(loopPolygons, point);
    }

    const distance = this.distanceToPoint(point);
    return this.containsPoint(point, Epsilon.preferIn) ? -distance : distance;
  }

  distanceToPoint(point: Vec2): number {
    if (this.triangles.length === 0) {
      if (this.vertices.length === 0) return Infinity;
      return Math.min(...this.vertices.map((vertex) => point.distance(vertex)));
    }

    const nakedEdges = this.nakedEdges();
    if (nakedEdges.length === 0) {
      if (this.vertices.length === 0) return Infinity;
      return Math.min(...this.vertices.map((vertex) => point.distance(vertex)));
    }

    return Line2.closestToPointForSegments(nakedEdges, point).smallestDistance;
  }

  aabb2(): Aabb2 {
    return Aabb2.fromPoints(...this.vertices);
  }

  /** Undirected mesh edges with one entry per vertex pair. */
  uniqueEdges(): Line2[] {
    return Array.from(this.uniqueEdgeIds()).map((key) => this.edgeVertices(key));
  }

  /** Boundary edges incident to exactly one triangle. */
  nakedEdges(): Line2[] {
    return Array.from(this.uniqueEdgeCounts().entries())
      .filter(([_, count]) => count === 1)
      .map(([key]) => this.edgeVertices(key));
  }

  /** Interior edges shared by two or more triangles. */
  coveredEdges(): Line2[] {
    return Array.from(this.uniqueEdgeCounts().entries())
      .filter(([_, count]) => count > 1)
      .map(([key]) => this.edgeVertices(key));
  }

  /**
   * Closed boundary loops chained from naked edges.
   * Winding follows triangle orientation on each boundary half-edge.
   */
  boundaryLoops(): BoundaryLoop2[] {
    if (this.boundaryLoopsCache) return this.boundaryLoopsCache;
    this.boundaryLoopsCache = this.computeBoundaryLoops();
    this.boundaryLoopPolygonsCache = this.boundaryLoopsCache.map((loop) => loop.polygon);
    return this.boundaryLoopsCache;
  }

  /** Boundary loops as polygons (empty for closed meshes). */
  boundaryLoopPolygons(): Polygon2[] {
    if (this.boundaryLoopPolygonsCache) return this.boundaryLoopPolygonsCache;
    this.boundaryLoops();
    return this.boundaryLoopPolygonsCache ?? [];
  }

  private computeBoundaryLoops(): BoundaryLoop2[] {
    const directed = this.directedNakedEdges();
    if (directed.length === 0) return [];

    const outgoing = new Map<number, number[]>();
    for (const [from, to] of directed) {
      const targets = outgoing.get(from) ?? [];
      targets.push(to);
      outgoing.set(from, targets);
    }

    const used = new Set<number>();
    const loops: BoundaryLoop2[] = [];
    const maxSteps = directed.length + 1;

    for (const [start, end] of directed) {
      const startKey = hash2(start, end);
      if (used.has(startKey)) continue;

      const indices: number[] = [start];
      let from = start;
      let to = end;
      used.add(startKey);

      while (to !== start && indices.length < maxSteps) {
        indices.push(to);

        const next = TriMesh2.nextBoundaryVertex(this.vertices, from, to, outgoing);
        if (next === null) break;

        from = to;
        to = next;
        const edgeKey = hash2(from, to);
        if (used.has(edgeKey)) break;
        used.add(edgeKey);
      }

      if (to !== start || indices.length < 3) continue;

      const vertices = indices.map((index) => this.vertices[index]!.clone());
      const signedArea = Polygon2.signedArea(vertices);
      loops.push({ polygon: new Polygon2(vertices), signedArea });
    }

    return loops;
  }

  /** Pick the sharpest left turn at a boundary vertex (interior stays on the left). */
  private static nextBoundaryVertex(
    vertices: readonly Vec2[],
    from: number,
    to: number,
    outgoing: ReadonlyMap<number, readonly number[]>,
  ): number | null {
    const candidates = (outgoing.get(to) ?? []).filter((target) => target !== from);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0]!;

    const fromVertex = vertices[from]!;
    const toVertex = vertices[to]!;

    let best = candidates[0]!;
    let bestTurn = Vec2.orient(fromVertex, toVertex, vertices[best]!);

    for (let index = 1; index < candidates.length; index++) {
      const candidate = candidates[index]!;
      const turn = Vec2.orient(fromVertex, toVertex, vertices[candidate]!);
      if (turn > bestTurn) {
        bestTurn = turn;
        best = candidate;
      }
    }

    return best;
  }

  private directedNakedEdges(): [number, number][] {
    const counts = this.uniqueEdgeCounts();
    const directed: [number, number][] = [];

    for (const [i, j, k] of this.triangles) {
      for (const [a, b] of [
        [i, j],
        [j, k],
        [k, i],
      ] as [number, number][]) {
        if (counts.get(TriMesh2.edgeKey(a, b)) === 1) {
          directed.push([a, b]);
        }
      }
    }

    return directed;
  }

  private edgeVertices(key: number): Line2 {
    const [i, j] = dehash2(key);
    return new Line2(this.vertices[i]!, this.vertices[j]!);
  }

  private static edgeKey(a: number, b: number): number {
    return a < b ? hash2(a, b) : hash2(b, a);
  }

  private uniqueEdgeIds(): Set<number> {
    const set = new Set<number>();
    for (const [i, j, k] of this.triangles) {
      set.add(TriMesh2.edgeKey(i, j));
      set.add(TriMesh2.edgeKey(j, k));
      set.add(TriMesh2.edgeKey(k, i));
    }
    return set;
  }

  private uniqueEdgeCounts(): Map<number, number> {
    const counts = new Map<number, number>();

    for (const [i, j, k] of this.triangles) {
      for (const [a, b] of [
        [i, j],
        [j, k],
        [k, i],
      ] as [number, number][]) {
        const key = TriMesh2.edgeKey(a, b);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }

    return counts;
  }

  /**
   * Create a mesh from vertices and triangles without dedupe, degenerate, or unused-vertex cleanup.
   * Use when the caller already provides a consistent mesh (e.g. after CDT).
   */
  static withoutCleanup(vertices: Vec2[], triangles: [number, number, number][]): TriMesh2 {
    const mesh = Object.create(TriMesh2.prototype) as TriMesh2;
    mesh.vertices = vertices;
    mesh.triangles = triangles;
    mesh.boundaryLoopsCache = null;
    mesh.boundaryLoopPolygonsCache = null;
    return mesh;
  }

  toJson(): TriMesh2Json {
    return {
      type: TriMesh2.type,
      vertices: this.vertices.map((v) => v.toJson()),
      triangles: this.triangles.map(([a, b, c]) => [a, b, c]),
    };
  }
}

export type TriMesh2Json = {
  type: typeof TriMesh2.type;
  vertices: Vec2Json[];
  triangles: [number, number, number][];
};

function triangleContainsPoint(a: Vec2, b: Vec2, c: Vec2, point: Vec2, slack: Epsilon): boolean {
  const o1 = Vec2.orient(a, b, point);
  const o2 = Vec2.orient(b, c, point);
  const o3 = Vec2.orient(c, a, point);
  const { value: signedSlack, sq: eps } = slack;

  if (signedSlack > 0) {
    const hasPos = o1 > eps || o2 > eps || o3 > eps;
    const hasNeg = o1 < -eps || o2 < -eps || o3 < -eps;
    return !(hasPos && hasNeg);
  }

  const positive = o1 > eps && o2 > eps && o3 > eps;
  const negative = o1 < -eps && o2 < -eps && o3 < -eps;
  return positive || negative;
}
