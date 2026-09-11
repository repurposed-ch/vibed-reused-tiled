import type { SdfNodeJson } from '@/domain/material';
import { snapScreenAngle } from './sdf-to-glsl';

/**
 * CPU reference evaluator mirroring SDF_LIB_GLSL.
 *
 * Purpose is seam regression testing in the node test environment, where no WebGL
 * context exists. It deliberately tests an INVARIANT (exact period-periodicity),
 * not agreement with the GPU — so float64-vs-float32 drift does not matter: a port
 * that is still periodic still proves the algorithm is periodic.
 */

export type Vec2 = [number, number];

// ---------------------------------------------------------------- GLSL builtins

const fract = (x: number) => x - Math.floor(x);
const glMod = (x: number, y: number) => x - y * Math.floor(x / y);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

const len = (v: Vec2) => Math.hypot(v[0], v[1]);
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];

// ---------------------------------------------------------------- periodic domain

const periodSafe = (p: Vec2): Vec2 => [Math.max(p[0], 1e-6), Math.max(p[1], 1e-6)];

function wrapPeriod(v: number, period: number): number {
  const p = Math.max(period, 1e-6);
  return glMod(glMod(v, p) + p, p);
}

const wrapPeriod2 = (v: Vec2, period: Vec2): Vec2 => [
  wrapPeriod(v[0], period[0]),
  wrapPeriod(v[1], period[1]),
];

function wrapCentered(v: number, period: number): number {
  const w = wrapPeriod(v, period);
  return w > period * 0.5 ? w - period : w;
}

function cellCount(scale: number, period: Vec2): Vec2 {
  const P = periodSafe(period);
  return [Math.max(1, Math.floor(P[0] * scale + 0.5)), Math.max(1, Math.floor(P[1] * scale + 0.5))];
}

function cellCountEven(scale: number, period: Vec2): Vec2 {
  const P = periodSafe(period);
  return [
    Math.max(2, 2 * Math.floor((P[0] * scale * 0.5) + 0.5)),
    Math.max(2, 2 * Math.floor((P[1] * scale * 0.5) + 0.5)),
  ];
}

function latticeP(p: Vec2, cells: Vec2, period: Vec2): Vec2 {
  const P = periodSafe(period);
  return wrapPeriod2([p[0] * (cells[0] / P[0]), p[1] * (cells[1] / P[1])], cells);
}

export function toShade(v: number): number {
  if (v < 0 || v > 1) return 1 - smoothstep(-0.02, 0.02, v);
  return clamp(v, 0, 1);
}

// ---------------------------------------------------------------- hashing / noise

function hash21(px: number, py: number, seed: number): number {
  let x = fract(px * 0.1031 + seed * 0.001);
  let y = fract(py * 0.1031 + seed * 0.001);
  let z = fract(px * 0.1031 + seed * 0.001);
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  x += d;
  y += d;
  z += d;
  return fract((x + y) * z);
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

function valueNoise2(p: Vec2, scale: number, seed: number, period: Vec2): number {
  const cells = cellCount(scale, period);
  const s = latticeP(p, cells, period);
  const i0: Vec2 = [Math.floor(s[0]), Math.floor(s[1])];
  const f: Vec2 = [s[0] - i0[0], s[1] - i0[1]];
  const fs: Vec2 = [fade(f[0]), fade(f[1])];
  const c0: Vec2 = [glMod(i0[0], cells[0]), glMod(i0[1], cells[1])];
  const c1: Vec2 = [glMod(i0[0] + 1, cells[0]), glMod(i0[1] + 1, cells[1])];
  const n00 = hash21(c0[0], c0[1], seed);
  const n10 = hash21(c1[0], c0[1], seed);
  const n01 = hash21(c0[0], c1[1], seed);
  const n11 = hash21(c1[0], c1[1], seed);
  return mix(mix(n00, n10, fs[0]), mix(n01, n11, fs[0]), fs[1]);
}

function fbmVariant(
  p: Vec2,
  scale: number,
  octaves: number,
  variant: number,
  seed: number,
  period: Vec2,
): number {
  let amp = 0.5;
  let freq = scale;
  let sum = 0;
  let norm = 0;
  let weight = 1;
  for (let i = 0; i < 8; i += 1) {
    if (i >= octaves) break;
    const n = valueNoise2(p, freq, seed + i * 1013, period);
    const s = n * 2 - 1;
    let v = n;
    if (variant === 1) {
      v = 1 - Math.abs(s);
      v = v * v * weight;
      weight = clamp(v * 2, 0, 1);
    } else if (variant === 2) {
      v = Math.abs(s);
    } else if (variant === 3) {
      v = s * s;
    }
    sum += amp * v;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return norm > 0 ? clamp(sum / norm, 0, 1) : 0;
}

const fbm2 = (p: Vec2, scale: number, octaves: number, seed: number, period: Vec2) =>
  fbmVariant(p, scale, octaves, 0, seed, period);

function warpP(
  p: Vec2,
  scale: number,
  amount: number,
  octaves: number,
  seed: number,
  period: Vec2,
): Vec2 {
  const wx = fbm2(p, scale, octaves, seed + 71.13, period) * 2 - 1;
  const wy = fbm2(p, scale, octaves, seed + 917.71, period) * 2 - 1;
  return [p[0] + amount * wx, p[1] + amount * wy];
}

// ---------------------------------------------------------------- primitives

const sdCircle = (p: Vec2, r: number) => len(p) - r;

function sdBox(p: Vec2, b: Vec2): number {
  const dx = Math.abs(p[0]) - b[0];
  const dy = Math.abs(p[1]) - b[1];
  return len([Math.max(dx, 0), Math.max(dy, 0)]) + Math.min(Math.max(dx, dy), 0);
}

const sdRing = (p: Vec2, r: number, t: number) => Math.abs(len(p) - r) - t * 0.5;

function sdSegment(p: Vec2, a: Vec2, b: Vec2, thickness: number): number {
  const pa = sub(p, a);
  const ba = sub(b, a);
  const h = clamp((pa[0] * ba[0] + pa[1] * ba[1]) / Math.max(ba[0] ** 2 + ba[1] ** 2, 1e-8), 0, 1);
  return len([pa[0] - ba[0] * h, pa[1] - ba[1] * h]) - thickness * 0.5;
}

function smin(a: number, b: number, k: number): number {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return mix(b, a, h) - k * h * (1 - h);
}

// ---------------------------------------------------------------- cellular

function cellDist(d: Vec2, distFn: number): number {
  if (distFn === 1) return Math.abs(d[0]) + Math.abs(d[1]);
  if (distFn === 2) return Math.max(Math.abs(d[0]), Math.abs(d[1]));
  return len(d);
}

function worley(
  p: Vec2,
  scale: number,
  metric: number,
  jitter: number,
  distFn: number,
  seed: number,
  period: Vec2,
): number {
  const cells = cellCount(scale, period);
  const s = latticeP(p, cells, period);
  const i0: Vec2 = [Math.floor(s[0]), Math.floor(s[1])];
  const f: Vec2 = [s[0] - i0[0], s[1] - i0[1]];
  const j = clamp(jitter, 0, 1);
  let f1 = 1e9;
  let f2 = 1e9;
  let id1 = 0;
  for (let jj = -1; jj <= 1; jj += 1) {
    for (let ii = -1; ii <= 1; ii += 1) {
      const cx = glMod(i0[0] + ii + cells[0], cells[0]);
      const cy = glMod(i0[1] + jj + cells[1], cells[1]);
      const ox = 0.5 + j * (hash21(cx, cy, seed) - 0.5);
      const oy = 0.5 + j * (hash21(cx, cy, seed + 19) - 0.5);
      const d: Vec2 = [ii + ox - f[0], jj + oy - f[1]];
      const dist = cellDist(d, distFn);
      if (dist < f1) {
        f2 = f1;
        f1 = dist;
        id1 = hash21(cx, cy, seed + 131);
      } else if (dist < f2) {
        f2 = dist;
      }
    }
  }
  if (metric === 2) return id1;
  const norm = distFn === 1 ? 2 : 1;
  return metric === 1 ? clamp((f2 - f1) / norm, 0, 1) : clamp(f1 / norm, 0, 1);
}

const voronoiEdge = (p: Vec2, scale: number, edgeWidth: number, seed: number, period: Vec2) =>
  1 - smoothstep(0, edgeWidth, worley(p, scale, 1, 1, 0, seed, period));

// ---------------------------------------------------------------- lattice patterns

function brickShade(
  p: Vec2,
  brickW: number,
  brickH: number,
  mortar: number,
  offsetAmt: number,
  period: Vec2,
): number {
  const P = periodSafe(period);
  const cols = Math.max(1, Math.floor(P[0] / Math.max(brickW, 1e-6) + 0.5));
  const pairs = Math.max(1, Math.floor(P[1] / Math.max(brickH * 2, 1e-6) + 0.5));
  const bw = P[0] / cols;
  const bh = P[1] / (pairs * 2);
  const row = Math.floor(p[1] / bh);
  const xOff = glMod(row, 2) < 0.5 ? 0 : bw * offsetAmt;
  const lx = glMod(p[0] + xOff, bw);
  const ly = glMod(p[1], bh);
  const mx = Math.min(lx, bw - lx);
  const my = Math.min(ly, bh - ly);
  return mx < mortar || my < mortar ? 0.15 : 0.85;
}

const truchetArc = (f: Vec2, thickness: number) =>
  Math.min(Math.abs(len(f) - 0.5), Math.abs(len(sub(f, [1, 1])) - 0.5)) - thickness * 0.5;

const truchetChamfer = (f: Vec2, thickness: number) =>
  Math.min(
    sdSegment(f, [0.5, 0], [1, 0.5], thickness),
    sdSegment(f, [0, 0.5], [0.5, 1], thickness),
  );

function truchetShade(
  p: Vec2,
  scale: number,
  thickness: number,
  soft: number,
  variant: number,
  seed: number,
  period: Vec2,
): number {
  const cells = cellCount(scale, period);
  const s = latticeP(p, cells, period);
  const i0: Vec2 = [Math.floor(s[0]), Math.floor(s[1])];
  const f: Vec2 = [s[0] - i0[0], s[1] - i0[1]];
  if (hash21(glMod(i0[0], cells[0]), glMod(i0[1], cells[1]), seed) > 0.5) f[0] = 1 - f[0];
  const d = variant === 1 ? truchetChamfer(f, thickness) : truchetArc(f, thickness);
  const w = Math.max(soft, 1e-4);
  return 1 - smoothstep(-w, w, d);
}

function stripeShade(v: number, spacing: number, duty: number, soft: number, P: number): number {
  const per = Math.max(P, 1e-6);
  const bands = Math.max(1, Math.floor(per / Math.max(spacing, 1e-6) + 0.5));
  const t = fract((v * bands) / per);
  const halfDuty = clamp(duty, 0, 1) * 0.5;
  const d = Math.abs(t - 0.5) - halfDuty;
  const w = Math.max(soft, 1e-5);
  return 1 - smoothstep(-w, w, d);
}

function checkerShade(p: Vec2, scale: number, period: Vec2): number {
  const cells = cellCountEven(scale, period);
  const s = latticeP(p, cells, period);
  return glMod(Math.floor(s[0]) + Math.floor(s[1]), 2) < 0.5 ? 0 : 1;
}

function scratchDist(
  p: Vec2,
  count: number,
  lengthM: number,
  widthM: number,
  scale: number,
  angle: number,
  spread: number,
  seed: number,
  period: Vec2,
): number {
  const cells = cellCount(scale, period);
  const P = periodSafe(period);
  const eff = cells[0] / P[0];
  const s = latticeP(p, cells, period);
  const i0: Vec2 = [Math.floor(s[0]), Math.floor(s[1])];
  const f: Vec2 = [s[0] - i0[0], s[1] - i0[1]];
  const lc = clamp(lengthM * eff, 0.02, 1);
  const wc = Math.max(widthM * eff, 1e-4);
  let best = 1e9;
  for (let jj = -1; jj <= 1; jj += 1) {
    for (let ii = -1; ii <= 1; ii += 1) {
      const cx = glMod(i0[0] + ii + cells[0], cells[0]);
      const cy = glMod(i0[1] + jj + cells[1], cells[1]);
      const base: Vec2 = [ii - f[0], jj - f[1]];
      for (let k = 0; k < 6; k += 1) {
        if (k >= count) break;
        const kk = k * 37;
        const c: Vec2 = [
          base[0] + hash21(cx, cy, seed + kk),
          base[1] + hash21(cx, cy, seed + kk + 7),
        ];
        const a = angle + spread * (hash21(cx, cy, seed + kk + 13) - 0.5);
        const dir: Vec2 = [Math.cos(a), Math.sin(a)];
        const h = lc * 0.5 * (0.5 + 0.5 * hash21(cx, cy, seed + kk + 23));
        best = Math.min(
          best,
          sdSegment(
            [0, 0],
            [c[0] - dir[0] * h, c[1] - dir[1] * h],
            [c[0] + dir[0] * h, c[1] + dir[1] * h],
            wc,
          ),
        );
      }
    }
  }
  return best / Math.max(eff, 1e-6);
}

// ---------------------------------------------------------------- halftone

function halftoneCells(scale: number, period: Vec2, det: number): Vec2 {
  const c = cellCount(scale, period);
  return [
    Math.max(det, Math.floor(c[0] / det + 0.5) * det),
    Math.max(det, Math.floor(c[1] / det + 0.5) * det),
  ];
}

function screenCoord(p: Vec2, cells: Vec2, period: Vec2, a: number, b: number): Vec2 {
  const s = latticeP(p, cells, period);
  const det = Math.max(a * a + b * b, 1e-6);
  return [(a * s[0] + b * s[1]) / det, (-b * s[0] + a * s[1]) / det];
}

function halftoneCenter(p: Vec2, scale: number, period: Vec2, a: number, b: number): Vec2 {
  const det = Math.max(a * a + b * b, 1e-6);
  const cells = halftoneCells(scale, period, det);
  const u = screenCoord(p, cells, period, a, b);
  const uf: Vec2 = [Math.floor(u[0]) + 0.5, Math.floor(u[1]) + 0.5];
  const s: Vec2 = [a * uf[0] - b * uf[1], b * uf[0] + a * uf[1]];
  const P = periodSafe(period);
  return [s[0] * (P[0] / cells[0]), s[1] * (P[1] / cells[1])];
}

function halftoneMask(
  p: Vec2,
  scale: number,
  soft: number,
  period: Vec2,
  a: number,
  b: number,
  v: number,
): number {
  const det = Math.max(a * a + b * b, 1e-6);
  const cells = halftoneCells(scale, period, det);
  const u = screenCoord(p, cells, period, a, b);
  const f: Vec2 = [u[0] - Math.floor(u[0]) - 0.5, u[1] - Math.floor(u[1]) - 0.5];
  const r = Math.sqrt(clamp(v, 0, 1)) * 0.7071;
  const w = Math.max(soft, 1e-4);
  return 1 - smoothstep(r - w, r + w, len(f));
}

// ---------------------------------------------------------------- remap / blend

function posterize(x: number, steps: number): number {
  const n = Math.max(steps, 2);
  return clamp(Math.floor(Math.min(clamp(x, 0, 1), 0.999999) * n) / (n - 1), 0, 1);
}

function remapRange(
  x: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  const t = clamp(((x - inMin) / Math.max(Math.abs(inMax - inMin), 1e-6)) * Math.sign(inMax - inMin), 0, 1);
  return mix(outMin, outMax, t);
}

const blendScreen = (a: number, b: number) => 1 - (1 - a) * (1 - b);
const blendOverlay = (a: number, b: number) =>
  a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);

// ---------------------------------------------------------------- interpreter

/** Evaluate an SDF graph at `p` (meters), mirroring the compiled GLSL expression. */
export function evalSdfNode(node: SdfNodeJson, p: Vec2, seed: number, period: Vec2): number {
  const ev = (n: SdfNodeJson, q: Vec2) => evalSdfNode(n, q, seed, period);

  switch (node.op) {
    case 'circle':
      return sdCircle(sub(p, node.center ?? [0, 0]), node.radius);
    case 'box':
      return sdBox(sub(p, node.center ?? [0, 0]), node.halfExtents);
    case 'ring':
      return sdRing(sub(p, node.center ?? [0, 0]), node.radius, node.thickness);
    case 'line':
      return sdSegment(p, node.a, node.b, node.thickness);
    case 'noise': {
      const variant = { fbm: 0, ridged: 1, turbulence: 2, billow: 3 }[node.variant ?? 'fbm'];
      return fbmVariant(p, node.scale, node.octaves ?? 3, variant, seed, period);
    }
    case 'voronoi':
      return voronoiEdge(p, node.scale, node.edgeWidth ?? 0.1, seed, period);
    case 'cells': {
      const metric = { f1: 0, f2f1: 1, id: 2 }[node.metric];
      const distFn = { euclidean: 0, manhattan: 1, chebyshev: 2 }[node.distance ?? 'euclidean'];
      return worley(p, node.scale, metric, node.jitter ?? 1, distFn, seed, period);
    }
    case 'brick':
      return brickShade(p, node.brickW, node.brickH, node.mortar, node.offset ?? 0.5, period);
    case 'truchet':
      return truchetShade(
        p,
        node.scale,
        node.thickness,
        node.soft ?? node.thickness * 0.25,
        node.variant === 'diagonals' ? 1 : 0,
        seed,
        period,
      );
    case 'stripe':
      return stripeShade(
        node.axis === 'x' ? p[0] : p[1],
        node.spacing,
        node.duty,
        node.soft ?? 0.02,
        node.axis === 'x' ? period[0] : period[1],
      );
    case 'checker':
      return checkerShade(p, node.scale, period);
    case 'scratches':
      return scratchDist(
        p,
        node.count,
        node.length,
        node.width,
        node.scale,
        node.angle ?? 0,
        node.spread ?? Math.PI * 2,
        seed,
        period,
      );
    case 'halftone': {
      const { a, b } = snapScreenAngle(node.angle ?? 0);
      const centre = halftoneCenter(p, node.scale, period, a, b);
      const v = toShade(ev(node.child, centre));
      return halftoneMask(p, node.scale, node.soft ?? 0.02, period, a, b, v);
    }
    case 'union':
      return Math.min(ev(node.a, p), ev(node.b, p));
    case 'subtract':
      return Math.max(ev(node.a, p), -ev(node.b, p));
    case 'intersect':
      return Math.max(ev(node.a, p), ev(node.b, p));
    case 'smoothUnion':
      return smin(ev(node.a, p), ev(node.b, p), node.k);
    case 'translate':
      return ev(node.child, sub(p, node.offset));
    case 'rotate': {
      const c = Math.cos(-node.angle);
      const s = Math.sin(-node.angle);
      return ev(node.child, [p[0] * c - p[1] * s, p[0] * s + p[1] * c]);
    }
    case 'scale': {
      const sx = typeof node.factor === 'number' ? node.factor : node.factor[0];
      const sy = typeof node.factor === 'number' ? node.factor : node.factor[1];
      const m = Math.min(Math.abs(sx), Math.abs(sy)) || 1;
      return ev(node.child, [p[0] / (sx || 1), p[1] / (sy || 1)]) * m;
    }
    case 'repeat':
      return ev(node.child, [
        wrapCentered(p[0], node.period[0]),
        wrapCentered(p[1], node.period[1]),
      ]);
    case 'mirror': {
      const q: Vec2 =
        node.axis === 'x'
          ? [Math.abs(p[0]), p[1]]
          : node.axis === 'y'
            ? [p[0], Math.abs(p[1])]
            : [Math.abs(p[0]), Math.abs(p[1])];
      return ev(node.child, q);
    }
    case 'warp':
      return ev(
        node.child,
        warpP(p, node.scale, node.amount, node.octaves ?? 3, seed, period),
      );
    case 'band': {
      const soft = node.soft ?? node.width * 0.25;
      return 1 - smoothstep(node.width - soft, node.width + soft, Math.abs(ev(node.child, p)));
    }
    case 'fill': {
      const soft = node.soft ?? 0.02;
      const s = 1 - smoothstep(-soft, soft, ev(node.child, p));
      return node.invert ? 1 - s : s;
    }
    case 'curve':
      return Math.pow(toShade(ev(node.child, p)), node.gamma);
    case 'posterize':
      return posterize(toShade(ev(node.child, p)), node.steps);
    case 'threshold': {
      const soft = Math.max(node.soft ?? 0.02, 1e-5);
      return smoothstep(node.level - soft, node.level + soft, toShade(ev(node.child, p)));
    }
    case 'remap':
      return remapRange(toShade(ev(node.child, p)), node.inMin, node.inMax, node.outMin, node.outMax);
    case 'invert':
      return 1 - toShade(ev(node.child, p));
    case 'mix':
      return mix(ev(node.a, p), ev(node.b, p), node.t);
    case 'mul':
      return ev(node.a, p) * ev(node.b, p);
    case 'add':
      return ev(node.a, p) + ev(node.b, p);
    case 'overlay':
      return blendOverlay(toShade(ev(node.a, p)), toShade(ev(node.b, p)));
    case 'screen':
      return blendScreen(toShade(ev(node.a, p)), toShade(ev(node.b, p)));
    default: {
      const _exhaustive: never = node;
      return _exhaustive;
    }
  }
}

/**
 * CPU mirror of the bake shader's `shadeAt` for continuous (non-edged) tiles: the uv in
 * 0..1 is scaled to meters and wrapped exactly as `shadeContinuous` does.
 */
export function shadeAtUv(node: SdfNodeJson, uv: Vec2, seed: number, period: Vec2): number {
  const p = wrapPeriod2([uv[0] * period[0], uv[1] * period[1]], period);
  return toShade(evalSdfNode(node, p, seed, period));
}

/**
 * CPU mirror of the bake shader's `surfaceNormal`: central differences `texel` apart in uv,
 * converted to a slope in meters and scaled by `relief`. Returns a unit vector.
 */
export function surfaceNormalAt(
  node: SdfNodeJson,
  uv: Vec2,
  seed: number,
  period: Vec2,
  relief: number,
  texel: number,
): [number, number, number] {
  const h = texel;
  const sx = shadeAtUv(node, [uv[0] + h, uv[1]], seed, period) - shadeAtUv(node, [uv[0] - h, uv[1]], seed, period);
  const sy = shadeAtUv(node, [uv[0], uv[1] + h], seed, period) - shadeAtUv(node, [uv[0], uv[1] - h], seed, period);
  const dx = (sx / (2 * h * period[0])) * relief;
  const dy = (sy / (2 * h * period[1])) * relief;
  const len = Math.hypot(dx, dy, 1);
  return [-dx / len, -dy / len, 1 / len];
}

/** CPU mirror of the bake shader's roughness output. */
export function roughnessAt(
  node: SdfNodeJson,
  uv: Vec2,
  seed: number,
  period: Vec2,
  roughness: [number, number],
): number {
  const s = shadeAtUv(node, uv, seed, period);
  return clamp(mix(roughness[0], roughness[1], s), 0, 1);
}

/** Deterministic sampler so failures reproduce. */
function sampler(seed = 0x2f6e2b1) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Max |f(edge) - f(opposite edge)| along both tile boundaries.
 *
 * This is the SHIP-CRITICAL property: the bake sweeps p over [0,Px) x [0,Py), so the
 * only discontinuity a viewer can see is between one tile's far edge and the next
 * tile's near edge. A graph containing a local, non-periodic feature (a lone circle
 * well inside the tile) still passes, correctly — it never crosses the boundary.
 */
export function maxSeamDelta(
  node: SdfNodeJson,
  seed: number,
  period: Vec2,
  samples = 256,
): number {
  const rand = sampler();
  let worst = 0;
  for (let i = 0; i < samples; i += 1) {
    const y = rand() * period[1];
    const x = rand() * period[0];
    const left = toShade(evalSdfNode(node, [0, y], seed, period));
    const right = toShade(evalSdfNode(node, [period[0], y], seed, period));
    const bottom = toShade(evalSdfNode(node, [x, 0], seed, period));
    const top = toShade(evalSdfNode(node, [x, period[1]], seed, period));
    worst = Math.max(worst, Math.abs(left - right), Math.abs(bottom - top));
  }
  return worst;
}

/**
 * Max |f(p) - f(p + P.e)| over random interior samples.
 *
 * Strictly stronger than maxSeamDelta: it asserts the field is globally periodic, which
 * catches lattice-closure bugs anywhere in the domain, not just at the edge. Only valid
 * for graphs built purely from periodic primitives — a graph with a local feature
 * (circle, box, line at a fixed position) is legitimately non-periodic and still tiles.
 */
export function maxPeriodDelta(
  node: SdfNodeJson,
  seed: number,
  period: Vec2,
  samples = 256,
): number {
  const rand = sampler();
  let worst = 0;
  for (let i = 0; i < samples; i += 1) {
    const x = rand() * period[0];
    const y = rand() * period[1];
    const base = toShade(evalSdfNode(node, [x, y], seed, period));
    const shiftX = toShade(evalSdfNode(node, [x + period[0], y], seed, period));
    const shiftY = toShade(evalSdfNode(node, [x, y + period[1]], seed, period));
    worst = Math.max(worst, Math.abs(base - shiftX), Math.abs(base - shiftY));
  }
  return worst;
}
