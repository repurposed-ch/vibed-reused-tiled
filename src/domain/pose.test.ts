import { describe, expect, it } from 'vitest';
import { multiplyMat3, rotationMat3, scaleMat3, translationMat3, transformPointMat3, type Mat3Json } from './mat3';
import { mat3ToPose, poseToMat3, type PoseJson } from './pose';

const tile = { length: 0.3, width: 0.15 };

/** The fill's orientation of a tile in its footprint: rotation first, then any mirror. */
function orientation(rotated: boolean, fx: boolean, fy: boolean): Mat3Json {
  const w = rotated ? tile.width : tile.length;
  const h = rotated ? tile.length : tile.width;
  const orient = rotated ? multiplyMat3(translationMat3(tile.width, 0), rotationMat3(Math.PI / 2)) : translationMat3(0, 0);
  const mirror = multiplyMat3(translationMat3(fx ? w : 0, fy ? h : 0), scaleMat3(fx ? -1 : 1, fy ? -1 : 1));
  return multiplyMat3(mirror, orient);
}

const frames: Array<[string, Mat3Json]> = [
  ['plain', translationMat3(0.3, -0.2)],
  ['rotated', multiplyMat3(translationMat3(-1.1, 2.3), rotationMat3(0.73))],
  ['mirrored', multiplyMat3(translationMat3(0.5, 0.9), scaleMat3(-1, 1))],
];

function expectSameMatrix(actual: Mat3Json, expected: Mat3Json) {
  actual.elements.forEach((e, i) => expect(e).toBeCloseTo(expected.elements[i]!, 12));
}

describe('pose', () => {
  it('applies mirror, then rotation, then position — all about the tile centre', () => {
    const pose: PoseJson = { position: { x: 2, y: 1 }, rotation: 90, mirror: true };
    const m = poseToMat3(pose, tile);
    // The centre lands on the position.
    const centre = transformPointMat3(m, tile.length / 2, tile.width / 2);
    expect(centre.x).toBeCloseTo(2, 12);
    expect(centre.y).toBeCloseTo(1, 12);
    // Mirror sends local +x to −x, the quarter turn then sends that to −y.
    const end = transformPointMat3(m, tile.length, tile.width / 2);
    expect(end.x - centre.x).toBeCloseTo(0, 12);
    expect(end.y - centre.y).toBeCloseTo(-tile.length / 2, 12);
  });

  it('is exact at quarter turns', () => {
    for (const rotation of [0, 90, 180, 270]) {
      const [a, b, , c, d] = poseToMat3({ position: { x: 0, y: 0 }, rotation, mirror: false }, tile).elements;
      for (const v of [a, b, c, d]) expect([-1, 0, 1]).toContain(v);
    }
  });

  it('round-trips a pose through its matrix', () => {
    for (const rotation of [0, 90, 180, 270, 37]) {
      for (const mirror of [false, true]) {
        const pose: PoseJson = { position: { x: 1.25, y: -0.5 }, rotation, mirror };
        const again = mat3ToPose(poseToMat3(pose, tile), tile);
        expect(again.mirror).toBe(mirror);
        expect(again.rotation).toBeCloseTo(rotation, 9);
        expect(again.position.x).toBeCloseTo(1.25, 12);
        expect(again.position.y).toBeCloseTo(-0.5, 12);
      }
    }
  });

  it('reproduces every matrix the schema fill builds', () => {
    for (const [, frame] of frames) {
      for (const rotated of [false, true]) {
        for (const fx of [false, true]) {
          for (const fy of [false, true]) {
            const m = multiplyMat3(frame, multiplyMat3(translationMat3(0.45, 0.3), orientation(rotated, fx, fy)));
            expectSameMatrix(poseToMat3(mat3ToPose(m, tile), tile), m);
          }
        }
      }
    }
  });

  it('snaps float noise to whole degrees', () => {
    const m = multiplyMat3(translationMat3(1, 1), rotationMat3(Math.PI / 2));
    expect(mat3ToPose(m, tile).rotation).toBe(90);
  });
});
