import type { SdfNodeJson } from '@/domain/material';
import { SDF_LIB_GLSL } from './shaders/sdf-lib.glsl';

function num(n: number): string {
  if (!Number.isFinite(n)) return '0.0';
  const s = String(n);
  return s.includes('.') || /e/i.test(s) ? s : `${s}.0`;
}

function vec2(a: number, b: number): string {
  return `vec2(${num(a)}, ${num(b)})`;
}

/**
 * Compile an SDF AST into a GLSL expression that returns float shade/distance
 * for local UV meters `p` (vec2), using locals `seed` and `period`.
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
    case 'noise':
      return `fbm2(${pExpr}, ${num(node.scale)}, ${node.octaves ?? 3}, seed, period)`;
    case 'voronoi':
      return `voronoiEdge(${pExpr}, ${num(node.scale)}, ${num(node.edgeWidth ?? 0.1)}, seed, period)`;
    case 'brick':
      return `brickShade(${pExpr}, ${num(node.brickW)}, ${num(node.brickH)}, ${num(node.mortar)}, ${num(node.offset ?? 0.5)})`;
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
      const c = `cos(${num(-node.angle)})`;
      const s = `sin(${num(-node.angle)})`;
      const q = `vec2(${pExpr}.x * ${c} - ${pExpr}.y * ${s}, ${pExpr}.x * ${s} + ${pExpr}.y * ${c})`;
      return compileSdfExpression(node.child, q);
    }
    case 'scale': {
      const sx = typeof node.factor === 'number' ? node.factor : node.factor[0];
      const sy = typeof node.factor === 'number' ? node.factor : node.factor[1];
      const m = Math.min(Math.abs(sx), Math.abs(sy)) || 1;
      const q = `vec2(${pExpr}.x / ${num(sx || 1)}, ${pExpr}.y / ${num(sy || 1)})`;
      return `(${compileSdfExpression(node.child, q)} * ${num(m)})`;
    }
    case 'repeat': {
      const [px, py] = node.period;
      const q = `vec2(wrapCentered(${pExpr}.x, ${num(px)}), wrapCentered(${pExpr}.y, ${num(py)}))`;
      return compileSdfExpression(node.child, q);
    }
    case 'mirror': {
      let q = pExpr;
      if (node.axis === 'x') q = `vec2(abs(${pExpr}.x), ${pExpr}.y)`;
      else if (node.axis === 'y') q = `vec2(${pExpr}.x, abs(${pExpr}.y))`;
      else q = `abs(${pExpr})`;
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
    case 'mix':
      return `mix(${compileSdfExpression(node.a, pExpr)}, ${compileSdfExpression(node.b, pExpr)}, ${num(node.t)})`;
    case 'mul':
      return `(${compileSdfExpression(node.a, pExpr)} * ${compileSdfExpression(node.b, pExpr)})`;
    case 'add':
      return `(${compileSdfExpression(node.a, pExpr)} + ${compileSdfExpression(node.b, pExpr)})`;
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
uniform float uPeriod;
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
out vec4 fragColor;
${SDF_LIB_GLSL}
float shadeRaw(vec2 p, float seed, float period) {
  return ${expr};
}
float normalizeShade(float v) {
  if (v < 0.0 || v > 1.0) {
    return 1.0 - smoothstep(-0.02, 0.02, v);
  }
  return clamp(v, 0.0, 1.0);
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
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float s = uEdged == 1 ? shadeEdged(uv) : shadeContinuous(uv);
  vec3 rgb;
  if (uColorMode == 1) {
    rgb = iqPalette(s, uPalA, uPalB, uPalC, uPalD);
  } else {
    rgb = mix(uColor * 0.55, uColor * 1.18, s);
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;
}
