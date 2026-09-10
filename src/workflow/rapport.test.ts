import { describe, expect, it } from 'vitest';
import { placementAabb, transformPointMat3 } from '@/domain/mat3';
import { createTileDefinition } from '@/domain/tile';
import { tileGridCells } from '@/domain/tile-grid';
import {
  findRapportModule,
  gridUnit,
  mirrorRapport,
  rapportTileDemand,
  rapportToDesignModule,
  rapportToTileGrid,
  rapportToTileSchema,
  type RapportModule,
} from '@/workflow/rapport';
import { resolveSchema, validateLattice } from '@/workflow/tile-grid-lattice';

const large = createTileDefinition({ id: 'large', name: '30x30', length: 0.3, width: 0.3 });
const small = createTileDefinition({ id: 'small', name: '15x15', length: 0.15, width: 0.15 });
const slab = createTileDefinition({ id: 'slab', name: '30x15', length: 0.3, width: 0.15 });

describe('gridUnit', () => {
  it('reduces tile dimensions to their common divisor', () => {
    expect(gridUnit([large, small])).toBeCloseTo(0.15, 6);
    expect(gridUnit([large, slab])).toBeCloseTo(0.15, 6);
  });
});

describe('findRapportModule', () => {
  it('fills the module without gaps or overlaps', () => {
    const module = findRapportModule({
      tiles: [large, small],
      targets: [
        { tileDefinitionId: 'large', areaShare: 60 },
        { tileDefinitionId: 'small', areaShare: 40 },
      ],
    });

    expect(module).not.toBeNull();
    if (!module) return;

    const covered = new Set<string>();
    let cells = 0;
    for (const p of module.placements) {
      for (let y = p.yUnits; y < p.yUnits + p.heightUnits; y += 1) {
        for (let x = p.xUnits; x < p.xUnits + p.widthUnits; x += 1) {
          const key = `${x}:${y}`;
          expect(covered.has(key)).toBe(false);
          covered.add(key);
          cells += 1;
        }
      }
    }
    expect(cells).toBe(module.widthUnits * module.heightUnits);
  });

  it('lands near the requested area shares', () => {
    const module = findRapportModule({
      tiles: [large, small],
      targets: [
        { tileDefinitionId: 'large', areaShare: 0.75 },
        { tileDefinitionId: 'small', areaShare: 0.25 },
      ],
    });

    expect(module).not.toBeNull();
    if (!module) return;
    expect(module.achievedShares.large).toBeGreaterThan(0.5);
    expect(module.deviation).toBeLessThan(30);
  });

  it('is deterministic for a given seed', () => {
    const options = {
      tiles: [large, slab],
      targets: [
        { tileDefinitionId: 'large', areaShare: 50 },
        { tileDefinitionId: 'slab', areaShare: 50 },
      ],
      seed: 42,
    };
    const a = findRapportModule(options);
    const b = findRapportModule(options);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('handles three formats and stays within a workable time budget', () => {
    const started = performance.now();
    const module = findRapportModule({
      tiles: [large, small, slab],
      targets: [
        { tileDefinitionId: 'large', areaShare: 50 },
        { tileDefinitionId: 'slab', areaShare: 30 },
        { tileDefinitionId: 'small', areaShare: 20 },
      ],
    });
    const elapsed = performance.now() - started;

    expect(module).not.toBeNull();
    expect(elapsed).toBeLessThan(1000);
  });

  it('returns null when no format carries a positive share', () => {
    const module = findRapportModule({
      tiles: [large, small],
      targets: [
        { tileDefinitionId: 'large', areaShare: 0 },
        { tileDefinitionId: 'small', areaShare: 0 },
      ],
    });
    expect(module).toBeNull();
  });
});

describe('mirrorRapport', () => {
  it('doubles each mirrored axis and keeps area shares', () => {
    const module = findRapportModule({
      tiles: [large, small],
      targets: [
        { tileDefinitionId: 'large', areaShare: 60 },
        { tileDefinitionId: 'small', areaShare: 40 },
      ],
    });
    expect(module).not.toBeNull();
    if (!module) return;

    const mirrored = mirrorRapport(module, { x: true, y: true });
    expect(mirrored.widthUnits).toBe(module.widthUnits * 2);
    expect(mirrored.heightUnits).toBe(module.heightUnits * 2);
    expect(mirrored.placements.length).toBe(module.placements.length * 4);
    expect(mirrored.achievedShares.large).toBeCloseTo(module.achievedShares.large ?? 0, 6);
  });

  it('still covers every cell exactly once after mirroring', () => {
    const module = findRapportModule({
      tiles: [large, slab],
      targets: [
        { tileDefinitionId: 'large', areaShare: 50 },
        { tileDefinitionId: 'slab', areaShare: 50 },
      ],
    });
    expect(module).not.toBeNull();
    if (!module) return;

    const mirrored = mirrorRapport(module, { x: true, y: false });
    const covered = new Set<string>();
    for (const p of mirrored.placements) {
      for (let y = p.yUnits; y < p.yUnits + p.heightUnits; y += 1) {
        for (let x = p.xUnits; x < p.xUnits + p.widthUnits; x += 1) {
          const key = `${x}:${y}`;
          expect(covered.has(key)).toBe(false);
          covered.add(key);
        }
      }
    }
    expect(covered.size).toBe(mirrored.widthUnits * mirrored.heightUnits);
  });
});

describe('rapportToDesignModule', () => {
  it('emits one placement per tile with grid-aligned transforms', () => {
    const module = findRapportModule({
      tiles: [large, small],
      targets: [
        { tileDefinitionId: 'large', areaShare: 60 },
        { tileDefinitionId: 'small', areaShare: 40 },
      ],
    });
    expect(module).not.toBeNull();
    if (!module) return;

    const designModule = rapportToDesignModule(module, { name: 'Test rapport' });
    expect(designModule.type).toBe('DesignModule');
    expect(designModule.name).toBe('Test rapport');
    expect(designModule.placements.length).toBe(module.placements.length);

    const first = designModule.placements[0];
    expect(first?.localMat3.type).toBe('Mat3');
    expect(first?.tileDefinitionId).toBeTruthy();
  });
});

describe('rapportTileDemand', () => {
  it('scales tile counts with the number of repeats', () => {
    const module = findRapportModule({
      tiles: [large, small],
      targets: [
        { tileDefinitionId: 'large', areaShare: 60 },
        { tileDefinitionId: 'small', areaShare: 40 },
      ],
    });
    expect(module).not.toBeNull();
    if (!module) return;

    const one = rapportTileDemand(module, { width: module.width, height: module.height });
    const four = rapportTileDemand(module, {
      width: module.width * 2,
      height: module.height * 2,
    });
    expect(four.large).toBe((one.large ?? 0) * 4);
  });
});

describe('rapportToDesignModule rotation', () => {
  it('carries a rotated placement in the matrix, not in a role string', () => {
    // A 0.3 × 0.15 slab standing on end: the footprint must come out
    // 0.15 wide and 0.3 tall, anchored at the placement origin.
    const module: RapportModule = {
      unit: 0.15,
      widthUnits: 1,
      heightUnits: 2,
      width: 0.15,
      height: 0.3,
      placements: [
        {
          tileDefinitionId: 'slab',
          xUnits: 0,
          yUnits: 0,
          widthUnits: 1,
          heightUnits: 2,
          rotated: true,
        },
      ],
      achievedShares: { slab: 1 },
      deviation: 0,
    };

    const designModule = rapportToDesignModule(module);
    const mat3 = designModule.placements[0]!.localMat3;

    // A rotation moves a different corner to the origin, so assert the
    // footprint the tile ends up occupying rather than where one corner lands.
    const aabb = placementAabb(mat3, slab);
    expect(aabb.minX).toBeCloseTo(0, 9);
    expect(aabb.minY).toBeCloseTo(0, 9);
    // The tile's length now runs along +Y and its width along +X.
    expect(aabb.maxX).toBeCloseTo(slab.width, 9);
    expect(aabb.maxY).toBeCloseTo(slab.length, 9);

    // Rotation must be a rigid motion: no scaling, no mirroring.
    const e = mat3.elements;
    expect(e[0]! * e[4]! - e[1]! * e[3]!).toBeCloseTo(1, 9);

    // The old behaviour recorded rotation only as a role string, which left the
    // matrix a pure translation and drew the tile 0.3 wide instead of 0.15.
    expect(transformPointMat3(mat3, slab.length, 0).y).toBeCloseTo(slab.length, 9);
  });

  it('leaves unrotated placements as plain translations', () => {
    const module = findRapportModule({
      tiles: [large, small],
      targets: [
        { tileDefinitionId: 'large', areaShare: 60 },
        { tileDefinitionId: 'small', areaShare: 40 },
      ],
    });
    expect(module).not.toBeNull();
    if (!module) return;

    const designModule = rapportToDesignModule(module);
    for (const placement of designModule.placements) {
      // Square formats never rotate, so every matrix stays a pure translation.
      expect(placement.localMat3.elements.slice(0, 6)).toEqual([1, 0, 0, 0, 1, 0]);
    }
  });
});

describe('rapportToTileGrid', () => {
  it('maps the solved module onto integer cells', () => {
    const module = findRapportModule({
      tiles: [large, small],
      targets: [
        { tileDefinitionId: 'large', areaShare: 60 },
        { tileDefinitionId: 'small', areaShare: 40 },
      ],
    });
    expect(module).not.toBeNull();
    if (!module) return;

    const tileGrid = rapportToTileGrid(module);
    expect(tileGrid.cell).toEqual({ x: module.unit, y: module.unit });
    expect(tileGrid.extent).toEqual({
      iCount: module.widthUnits,
      jCount: module.heightUnits,
    });
    expect(tileGrid.instances).toHaveLength(module.placements.length);
    // The small format is one cell, so it is what a clipped large tile becomes.
    expect(tileGrid.fallbackTileDefinitionId).toBe('small');
  });

  it('produces a domain that tiles the plane under the module extent', () => {
    const module = findRapportModule({
      tiles: [large, slab],
      targets: [
        { tileDefinitionId: 'large', areaShare: 50 },
        { tileDefinitionId: 'slab', areaShare: 50 },
      ],
    });
    expect(module).not.toBeNull();
    if (!module) return;

    const tileGrid = rapportToTileGrid(module);
    const result = validateLattice(
      tileGridCells(tileGrid),
      { i: module.widthUnits, j: 0 },
      { i: 0, j: module.heightUnits },
    );
    expect(result.ok).toBe(true);
  });
});

describe('rapportToTileSchema', () => {
  it('resolves into an exact cover of the plane', () => {
    const module = findRapportModule({
      tiles: [large, small],
      targets: [
        { tileDefinitionId: 'large', areaShare: 60 },
        { tileDefinitionId: 'small', areaShare: 40 },
      ],
    });
    expect(module).not.toBeNull();
    if (!module) return;

    const resolved = resolveSchema(rapportToTileSchema(module, { name: 'From rapport' }));
    expect(resolved.cells).toHaveLength(module.widthUnits * module.heightUnits);
    expect(resolved.u).toEqual({ i: module.widthUnits, j: 0 });
    expect(resolved.v).toEqual({ i: 0, j: module.heightUnits });
  });

  it('doubles the repeat when the master grid mirrors', () => {
    const module = findRapportModule({
      tiles: [large, small],
      targets: [
        { tileDefinitionId: 'large', areaShare: 60 },
        { tileDefinitionId: 'small', areaShare: 40 },
      ],
    });
    expect(module).not.toBeNull();
    if (!module) return;

    const resolved = resolveSchema(
      rapportToTileSchema(module, { mirror: { x: 'alternate', y: 'none' } }),
    );
    expect(resolved.u).toEqual({ i: module.widthUnits * 2, j: 0 });
    expect(resolved.cells).toHaveLength(module.widthUnits * module.heightUnits * 2);
  });
});

describe('zero shares', () => {
  const odd = createTileDefinition({ id: 'odd', name: '13x13', length: 0.13, width: 0.13 });

  it('never places a format the designer asked for none of', () => {
    const module = findRapportModule({
      tiles: [large, small, slab],
      targets: [
        { tileDefinitionId: 'large', areaShare: 50 },
        { tileDefinitionId: 'small', areaShare: 50 },
        { tileDefinitionId: 'slab', areaShare: 0 },
      ],
    });

    expect(module).not.toBeNull();
    if (!module) return;
    expect(module.placements.some((p) => p.tileDefinitionId === 'slab')).toBe(false);
    expect(module.achievedShares).not.toHaveProperty('slab');
  });

  it('keeps an unwanted format out of the cell size', () => {
    // gridUnit is a GCD over the catalogue, so a 0.13 m tile would drag the unit
    // from 0.15 m down to 0.01 m — wrecking a pattern built from formats the
    // designer does want. A zero share has to be excluded before that runs.
    const targets = [
      { tileDefinitionId: 'large', areaShare: 60 },
      { tileDefinitionId: 'small', areaShare: 40 },
    ];
    const without = findRapportModule({ tiles: [large, small], targets });
    const withZero = findRapportModule({
      tiles: [large, small, odd],
      targets: [...targets, { tileDefinitionId: 'odd', areaShare: 0 }],
    });

    expect(without).not.toBeNull();
    expect(withZero).not.toBeNull();
    if (!without || !withZero) return;
    expect(withZero.unit).toBeCloseTo(without.unit, 9);
    expect(withZero.unit).toBeCloseTo(0.15, 9);
  });

  it('produces the same repeat whether or not zero-share formats are listed', () => {
    const base = findRapportModule({
      tiles: [large, small],
      targets: [
        { tileDefinitionId: 'large', areaShare: 60 },
        { tileDefinitionId: 'small', areaShare: 40 },
      ],
    });
    const padded = findRapportModule({
      tiles: [large, small, slab],
      targets: [
        { tileDefinitionId: 'large', areaShare: 60 },
        { tileDefinitionId: 'small', areaShare: 40 },
        { tileDefinitionId: 'slab', areaShare: 0 },
      ],
    });
    expect(JSON.stringify(padded)).toBe(JSON.stringify(base));
  });

  it('still returns null when nothing carries a positive share', () => {
    expect(
      findRapportModule({
        tiles: [large, small],
        targets: [
          { tileDefinitionId: 'large', areaShare: 0 },
          { tileDefinitionId: 'small', areaShare: 0 },
        ],
      }),
    ).toBeNull();
  });
});
