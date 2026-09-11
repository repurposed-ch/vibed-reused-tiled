import type { PlacementJson } from '@/domain/instance';
import type { Mat3Json } from '@/domain/mat3';
import type { MaterialDefinitionJson } from '@/domain/material';
import { hasCompleteRhythm, type TileDefinitionJson } from '@/domain/tile';
import { hashEdgeName } from '@/render/materials/bake';
import { seamlessnessReport, worstSeverity } from '@/render/materials/seamlessness';
import { mulberry32 } from '@/workflow/sample-stock';

/**
 * Per-instance data for rendering tiles with one InstancedMesh per tile type.
 *
 * Pure: no React, no three. Everything here is unit-testable in node, and the scene only
 * copies these arrays into GPU buffers.
 */

export type TileVariationSettings = {
  enabled: boolean;
  /** UV offset strength: each tile shows a window offset by up to this fraction of the tile. */
  offset: number;
  /** Tint depth: each tile is darkened by up to this fraction. */
  tint: number;
  seed: number;
};

export const DEFAULT_TILE_VARIATION: TileVariationSettings = {
  enabled: true,
  offset: 1,
  tint: 0.12,
  seed: 1,
};

export const MAX_TINT = 0.25;

/**
 * Tints are rounded to this step so the 3D view and an export use bit-identical values,
 * and so export can share one material per step instead of one per tile.
 */
export const TINT_STEP = 1 / 64;

/**
 * Tile centres are quantized before hashing, so a centre that differs only by float noise
 * keeps its variation. One micrometre, not one millimetre: on mm-aligned grids a half cell
 * (e.g. 0.0375 m) lands a centre exactly on a half-millimetre, which is a rounding boundary
 * where noise would flip the result. On those grids centres sit on whole micrometres.
 */
export const CENTER_QUANTUM = 1e-6;

export type PlacementPose = {
  /** Column-major 4x4 for a box CENTRED at the origin. Its linear part always has det > 0. */
  matrix: number[];
  /** Tile centre in the placement plane. */
  center: [number, number];
  /** 1 when the placement was mirrored; the mirror moves into the UVs instead. */
  mirrorU: 0 | 1;
};

/**
 * Split a placement into an instance matrix with positive determinant plus a UV mirror flag.
 *
 * InstancedMesh cannot correct triangle winding per instance, so a mirrored placement would
 * render inside out. A box is symmetric about its own centre, so mirroring it changes no
 * geometry — only which texel lands where. Negating the tile-local x axis restores det > 0,
 * and `mirrorU` reproduces the texture mirror in the vertex shader. This is exact on all six
 * box faces, for a flip in x, in y (a 180° turn plus a u-mirror), in both, and with the
 * 90° rotation — see tile-instances.test.ts.
 */
export function decomposePlacement(
  mat3: Mat3Json,
  tile: Pick<TileDefinitionJson, 'length' | 'width' | 'thickness'>,
): PlacementPose {
  const e = mat3.elements;
  // Column-major, matching the Matrix4 the scene has always built from these elements.
  let a = e[0];
  let b = e[1];
  const c = e[3];
  const d = e[4];
  const tx = e[6];
  const ty = e[7];

  const cx = a * (tile.length / 2) + c * (tile.width / 2) + tx;
  const cy = b * (tile.length / 2) + d * (tile.width / 2) + ty;

  let mirrorU: 0 | 1 = 0;
  if (a * d - c * b < 0) {
    a = -a;
    b = -b;
    mirrorU = 1;
  }

  return {
    matrix: [a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, cx, cy, tile.thickness / 2, 1],
    center: [cx, cy],
    mirrorU,
  };
}

export type TileVariation = {
  offset: [number, number];
  tint: number;
};

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : lo;
}

export function quantizeTint(v: number): number {
  return Math.round(v / TINT_STEP) * TINT_STEP;
}

/**
 * Deterministic variation for one tile.
 *
 * Keyed on tile type and position, never on placement id: ids are fresh UUIDs on every
 * solve, and auto-solve runs on every load and edit, so an id-keyed offset would reshuffle
 * constantly. Three numbers are always drawn, so switching tint on or off never changes the
 * offsets.
 */
export function variationFor(
  tileId: string,
  center: readonly [number, number],
  settings: TileVariationSettings,
  allow: { offset: boolean; tint: boolean },
): TileVariation {
  const qx = Math.round(center[0] / CENTER_QUANTUM);
  const qy = Math.round(center[1] / CENTER_QUANTUM);
  const rng = mulberry32(hashEdgeName(`${tileId}|${qx}|${qy}|${settings.seed >>> 0}`));
  const r1 = rng();
  const r2 = rng();
  const r3 = rng();

  const strength = clamp(settings.offset, 0, 1);
  const depth = clamp(settings.tint, 0, MAX_TINT);

  return {
    offset: allow.offset ? [r1 * strength, r2 * strength] : [0, 0],
    // Darken only: glTF caps baseColorFactor at 1, so a brightening tint could not export.
    tint: allow.tint ? quantizeTint(1 - depth * r3) : 1,
  };
}

/**
 * Whether a material may be offset. An offset slides the texture's wrap line into the middle
 * of the tile, which is invisible only when the field is truly periodic. A graph the
 * seamlessness linter flags as an error (off-lattice rotate, non-unit scale, bad repeat) would
 * show that line as a seam, so it keeps its tint but not its offset.
 */
export function materialAllowsOffset(
  material: MaterialDefinitionJson | undefined,
  tile: Pick<TileDefinitionJson, 'length' | 'width'>,
): boolean {
  if (!material) return true;
  return (
    worstSeverity(seamlessnessReport(material.sdf, { length: tile.length, width: tile.width })) !==
    'error'
  );
}

export type TileInstanceData = {
  tileDefinitionId: string;
  count: number;
  /** 16 per instance, column-major. */
  matrices: Float32Array;
  /** 3 per instance: offset u, offset v, mirrorU. */
  uvXform: Float32Array;
  /** 1 per instance (grey multiplier), or null when no instance of this type is tinted. */
  tints: Float32Array | null;
};

/** Group placements by tile type and compute every per-instance value, in placement order. */
export function buildTileInstances(
  placements: readonly PlacementJson[],
  tiles: ReadonlyMap<string, TileDefinitionJson>,
  settings: TileVariationSettings,
  offsetAllowed: (tile: TileDefinitionJson) => boolean = () => true,
): Map<string, TileInstanceData> {
  const grouped = new Map<string, PlacementJson[]>();
  for (const placement of placements) {
    if (!tiles.has(placement.tileDefinitionId)) continue;
    const list = grouped.get(placement.tileDefinitionId);
    if (list) list.push(placement);
    else grouped.set(placement.tileDefinitionId, [placement]);
  }

  const out = new Map<string, TileInstanceData>();
  for (const [tileId, list] of grouped) {
    const tile = tiles.get(tileId)!;
    // Edged tiles match their neighbours by rhythm label, so they are never offset or tinted.
    const continuous = !hasCompleteRhythm(tile.rhythm);
    const allow = {
      offset: settings.enabled && continuous && offsetAllowed(tile),
      tint: settings.enabled && continuous,
    };

    const count = list.length;
    const matrices = new Float32Array(count * 16);
    const uvXform = new Float32Array(count * 3);
    const tints = allow.tint ? new Float32Array(count) : null;

    list.forEach((placement, i) => {
      const pose = decomposePlacement(placement.mat3, tile);
      matrices.set(pose.matrix, i * 16);
      const variation = variationFor(tileId, pose.center, settings, allow);
      uvXform[i * 3] = variation.offset[0];
      uvXform[i * 3 + 1] = variation.offset[1];
      // The mirror is geometry, not variation: it applies to every tile, always.
      uvXform[i * 3 + 2] = pose.mirrorU;
      if (tints) tints[i] = variation.tint;
    });

    out.set(tileId, { tileDefinitionId: tileId, count, matrices, uvXform, tints });
  }
  return out;
}

/** Fill in and clamp a stored settings object, which may come from an older build. */
export function normalizeTileVariation(value: unknown): TileVariationSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<TileVariationSettings>;
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_TILE_VARIATION.enabled,
    offset:
      typeof v.offset === 'number' ? clamp(v.offset, 0, 1) : DEFAULT_TILE_VARIATION.offset,
    tint: typeof v.tint === 'number' ? clamp(v.tint, 0, MAX_TINT) : DEFAULT_TILE_VARIATION.tint,
    seed:
      typeof v.seed === 'number' && Number.isFinite(v.seed)
        ? Math.trunc(v.seed) >>> 0
        : DEFAULT_TILE_VARIATION.seed,
  };
}
