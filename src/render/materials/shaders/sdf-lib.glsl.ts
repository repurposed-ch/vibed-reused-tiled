/** Shared GLSL helpers inlined into every material bake fragment shader (WebGL2 / GLSL ES 3.00). */
export const SDF_LIB_GLSL = /* glsl */ `
float wrapPeriod(float v, float period) {
  float p = max(period, 1e-6);
  return mod(mod(v, p) + p, p);
}

vec2 wrapPeriod2(vec2 v, float period) {
  return vec2(wrapPeriod(v.x, period), wrapPeriod(v.y, period));
}

float wrapCentered(float v, float period) {
  float w = wrapPeriod(v, period);
  return w > period * 0.5 ? w - period : w;
}

float hash21(vec2 p, float seed) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + seed * 0.001);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float fade(float t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float valueNoise2(vec2 p, float scale, float seed, float period) {
  float cells = max(1.0, floor(period * scale + 0.5));
  vec2 scaled = wrapPeriod2(p * scale, period * scale);
  vec2 i0 = floor(scaled);
  vec2 f = scaled - i0;
  vec2 fSmooth = vec2(fade(f.x), fade(f.y));
  float x0 = mod(i0.x, cells);
  float y0 = mod(i0.y, cells);
  float x1 = mod(i0.x + 1.0, cells);
  float y1 = mod(i0.y + 1.0, cells);
  float n00 = hash21(vec2(x0, y0), seed);
  float n10 = hash21(vec2(x1, y0), seed);
  float n01 = hash21(vec2(x0, y1), seed);
  float n11 = hash21(vec2(x1, y1), seed);
  return mix(mix(n00, n10, fSmooth.x), mix(n01, n11, fSmooth.x), fSmooth.y);
}

float fbm2(vec2 p, float scale, int octaves, float seed, float period) {
  float amp = 0.5;
  float freq = scale;
  float sum = 0.0;
  float norm = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * valueNoise2(p, freq, seed + float(i) * 1013.0, period);
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return norm > 0.0 ? sum / norm : 0.0;
}

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

float voronoiEdge(vec2 p, float scale, float edgeWidth, float seed, float period) {
  float cells = max(1.0, floor(period * scale + 0.5));
  vec2 scaled = wrapPeriod2(p * scale, period * scale);
  vec2 i0 = floor(scaled);
  vec2 f = scaled - i0;
  float f1 = 1e9;
  float f2 = 1e9;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      float cx = mod(i0.x + float(i) + cells, cells);
      float cy = mod(i0.y + float(j) + cells, cells);
      float ox = hash21(vec2(cx, cy), seed);
      float oy = hash21(vec2(cx, cy), seed + 19.0);
      vec2 d = vec2(float(i), float(j)) + vec2(ox, oy) - f;
      float dist = length(d);
      if (dist < f1) {
        f2 = f1;
        f1 = dist;
      } else if (dist < f2) {
        f2 = dist;
      }
    }
  }
  float edge = f2 - f1;
  return 1.0 - smoothstep(0.0, edgeWidth, edge);
}

float brickShade(vec2 p, float brickW, float brickH, float mortar, float offsetAmt) {
  float row = floor(p.y / brickH);
  float xOff = mod(row, 2.0) < 0.5 ? 0.0 : brickW * offsetAmt;
  float lx = mod(p.x + xOff, brickW);
  float ly = mod(p.y, brickH);
  if (lx < 0.0) lx += brickW;
  if (ly < 0.0) ly += brickH;
  float mx = min(lx, brickW - lx);
  float my = min(ly, brickH - ly);
  bool inMortar = mx < mortar || my < mortar;
  return inMortar ? 0.15 : 0.85;
}
`;
