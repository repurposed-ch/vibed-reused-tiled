import type { MaterialDefinitionJson, SdfNodeJson } from '@/domain/material';
import {
  hasCompleteRhythm,
  type RhythmSideJson,
  type TileColorJson,
  type TileDefinitionJson,
} from '@/domain/tile';
import { evalSdfNode, toShade, type Vec2 } from './sdf-cpu';
import {
  buildFieldFragmentShader,
  FULLSCREEN_VERT_GLSL,
  SURFACE_FRAGMENT_GLSL,
} from './sdf-to-glsl';

export const TEXTURE_SIZE = 1024;

/**
 * Largest bake the CPU fallback produces. It only runs when WebGL2 is missing or broken, and a
 * 1024² CPU bake of a deep graph takes seconds; a soft texture beats a frozen tab.
 */
const CPU_MAX_SIZE = 256;

/**
 * Pixels per field draw. Windows resets the GPU when one submission runs longer than ~2 s
 * (TDR), which WebGL reports as a lost context. Splitting the expensive pass into strips,
 * each flushed on its own, keeps every submission short on slow integrated GPUs.
 */
const STRIP_PIXELS = 128 * 1024;

/** Compiled field programs kept per context. Each committed edit in the editor adds one. */
const PROGRAM_CACHE_LIMIT = 24;

export type BakeTileInput = {
  material: MaterialDefinitionJson;
  color: TileColorJson;
  length: number;
  width: number;
  rhythm?: TileDefinitionJson['rhythm'];
};

export type BakeMap = {
  canvas: HTMLCanvasElement;
  imageData: ImageData;
};

export type BakeResult = {
  /** The primary output — albedo, or the lit preview when `primary: 'lit'`. */
  canvas: HTMLCanvasElement;
  /** PNG of the primary output, encoded on first read: the 3D path never needs it. */
  readonly dataUrl: string;
  imageData: ImageData;
  edged: boolean;
  /** Tangent-space normal, RGB-encoded. Only present when requested. */
  normal?: BakeMap;
  /** Roughness in every channel (three reads .g). Only present when requested. */
  roughness?: BakeMap;
};

export type BakeOptions = {
  primary?: 'albedo' | 'lit';
  normal?: boolean;
  roughness?: boolean;
};

/** Matches `uOutput` in SURFACE_FRAGMENT_GLSL. */
const OUTPUT = { albedo: 0, normal: 1, roughness: 2, lit: 3 } as const;
type OutputCode = (typeof OUTPUT)[keyof typeof OUTPUT];

type Target = { field: WebGLTexture; fieldFbo: WebGLFramebuffer; out: WebGLTexture; outFbo: WebGLFramebuffer };

type BakeGl = {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  vao: WebGLVertexArrayObject;
  surface: WebGLProgram;
  /** Insertion-ordered, so the first key is the least recently used. */
  fieldPrograms: Map<string, WebGLProgram>;
  targets: Map<number, Target>;
  lost: boolean;
};

let shared: BakeGl | null = null;
/** Set once WebGL2 cannot be created at all; every later bake goes straight to the CPU. */
let gpuUnavailable = false;
let warned = false;

export function parseHexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [196 / 255, 165 / 255, 116 / 255];
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function hashEdgeName(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Which path the next bake will take — surfaced for diagnostics. */
export function bakeBackend(): 'webgl2' | 'cpu' {
  return gpuUnavailable ? 'cpu' : 'webgl2';
}

// ---------------------------------------------------------------- GL setup

function createDrawingCanvas(): OffscreenCanvas | HTMLCanvasElement {
  // Every pass renders into its own framebuffer, so the canvas itself never needs resizing.
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(1, 1);
    } catch {
      /* fall through */
    }
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return c;
  }
  throw new Error('No canvas available for GLSL texture bake');
}

function linkProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vs || !fs || !program) throw new Error('Failed to create WebGL program');
  gl.shaderSource(vs, vertSrc);
  gl.shaderSource(fs, fragSrc);
  gl.compileShader(vs);
  gl.compileShader(fs);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  // Only the link status is queried: each status query is a sync point with the GPU process,
  // and the shader logs are only worth fetching once something has failed.
  const ok = gl.getProgramParameter(program, gl.LINK_STATUS);
  const log = ok
    ? ''
    : [gl.getShaderInfoLog(fs), gl.getShaderInfoLog(vs), gl.getProgramInfoLog(program)]
        .filter(Boolean)
        .join('\n');
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!ok) {
    gl.deleteProgram(program);
    throw new Error(`Bake shader failed to compile: ${log || 'unknown error'}`);
  }
  return program;
}

function createContext(): BakeGl {
  const canvas = createDrawingCanvas();
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    depth: false,
    stencil: false,
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    // Ask for the integrated GPU on dual-GPU laptops: bakes are short, and waking the discrete
    // GPU for them is what tends to stall Windows machines.
    powerPreference: 'low-power',
  }) as WebGL2RenderingContext | null;
  if (!gl) {
    gpuUnavailable = true;
    throw new Error('WebGL2 unavailable for material texture bake');
  }

  const vao = gl.createVertexArray();
  if (!vao) throw new Error('Failed to create VAO');
  gl.bindVertexArray(vao);

  const ctx: BakeGl = {
    canvas,
    gl,
    vao,
    surface: linkProgram(gl, FULLSCREEN_VERT_GLSL, SURFACE_FRAGMENT_GLSL),
    fieldPrograms: new Map(),
    targets: new Map(),
    lost: false,
  };
  // A GPU reset (TDR on Windows, driver update, sleep) loses the context. Drop it so the next
  // bake builds a fresh one instead of failing forever.
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    ctx.lost = true;
    if (shared === ctx) shared = null;
  });
  return ctx;
}

function getBakeGl(): BakeGl {
  if (shared && !shared.lost && !shared.gl.isContextLost()) return shared;
  shared = createContext();
  return shared;
}

function getFieldProgram(ctx: BakeGl, fragSrc: string): WebGLProgram {
  const hit = ctx.fieldPrograms.get(fragSrc);
  if (hit) {
    ctx.fieldPrograms.delete(fragSrc);
    ctx.fieldPrograms.set(fragSrc, hit);
    return hit;
  }
  const program = linkProgram(ctx.gl, FULLSCREEN_VERT_GLSL, fragSrc);
  ctx.fieldPrograms.set(fragSrc, program);
  if (ctx.fieldPrograms.size > PROGRAM_CACHE_LIMIT) {
    const [oldKey, oldProgram] = ctx.fieldPrograms.entries().next().value!;
    ctx.gl.deleteProgram(oldProgram);
    ctx.fieldPrograms.delete(oldKey);
  }
  return program;
}

function createTarget(gl: WebGL2RenderingContext, size: number): { tex: WebGLTexture; fbo: WebGLFramebuffer } {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) throw new Error('Failed to create bake render target');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, size, size);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('Bake render target incomplete');
  }
  return { tex, fbo };
}

function getTarget(ctx: BakeGl, size: number): Target {
  const hit = ctx.targets.get(size);
  if (hit) return hit;
  const { gl } = ctx;
  const field = createTarget(gl, size);
  const out = createTarget(gl, size);
  const target = { field: field.tex, fieldFbo: field.fbo, out: out.tex, outFbo: out.fbo };
  ctx.targets.set(size, target);
  // Thumbnails, previews and 3D bakes use a handful of sizes; anything beyond that is churn.
  if (ctx.targets.size > 4) {
    const [oldSize, old] = ctx.targets.entries().next().value!;
    gl.deleteTexture(old.field);
    gl.deleteTexture(old.out);
    gl.deleteFramebuffer(old.fieldFbo);
    gl.deleteFramebuffer(old.outFbo);
    ctx.targets.delete(oldSize);
  }
  return target;
}

// ---------------------------------------------------------------- shared helpers

function createOutputCanvas(size: number): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('document required to materialize baked texture canvas');
  }
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/** Cheap seam check: max channel delta between opposite edges (0 = perfect wrap). */
export function seamError(imageData: ImageData): number {
  const { width, height, data } = imageData;
  let max = 0;
  for (let y = 0; y < height; y += 1) {
    const L = (y * width + 0) * 4;
    const R = (y * width + (width - 1)) * 4;
    for (let c = 0; c < 3; c += 1) {
      max = Math.max(max, Math.abs(data[L + c]! - data[R + c]!));
    }
  }
  for (let x = 0; x < width; x += 1) {
    const T = (0 * width + x) * 4;
    const B = ((height - 1) * width + x) * 4;
    for (let c = 0; c < 3; c += 1) {
      max = Math.max(max, Math.abs(data[T + c]! - data[B + c]!));
    }
  }
  return max;
}

type EdgeUniform = { seed: number; mirror: number };

function edgeUniforms(side: RhythmSideJson | undefined): EdgeUniform {
  if (!side) return { seed: 1, mirror: 0 };
  return {
    seed: hashEdgeName(side.name),
    mirror: side.mirrored ? 1 : 0,
  };
}

type Colour = {
  mode: 0 | 1;
  color: [number, number, number];
  palA: [number, number, number];
  palB: [number, number, number];
  palC: [number, number, number];
  palD: [number, number, number];
};

function colourUniforms(color: TileColorJson): Colour {
  if (color.mode === 'palette') {
    const [a, b, d] = color.colors;
    return {
      mode: 1,
      color: [0, 0, 0],
      palA: parseHexRgb(a),
      palB: parseHexRgb(b),
      palC: color.c ?? [1, 1, 1],
      palD: parseHexRgb(d),
    };
  }
  return {
    mode: 0,
    color: parseHexRgb(color.color),
    palA: [0, 0, 0],
    palB: [0, 0, 0],
    palC: [1, 1, 1],
    palD: [0, 0, 0],
  };
}

/** Bottom-up RGBA rows (GL order) into a top-down canvas. */
function toBakeMap(pixels: Uint8Array, size: number): BakeMap {
  const imageData = new ImageData(size, size);
  const row = size * 4;
  for (let y = 0; y < size; y += 1) {
    const src = (size - 1 - y) * row;
    imageData.data.set(pixels.subarray(src, src + row), y * row);
  }
  const canvas = createOutputCanvas(size);
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) throw new Error('2D context unavailable for bake output');
  ctx2d.putImageData(imageData, 0, 0);
  return { canvas, imageData };
}

function assemble(
  primary: BakeMap,
  edged: boolean,
  normal: BakeMap | undefined,
  roughness: BakeMap | undefined,
): BakeResult {
  let url: string | undefined;
  const result: BakeResult = {
    canvas: primary.canvas,
    imageData: primary.imageData,
    edged,
    get dataUrl() {
      url ??= primary.canvas.toDataURL('image/png');
      return url;
    },
  };
  if (normal) result.normal = normal;
  if (roughness) result.roughness = roughness;
  return result;
}

// ---------------------------------------------------------------- GPU path

function bakeGpu(input: BakeTileInput, size: number, options: BakeOptions): BakeResult {
  const { material, color, length, width, rhythm } = input;
  const edged = hasCompleteRhythm(rhythm);
  const ctx = getBakeGl();
  const { gl, vao } = ctx;
  const fieldProgram = getFieldProgram(ctx, buildFieldFragmentShader(material.sdf, edged));
  const target = getTarget(ctx, size);

  gl.bindVertexArray(vao);
  gl.viewport(0, 0, size, size);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);

  // Pass 1 — the expensive one: the material's field, once per texel, in short strips.
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fieldFbo);
  gl.useProgram(fieldProgram);
  const f = (name: string) => gl.getUniformLocation(fieldProgram, name);
  gl.uniform2f(f('uResolution'), size, size);
  gl.uniform2f(f('uTileSize'), length, width);
  gl.uniform1f(f('uSeed'), material.seed);
  gl.uniform2f(f('uPeriod'), Math.max(length, 1e-6), Math.max(width, 1e-6));
  if (edged) {
    const sides = { S: rhythm?.south, N: rhythm?.north, E: rhythm?.east, W: rhythm?.west };
    for (const [k, side] of Object.entries(sides)) {
      const e = edgeUniforms(side);
      gl.uniform1f(f(`uEdgeSeed${k}`), e.seed);
      gl.uniform1f(f(`uEdgeMirror${k}`), e.mirror);
    }
  }
  const rows = Math.max(1, Math.floor(STRIP_PIXELS / size));
  gl.enable(gl.SCISSOR_TEST);
  for (let y = 0; y < size; y += rows) {
    gl.scissor(0, y, size, Math.min(rows, size - y));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.flush();
  }
  gl.disable(gl.SCISSOR_TEST);

  // Pass 2 — cheap: albedo / normal / roughness from the stored field.
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.outFbo);
  gl.useProgram(ctx.surface);
  const s = (name: string) => gl.getUniformLocation(ctx.surface, name);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, target.field);
  gl.uniform1i(s('uField'), 0);
  gl.uniform2f(s('uTileSize'), length, width);
  gl.uniform1i(s('uWrap'), edged ? 0 : 1);
  gl.uniform1f(s('uRelief'), material.relief ?? 0);
  const [roughLow, roughHigh] = material.roughness ?? [1, 1];
  gl.uniform2f(s('uRough'), roughLow, roughHigh);
  const c = colourUniforms(color);
  gl.uniform1i(s('uColorMode'), c.mode);
  gl.uniform3f(s('uColor'), ...c.color);
  gl.uniform3f(s('uPalA'), ...c.palA);
  gl.uniform3f(s('uPalB'), ...c.palB);
  gl.uniform3f(s('uPalC'), ...c.palC);
  gl.uniform3f(s('uPalD'), ...c.palD);

  const outputLoc = s('uOutput');
  const pixels = new Uint8Array(size * size * 4);
  const draw = (code: OutputCode): BakeMap => {
    gl.uniform1i(outputLoc, code);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return toBakeMap(pixels, size);
  };

  const primary = draw(OUTPUT[options.primary ?? 'albedo']);
  const normal = options.normal ? draw(OUTPUT.normal) : undefined;
  const roughness = options.roughness ? draw(OUTPUT.roughness) : undefined;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  if (gl.isContextLost()) throw new Error('WebGL context lost during bake');
  return assemble(primary, edged, normal, roughness);
}

// ---------------------------------------------------------------- CPU fallback

function safeShade(node: SdfNodeJson, p: Vec2, seed: number, period: Vec2): number {
  try {
    const v = toShade(evalSdfNode(node, p, seed, period));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

/** The field in GL row order (row 0 = bottom), mirroring the field shader. */
function cpuField(input: BakeTileInput, size: number, edged: boolean): Float32Array {
  const { material, length, width, rhythm } = input;
  const period: Vec2 = [Math.max(length, 1e-6), Math.max(width, 1e-6)];
  const node = material.sdf;
  const out = new Float32Array(size * size);
  const S = edgeUniforms(rhythm?.south);
  const N = edgeUniforms(rhythm?.north);
  const E = edgeUniforms(rhythm?.east);
  const W = edgeUniforms(rhythm?.west);
  const wrap = (v: number, p: number) => ((v % p) + p) % p;

  for (let y = 0; y < size; y += 1) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      let s: number;
      if (!edged) {
        s = safeShade(node, [wrap(u * length, period[0]), wrap(v * width, period[1])], material.seed, period);
      } else {
        const dS = v;
        const dN = 1 - v;
        const dW = u;
        const dE = 1 - u;
        const tS = S.mirror ? 1 - u : u;
        const tN = N.mirror ? 1 - u : u;
        const tW = W.mirror ? 1 - v : v;
        const tE = E.mirror ? 1 - v : v;
        const sS = safeShade(node, [tS * length, dS * width], S.seed, period);
        const sN = safeShade(node, [tN * length, dN * width], N.seed, period);
        const sW = safeShade(node, [dW * length, tW * width], W.seed, period);
        const sE = safeShade(node, [dE * length, tE * width], E.seed, period);
        const wS = 1 / (dS + 0.05);
        const wN = 1 / (dN + 0.05);
        const wW = 1 / (dW + 0.05);
        const wE = 1 / (dE + 0.05);
        s = (sS * wS + sN * wN + sW * wW + sE * wE) / (wS + wN + wW + wE);
      }
      out[y * size + x] = Math.min(Math.max(s, 0), 1);
    }
  }
  return out;
}

function bakeCpu(input: BakeTileInput, requested: number, options: BakeOptions): BakeResult {
  const size = Math.min(requested, CPU_MAX_SIZE);
  const edged = hasCompleteRhythm(input.rhythm);
  const field = cpuField(input, size, edged);
  const { material, length, width } = input;
  const relief = material.relief ?? 0;
  const [roughLow, roughHigh] = material.roughness ?? [1, 1];
  const col = colourUniforms(input.color);
  const h = 1 / size;
  const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
  const at = (x: number, y: number) => {
    if (edged) {
      x = Math.min(Math.max(x, 0), size - 1);
      y = Math.min(Math.max(y, 0), size - 1);
    } else {
      x = (x + size) % size;
      y = (y + size) % size;
    }
    return field[y * size + x]!;
  };
  const normalAt = (x: number, y: number): [number, number, number] => {
    const dx = ((at(x + 1, y) - at(x - 1, y)) / (2 * h * length)) * relief;
    const dy = ((at(x, y + 1) - at(x, y - 1)) / (2 * h * width)) * relief;
    const len = Math.hypot(dx, dy, 1);
    return [-dx / len, -dy / len, 1 / len];
  };
  const albedo = (s: number): [number, number, number] => {
    if (col.mode === 1) {
      return [0, 1, 2].map(
        (i) => col.palA[i]! + col.palB[i]! * Math.cos(6.28318530718 * (col.palC[i]! * s + col.palD[i]!)),
      ) as [number, number, number];
    }
    return [0, 1, 2].map((i) => col.color[i]! * (0.55 + (1.18 - 0.55) * s)) as [number, number, number];
  };
  const light = (() => {
    const l = [-0.55, 0.6, 0.58];
    const n = Math.hypot(l[0]!, l[1]!, l[2]!);
    return l.map((c) => c / n);
  })();

  const draw = (code: OutputCode): BakeMap => {
    const px = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = (y * size + x) * 4;
        let rgb: number[];
        if (code === OUTPUT.normal) {
          rgb = normalAt(x, y).map((c) => c * 0.5 + 0.5);
        } else if (code === OUTPUT.roughness) {
          const r = clamp01(roughLow + (roughHigh - roughLow) * at(x, y));
          rgb = [r, r, r];
        } else {
          rgb = albedo(at(x, y));
          if (code === OUTPUT.lit) {
            const n = normalAt(x, y);
            const k = 0.28 + 0.9 * Math.max(n[0] * light[0]! + n[1] * light[1]! + n[2] * light[2]!, 0);
            rgb = rgb.map((c) => c * k);
          }
        }
        px[i] = Math.round(clamp01(rgb[0]!) * 255);
        px[i + 1] = Math.round(clamp01(rgb[1]!) * 255);
        px[i + 2] = Math.round(clamp01(rgb[2]!) * 255);
        px[i + 3] = 255;
      }
    }
    return toBakeMap(px, size);
  };

  const primary = draw(OUTPUT[options.primary ?? 'albedo']);
  const normal = options.normal ? draw(OUTPUT.normal) : undefined;
  const roughness = options.roughness ? draw(OUTPUT.roughness) : undefined;
  return assemble(primary, edged, normal, roughness);
}

// ---------------------------------------------------------------- entry point

/**
 * Bake a tile's material to texture maps.
 *
 * Two passes on a shared WebGL2 context: the material's field is evaluated once per texel
 * into a 16-bit target, then a fixed shader derives albedo, normal (the field's gradient) and
 * roughness (a remap of it) from that target. Only requested outputs are read back.
 *
 * If WebGL2 is missing, the context is lost mid-bake, or the driver rejects the shader, the
 * bake falls back to the CPU evaluator at reduced resolution instead of leaving tiles blank.
 */
export function bakeMaterialTexture(
  input: BakeTileInput,
  size = TEXTURE_SIZE,
  options: BakeOptions = {},
): BakeResult {
  // Two attempts: a context lost to a GPU reset is rebuilt once before giving up on the GPU.
  for (let attempt = 0; attempt < 2 && !gpuUnavailable; attempt += 1) {
    try {
      return bakeGpu(input, size, options);
    } catch (error) {
      const lost = shared === null || shared.lost || shared.gl.isContextLost();
      if (lost && attempt === 0) {
        shared = null;
        continue;
      }
      if (!warned) {
        warned = true;
        console.warn('GPU material bake failed; falling back to CPU bake.', error);
      }
      break;
    }
  }
  return bakeCpu(input, size, options);
}

/** Release the shared WebGL bake context (tests / hot reload). */
export function disposeBakeContext(): void {
  if (!shared) return;
  const { gl, fieldPrograms, surface, targets, vao } = shared;
  for (const program of fieldPrograms.values()) gl.deleteProgram(program);
  gl.deleteProgram(surface);
  for (const t of targets.values()) {
    gl.deleteTexture(t.field);
    gl.deleteTexture(t.out);
    gl.deleteFramebuffer(t.fieldFbo);
    gl.deleteFramebuffer(t.outFbo);
  }
  gl.deleteVertexArray(vao);
  shared = null;
}
