import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { DesignInstanceJson, InstanceGridJson } from '@/domain/instance';
import { multiplyMat3, rotationMat3, scaleMat3, translationMat3, type Mat3Json } from '@/domain/mat3';
import { createTileDefinition } from '@/domain/tile';
import { groutPathD } from '@/render/svg/grout-path';
import {
  buildGroutGeometry,
  GROUT_BAKE_PERIOD,
  groutBlocks,
  MIN_GROUT_TOP,
  type GroutBlock,
} from './grout-geometry';

const tile = createTileDefinition({ id: 't', length: 0.14, width: 0.14, thickness: 0.02 });
const tiles = new Map([[tile.id, tile]]);

function gridInstance(frame: Mat3Json): DesignInstanceJson {
  const grid: InstanceGridJson = { frame, cell: { x: 0.15, y: 0.15 }, joint: 0.01 };
  const placements = [
    { i: 0, j: 0 },
    { i: 1, j: 0 },
    { i: 0, j: 1 },
    { i: 1, j: 1 },
  ].map(({ i, j }) => ({
    id: `${i}:${j}`,
    tileDefinitionId: tile.id,
    mat3: translationMat3(0, 0),
    cell: { i, j, iSpan: 1, jSpan: 1 },
  }));
  return { type: 'DesignInstance', placements, grid };
}

const frames: Array<[string, Mat3Json]> = [
  ['plain', translationMat3(0.3, -0.2)],
  ['rotated', multiplyMat3(translationMat3(-1.1, 2.3), rotationMat3(0.73))],
  ['mirrored', multiplyMat3(translationMat3(0.5, 0.9), scaleMat3(-1, 1))],
];

function read(blocks: GroutBlock[]) {
  const g = buildGroutGeometry(blocks);
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  return Array.from({ length: pos.count }, (_, i) => ({
    p: new Vector3().fromBufferAttribute(pos, i),
    n: new Vector3().fromBufferAttribute(nrm, i),
    uv: [uv.getX(i), uv.getY(i)] as const,
  }));
}

describe('grout geometry', () => {
  it('builds a top and four sides per block', () => {
    const blocks = groutBlocks(gridInstance(frames[0]![1]), tiles, 0.0015);
    expect(read(blocks)).toHaveLength(20 * blocks.length);
  });

  it('recesses the grout surface below the tile top, never to the floor', () => {
    const shallow = groutBlocks(gridInstance(frames[0]![1]), tiles, 0.0015);
    expect(shallow[0]!.top).toBeCloseTo(0.02 - 0.0015, 12);
    const deep = groutBlocks(gridInstance(frames[0]![1]), tiles, 0.05);
    expect(deep[0]!.top).toBe(MIN_GROUT_TOP);
  });

  // Every block in a grid shares the frame's axes, so the texture must be continuous across
  // every joint: a world point on a shared edge gets the same UV from each block that has it.
  it.each(frames)('keeps texture continuous across shared edges: %s frame', (_name, frame) => {
    const vs = read(groutBlocks(gridInstance(frame), tiles, 0.0015)).filter((v) => v.n.z > 0.5);
    const byPoint = new Map<string, Array<readonly [number, number]>>();
    for (const v of vs) {
      const k = `${v.p.x.toFixed(9)},${v.p.y.toFixed(9)}`;
      (byPoint.get(k) ?? byPoint.set(k, []).get(k)!).push(v.uv);
    }
    let shared = 0;
    for (const uvs of byPoint.values()) {
      if (uvs.length < 2) continue;
      shared += 1;
      for (const uv of uvs) {
        expect(uv[0]).toBeCloseTo(uvs[0]![0], 9);
        expect(uv[1]).toBeCloseTo(uvs[0]![1], 9);
      }
    }
    expect(shared).toBeGreaterThan(0);
  });

  it.each(frames)('faces the top up and the sides outward: %s frame', (_name, frame) => {
    const blocks = groutBlocks(gridInstance(frame), tiles, 0.0015);
    const vs = read(blocks);
    for (let b = 0; b < blocks.length; b += 1) {
      const block = vs.slice(b * 20, b * 20 + 20);
      const centre = block.slice(0, 4).reduce((acc, v) => acc.add(v.p), new Vector3()).multiplyScalar(0.25);
      for (const v of block.slice(0, 4)) expect(v.n.z).toBeCloseTo(1, 12);
      for (const v of block.slice(4)) {
        expect(v.n.z).toBeCloseTo(0, 12);
        expect(v.n.x * (v.p.x - centre.x) + v.n.y * (v.p.y - centre.y)).toBeGreaterThan(0);
      }
    }
  });

  it('maps loose (design-family) blocks straight from world xy', () => {
    const instance: DesignInstanceJson = {
      type: 'DesignInstance',
      placements: [{ id: 'p', tileDefinitionId: tile.id, mat3: translationMat3(1.2, 0.7) }],
    };
    for (const v of read(groutBlocks(instance, tiles, 0.0015))) {
      expect(v.uv[0]).toBeCloseTo(v.p.x / GROUT_BAKE_PERIOD, 9);
      expect(v.uv[1]).toBeCloseTo(v.p.y / GROUT_BAKE_PERIOD, 9);
    }
  });
});

describe('groutPathD', () => {
  it('emits one closed subpath per block at the block corners', () => {
    const blocks = groutBlocks(gridInstance(frames[1]![1]), tiles, 0.0015);
    const d = groutPathD(blocks);
    expect(d.match(/M/g)).toHaveLength(blocks.length);
    expect(d.match(/Z/g)).toHaveLength(blocks.length);
    expect(d.match(/L/g)).toHaveLength(blocks.length * 3);
  });
});
