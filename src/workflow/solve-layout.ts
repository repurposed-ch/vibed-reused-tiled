import type { BoundaryConditionsJson } from '@/domain/boundaries';
import type { DesignFamilyJson, DesignModuleJson } from '@/domain/design-family';
import type { DesignInstanceJson, PlacementJson } from '@/domain/instance';
import { identityMat3, multiplyMat3, translationMat3, type Mat3Json } from '@/domain/mat3';
import type { TileDefinitionJson } from '@/domain/tile';
import type { SampledStock } from './sample-stock';

export type SolveInput = {
  tileDefinitions: TileDefinitionJson[];
  designFamily: DesignFamilyJson;
  boundaries: BoundaryConditionsJson;
  sampledStock: SampledStock[];
  seed: number;
};

type Rect = { x: number; y: number; w: number; h: number };

function outerAabb(boundaries: BoundaryConditionsJson): Rect {
  let minX = 0;
  let minY = 0;
  let maxX = 4;
  let maxY = 3;
  const outer = boundaries.outers[0];
  if (outer && outer.type === 'Polygon2' && Array.isArray(outer.vertices)) {
    const verts = outer.vertices as Array<{ x: number; y: number }>;
    if (verts.length) {
      minX = Math.min(...verts.map((v) => v.x));
      minY = Math.min(...verts.map((v) => v.y));
      maxX = Math.max(...verts.map((v) => v.x));
      maxY = Math.max(...verts.map((v) => v.y));
    }
  } else if (outer && outer.type === 'Aabb2') {
    const min = outer.min as { x: number; y: number } | undefined;
    const max = outer.max as { x: number; y: number } | undefined;
    if (min && max) {
      minX = min.x;
      minY = min.y;
      maxX = max.x;
      maxY = max.y;
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function expandModule(
  module: DesignModuleJson,
  world: Mat3Json,
  tiles: Map<string, TileDefinitionJson>,
  remaining: Map<string, number>,
): PlacementJson[] {
  const out: PlacementJson[] = [];
  const repeats = module.repeat?.count ?? 1;
  let cursor = world;
  for (let r = 0; r < repeats; r += 1) {
    for (const pl of module.placements) {
      const left = remaining.get(pl.tileDefinitionId) ?? 0;
      if (left <= 0) continue;
      if (!tiles.has(pl.tileDefinitionId)) continue;
      out.push({
        id: crypto.randomUUID(),
        tileDefinitionId: pl.tileDefinitionId,
        mat3: multiplyMat3(cursor, pl.localMat3),
        moduleId: module.id,
      });
      remaining.set(pl.tileDefinitionId, left - 1);
    }
    if (module.repeat && r < repeats - 1) {
      cursor = multiplyMat3(cursor, module.repeat.offsetMat3);
    }
  }
  return out;
}

function placementFootprint(
  placement: PlacementJson,
  tile: TileDefinitionJson,
): Rect {
  const x = placement.mat3.elements[6] ?? 0;
  const y = placement.mat3.elements[7] ?? 0;
  return { x, y, w: tile.length, h: tile.width };
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return !(
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  );
}

function insideBounds(rect: Rect, bounds: Rect): boolean {
  return (
    rect.x >= bounds.x - 1e-9 &&
    rect.y >= bounds.y - 1e-9 &&
    rect.x + rect.w <= bounds.x + bounds.w + 1e-9 &&
    rect.y + rect.h <= bounds.y + bounds.h + 1e-9
  );
}

function scoreCandidate(
  family: DesignFamilyJson,
  tiles: Map<string, TileDefinitionJson>,
  existing: PlacementJson[],
  candidate: PlacementJson,
): number {
  let score = 0;
  const tile = tiles.get(candidate.tileDefinitionId);
  if (!tile) return -Infinity;
  const gapRule = family.constraints.find((c) => c.kind === 'gapTolerance');
  const maxGap = Number(gapRule?.params.maxGap ?? 0.01);
  const candRect = placementFootprint(candidate, tile);

  for (const other of existing) {
    const ot = tiles.get(other.tileDefinitionId);
    if (!ot) continue;
    const oRect = placementFootprint(other, ot);
    if (overlaps(candRect, oRect, 0)) return -Infinity;

    const dx = Math.abs(candRect.x - (oRect.x + oRect.w));
    const dy = Math.abs(candRect.y - (oRect.y + oRect.h));
    const touching =
      Math.abs(candRect.x - (oRect.x + oRect.w)) <= maxGap ||
      Math.abs(oRect.x - (candRect.x + candRect.w)) <= maxGap ||
      Math.abs(candRect.y - (oRect.y + oRect.h)) <= maxGap ||
      Math.abs(oRect.y - (candRect.y + candRect.h)) <= maxGap;

    for (const c of family.constraints) {
      if (c.kind === 'materialAlternate' && touching) {
        if (tile.material !== ot.material) score += c.weight;
      }
      if (c.kind === 'adjacencyPrefer' && touching) {
        score += c.weight * 0.5;
      }
      if (c.kind === 'rhythmMatch' && touching) {
        score += c.weight;
      }
      if (c.kind === 'gapTolerance') {
        score += c.weight * (1 / (1 + Math.min(dx, dy)));
      }
    }
  }
  return score;
}

/**
 * Solver v1: place primary modules along +X then +Y, then greedy leftover fill on a coarse grid.
 */
export function solveLayout(input: SolveInput): DesignInstanceJson {
  const tiles = new Map(input.tileDefinitions.map((t) => [t.id, t]));
  const remaining = new Map(input.sampledStock.map((s) => [s.tileDefinitionId, s.count]));
  const bounds = outerAabb(input.boundaries);
  const placements: PlacementJson[] = [];

  const primaryIds =
    input.designFamily.primaryModuleIds.length > 0
      ? input.designFamily.primaryModuleIds
      : input.designFamily.modules.map((m) => m.id);

  let cursorX = bounds.x;
  let cursorY = bounds.y;
  let rowHeight = 0;

  for (const moduleId of primaryIds) {
    const module = input.designFamily.modules.find((m) => m.id === moduleId);
    if (!module || module.placements.length === 0) continue;

    const moduleW = module.placements.reduce((w, pl) => {
      const t = tiles.get(pl.tileDefinitionId);
      const x = (pl.localMat3.elements[6] ?? 0) + (t?.length ?? 0);
      return Math.max(w, x);
    }, 0);
    const moduleH = module.placements.reduce((h, pl) => {
      const t = tiles.get(pl.tileDefinitionId);
      const y = (pl.localMat3.elements[7] ?? 0) + (t?.width ?? 0);
      return Math.max(h, y);
    }, 0);

    const repeats = module.repeat?.count ?? 1;
    for (let r = 0; r < repeats; r += 1) {
      if (cursorX + moduleW > bounds.x + bounds.w + 1e-6) {
        cursorX = bounds.x;
        cursorY += rowHeight || moduleH;
        rowHeight = 0;
      }
      if (cursorY + moduleH > bounds.y + bounds.h + 1e-6) break;

      const world = translationMat3(cursorX, cursorY);
      const added = expandModule(module, world, tiles, remaining);
      if (!added.length) break;
      placements.push(...added);
      cursorX += moduleW + 0.002;
      rowHeight = Math.max(rowHeight, moduleH);
    }
  }

  // Greedy leftover fill on a coarse grid
  const step = Math.max(
    0.2,
    Math.min(...input.tileDefinitions.map((t) => Math.min(t.length, t.width)), 0.4),
  );
  const gap =
    Number(
      input.designFamily.constraints.find((c) => c.kind === 'gapTolerance')?.params.maxGap ??
        0.002,
    ) || 0.002;

  let guard = 0;
  const maxFill = 200;
  while (guard++ < maxFill) {
    let best: { score: number; placement: PlacementJson } | null = null;
    for (const [tileId, count] of remaining) {
      if (count <= 0) continue;
      const tile = tiles.get(tileId);
      if (!tile) continue;
      for (let y = bounds.y; y + tile.width <= bounds.y + bounds.h + 1e-9; y += step) {
        for (let x = bounds.x; x + tile.length <= bounds.x + bounds.w + 1e-9; x += step) {
          const candidate: PlacementJson = {
            id: 'tmp',
            tileDefinitionId: tileId,
            mat3: translationMat3(x, y),
          };
          const rect = placementFootprint(candidate, tile);
          if (!insideBounds(rect, bounds)) continue;
          let hit = false;
          for (const p of placements) {
            const ot = tiles.get(p.tileDefinitionId);
            if (!ot) continue;
            if (overlaps(rect, placementFootprint(p, ot), gap)) {
              hit = true;
              break;
            }
          }
          if (hit) continue;
          const score = scoreCandidate(input.designFamily, tiles, placements, candidate);
          if (!best || score > best.score) {
            best = {
              score,
              placement: { ...candidate, id: crypto.randomUUID() },
            };
          }
        }
      }
    }
    if (!best || best.score === -Infinity) break;
    placements.push(best.placement);
    remaining.set(
      best.placement.tileDefinitionId,
      (remaining.get(best.placement.tileDefinitionId) ?? 1) - 1,
    );
  }

  return {
    type: 'DesignInstance',
    placements,
    meta: {
      seed: input.seed,
      sampledStock: input.sampledStock,
      solverStats: {
        placementCount: placements.length,
        remainingTotal: [...remaining.values()].reduce((a, b) => a + b, 0),
      },
    },
  };
}

export { identityMat3 };
