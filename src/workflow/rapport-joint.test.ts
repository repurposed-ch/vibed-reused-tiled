import { describe, expect, it } from 'vitest';
import type { BoundaryConditionsJson } from '@/domain/boundaries';
import { createTileDefinition } from '@/domain/tile';
import { findRapportModule, gridUnit, rapportToTileSchema } from './rapport';
import { fillPolygonWithTileSchema } from './tile-grid-fill';

const big = createTileDefinition({ id: 'big', name: 'big', length: 0.29, width: 0.29 });
const unit = createTileDefinition({ id: 'unit', name: 'unit', length: 0.14, width: 0.14 });

function rect(size: number): BoundaryConditionsJson {
  return {
    type: 'BoundaryConditions',
    outers: [
      {
        type: 'Polygon2',
        vertices: [
          [0, 0],
          [size, 0],
          [size, size],
          [0, size],
        ].map(([x, y]) => ({ type: 'Vec2' as const, x: x!, y: y! })),
      },
    ],
    holes: [],
    guides: [],
  } as BoundaryConditionsJson;
}

describe('rapport with a joint', () => {
  it('finds the grid unit over dimension + joint', () => {
    expect(gridUnit([big, unit], 0.001, 0.01)).toBeCloseTo(0.15, 9);
    // Without the joint those sizes share only a 0.01 m divisor.
    expect(gridUnit([big, unit], 0.001, 0)).toBeCloseTo(0.01, 9);
  });

  it('builds a repeat whose tiles all fit their footprints', () => {
    const module = findRapportModule({
      tiles: [big, unit],
      targets: [
        { tileDefinitionId: 'big', areaShare: 60 },
        { tileDefinitionId: 'unit', areaShare: 40 },
      ],
      joint: 0.01,
    });
    expect(module).not.toBeNull();
    expect(module!.unit).toBeCloseTo(0.15, 9);

    const schema = rapportToTileSchema(module!, { joint: 0.01 });
    expect(schema.tileGrids[0]!.joint).toBeCloseTo(0.01, 9);

    const result = fillPolygonWithTileSchema({ schema, tiles: [big, unit], boundaries: rect(1.2) });
    expect(result.placements.length).toBeGreaterThan(0);
    expect(result.stats.oversized).toEqual({});
  });
});
