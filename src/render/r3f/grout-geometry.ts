import { BufferGeometry, Float32BufferAttribute, MeshStandardMaterial } from 'three';
import { instanceBlocks, type DesignInstanceJson, type PlacementBlock } from '@/domain/instance';
import { transformPointMat3 } from '@/domain/mat3';
import type { TileDefinitionJson } from '@/domain/tile';
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

export type GroutBlock = PlacementBlock & { top: number };

/** Every placement's grout block, with its surface sitting `depth` below that tile's top. */
export function groutBlocks(
  instance: DesignInstanceJson,
  tiles: ReadonlyMap<string, TileDefinitionJson>,
  depth: number,
): GroutBlock[] {
  return instanceBlocks(instance, tiles).map((block) => {
    const tile = tiles.get(block.tileDefinitionId)!;
    return { ...block, top: Math.max(MIN_GROUT_TOP, tile.thickness - Math.max(depth, 0)) };
  });
}

/**
 * One merged mesh for all the grout: a top quad and four side quads per block.
 *
 * Merged rather than instanced — one draw call, one exported mesh instead of one per block,
 * and UVs computed here where they can be tested.
 *
 * **Texture space** is `R⁻¹ · (world xy) / period`, where R is the block's linear part. Every
 * grid block shares the schema frame's R, so a world point on an edge two blocks share gets
 * the same UV from both — the grout texture is continuous across every joint, and aligned to
 * the grid, for a rotated or mirrored frame alike. R⁻¹, not Rᵀ: frame axes are not normalised.
 */
export function buildGroutGeometry(
  blocks: readonly GroutBlock[],
  period = GROUT_BAKE_PERIOD,
): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const block of blocks) {
    const e = block.mat3.elements;
    const a = e[0];
    const b = e[1];
    const c = e[3];
    const d = e[4];
    const det = a * d - c * b;
    if (Math.abs(det) < 1e-12) continue;

    const toUv = (x: number, y: number): [number, number] => [
      (d * x - c * y) / det / period,
      (-b * x + a * y) / det / period,
    ];

    const local: Array<[number, number]> = [
      [0, 0],
      [block.width, 0],
      [block.width, block.height],
      [0, block.height],
    ];
    const world = local.map(([x, y]) => transformPointMat3(block.mat3, x, y));
    // A mirrored frame reverses the winding; restore counter-clockwise in world space so the
    // top faces up and the sides face out.
    if (det < 0) world.reverse();

    const vertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => {
      positions.push(x, y, z);
      normals.push(nx, ny, nz);
      uvs.push(...toUv(x, y));
      return positions.length / 3 - 1;
    };

    const topIndex = world.map((p) => vertex(p.x, p.y, block.top, 0, 0, 1));
    indices.push(topIndex[0]!, topIndex[1]!, topIndex[2]!, topIndex[0]!, topIndex[2]!, topIndex[3]!);

    for (let k = 0; k < 4; k += 1) {
      const p = world[k]!;
      const q = world[(k + 1) % 4]!;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      // Outward normal of a counter-clockwise edge.
      const nx = dy / len;
      const ny = -dx / len;
      const p0 = vertex(p.x, p.y, 0, nx, ny, 0);
      const q0 = vertex(q.x, q.y, 0, nx, ny, 0);
      const q1 = vertex(q.x, q.y, block.top, nx, ny, 0);
      const p1 = vertex(p.x, p.y, block.top, nx, ny, 0);
      indices.push(p0, q0, q1, p0, q1, p1);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
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
    // With no joint the tile wall and grout wall can share a plane at the pattern edge; the
    // offset makes the tile win instead of flickering.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}
