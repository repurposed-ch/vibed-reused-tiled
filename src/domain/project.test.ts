import { describe, expect, it } from 'vitest';
import { createDefaultProject, parseTilingProject } from '@/domain/project';
import { mulberry32, sampleStock } from '@/workflow/sample-stock';
import { solveLayout } from '@/workflow/solve-layout';

describe('project schema', () => {
  it('round-trips the default project', () => {
    const project = createDefaultProject();
    const again = parseTilingProject(JSON.parse(JSON.stringify(project)) as unknown);
    expect(again.schemaVersion).toBe(1);
    expect(again.tileDefinitions.length).toBeGreaterThan(0);
  });
});

describe('workflow', () => {
  it('samples stock and produces placements', () => {
    const project = createDefaultProject();
    const sampled = sampleStock(project.stock, mulberry32(7));
    expect(sampled.every((s) => s.count >= 0)).toBe(true);
    const instance = solveLayout({
      tileDefinitions: project.tileDefinitions,
      designFamily: project.designFamily,
      boundaries: project.boundaries,
      sampledStock: sampled,
      seed: 7,
    });
    expect(instance.placements.length).toBeGreaterThan(0);
  });
});
