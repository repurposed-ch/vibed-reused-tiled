/** Shared GLSL helpers inlined into every material bake fragment shader (WebGL2 / GLSL ES 3.00). */
export const SDF_LIB_GLSL = /* glsl */ `
// ---------------------------------------------------------------- periodic domain

vec2 periodSafe(vec2 period) {
  return max(period, vec2(1e-6));
}

float wrapPeriod(float v, float period) {
  float p = max(period, 1e-6);
  return mod(mod(v, p) + p, p);
}

vec2 wrapPeriod2(vec2 v, vec2 period) {
  return vec2(wrapPeriod(v.x, period.x), wrapPeriod(v.y, period.y));
}

float wrapCentered(float v, float period) {
  float w = wrapPeriod(v, period);
  return w > period * 0.5 ? w - period : w;
}

/** Integer per-axis cell count for a lattice primitive at \`scale\`. */
vec2 cellCount(float scale, vec2 period) {
  return max(vec2(1.0), floor(periodSafe(period) * scale + 0.5));
}

/** Even per-axis cell count, for parity-indexed patterns (checker, brick rows). */
vec2 cellCountEven(float scale, vec2 period) {
  return max(vec2(2.0), 2.0 * floor(periodSafe(period) * scale * 0.5 + 0.5));
}

/**
 * Lattice coords in [0,cells), exactly period-periodic.
 * The modulus is the INTEGER cell count, so the lattice closes bit-exactly.
 */
vec2 latticeP(vec2 p, vec2 cells, vec2 period) {
  return wrapPeriod2(p * (cells / periodSafe(period)), cells);
}

/** Distance-or-shade coercion. A value outside 0..1 is treated as a signed distance. */
float toShade(float v) {
  if (v < 0.0 || v > 1.0) {
    return 1.0 - smoothstep(-0.02, 0.02, v);
  }
  return clamp(v, 0.0, 1.0);
}

// ---------------------------------------------------------------- transforms

vec2 rot2(vec2 p, float c, float s) {
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

vec2 scale2(vec2 p, vec2 f) {
  return p / f;
}

vec2 repeat2(vec2 p, vec2 per) {
  return vec2(wrapCentered(p.x, per.x), wrapCentered(p.y, per.y));
}

vec2 mirror2(vec2 p, vec2 m) {
  return mix(p, abs(p), m);
}

// ---------------------------------------------------------------- hashing / noise

float hash21(vec2 p, float seed) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + seed * 0.001);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float fade(float t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float valueNoise2(vec2 p, float scale, float seed, vec2 period) {
  vec2 cells = cellCount(scale, period);
  vec2 s = latticeP(p, cells, period);
  vec2 i0 = floor(s);
  vec2 f = s - i0;
  vec2 fSmooth = vec2(fade(f.x), fade(f.y));
  vec2 c0 = mod(i0, cells);
  vec2 c1 = mod(i0 + 1.0, cells);
  float n00 = hash21(vec2(c0.x, c0.y), seed);
  float n10 = hash21(vec2(c1.x, c0.y), seed);
  float n01 = hash21(vec2(c0.x, c1.y), seed);
  float n11 = hash21(vec2(c1.x, c1.y), seed);
  return mix(mix(n00, n10, fSmooth.x), mix(n01, n11, fSmooth.x), fSmooth.y);
}

const int NOISE_FBM = 0;
const int NOISE_RIDGED = 1;
const int NOISE_TURBULENCE = 2;
const int NOISE_BILLOW = 3;

float fbmVariant(vec2 p, float scale, int octaves, int variant, float seed, vec2 period) {
  float amp = 0.5;
  float freq = scale;
  float sum = 0.0;
  float norm = 0.0;
  float weight = 1.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float n = valueNoise2(p, freq, seed + float(i) * 1013.0, period);
    float s = n * 2.0 - 1.0;
    float v = n;
    if (variant == NOISE_RIDGED) {
      v = 1.0 - abs(s);
      v = v * v * weight;
      weight = clamp(v * 2.0, 0.0, 1.0);
    } else if (variant == NOISE_TURBULENCE) {
      v = abs(s);
    } else if (variant == NOISE_BILLOW) {
      v = s * s;
    }
    sum += amp * v;
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return norm > 0.0 ? clamp(sum / norm, 0.0, 1.0) : 0.0;
}

float fbm2(vec2 p, float scale, int octaves, float seed, vec2 period) {
  return fbmVariant(p, scale, octaves, NOISE_FBM, seed, period);
}

// ---------------------------------------------------------------- domain warp

vec2 warpOffset(vec2 p, float scale, int octaves, float seed, vec2 period) {
  float wx = fbm2(p, scale, octaves, seed + 71.13, period);
  float wy = fbm2(p, scale, octaves, seed + 917.71, period);
  return vec2(wx, wy) * 2.0 - 1.0;
}

/** Additive periodic displacement: commutes with lattice translation, so it preserves seams. */
vec2 warpP(vec2 p, float scale, float amount, int octaves, float seed, vec2 period) {
  return p + amount * warpOffset(p, scale, octaves, seed, period);
}

// ---------------------------------------------------------------- primitives

float sdCircle(vec2 p, float r) {
  return length(p) - r;
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdRing(vec2 p, float r, float thickness) {
  return abs(length(p) - r) - thickness * 0.5;
}

float sdSegment(vec2 p, vec2 a, vec2 b, float thickness) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h) - thickness * 0.5;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// ---------------------------------------------------------------- cellular

float cellDist(vec2 d, int distFn) {
  if (distFn == 1) return abs(d.x) + abs(d.y);
  if (distFn == 2) return max(abs(d.x), abs(d.y));
  return length(d);
}

/** metric: 0 = f1, 1 = f2-f1, 2 = per-cell id. Always returns 0..1. */
float worley(vec2 p, float scale, int metric, float jitter, int distFn, float seed, vec2 period) {
  vec2 cells = cellCount(scale, period);
  vec2 s = latticeP(p, cells, period);
  vec2 i0 = floor(s);
  vec2 f = s - i0;
  float j = clamp(jitter, 0.0, 1.0);
  float f1 = 1e9;
  float f2 = 1e9;
  float id1 = 0.0;
  for (int jj = -1; jj <= 1; jj++) {
    for (int ii = -1; ii <= 1; ii++) {
      float cx = mod(i0.x + float(ii) + cells.x, cells.x);
      float cy = mod(i0.y + float(jj) + cells.y, cells.y);
      float ox = 0.5 + j * (hash21(vec2(cx, cy), seed) - 0.5);
      float oy = 0.5 + j * (hash21(vec2(cx, cy), seed + 19.0) - 0.5);
      vec2 d = vec2(float(ii), float(jj)) + vec2(ox, oy) - f;
      float dist = cellDist(d, distFn);
      if (dist < f1) {
        f2 = f1;
        f1 = dist;
        id1 = hash21(vec2(cx, cy), seed + 131.0);
      } else if (dist < f2) {
        f2 = dist;
      }
    }
  }
  if (metric == 2) return id1;
  float norm = distFn == 1 ? 2.0 : 1.0;
  return metric == 1 ? clamp((f2 - f1) / norm, 0.0, 1.0)
                     : clamp(f1 / norm, 0.0, 1.0);
}

float voronoiEdge(vec2 p, float scale, float edgeWidth, float seed, vec2 period) {
  return 1.0 - smoothstep(0.0, edgeWidth, worley(p, scale, 1, 1.0, 0, seed, period));
}

// ---------------------------------------------------------------- lattice patterns

/** Running bond. brickW / brickH are snapped so columns and ROW PAIRS both divide the period. */
float brickShade(vec2 p, float brickW, float brickH, float mortar, float offsetAmt, vec2 period) {
  vec2 P = periodSafe(period);
  float cols = max(1.0, floor(P.x / max(brickW, 1e-6) + 0.5));
  float pairs = max(1.0, floor(P.y / max(brickH * 2.0, 1e-6) + 0.5));
  float bw = P.x / cols;
  float bh = P.y / (pairs * 2.0);
  float row = floor(p.y / bh);
  float xOff = mod(row, 2.0) < 0.5 ? 0.0 : bw * offsetAmt;
  float lx = mod(p.x + xOff, bw);
  float ly = mod(p.y, bh);
  float mx = min(lx, bw - lx);
  float my = min(ly, bh - ly);
  bool inMortar = mx < mortar || my < mortar;
  return inMortar ? 0.15 : 0.85;
}

float truchetArc(vec2 f, float thickness) {
  float d0 = abs(length(f) - 0.5);
  float d1 = abs(length(f - vec2(1.0)) - 0.5);
  return min(d0, d1) - thickness * 0.5;
}

float truchetChamfer(vec2 f, float thickness) {
  return min(sdSegment(f, vec2(0.5, 0.0), vec2(1.0, 0.5), thickness),
             sdSegment(f, vec2(0.0, 0.5), vec2(0.5, 1.0), thickness));
}

/**
 * variant: 0 = arcs, 1 = diagonals. Returns 0..1.
 * Both variants terminate at the four edge midpoints under either flip, so strokes
 * always join across cell borders — including across the tile wrap.
 */
float truchetShade(vec2 p, float scale, float thickness, float soft, int variant,
                   float seed, vec2 period) {
  vec2 cells = cellCount(scale, period);
  vec2 s = latticeP(p, cells, period);
  vec2 i0 = floor(s);
  vec2 f = s - i0;
  if (hash21(vec2(mod(i0.x, cells.x), mod(i0.y, cells.y)), seed) > 0.5) f.x = 1.0 - f.x;
  float d = variant == 1 ? truchetChamfer(f, thickness) : truchetArc(f, thickness);
  float w = max(soft, 1e-4);
  return 1.0 - smoothstep(-w, w, d);
}

/** v is p.x or p.y; P is the matching period component. Spacing snaps to a divisor of P. */
float stripeShade(float v, float spacing, float duty, float soft, float P) {
  float per = max(P, 1e-6);
  float bands = max(1.0, floor(per / max(spacing, 1e-6) + 0.5));
  float t = fract(v * bands / per);
  float halfDuty = clamp(duty, 0.0, 1.0) * 0.5;
  float d = abs(t - 0.5) - halfDuty;
  float w = max(soft, 1e-5);
  return 1.0 - smoothstep(-w, w, d);
}

float checkerShade(vec2 p, float scale, vec2 period) {
  vec2 cells = cellCountEven(scale, period);
  vec2 s = latticeP(p, cells, period);
  vec2 i0 = floor(s);
  return mod(i0.x + i0.y, 2.0) < 0.5 ? 0.0 : 1.0;
}

/** Signed distance IN METERS to the nearest scratch segment. */
float scratchDist(vec2 p, int count, float lengthM, float widthM, float scale,
                  float angle, float spread, float seed, vec2 period) {
  vec2 cells = cellCount(scale, period);
  vec2 effv = cells / periodSafe(period);
  float eff = effv.x;
  vec2 s = latticeP(p, cells, period);
  vec2 i0 = floor(s);
  vec2 f = s - i0;
  float lc = clamp(lengthM * eff, 0.02, 1.0);
  float wc = max(widthM * eff, 1e-4);
  float best = 1e9;
  for (int jj = -1; jj <= 1; jj++) {
    for (int ii = -1; ii <= 1; ii++) {
      float cx = mod(i0.x + float(ii) + cells.x, cells.x);
      float cy = mod(i0.y + float(jj) + cells.y, cells.y);
      vec2 base = vec2(float(ii), float(jj)) - f;
      for (int k = 0; k < 6; k++) {
        if (k >= count) break;
        float kk = float(k) * 37.0;
        vec2 c = base + vec2(hash21(vec2(cx, cy), seed + kk),
                             hash21(vec2(cx, cy), seed + kk + 7.0));
        float a = angle + spread * (hash21(vec2(cx, cy), seed + kk + 13.0) - 0.5);
        vec2 dir = vec2(cos(a), sin(a));
        float h = lc * 0.5 * (0.5 + 0.5 * hash21(vec2(cx, cy), seed + kk + 23.0));
        best = min(best, sdSegment(vec2(0.0), c - dir * h, c + dir * h, wc));
      }
    }
  }
  return best / max(eff, 1e-6);
}

// ---------------------------------------------------------------- halftone

/** Cell counts snapped to a multiple of det = a*a + b*b, so the dot lattice closes. */
vec2 halftoneCells(float scale, vec2 period, float det) {
  vec2 c = cellCount(scale, period);
  return max(vec2(det), floor(c / det + 0.5) * det);
}

/** Screen coords for the Gaussian-integer rotation M = [[a,-b],[b,a]]. Dots sit at integer u. */
vec2 screenCoord(vec2 p, vec2 cells, vec2 period, float a, float b) {
  vec2 s = latticeP(p, cells, period);
  float det = max(a * a + b * b, 1e-6);
  return vec2(a * s.x + b * s.y, -b * s.x + a * s.y) / det;
}

/** Meter-space centre of the halftone cell containing p, for centre-sampling the child. */
vec2 halftoneCenter(vec2 p, float scale, vec2 period, float a, float b) {
  float det = max(a * a + b * b, 1e-6);
  vec2 cells = halftoneCells(scale, period, det);
  vec2 u = floor(screenCoord(p, cells, period, a, b)) + 0.5;
  vec2 s = vec2(a * u.x - b * u.y, b * u.x + a * u.y);
  return s * (periodSafe(period) / cells);
}

/** v is the child value (0..1) sampled at the dot centre. Dot AREA is linear in v. */
float halftoneMask(vec2 p, float scale, float soft, vec2 period, float a, float b, float v) {
  float det = max(a * a + b * b, 1e-6);
  vec2 cells = halftoneCells(scale, period, det);
  vec2 u = screenCoord(p, cells, period, a, b);
  vec2 f = u - floor(u) - 0.5;
  float r = sqrt(clamp(v, 0.0, 1.0)) * 0.7071;
  float w = max(soft, 1e-4);
  return 1.0 - smoothstep(r - w, r + w, length(f));
}

// ---------------------------------------------------------------- remap / blend

float posterize(float x, float steps) {
  float n = max(steps, 2.0);
  return clamp(floor(min(clamp(x, 0.0, 1.0), 0.999999) * n) / (n - 1.0), 0.0, 1.0);
}

float remapRange(float x, float inMin, float inMax, float outMin, float outMax) {
  float t = clamp((x - inMin) / max(abs(inMax - inMin), 1e-6) * sign(inMax - inMin), 0.0, 1.0);
  return mix(outMin, outMax, t);
}

float blendScreen(float a, float b) {
  return 1.0 - (1.0 - a) * (1.0 - b);
}

float blendOverlay(float a, float b) {
  return a < 0.5 ? (2.0 * a * b) : (1.0 - 2.0 * (1.0 - a) * (1.0 - b));
}

// ---------------------------------------------------------------- color

vec3 iqPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318530718 * (c * t + d));
}
`;
