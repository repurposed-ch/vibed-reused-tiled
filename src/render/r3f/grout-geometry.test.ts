import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  instanceBlocks,
  type DesignInstanceJson,
  type InstanceGridJson,
  type PlacementJson,
} from '@/domain/instance';
import {
  identityMat3,
  multiplyMat3,
  rotationMat3,
  scaleMat3,
  transformPointMat3,
  translationMat3,
  type Mat3Json,
} from '@/domain/mat3';
import { cornerRadiusMetres, createTileDefinition, type TileDefinitionJson } from '@/domain/tile';
import { groutPathD } from '@/render/svg/grout-path';
import { buildGroutGeometry, GROUT_BAKE_PERIOD, groutPlan, MIN_GROUT_TOP } from './grout-geometry';
import { roundedRectOutline } from './rounded-slab-geometry';

type P2 = { x: number; y: number };

const CELL = 0.15;
const square = createTileDefinition({ id: 'sq', length: 0.14, width: 0.14, thickness: 0.02 });
const rounded = createTileDefinition({ id: 'rd', length: 0.14, width: 0.14, thickness: 0.02, cornerRounding: 0.1 });
const slab = createTileDefinition({ id: 'sl', length: 0.29, width: 0.14, thickness: 0.02, cornerRounding: 0.1 });
/** Undersized for its cell in both axes, by different amounts. */
const small = createTileDefinition({ id: 'sm', length: 0.13, width: 0.12, thickness: 0.02, cornerRounding: 0.05 });
const flushSquare = createTileDefinition({ id: 'fs', length: CELL, width: CELL, thickness: 0.02 });
const flushRounded = createTileDefinition({ id: 'fr', length: CELL, width: CELL, thickness: 0.02, cornerRounding: 0.1 });
const thin = createTileDefinition({ id: 'th', length: 0.14, width: 0.14, thickness: 0.01 });
const big = createTileDefinition({ id: 'bg', length: 0.3, width: 0.3, thickness: 0.02 });
const oversized = createTileDefinition({ id: 'ov', length: 0.2, width: 0.2, thickness: 0.02, cornerRounding: 0.1 });
const catalogue = new Map(
  [square, rounded, slab, small, flushSquare, flushRounded, thin, big, oversized].map((t) => [t.id, t]),
);

/** Mirrors orientationMat3 in tile-grid-fill.ts. */
function orientation(tile: TileDefinitionJson, rotated: boolean, fx: boolean, fy: boolean): Mat3Json {
  const orient = rotated ? multiplyMat3(translationMat3(tile.width, 0), rotationMat3(Math.PI / 2)) : null;
  const w = rotated ? tile.width : tile.length;
  const h = rotated ? tile.length : tile.width;
  const mirror =
    fx || fy ? multiplyMat3(translationMat3(fx ? w : 0, fy ? h : 0), scaleMat3(fx ? -1 : 1, fy ? -1 : 1)) : null;
  if (mirror && orient) return multiplyMat3(mirror, orient);
  return mirror ?? orient ?? identityMat3();
}

type Spec = {
  tile: TileDefinitionJson;
  i: number;
  j: number;
  iSpan?: number;
  jSpan?: number;
  rotated?: boolean;
  fx?: boolean;
  fy?: boolean;
};

/** A schema-fill-like instance: each tile centred in its cell block. */
function gridInstance(frame: Mat3Json, specs: Spec[], joint = 0.01): DesignInstanceJson {
  const grid: InstanceGridJson = { frame, cell: { x: CELL, y: CELL }, joint };
  const placements = specs.map((s, n): PlacementJson => {
    const iSpan = s.iSpan ?? 1;
    const jSpan = s.jSpan ?? 1;
    const w = s.rotated ? s.tile.width : s.tile.length;
    const h = s.rotated ? s.tile.length : s.tile.width;
    const inset = translationMat3(s.i * CELL + (iSpan * CELL - w) / 2, s.j * CELL + (jSpan * CELL - h) / 2);
    return {
      id: `p${n}`,
      tileDefinitionId: s.tile.id,
      mat3: multiplyMat3(frame, multiplyMat3(inset, orientation(s.tile, !!s.rotated, !!s.fx, !!s.fy))),
      cell: { i: s.i, j: s.j, iSpan, jSpan },
    };
  });
  return { type: 'DesignInstance', placements, grid };
}

function looseInstance(mats: Array<[TileDefinitionJson, Mat3Json]>): DesignInstanceJson {
  return {
    type: 'DesignInstance',
    placements: mats.map(([tile, mat3], n) => ({ id: `p${n}`, tileDefinitionId: tile.id, mat3 })),
  };
}

const frames: Array<[string, Mat3Json]> = [
  ['plain', translationMat3(0.3, -0.2)],
  ['rotated', multiplyMat3(translationMat3(-1.1, 2.3), rotationMat3(0.73))],
  ['mirrored', multiplyMat3(translationMat3(0.5, 0.9), scaleMat3(-1, 1))],
];

const layouts: Array<[string, (frame: Mat3Json) => DesignInstanceJson, number]> = [
  [
    'square 2×2',
    (f) =>
      gridInstance(f, [
        { tile: square, i: 0, j: 0 },
        { tile: square, i: 1, j: 0 },
        { tile: square, i: 0, j: 1 },
        { tile: square, i: 1, j: 1 },
      ]),
    4 * 2 * CELL,
  ],
  [
    'rounded mixed formats',
    (f) =>
      gridInstance(f, [
        { tile: slab, i: 0, j: 0, iSpan: 2 },
        { tile: rounded, i: 0, j: 1, fx: true },
        { tile: small, i: 1, j: 1, rotated: true },
        { tile: slab, i: 2, j: 0, jSpan: 2, rotated: true, fy: true },
      ]),
    2 * (3 * CELL + 2 * CELL),
  ],
];

const cases = frames.flatMap(([frameName, frame]) =>
  layouts.map(([layoutName, build, perimeter]) => [`${layoutName}, ${frameName}`, build(frame), perimeter] as const),
);

// ------------------------------------------------------------------ reading the mesh
function read(instance: DesignInstanceJson, depth = 0.0015) {
  const geometry = buildGroutGeometry(groutPlan(instance, catalogue, depth));
  const pos = geometry.getAttribute('position');
  const nrm = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const verts = Array.from({ length: pos.count }, (_, i) => ({
    p: new Vector3().fromBufferAttribute(pos, i),
    n: new Vector3().fromBufferAttribute(nrm, i),
    uv: [uv.getX(i), uv.getY(i)] as const,
  }));
  const index = geometry.getIndex()!;
  const tris: Array<[number, number, number]> = [];
  for (let t = 0; t < index.count; t += 3) tris.push([index.getX(t), index.getX(t + 1), index.getX(t + 2)]);
  const top = tris.filter((t) => t.every((i) => verts[i]!.n.z > 0.5));
  const walls = tris.filter((t) => t.every((i) => Math.abs(verts[i]!.n.z) < 1e-6));
  expect(top.length + walls.length).toBe(tris.length);
  return { geometry, verts, top, walls };
}

type Mesh = ReturnType<typeof read>;
const xy = (v: Vector3): P2 => ({ x: v.x, y: v.y });
const cross = (a: P2, b: P2, c: P2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function outlineOf(p: PlacementJson): P2[] {
  const tile = catalogue.get(p.tileDefinitionId)!;
  return roundedRectOutline(tile.length, tile.width, cornerRadiusMetres(tile)).map((q) =>
    transformPointMat3(p.mat3, q.x + tile.length / 2, q.y + tile.width / 2),
  );
}

function polygonArea(poly: P2[]): number {
  let sum = 0;
  for (let k = 0; k < poly.length; k += 1) {
    const a = poly[k]!;
    const b = poly[(k + 1) % poly.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function insidePolygon(poly: P2[], p: P2): boolean {
  let inside = false;
  for (let k = 0, j = poly.length - 1; k < poly.length; j = k, k += 1) {
    const a = poly[k]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToPolygon(poly: P2[], p: P2): number {
  let best = Infinity;
  for (let k = 0; k < poly.length; k += 1) {
    const a = poly[k]!;
    const b = poly[(k + 1) % poly.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}

function blockPolygons(instance: DesignInstanceJson): P2[][] {
  return instanceBlocks(instance, catalogue).map((b) =>
    [
      [0, 0],
      [b.width, 0],
      [b.width, b.height],
      [0, b.height],
    ].map(([x, y]) => transformPointMat3(b.mat3, x!, y!)),
  );
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ shared checks
function expectNoGroutUnderTiles(instance: DesignInstanceJson, mesh: Mesh) {
  const outlines = instance.placements.filter((p) => catalogue.has(p.tileDefinitionId)).map(outlineOf);
  for (const [a, b, c] of mesh.top) {
    const centroid = {
      x: (mesh.verts[a]!.p.x + mesh.verts[b]!.p.x + mesh.verts[c]!.p.x) / 3,
      y: (mesh.verts[a]!.p.y + mesh.verts[b]!.p.y + mesh.verts[c]!.p.y) / 3,
    };
    for (const outline of outlines) expect(insidePolygon(outline, centroid)).toBe(false);
  }
}

function topArea(mesh: Mesh): number {
  return mesh.top.reduce(
    (sum, [a, b, c]) => sum + cross(xy(mesh.verts[a]!.p), xy(mesh.verts[b]!.p), xy(mesh.verts[c]!.p)) / 2,
    0,
  );
}

/** Blocks must be disjoint and hold their tiles for block area − outline area to be the grout area. */
function expectAreaIdentity(instance: DesignInstanceJson, mesh: Mesh) {
  const blocks = blockPolygons(instance).reduce((sum, poly) => sum + polygonArea(poly), 0);
  const outlines = instance.placements.reduce((sum, p) => sum + polygonArea(outlineOf(p)), 0);
  expect(Math.abs(topArea(mesh) - (blocks - outlines))).toBeLessThan(1e-5);
}

/** Grout covers every point of the blocks outside the tiles exactly once, and nothing inside a tile. */
function expectCoverage(instance: DesignInstanceJson, mesh: Mesh, samples = 1500) {
  const blocks = blockPolygons(instance);
  const outlines = instance.placements.map(outlineOf);
  const all = blocks.flat();
  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const maxY = Math.max(...all.map((p) => p.y));
  const random = mulberry32(7);
  const triangles = mesh.top.map((t) => t.map((i) => xy(mesh.verts[i]!.p)) as [P2, P2, P2]);
  let checked = 0;
  for (let s = 0; s < samples; s += 1) {
    const p = { x: minX + random() * (maxX - minX), y: minY + random() * (maxY - minY) };
    if (outlines.some((o) => distanceToPolygon(o, p) < 1e-5)) continue;
    if (blocks.some((o) => distanceToPolygon(o, p) < 1e-5)) continue;
    const inBlock = blocks.some((o) => insidePolygon(o, p));
    const inTile = outlines.some((o) => insidePolygon(o, p));
    const hits = triangles.filter(([a, b, c]) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0);
    expect(hits.length).toBe(inBlock && !inTile ? 1 : 0);
    checked += 1;
  }
  expect(checked).toBeGreaterThan(samples / 4);
}

/** Wall quads in emission order: [top-edge from, top-edge to, outward normal]. */
function wallQuads(mesh: Mesh) {
  const out: Array<{ p: P2; q: P2; n: Vector3 }> = [];
  for (let w = 0; w + 1 < mesh.walls.length; w += 2) {
    const q1 = mesh.verts[mesh.walls[w]![2]]!;
    const p1 = mesh.verts[mesh.walls[w + 1]![2]]!;
    out.push({ p: xy(p1.p), q: xy(q1.p), n: q1.n });
  }
  return out;
}

function expectWalls(instance: DesignInstanceJson, mesh: Mesh, perimeter: number) {
  const blocks = blockPolygons(instance);
  const inUnion = (p: P2) => blocks.some((o) => insidePolygon(o, p));
  let length = 0;
  for (const { p, q, n } of wallQuads(mesh)) {
    length += Math.hypot(q.x - p.x, q.y - p.y);
    const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    expect(inUnion({ x: m.x + n.x * 1e-5, y: m.y + n.y * 1e-5 })).toBe(false);
    expect(inUnion({ x: m.x - n.x * 1e-5, y: m.y - n.y * 1e-5 })).toBe(true);
  }
  expect(length).toBeCloseTo(perimeter, 5);
  // Every wall triangle is wound to face its normal.
  for (const [a, b, c] of mesh.walls) {
    const [pa, pb, pc] = [a, b, c].map((i) => mesh.verts[i]!.p);
    const face = new Vector3().subVectors(pb!, pa!).cross(new Vector3().subVectors(pc!, pa!));
    expect(face.dot(mesh.verts[a]!.n)).toBeGreaterThan(0);
  }
}

// ------------------------------------------------------------------ tests
describe('grout surface', () => {
  it.each(cases)('never lies under a tile: %s', (_name, instance) => {
    expectNoGroutUnderTiles(instance, read(instance));
  });

  it.each(cases)('covers exactly the blocks minus the tile outlines: %s', (_name, instance) => {
    const mesh = read(instance);
    expectAreaIdentity(instance, mesh);
    expectCoverage(instance, mesh);
  });

  it.each(cases)('cuts every tile hole along the tile outline itself: %s', (_name, instance) => {
    const mesh = read(instance);
    const top = [...new Set(mesh.top.flat())].map((i) => xy(mesh.verts[i]!.p));
    for (const placement of instance.placements) {
      for (const point of outlineOf(placement)) {
        const nearest = Math.min(...top.map((t) => Math.hypot(t.x - point.x, t.y - point.y)));
        expect(nearest).toBeLessThan(1e-6);
      }
    }
  });

  it.each(cases)('has no T-junctions in the surface: %s', (_name, instance) => {
    const mesh = read(instance);
    const ids = [...new Set(mesh.top.flat())];
    const edges = new Set<string>();
    for (const [a, b, c] of mesh.top) {
      for (const [p, q] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        edges.add(p < q ? `${p},${q}` : `${q},${p}`);
      }
    }
    for (const edge of edges) {
      const [p, q] = edge.split(',').map(Number) as [number, number];
      const a = xy(mesh.verts[p]!.p);
      const b = xy(mesh.verts[q]!.p);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      for (const id of ids) {
        if (id === p || id === q) continue;
        const v = xy(mesh.verts[id]!.p);
        const t = ((v.x - a.x) * (b.x - a.x) + (v.y - a.y) * (b.y - a.y)) / (len * len);
        if (t * len < 1e-6 || (1 - t) * len < 1e-6) continue;
        expect(Math.abs(cross(a, b, v)) / len).toBeGreaterThan(1e-6);
      }
    }
  });

  it.each(cases)('puts walls only on the pattern edge, facing out: %s', (_name, instance, perimeter) => {
    expectWalls(instance, read(instance), perimeter);
  });

  it.each(cases)('faces the surface up and maps texture from the grid frame: %s', (_name, instance) => {
    const mesh = read(instance);
    for (const [a, b, c] of mesh.top) {
      expect(cross(xy(mesh.verts[a]!.p), xy(mesh.verts[b]!.p), xy(mesh.verts[c]!.p))).toBeGreaterThan(0);
      for (const i of [a, b, c]) expect(mesh.verts[i]!.n.z).toBeCloseTo(1, 12);
    }
    const [m00, m10, , m01, m11] = instance.grid!.frame.elements;
    const det = m00 * m11 - m01 * m10;
    for (const { p, uv } of mesh.verts) {
      expect(uv[0]).toBeCloseTo((m11 * p.x - m01 * p.y) / det / GROUT_BAKE_PERIOD, 5);
      expect(uv[1]).toBeCloseTo((-m10 * p.x + m00 * p.y) / det / GROUT_BAKE_PERIOD, 5);
    }
  });
});

describe('grout surface edge cases', () => {
  const plain = frames[0]![1];

  it('keeps cells that only touch at a corner apart', () => {
    const instance = gridInstance(plain, [
      { tile: rounded, i: 0, j: 0 },
      { tile: rounded, i: 1, j: 1 },
    ]);
    const mesh = read(instance);
    expectAreaIdentity(instance, mesh);
    expectCoverage(instance, mesh);
    expectWalls(instance, mesh, 8 * CELL);
  });

  it('leaves an empty cell open, walled from the inside', () => {
    const specs: Spec[] = [];
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) if (i !== 1 || j !== 1) specs.push({ tile: square, i, j });
    const instance = gridInstance(plain, specs);
    const mesh = read(instance);
    expectAreaIdentity(instance, mesh);
    expectCoverage(instance, mesh);
    expectWalls(instance, mesh, 4 * 3 * CELL + 4 * CELL);
  });

  it('leaves no grout between square tiles with no joint', () => {
    const instance = gridInstance(
      plain,
      [0, 1].flatMap((i) => [0, 1].map((j) => ({ tile: flushSquare, i, j }))),
      0,
    );
    expect(read(instance).geometry.getAttribute('position').count).toBe(0);
  });

  it.each(frames)('fills the corners between rounded tiles with no joint: %s frame', (_name, frame) => {
    const instance = gridInstance(
      frame,
      [0, 1].flatMap((i) => [0, 1].map((j) => ({ tile: flushRounded, i, j }))),
      0,
    );
    const mesh = read(instance);
    expectNoGroutUnderTiles(instance, mesh);
    expectAreaIdentity(instance, mesh);
    expectCoverage(instance, mesh);
    // Only the fillet sides on the pattern edge are exposed: two per tile corner on each edge.
    expectWalls(instance, mesh, 16 * cornerRadiusMetres(flushRounded));
  });

  it('sets one grout height below the thinnest tile, never down to the floor', () => {
    const instance = gridInstance(plain, [
      { tile: square, i: 0, j: 0 },
      { tile: thin, i: 1, j: 0 },
    ]);
    expect(groutPlan(instance, catalogue, 0.0015)!.top).toBeCloseTo(0.01 - 0.0015, 12);
    expect(groutPlan(instance, catalogue, 0.05)!.top).toBe(MIN_GROUT_TOP);
    const mesh = read(instance);
    for (const i of new Set(mesh.top.flat())) expect(mesh.verts[i]!.p.z).toBeCloseTo(0.01 - 0.0015, 6);
  });

  it('leaves no grout between loose tiles that touch', () => {
    const instance = looseInstance([
      [big, translationMat3(0, 0)],
      [big, translationMat3(0.3, 0)],
    ]);
    const mesh = read(instance);
    expectNoGroutUnderTiles(instance, mesh);
    expect(topArea(mesh)).toBeCloseTo(0.602 * 0.302 - 2 * 0.09, 5);
    for (const { p, uv } of mesh.verts) {
      expect(uv[0]).toBeCloseTo(p.x / GROUT_BAKE_PERIOD, 5);
      expect(uv[1]).toBeCloseTo(p.y / GROUT_BAKE_PERIOD, 5);
    }
  });

  it('cuts a mirrored, turned loose rounded tile exactly', () => {
    const mirrored = multiplyMat3(translationMat3(1, 0.5), orientation(slab, false, true, false));
    const turned = multiplyMat3(translationMat3(2, 0.5), orientation(slab, true, false, true));
    const instance = looseInstance([
      [slab, mirrored],
      [slab, turned],
    ]);
    const mesh = read(instance);
    expectNoGroutUnderTiles(instance, mesh);
    expectAreaIdentity(instance, mesh);
    expectCoverage(instance, mesh);
  });

  it('skips placements whose tile no longer exists', () => {
    const instance = looseInstance([[square, translationMat3(0, 0)]]);
    const withMissing: DesignInstanceJson = {
      ...instance,
      placements: [...instance.placements, { id: 'x', tileDefinitionId: 'gone', mat3: translationMat3(1, 1) }],
    };
    expect(read(withMissing).geometry.getAttribute('position').count).toBe(
      read(instance).geometry.getAttribute('position').count,
    );
    expect(groutPlan({ type: 'DesignInstance', placements: [] }, catalogue, 0.0015)).toBeNull();
  });

  it('keeps grout out from under a stale tile overhanging its block', () => {
    const instance = gridInstance(plain, [
      { tile: oversized, i: 0, j: 0 },
      { tile: square, i: 1, j: 0 },
    ]);
    expectNoGroutUnderTiles(instance, read(instance));
  });

  it('plans an instance mixing cell blocks and loose tiles as loose', () => {
    const instance = gridInstance(frames[1]![1], [
      { tile: square, i: 0, j: 0 },
      { tile: square, i: 1, j: 0 },
    ]);
    const { cell: _dropped, ...loose } = instance.placements[1]!;
    const mixed: DesignInstanceJson = { ...instance, placements: [instance.placements[0]!, loose] };
    const plan = groutPlan(mixed, catalogue, 0.0015)!;
    expect(plan.frame.elements).toEqual(identityMat3().elements);
    expect(plan.blocks).toHaveLength(2);
    expectNoGroutUnderTiles(mixed, read(mixed));
  });
});

describe('groutPathD', () => {
  it('emits one closed subpath per block at the block corners', () => {
    const blocks = instanceBlocks(layouts[0]![1](frames[1]![1]), catalogue);
    const d = groutPathD(blocks);
    expect(d.match(/M/g)).toHaveLength(blocks.length);
    expect(d.match(/Z/g)).toHaveLength(blocks.length);
    expect(d.match(/L/g)).toHaveLength(blocks.length * 3);
  });
});
