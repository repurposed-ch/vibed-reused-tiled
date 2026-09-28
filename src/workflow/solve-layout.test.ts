import { describe, expect, it } from 'vitest';
import { poseAabb } from '@/domain/pose';
import { createDefaultProject } from '@/domain/project';
import { mulberry32, sampleStock } from './sample-stock';
import { solveLayout } from './solve-layout';

describe('solveLayout module packing', () => {
  it('lays each module repeat down once, with no overlapping tiles', () => {
    const project = { ...createDefaultProject(), tileSchema: undefined };
    const module = project.designFamily.modules[0]!;
    expect(module.repeat?.count).toBeGreaterThan(1);

    const instance = solveLayout({
      tileDefinitions: project.tileDefinitions,
      designFamily: project.designFamily,
      boundaries: project.boundaries,
      sampledStock: sampleStock(project.stock, mulberry32(7)),
      seed: 7,
      tileSchema: project.tileSchema,
    });

    const tiles = new Map(project.tileDefinitions.map((t) => [t.id, t]));
    const boxes = instance.placements.map((p) => poseAabb(p, tiles.get(p.tileDefinitionId)!));
    expect(boxes.length).toBeGreaterThan(module.placements.length * module.repeat!.count);

    const eps = 1e-9;
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlap =
          a.minX < b.maxX - eps &&
          b.minX < a.maxX - eps &&
          a.minY < b.maxY - eps &&
          b.minY < a.maxY - eps;
        expect(overlap, `placements ${i} and ${j} overlap`).toBe(false);
      }
    }
  });
});
