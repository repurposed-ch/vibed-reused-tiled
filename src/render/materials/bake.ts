import type { MaterialDefinitionJson } from '@/domain/material';
import {
  hasCompleteRhythm,
  type RhythmSideJson,
  type TileColorJson,
  type TileDefinitionJson,
} from '@/domain/tile';
import { buildBakeFragmentShader, FULLSCREEN_VERT_GLSL } from './sdf-to-glsl';

export const TEXTURE_SIZE = 1024;

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
  dataUrl: string;
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

/** Matches `uOutput` in buildBakeFragmentShader. */
const OUTPUT = { albedo: 0, normal: 1, roughness: 2, lit: 3 } as const;

type BakeGl = {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  vao: WebGLVertexArrayObject;
  programs: Map<string, WebGLProgram>;
};

let shared: BakeGl | null = null;

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

function createDrawingCanvas(size: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(size, size);
    } catch {
      /* fall through */
    }
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    return c;
  }
  throw new Error('No canvas available for GLSL texture bake');
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create WebGL shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown';
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create WebGL program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown';
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  return program;
}

function getBakeGl(size: number): BakeGl {
  if (shared) {
    const { canvas } = shared;
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    return shared;
  }

  const canvas = createDrawingCanvas(size);
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
    premultipliedAlpha: false,
  }) as WebGL2RenderingContext | null;
  if (!gl) throw new Error('WebGL2 unavailable for material texture bake');

  const vao = gl.createVertexArray();
  if (!vao) throw new Error('Failed to create VAO');
  gl.bindVertexArray(vao);

  shared = { canvas, gl, vao, programs: new Map() };
  return shared;
}

function getProgram(ctx: BakeGl, fragSrc: string): WebGLProgram {
  const hit = ctx.programs.get(fragSrc);
  if (hit) return hit;
  const program = linkProgram(ctx.gl, FULLSCREEN_VERT_GLSL, fragSrc);
  ctx.programs.set(fragSrc, program);
  return program;
}

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

function edgeUniforms(side: RhythmSideJson | undefined): { seed: number; mirror: number } {
  if (!side) return { seed: 1, mirror: 0 };
  return {
    seed: hashEdgeName(side.name),
    mirror: side.mirrored ? 1 : 0,
  };
}

/** Read the current framebuffer into a top-down canvas (readPixels is bottom-up). */
function readOutput(gl: WebGL2RenderingContext, size: number): BakeMap {
  const pixels = new Uint8Array(size * size * 4);
  gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  const imageData = new ImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    const srcRow = (size - 1 - y) * size * 4;
    const dstRow = y * size * 4;
    imageData.data.set(pixels.subarray(srcRow, srcRow + size * 4), dstRow);
  }

  const canvas = createOutputCanvas(size);
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) throw new Error('2D context unavailable for bake output');
  ctx2d.putImageData(imageData, 0, 0);
  return { canvas, imageData };
}

/**
 * Bake a tile via GLSL on a WebGL2 OffscreenCanvas (or hidden canvas fallback).
 *
 * Every output comes from the same program — the normal is the gradient of the albedo's
 * scalar field and roughness is a remap of it — so extra outputs are one more draw and
 * readback each, not another shader. Only requested outputs are baked: the 2D previews ask
 * for albedo alone and pay nothing extra.
 */
export function bakeMaterialTexture(
  input: BakeTileInput,
  size = TEXTURE_SIZE,
  options: BakeOptions = {},
): BakeResult {
  const { material, color, length, width, rhythm } = input;
  const edged = hasCompleteRhythm(rhythm);
  const ctx = getBakeGl(size);
  const { gl, vao } = ctx;
  const fragSrc = buildBakeFragmentShader(material.sdf);
  const program = getProgram(ctx, fragSrc);

  gl.bindVertexArray(vao);
  gl.viewport(0, 0, size, size);
  gl.useProgram(program);

  const periodX = Math.max(length, 1e-6);
  const periodY = Math.max(width, 1e-6);
  const s = edgeUniforms(rhythm?.south);
  const n = edgeUniforms(rhythm?.north);
  const e = edgeUniforms(rhythm?.east);
  const w = edgeUniforms(rhythm?.west);

  gl.uniform2f(gl.getUniformLocation(program, 'uResolution'), size, size);
  gl.uniform2f(gl.getUniformLocation(program, 'uTileSize'), length, width);
  gl.uniform1f(gl.getUniformLocation(program, 'uSeed'), material.seed);
  gl.uniform2f(gl.getUniformLocation(program, 'uPeriod'), periodX, periodY);
  gl.uniform1i(gl.getUniformLocation(program, 'uEdged'), edged ? 1 : 0);
  gl.uniform1f(gl.getUniformLocation(program, 'uEdgeSeedS'), s.seed);
  gl.uniform1f(gl.getUniformLocation(program, 'uEdgeSeedN'), n.seed);
  gl.uniform1f(gl.getUniformLocation(program, 'uEdgeSeedE'), e.seed);
  gl.uniform1f(gl.getUniformLocation(program, 'uEdgeSeedW'), w.seed);
  gl.uniform1f(gl.getUniformLocation(program, 'uEdgeMirrorS'), s.mirror);
  gl.uniform1f(gl.getUniformLocation(program, 'uEdgeMirrorN'), n.mirror);
  gl.uniform1f(gl.getUniformLocation(program, 'uEdgeMirrorE'), e.mirror);
  gl.uniform1f(gl.getUniformLocation(program, 'uEdgeMirrorW'), w.mirror);
  gl.uniform1f(gl.getUniformLocation(program, 'uRelief'), material.relief ?? 0);
  const [roughLow, roughHigh] = material.roughness ?? [1, 1];
  gl.uniform2f(gl.getUniformLocation(program, 'uRough'), roughLow, roughHigh);

  if (color.mode === 'palette') {
    const [a, b, d] = color.colors;
    const [cx, cy, cz] = color.c ?? [1, 1, 1];
    const pa = parseHexRgb(a);
    const pb = parseHexRgb(b);
    const pd = parseHexRgb(d);
    gl.uniform1i(gl.getUniformLocation(program, 'uColorMode'), 1);
    gl.uniform3f(gl.getUniformLocation(program, 'uColor'), 0, 0, 0);
    gl.uniform3f(gl.getUniformLocation(program, 'uPalA'), pa[0], pa[1], pa[2]);
    gl.uniform3f(gl.getUniformLocation(program, 'uPalB'), pb[0], pb[1], pb[2]);
    gl.uniform3f(gl.getUniformLocation(program, 'uPalC'), cx, cy, cz);
    gl.uniform3f(gl.getUniformLocation(program, 'uPalD'), pd[0], pd[1], pd[2]);
  } else {
    const [r, g, bl] = parseHexRgb(color.color);
    gl.uniform1i(gl.getUniformLocation(program, 'uColorMode'), 0);
    gl.uniform3f(gl.getUniformLocation(program, 'uColor'), r, g, bl);
    gl.uniform3f(gl.getUniformLocation(program, 'uPalA'), 0, 0, 0);
    gl.uniform3f(gl.getUniformLocation(program, 'uPalB'), 0, 0, 0);
    gl.uniform3f(gl.getUniformLocation(program, 'uPalC'), 1, 1, 1);
    gl.uniform3f(gl.getUniformLocation(program, 'uPalD'), 0, 0, 0);
  }

  const outputLoc = gl.getUniformLocation(program, 'uOutput');
  const draw = (code: number): BakeMap => {
    gl.uniform1i(outputLoc, code);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return readOutput(gl, size);
  };

  const primary = draw(OUTPUT[options.primary ?? 'albedo']);
  const result: BakeResult = {
    canvas: primary.canvas,
    // Only the primary gets a data URL — toDataURL is the expensive part of a bake, and
    // nothing consumes a data URL for the normal or roughness maps.
    dataUrl: primary.canvas.toDataURL('image/png'),
    imageData: primary.imageData,
    edged,
  };
  if (options.normal) result.normal = draw(OUTPUT.normal);
  if (options.roughness) result.roughness = draw(OUTPUT.roughness);
  return result;
}

/** Release the shared WebGL bake context (tests / hot reload). */
export function disposeBakeContext(): void {
  if (!shared) return;
  const { gl, programs, vao } = shared;
  for (const program of programs.values()) gl.deleteProgram(program);
  gl.deleteVertexArray(vao);
  shared = null;
}
