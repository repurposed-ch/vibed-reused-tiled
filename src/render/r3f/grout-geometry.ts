import { BufferGeometry, Float32BufferAttribute, MeshStandardMaterial } from 'three';
import { placementBlock, type DesignInstanceJson } from '@/domain/instance';
import {
  identityMat3,
  invertMat3,
  multiplyMat3,
  transformedRectAabb,
  transformPointMat3,
  type Mat3Json,
} from '@/domain/mat3';
import { cornerRadiusMetres, type TileDefinitionJson } from '@/domain/tile';
import { roundedRectQuarters } from './rounded-slab-geometry';
import type { TileMaps } from './tile-instanced-mesh';

/**
 * Size of the square the joint material is baked at, in metres.
 *
 * Not small: SDF cell counts snap to the bake period, so a 0.1 m period would collapse any
 * feature coarser than 5 per metre to a single cell and repeat visibly every 10 cm.
 */
export const GROUT_BAKE_PERIOD = 0.5;

/** A grout surface is never flush with the floor, even for a joint deeper than the tile. */
export const MIN_GROUT_TOP = 0.0005;

/** Coordinates closer than this, in metres, are the same coordinate. */
export const GROUT_SNAP = 1e-6;

export type GroutPoint = { u: number; v: number };
export type GroutRect = { u0: number; v0: number; u1: number; v1: number };
/**
 * The grout filling one rounded tile corner: the corner of the tile's rect minus the arc.
 * `arc[0]` and `arc[n]` are the tangent points, each lying exactly on one side of the rect.
 */
export type GroutFillet = { corner: GroutPoint; arc: GroutPoint[] };

/**
 * Everything the grout surface is built from, in the layout's own frame — the schema grid's
 * frame, or the world for a loose layout. In that frame every block and every tile rect is
 * axis-aligned, because tiles only ever turn by quarter turns and mirror.
 */
export type GroutPlan = {
  frame: Mat3Json;
  /** Height of the grout surface. */
  top: number;
  blocks: GroutRect[];
  tiles: GroutRect[];
  fillets: GroutFillet[];
};

/**
 * The grout for an instance: the placement blocks minus the tiles, with its surface `depth`
 * below the thinnest tile's top.
 *
 * A grid layout is planned in its grid frame only when every placed tile has a cell block;
 * anything else, including an instance that mixes both, is planned as loose in world space.
 */
export function groutPlan(
  instance: DesignInstanceJson,
  tiles: ReadonlyMap<string, TileDefinitionJson>,
  depth: number,
): GroutPlan | null {
  const placed = instance.placements.flatMap((placement) => {
    const tile = tiles.get(placement.tileDefinitionId);
    return tile ? [{ placement, tile }] : [];
  });
  if (placed.length === 0) return null;

  const grid = instance.grid && placed.every(({ placement }) => placement.cell) ? instance.grid : undefined;
  const frame = grid ? grid.frame : identityMat3();
  const inverse = invertMat3(frame);
  if (!inverse) return null;

  const rectOf = (m: Mat3Json, width: number, height: number): GroutRect => {
    const box = transformedRectAabb(m, width, height);
    return { u0: box.minX, v0: box.minY, u1: box.maxX, v1: box.maxY };
  };

  const blocks: GroutRect[] = [];
  const tileRects: GroutRect[] = [];
  const fillets: GroutFillet[] = [];
  let thinnest = Infinity;
  for (const { placement, tile } of placed) {
    thinnest = Math.min(thinnest, tile.thickness);
    const block = placementBlock(placement, tile, grid);
    blocks.push(rectOf(multiplyMat3(inverse, block.mat3), block.width, block.height));
    const local = multiplyMat3(inverse, placement.mat3);
    const rect = rectOf(local, tile.length, tile.width);
    tileRects.push(rect);
    fillets.push(...tileFillets(local, tile, rect));
  }

  return {
    frame,
    top: Math.max(MIN_GROUT_TOP, thinnest - Math.max(depth, 0)),
    blocks,
    tiles: tileRects,
    fillets,
  };
}

/**
 * The four corner fillets of a rounded tile, from the same outline the tile slab is built from.
 *
 * A tile that is not axis-aligned in the layout frame has no producer today; it gets no
 * fillets, so grout would stop at its bounding rect.
 */
function tileFillets(local: Mat3Json, tile: TileDefinitionJson, rect: GroutRect): GroutFillet[] {
  const e = local.elements;
  const zero = (x: number) => Math.abs(x) <= 1e-9;
  if (!((zero(e[1]) && zero(e[3])) || (zero(e[0]) && zero(e[4])))) return [];
  const { radius, quarters } = roundedRectQuarters(tile.length, tile.width, cornerRadiusMetres(tile));
  if (radius === 0) return [];

  const centreU = (rect.u0 + rect.u1) / 2;
  const centreV = (rect.v0 + rect.v1) / 2;
  return quarters.map((quarter) => {
    const arc = quarter.map((p) => {
      const q = transformPointMat3(local, p.x + tile.length / 2, p.y + tile.width / 2);
      return { u: q.x, v: q.y };
    });
    const mid = arc[arc.length >> 1]!;
    const corner = { u: mid.u < centreU ? rect.u0 : rect.u1, v: mid.v < centreV ? rect.v0 : rect.v1 };
    // Pin the tangent points exactly onto the rect sides they touch.
    const first = arc[0]!;
    const last = arc[arc.length - 1]!;
    if (Math.abs(first.v - corner.v) < Math.abs(first.u - corner.u)) {
      first.v = corner.v;
      last.u = corner.u;
    } else {
      first.u = corner.u;
      last.v = corner.v;
    }
    return { corner, arc };
  });
}

type Interval = readonly [number, number];
type Vert = { u: number; v: number; i: number };

/** Maps each value to the first value of its cluster, clusters being runs within `GROUT_SNAP`. */
function snapper(values: number[]): (x: number) => number {
  const sorted = Float64Array.from(values).sort();
  const starts: number[] = [];
  for (const x of sorted) {
    if (starts.length === 0 || x - starts[starts.length - 1]! > GROUT_SNAP) starts.push(x);
  }
  return (x) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= x) lo = mid;
      else hi = mid - 1;
    }
    return starts[lo]!;
  };
}

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** `a − b` for merged, sorted interval lists. */
function subtractIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  let j = 0;
  for (const [s, e] of a) {
    while (j < b.length && b[j]![1] <= s) j += 1;
    let cursor = s;
    for (let k = j; k < b.length && b[k]![0] < e; k += 1) {
      if (b[k]![0] > cursor) out.push([cursor, b[k]![0]]);
      cursor = Math.max(cursor, b[k]![1]);
    }
    if (cursor < e) out.push([cursor, e]);
  }
  return out;
}

/** `a ∩ b` for merged, sorted interval lists. */
function intersectIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i]![0], b[j]![0]);
    const e = Math.min(a[i]![1], b[j]![1]);
    if (s < e) out.push([s, e]);
    if (a[i]![1] < b[j]![1]) i += 1;
    else j += 1;
  }
  return out;
}

/** Index of the first element `>= x`. */
function lowerBound(sorted: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * One merged mesh for all the grout: a flat surface with every tile cut out, and walls only
 * where the grout meets the edge of the pattern.
 *
 * Grout never lies under a tile and nothing is coplanar with a tile face, so no depth bias is
 * needed — which matters because none survives export to GLB or USDZ.
 *
 * **Construction** is a sweep over horizontal bands of the layout frame. Band lines sit at every
 * block edge, tile edge and fillet tangent point; within a band, grout is the merged block
 * intervals minus the merged tile intervals. Each band piece is a rectangle zipped between the
 * vertices of its two lines, and every triangle bordering a line uses that line's full vertex
 * set, so the surface has no T-junctions. Rounded corners add fillets fanned against the arc.
 *
 * **Texture space** is `R⁻¹ · (world xy) / period`, with R the frame's linear part: aligned to
 * the grid and continuous across it, for a rotated or mirrored frame alike. R⁻¹, not Rᵀ: frame
 * axes are not normalised.
 */
export function buildGroutGeometry(plan: GroutPlan | null, period = GROUT_BAKE_PERIOD): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  if (plan) sweep(plan, period, positions, normals, uvs, indices);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  if (positions.length > 0) {
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  return geometry;
}

function sweep(
  plan: GroutPlan,
  period: number,
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
): void {
  // ---------------------------------------------------------------- snap
  const us: number[] = [];
  const vs: number[] = [];
  for (const r of [...plan.blocks, ...plan.tiles]) us.push(r.u0, r.u1), vs.push(r.v0, r.v1);
  for (const f of plan.fillets) {
    for (const p of [f.corner, f.arc[0]!, f.arc[f.arc.length - 1]!]) us.push(p.u), vs.push(p.v);
  }
  if (us.length === 0) return;
  const snapU = snapper(us);
  const snapV = snapper(vs);

  const snapRect = (r: GroutRect): GroutRect => ({
    u0: snapU(r.u0),
    v0: snapV(r.v0),
    u1: snapU(r.u1),
    v1: snapV(r.v1),
  });
  const nonEmpty = (r: GroutRect) => r.u1 > r.u0 && r.v1 > r.v0;
  const blocks = plan.blocks.map(snapRect).filter(nonEmpty);
  const tiles = plan.tiles.map(snapRect).filter(nonEmpty);
  const fillets = plan.fillets.flatMap((f) => {
    const n = f.arc.length - 1;
    // Two arc segments at least: the end pieces fan from arc[1] and arc[n − 1].
    if (n < 2) return [];
    const corner = { u: snapU(f.corner.u), v: snapV(f.corner.v) };
    const arc = f.arc.map((p, k) => (k === 0 || k === n ? { u: snapU(p.u), v: snapV(p.v) } : p));
    const same = (p: GroutPoint) => p.u === corner.u && p.v === corner.v;
    return same(arc[0]!) || same(arc[n]!) ? [] : [{ corner, arc }];
  });
  if (blocks.length === 0) return;

  // ---------------------------------------------------------------- bands
  const ys = Float64Array.from(
    new Set([...blocks.flatMap((r) => [r.v0, r.v1]), ...tiles.flatMap((r) => [r.v0, r.v1]), ...fillets.flatMap((f) => [f.corner.v, f.arc[0]!.v, f.arc[f.arc.length - 1]!.v])]),
  ).sort();
  const lineOf = new Map<number, number>();
  ys.forEach((y, k) => lineOf.set(y, k));
  const bandCount = ys.length - 1;
  if (bandCount < 1) return;

  const bandBlocks: Interval[][] = Array.from({ length: bandCount }, () => []);
  const bandTiles: Interval[][] = Array.from({ length: bandCount }, () => []);
  for (const r of blocks) for (let k = lineOf.get(r.v0)!; k < lineOf.get(r.v1)!; k += 1) bandBlocks[k]!.push([r.u0, r.u1]);
  for (const r of tiles) for (let k = lineOf.get(r.v0)!; k < lineOf.get(r.v1)!; k += 1) bandTiles[k]!.push([r.u0, r.u1]);
  const blockU = bandBlocks.map(mergeIntervals);
  const groutU = blockU.map((b, k) => subtractIntervals(b, mergeIntervals(bandTiles[k]!)));

  // Every vertex that lies on a line, shared by the triangles on both sides of it.
  const lineSets = Array.from(ys, () => new Set<number>());
  for (let k = 0; k < bandCount; k += 1) {
    for (const [s, e] of [...blockU[k]!, ...groutU[k]!]) {
      lineSets[k]!.add(s).add(e);
      lineSets[k + 1]!.add(s).add(e);
    }
  }
  for (const f of fillets) {
    for (const p of [f.corner, f.arc[0]!, f.arc[f.arc.length - 1]!]) lineSets[lineOf.get(p.v)!]!.add(p.u);
  }
  const lines = lineSets.map((set) => Float64Array.from(set).sort());
  const onLine = (k: number, lo: number, hi: number): number[] => {
    const line = lines[k]!;
    const out: number[] = [];
    for (let i = lowerBound(line, lo); i < line.length && line[i]! <= hi; i += 1) out.push(line[i]!);
    return out;
  };

  const inBlocks = (u: number, v: number): boolean => {
    if (!(v >= ys[0]! && v < ys[bandCount]!)) return false;
    const k = lowerBound(ys, v + Number.MIN_VALUE) - 1;
    return blockU[k]!.some(([s, e]) => u > s && u < e);
  };

  // ---------------------------------------------------------------- emit helpers
  const frame = plan.frame;
  const [a, b, , c, d] = frame.elements;
  const det = a * d - c * b;
  const mirrored = det < 0;

  const vertex = (u: number, v: number, z: number, nx: number, ny: number, nz: number): number => {
    const p = transformPointMat3(frame, u, v);
    positions.push(p.x, p.y, z);
    normals.push(nx, ny, nz);
    uvs.push((d * p.x - c * p.y) / det / period, (-b * p.x + a * p.y) / det / period);
    return positions.length / 3 - 1;
  };

  const topIndex = Array.from(ys, () => new Map<number, number>());
  const lineVert = (k: number, u: number): Vert => {
    const map = topIndex[k]!;
    let i = map.get(u);
    if (i === undefined) {
      i = vertex(u, ys[k]!, plan.top, 0, 0, 1);
      map.set(u, i);
    }
    return { u, v: ys[k]!, i };
  };

  /** A top triangle, wound counter-clockwise in world space whatever order it is given in. */
  const triangle = (p: Vert, q: Vert, r: Vert) => {
    const cross = (q.u - p.u) * (r.v - p.v) - (q.v - p.v) * (r.u - p.u);
    if (Math.abs(cross) <= 1e-18) return;
    if (cross > 0 !== mirrored) indices.push(p.i, q.i, r.i);
    else indices.push(p.i, r.i, q.i);
  };

  const walls: Array<[GroutPoint, GroutPoint]> = [];
  /** Wall pieces along a run of points, with the grout on the left of the direction of travel. */
  const wallRun = (points: readonly GroutPoint[]) => {
    for (let k = 0; k + 1 < points.length; k += 1) walls.push([points[k]!, points[k + 1]!]);
  };

  // ---------------------------------------------------------------- top surface
  for (let k = 0; k < bandCount; k += 1) {
    for (const [s, e] of groutU[k]!) {
      const bottom = onLine(k, s, e).map((u) => lineVert(k, u));
      const top = onLine(k + 1, s, e).map((u) => lineVert(k + 1, u));
      let i = 0;
      let j = 0;
      while (i < bottom.length - 1 || j < top.length - 1) {
        if (j === top.length - 1 || (i < bottom.length - 1 && bottom[i + 1]!.u <= top[j + 1]!.u)) {
          triangle(bottom[i]!, bottom[i + 1]!, top[j]!);
          i += 1;
        } else {
          triangle(bottom[i]!, top[j + 1]!, top[j]!);
          j += 1;
        }
      }
    }
  }

  // ---------------------------------------------------------------- fillets
  const probe = GROUT_SNAP / 2;
  for (const f of fillets) {
    const n = f.arc.length - 1;
    const mid = f.arc[n >> 1]!;
    const du = Math.sign(mid.u - f.corner.u);
    const dv = Math.sign(mid.v - f.corner.v);
    // A corner outside every block belongs to a stale layout, not to a joint.
    if (!inBlocks(f.corner.u + du * probe, f.corner.v + dv * probe)) continue;

    const kc = lineOf.get(f.corner.v)!;
    const corner = lineVert(kc, f.corner.u);
    const arc = f.arc.map((p, k): Vert =>
      k === 0 || k === n
        ? lineVert(lineOf.get(p.v)!, p.u)
        : { u: p.u, v: p.v, i: vertex(p.u, p.v, plan.top, 0, 0, 1) },
    );
    for (let k = 1; k <= n - 2; k += 1) triangle(corner, arc[k]!, arc[k + 1]!);

    for (const [end, apex] of [
      [0, 1],
      [n, n - 1],
    ] as const) {
      const tangent = arc[end]!;
      // Every line vertex on the side from the corner to the tangent point, in that order.
      let chain: Vert[];
      if (tangent.v === corner.v) {
        chain = onLine(kc, Math.min(corner.u, tangent.u), Math.max(corner.u, tangent.u)).map((u) => lineVert(kc, u));
        if (tangent.u < corner.u) chain.reverse();
      } else {
        const kt = lineOf.get(tangent.v)!;
        const step = kt > kc ? 1 : -1;
        chain = [];
        for (let k = kc; k !== kt + step; k += step) {
          if (k === kc || k === kt || lineSets[k]!.has(corner.u)) chain.push(lineVert(k, corner.u));
        }
      }
      for (let s = 0; s + 1 < chain.length; s += 1) triangle(arc[apex]!, chain[s]!, chain[s + 1]!);

      // On the pattern edge (a joint of zero), the fillet side is exposed and needs a wall.
      const horizontal = tangent.v === corner.v;
      for (let s = 0; s + 1 < chain.length; s += 1) {
        const p = chain[s]!;
        const q = chain[s + 1]!;
        const mu = (p.u + q.u) / 2;
        const mv = (p.v + q.v) / 2;
        const outside = horizontal ? !inBlocks(mu, mv - dv * probe) : !inBlocks(mu - du * probe, mv);
        if (!outside) continue;
        // The fillet lies towards (du, dv); keep it on the left of the wall's direction.
        const dirU = q.u - p.u;
        const dirV = q.v - p.v;
        const left = -dirV * du + dirU * dv;
        walls.push(left > 0 ? [p, q] : [q, p]);
      }
    }
  }

  // ---------------------------------------------------------------- walls on the pattern edge
  for (let k = 0; k < bandCount; k += 1) {
    const starts = new Set(groutU[k]!.map(([s]) => s));
    const ends = new Set(groutU[k]!.map(([, e]) => e));
    for (const [s, e] of blockU[k]!) {
      if (starts.has(s)) walls.push([{ u: s, v: ys[k + 1]! }, { u: s, v: ys[k]! }]);
      if (ends.has(e)) walls.push([{ u: e, v: ys[k]! }, { u: e, v: ys[k + 1]! }]);
    }
  }
  for (let k = 0; k <= bandCount; k += 1) {
    const below = k > 0 ? blockU[k - 1]! : [];
    const above = k < bandCount ? blockU[k]! : [];
    const y = ys[k]!;
    // Grout below, nothing above: travel towards −u so the grout is on the left.
    for (const [s, e] of intersectIntervals(subtractIntervals(below, above), k > 0 ? groutU[k - 1]! : [])) {
      wallRun(onLine(k, s, e).reverse().map((u) => ({ u, v: y })));
    }
    for (const [s, e] of intersectIntervals(subtractIntervals(above, below), k < bandCount ? groutU[k]! : [])) {
      wallRun(onLine(k, s, e).map((u) => ({ u, v: y })));
    }
  }

  for (const [p, q] of walls) {
    // Grout is on the left in the frame; a mirrored frame puts it on the right in the world.
    const [from, to] = mirrored ? [q, p] : [p, q];
    const wp = transformPointMat3(frame, from.u, from.v);
    const wq = transformPointMat3(frame, to.u, to.v);
    const dx = wq.x - wp.x;
    const dy = wq.y - wp.y;
    const len = Math.hypot(dx, dy);
    if (len <= 1e-12) continue;
    // Outward normal of an edge with the grout on its left.
    const nx = dy / len;
    const ny = -dx / len;
    const p0 = vertex(from.u, from.v, 0, nx, ny, 0);
    const q0 = vertex(to.u, to.v, 0, nx, ny, 0);
    const q1 = vertex(to.u, to.v, plan.top, nx, ny, 0);
    const p1 = vertex(from.u, from.v, plan.top, nx, ny, 0);
    indices.push(p0, q0, q1, p0, q1, p1);
  }
}

/** The joint's material. Textures are borrowed from the texture cache, never owned. */
export function createGroutMaterial(maps: TileMaps | null): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    map: maps?.map ?? null,
    normalMap: maps?.normalMap ?? null,
    roughnessMap: maps?.roughnessMap ?? null,
  });
}
