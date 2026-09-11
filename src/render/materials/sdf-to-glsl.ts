import type { SdfNodeJson } from '@/domain/material';
import { SDF_LIB_GLSL } from './shaders/sdf-lib.glsl';

function num(n: number): string {
  if (!Number.isFinite(n)) return '0.0';
  const s = String(n);
  return s.includes('.') || /e/i.test(s) ? s : `${s}.0`;
}

/** GLSL `int` params must NOT go through num() — it appends `.0`, which is a type error. */
function int(n: number): string {
  return String(Math.trunc(n));
}

function vec2(a: number, b: number): string {
  return `vec2(${num(a)}, ${num(b)})`;
}

const NOISE_VARIANT: Record<string, number> = {
  fbm: 0,
  ridged: 1,
  turbulence: 2,
  billow: 3,
};

const CELL_METRIC: Record<string, number> = { f1: 0, f2f1: 1, id: 2 };
const CELL_DIST: Record<string, number> = { euclidean: 0, manhattan: 1, chebyshev: 2 };

/**
 * Nearest Gaussian-integer rotation M = [[a,-b],[b,a]] to `angle`.
 *
 * A free-float screen angle cannot close on the torus (it needs
 * `cells * (cos t, -sin t)` to be an integer vector), so the halftone lattice is
 * restricted to angles of the form atan2(b, a) and the cell count is snapped to a
 * multiple of det = a^2 + b^2.
 */
export function snapScreenAngle(angle: number): { a: number; b: number } {
  let best = { a: 1, b: 0 };
  let bestErr = Infinity;
  for (let a = -6; a <= 6; a += 1) {
    for (let b = -6; b <= 6; b += 1) {
      if (a === 0 && b === 0) continue;
      if (a * a + b * b > 36) continue;
      const err = Math.abs(Math.atan2(b, a) - angle);
      if (err < bestErr) {
        bestErr = err;
        best = { a, b };
      }
    }
  }
  return best;
}

/**
 * Compile an SDF AST into a GLSL expression that returns float shade/distance
 * for local UV meters `p` (vec2), using locals `seed` (float) and `period` (vec2).
 *
 * Invariant: never reference `pExpr` or a child expression more than once in emitted
 * code — the output is also the shader-program cache key, so duplication compounds
 * exponentially through nesting. Multi-reference ops go through SDF_LIB_GLSL instead.
 */
export function compileSdfExpression(node: SdfNodeJson, pExpr = 'p'): string {
  switch (node.op) {
    case 'circle': {
      const [cx, cy] = node.center ?? [0, 0];
      return `sdCircle(${pExpr} - ${vec2(cx, cy)}, ${num(node.radius)})`;
    }
    case 'box': {
      const [cx, cy] = node.center ?? [0, 0];
      const [hx, hy] = node.halfExtents;
      return `sdBox(${pExpr} - ${vec2(cx, cy)}, ${vec2(hx, hy)})`;
    }
    case 'ring': {
      const [cx, cy] = node.center ?? [0, 0];
      return `sdRing(${pExpr} - ${vec2(cx, cy)}, ${num(node.radius)}, ${num(node.thickness)})`;
    }
    case 'line':
      return `sdSegment(${pExpr}, ${vec2(node.a[0], node.a[1])}, ${vec2(node.b[0], node.b[1])}, ${num(node.thickness)})`;
    case 'noise': {
      const variant = NOISE_VARIANT[node.variant ?? 'fbm'] ?? 0;
      const octaves = int(node.octaves ?? 3);
      return variant === 0
        ? `fbm2(${pExpr}, ${num(node.scale)}, ${octaves}, seed, period)`
        : `fbmVariant(${pExpr}, ${num(node.scale)}, ${octaves}, ${int(variant)}, seed, period)`;
    }
    case 'voronoi':
      return `voronoiEdge(${pExpr}, ${num(node.scale)}, ${num(node.edgeWidth ?? 0.1)}, seed, period)`;
    case 'cells':
      return `worley(${pExpr}, ${num(node.scale)}, ${int(CELL_METRIC[node.metric] ?? 0)}, ${num(node.jitter ?? 1)}, ${int(CELL_DIST[node.distance ?? 'euclidean'] ?? 0)}, seed, period)`;
    case 'brick':
      return `brickShade(${pExpr}, ${num(node.brickW)}, ${num(node.brickH)}, ${num(node.mortar)}, ${num(node.offset ?? 0.5)}, period)`;
    case 'truchet':
      return `truchetShade(${pExpr}, ${num(node.scale)}, ${num(node.thickness)}, ${num(node.soft ?? node.thickness * 0.25)}, ${int(node.variant === 'diagonals' ? 1 : 0)}, seed, period)`;
    case 'stripe': {
      const v = node.axis === 'x' ? `${pExpr}.x` : `${pExpr}.y`;
      const per = node.axis === 'x' ? 'period.x' : 'period.y';
      return `stripeShade(${v}, ${num(node.spacing)}, ${num(node.duty)}, ${num(node.soft ?? 0.02)}, ${per})`;
    }
    case 'checker':
      return `checkerShade(${pExpr}, ${num(node.scale)}, period)`;
    case 'scratches':
      return `scratchDist(${pExpr}, ${int(node.count)}, ${num(node.length)}, ${num(node.width)}, ${num(node.scale)}, ${num(node.angle ?? 0)}, ${num(node.spread ?? Math.PI * 2)}, seed, period)`;
    case 'halftone': {
      const { a, b } = snapScreenAngle(node.angle ?? 0);
      const centre = `halftoneCenter(${pExpr}, ${num(node.scale)}, period, ${num(a)}, ${num(b)})`;
      const v = `toShade(${compileSdfExpression(node.child, centre)})`;
      return `halftoneMask(${pExpr}, ${num(node.scale)}, ${num(node.soft ?? 0.02)}, period, ${num(a)}, ${num(b)}, ${v})`;
    }
    case 'union':
      return `min(${compileSdfExpression(node.a, pExpr)}, ${compileSdfExpression(node.b, pExpr)})`;
    case 'subtract':
      return `max(${compileSdfExpression(node.a, pExpr)}, -(${compileSdfExpression(node.b, pExpr)}))`;
    case 'intersect':
      return `max(${compileSdfExpression(node.a, pExpr)}, ${compileSdfExpression(node.b, pExpr)})`;
    case 'smoothUnion':
      return `smin(${compileSdfExpression(node.a, pExpr)}, ${compileSdfExpression(node.b, pExpr)}, ${num(node.k)})`;
    case 'translate': {
      const q = `(${pExpr} - ${vec2(node.offset[0], node.offset[1])})`;
      return compileSdfExpression(node.child, q);
    }
    case 'rotate': {
      // Fold the trig at compile time; rot2 keeps pExpr to a single reference.
      const c = Math.cos(-node.angle);
      const s = Math.sin(-node.angle);
      return compileSdfExpression(node.child, `rot2(${pExpr}, ${num(c)}, ${num(s)})`);
    }
    case 'scale': {
      const sx = typeof node.factor === 'number' ? node.factor : node.factor[0];
      const sy = typeof node.factor === 'number' ? node.factor : node.factor[1];
      const m = Math.min(Math.abs(sx), Math.abs(sy)) || 1;
      const q = `scale2(${pExpr}, ${vec2(sx || 1, sy || 1)})`;
      return `(${compileSdfExpression(node.child, q)} * ${num(m)})`;
    }
    case 'repeat': {
      const [px, py] = node.period;
      return compileSdfExpression(node.child, `repeat2(${pExpr}, ${vec2(px, py)})`);
    }
    case 'mirror': {
      const m =
        node.axis === 'x' ? vec2(1, 0) : node.axis === 'y' ? vec2(0, 1) : vec2(1, 1);
      return compileSdfExpression(node.child, `mirror2(${pExpr}, ${m})`);
    }
    case 'warp': {
      const q = `warpP(${pExpr}, ${num(node.scale)}, ${num(node.amount)}, ${int(node.octaves ?? 3)}, seed, period)`;
      return compileSdfExpression(node.child, q);
    }
    case 'band': {
      const soft = node.soft ?? node.width * 0.25;
      return `(1.0 - smoothstep(${num(node.width - soft)}, ${num(node.width + soft)}, abs(${compileSdfExpression(node.child, pExpr)})))`;
    }
    case 'fill': {
      const soft = node.soft ?? 0.02;
      const s = `(1.0 - smoothstep(${num(-soft)}, ${num(soft)}, ${compileSdfExpression(node.child, pExpr)}))`;
      return node.invert ? `(1.0 - ${s})` : s;
    }
    case 'curve':
      // toShade guarantees a non-negative base; pow() is undefined for x < 0.
      return `pow(toShade(${compileSdfExpression(node.child, pExpr)}), ${num(node.gamma)})`;
    case 'posterize':
      return `posterize(toShade(${compileSdfExpression(node.child, pExpr)}), ${num(node.steps)})`;
    case 'threshold': {
      // smoothstep() is undefined when both edges are equal.
      const soft = Math.max(node.soft ?? 0.02, 1e-5);
      return `smoothstep(${num(node.level - soft)}, ${num(node.level + soft)}, toShade(${compileSdfExpression(node.child, pExpr)}))`;
    }
    case 'remap':
      return `remapRange(toShade(${compileSdfExpression(node.child, pExpr)}), ${num(node.inMin)}, ${num(node.inMax)}, ${num(node.outMin)}, ${num(node.outMax)})`;
    case 'invert':
      return `(1.0 - toShade(${compileSdfExpression(node.child, pExpr)}))`;
    case 'mix':
      return `mix(${compileSdfExpression(node.a, pExpr)}, ${compileSdfExpression(node.b, pExpr)}, ${num(node.t)})`;
    case 'mul':
      return `(${compileSdfExpression(node.a, pExpr)} * ${compileSdfExpression(node.b, pExpr)})`;
    case 'add':
      return `(${compileSdfExpression(node.a, pExpr)} + ${compileSdfExpression(node.b, pExpr)})`;
    case 'overlay':
      return `blendOverlay(toShade(${compileSdfExpression(node.a, pExpr)}), toShade(${compileSdfExpression(node.b, pExpr)}))`;
    case 'screen':
      return `blendScreen(toShade(${compileSdfExpression(node.a, pExpr)}), toShade(${compileSdfExpression(node.b, pExpr)}))`;
    default: {
      const _exhaustive: never = node;
      return _exhaustive;
    }
  }
}

export const FULLSCREEN_VERT_GLSL = /* glsl */ `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  gl_Position = vec4(POS[gl_VertexID], 0.0, 1.0);
}
`;

/** Full fragment shader source for baking a material SDF onto a tile. */
export function buildBakeFragmentShader(sdf: SdfNodeJson): string {
  const expr = compileSdfExpression(sdf, 'p');
  return /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform vec2 uTileSize;
uniform float uSeed;
uniform vec2 uPeriod;
uniform int uColorMode; // 0 = brightness, 1 = palette
uniform vec3 uColor;    // brightness base / unused in palette
uniform vec3 uPalA;
uniform vec3 uPalB;
uniform vec3 uPalC;
uniform vec3 uPalD;
uniform int uEdged;     // 0 = continuous, 1 = edged
uniform float uEdgeSeedS;
uniform float uEdgeSeedN;
uniform float uEdgeSeedE;
uniform float uEdgeSeedW;
uniform float uEdgeMirrorS;
uniform float uEdgeMirrorN;
uniform float uEdgeMirrorE;
uniform float uEdgeMirrorW;
uniform int uOutput;    // 0 = albedo, 1 = normal, 2 = roughness, 3 = lit preview
uniform float uRelief;  // meters the 0..1 field spans
uniform vec2 uRough;    // roughness at field 0, at field 1
out vec4 fragColor;
${SDF_LIB_GLSL}
float shadeRaw(vec2 p, float seed, vec2 period) {
  return ${expr};
}
float normalizeShade(float v) {
  return toShade(v);
}
float shadeContinuous(vec2 uv01) {
  vec2 p = wrapPeriod2(uv01 * uTileSize, uPeriod);
  return normalizeShade(shadeRaw(p, uSeed, uPeriod));
}
float shadeEdged(vec2 uv) {
  float u = uv.x;
  float v = uv.y;
  float dS = v;
  float dN = 1.0 - v;
  float dW = u;
  float dE = 1.0 - u;
  float tS = uEdgeMirrorS > 0.5 ? 1.0 - u : u;
  float tN = uEdgeMirrorN > 0.5 ? 1.0 - u : u;
  float tW = uEdgeMirrorW > 0.5 ? 1.0 - v : v;
  float tE = uEdgeMirrorE > 0.5 ? 1.0 - v : v;
  vec2 pS = vec2(tS * uTileSize.x, dS * uTileSize.y);
  vec2 pN = vec2(tN * uTileSize.x, dN * uTileSize.y);
  vec2 pW = vec2(dW * uTileSize.x, tW * uTileSize.y);
  vec2 pE = vec2(dE * uTileSize.x, tE * uTileSize.y);
  float sS = normalizeShade(shadeRaw(pS, uEdgeSeedS, uPeriod));
  float sN = normalizeShade(shadeRaw(pN, uEdgeSeedN, uPeriod));
  float sW = normalizeShade(shadeRaw(pW, uEdgeSeedW, uPeriod));
  float sE = normalizeShade(shadeRaw(pE, uEdgeSeedE, uPeriod));
  float wS = 1.0 / (dS + 0.05);
  float wN = 1.0 / (dN + 0.05);
  float wW = 1.0 / (dW + 0.05);
  float wE = 1.0 / (dE + 0.05);
  float wSum = wS + wN + wW + wE;
  return (sS * wS + sN * wN + sW * wW + sE * wE) / wSum;
}
// Every output below derives from this one scalar field — the normal is its gradient, the
// roughness is a remap of it. Nothing is authored twice.
float shadeAt(vec2 uv) {
  return uEdged == 1 ? shadeEdged(uv) : shadeContinuous(uv);
}
vec3 albedoFor(float s) {
  if (uColorMode == 1) {
    return iqPalette(s, uPalA, uPalB, uPalC, uPalD);
  }
  return mix(uColor * 0.55, uColor * 1.18, s);
}
// Central differences one texel apart. shadeContinuous wraps its point, and wrapPeriod is
// defined for negatives, so at uv = 0 the -h tap wraps to the far edge instead of clamping:
// the normal map inherits the albedo's exact seamlessness for free.
vec3 surfaceNormal(vec2 uv) {
  float h = 1.0 / uResolution.x;
  float sx = shadeAt(uv + vec2(h, 0.0)) - shadeAt(uv - vec2(h, 0.0));
  float sy = shadeAt(uv + vec2(0.0, h)) - shadeAt(uv - vec2(0.0, h));
  // Slope in METERS, not uv — otherwise a non-square tile skews the normal.
  vec2 d = vec2(sx / (2.0 * h * uTileSize.x), sy / (2.0 * h * uTileSize.y)) * uRelief;
  return normalize(vec3(-d.x, -d.y, 1.0));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  if (uOutput == 1) {
    fragColor = vec4(surfaceNormal(uv) * 0.5 + 0.5, 1.0);
    return;
  }
  float s = shadeAt(uv);
  if (uOutput == 2) {
    float r = clamp(mix(uRough.x, uRough.y, s), 0.0, 1.0);
    fragColor = vec4(r, r, r, 1.0);
    return;
  }
  vec3 rgb = albedoFor(s);
  if (uOutput == 3) {
    // Fixed key light from the upper left, plus a floor so shadowed relief stays readable.
    vec3 n = surfaceNormal(uv);
    vec3 l = normalize(vec3(-0.55, 0.6, 0.58));
    float lambert = max(dot(n, l), 0.0);
    rgb *= 0.28 + 0.9 * lambert;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;
}
