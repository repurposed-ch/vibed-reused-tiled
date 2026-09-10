import { createMaterialDefinition, type MaterialDefinitionJson, type SdfNodeJson } from './material';

const terracottaSdf: SdfNodeJson = {
  op: 'mix',
  t: 0.55,
  a: { op: 'noise', scale: 6, octaves: 4 },
  b: {
    op: 'mul',
    a: { op: 'noise', scale: 18, octaves: 2 },
    b: { op: 'fill', soft: 0.02, child: { op: 'circle', radius: 0.08, center: [0.15, 0.2] } },
  },
};

const stoneSdf: SdfNodeJson = {
  op: 'mix',
  t: 0.45,
  a: { op: 'voronoi', scale: 5, edgeWidth: 0.08 },
  b: { op: 'noise', scale: 12, octaves: 3 },
};

const ceramicSdf: SdfNodeJson = {
  op: 'mix',
  t: 0.35,
  a: { op: 'noise', scale: 10, octaves: 2 },
  b: {
    op: 'band',
    width: 0.04,
    soft: 0.01,
    child: {
      op: 'brick',
      brickW: 0.15,
      brickH: 0.08,
      mortar: 0.012,
      offset: 0.5,
    },
  },
};

/** Ridged noise, domain-warped, thresholded into veins over a soft base. */
const marbleSdf: SdfNodeJson = {
  op: 'mix',
  t: 0.55,
  a: { op: 'noise', scale: 10, octaves: 3 },
  b: {
    op: 'curve',
    gamma: 0.8,
    child: {
      op: 'threshold',
      level: 0.7,
      soft: 0.08,
      child: {
        op: 'warp',
        scale: 5,
        amount: 0.09,
        octaves: 3,
        child: { op: 'noise', scale: 10, octaves: 5, variant: 'ridged' },
      },
    },
  },
};

/** Per-cell random chips (cells/id) darkened at the cell borders (cells/f2f1). */
const terrazzoSdf: SdfNodeJson = {
  op: 'mul',
  a: {
    op: 'remap',
    inMin: 0,
    inMax: 1,
    outMin: 0.35,
    outMax: 1,
    child: { op: 'posterize', steps: 7, child: { op: 'cells', scale: 9, metric: 'id' } },
  },
  b: {
    op: 'threshold',
    level: 0.06,
    soft: 0.03,
    child: { op: 'cells', scale: 9, metric: 'f2f1' },
  },
};

/** Thin dark crackle lines over a near-flat glaze. */
const craquelureSdf: SdfNodeJson = {
  op: 'mix',
  t: 0.25,
  a: { op: 'noise', scale: 10, octaves: 2 },
  b: {
    op: 'threshold',
    level: 0.045,
    soft: 0.02,
    child: {
      op: 'warp',
      scale: 5,
      amount: 0.02,
      octaves: 2,
      child: { op: 'cells', scale: 10, metric: 'f2f1' },
    },
  },
};

/** Warped growth rings plus stretched grain. factor.y = 1/6 squashes the noise along y. */
const woodSdf: SdfNodeJson = {
  op: 'mix',
  t: 0.42,
  a: {
    op: 'warp',
    scale: 5,
    amount: 0.035,
    octaves: 3,
    child: { op: 'stripe', axis: 'y', spacing: 0.035, duty: 0.5, soft: 0.3 },
  },
  b: {
    op: 'scale',
    factor: [1, 1 / 8],
    child: { op: 'noise', scale: 20, octaves: 3 },
  },
};

/** Truchet quarter-arcs — strokes always join across cells, including across the wrap. */
const azulejoSdf: SdfNodeJson = {
  op: 'mix',
  t: 0.2,
  a: { op: 'truchet', scale: 10, thickness: 0.26, variant: 'arcs', soft: 0.012 },
  b: { op: 'noise', scale: 10, octaves: 2 },
};

/** Hard-edged repeated geometry flattened to discrete steps, with light wear. */
const encausticSdf: SdfNodeJson = {
  op: 'mix',
  t: 0.18,
  a: {
    op: 'posterize',
    steps: 3,
    child: {
      op: 'fill',
      soft: 0.006,
      child: {
        op: 'repeat',
        period: [0.15, 0.15],
        child: {
          op: 'union',
          a: { op: 'circle', radius: 0.045 },
          b: { op: 'box', halfExtents: [0.062, 0.008] },
        },
      },
    },
  },
  b: { op: 'noise', scale: 14, octaves: 2 },
};

/** Turbulent base, cellular pitting, directional wear streaks. */
const concreteSdf: SdfNodeJson = {
  op: 'mul',
  a: {
    op: 'mix',
    t: 0.4,
    a: { op: 'noise', scale: 10, octaves: 4, variant: 'turbulence' },
    b: {
      op: 'remap',
      inMin: 0,
      inMax: 0.6,
      outMin: 0.35,
      outMax: 1,
      child: { op: 'cells', scale: 12, metric: 'f1' },
    },
  },
  b: {
    op: 'fill',
    invert: true,
    soft: 0.0015,
    child: {
      op: 'scratches',
      count: 3,
      length: 0.05,
      width: 0.0025,
      scale: 10,
      angle: 0.4,
      spread: 1.2,
    },
  },
};

/** Topographic banding — warped fbm flattened into discrete contour steps. */
const contourSdf: SdfNodeJson = {
  op: 'posterize',
  steps: 9,
  child: {
    op: 'remap',
    inMin: 0.06,
    inMax: 0.9,
    outMin: 0,
    outMax: 1,
    child: {
      op: 'warp',
      scale: 5,
      amount: 0.08,
      octaves: 3,
      child: { op: 'noise', scale: 10, octaves: 4 },
    },
  },
};

/**
 * Setts: cell borders darken into joints, each stone gets its own tone (cells/id),
 * and cells/f1 domes it. All three share scale + seed, so they see the same cells.
 */
const cobblestoneSdf: SdfNodeJson = {
  op: 'mul',
  a: {
    op: 'threshold',
    level: 0.05,
    soft: 0.025,
    child: { op: 'cells', scale: 9, metric: 'f2f1', distance: 'manhattan' },
  },
  b: {
    op: 'mix',
    t: 0.5,
    a: {
      op: 'remap',
      inMin: 0,
      inMax: 1,
      outMin: 0.5,
      outMax: 1,
      child: { op: 'cells', scale: 9, metric: 'id' },
    },
    b: {
      op: 'curve',
      gamma: 0.7,
      child: {
        op: 'invert',
        child: {
          op: 'remap',
          inMin: 0,
          inMax: 0.6,
          outMin: 0,
          outMax: 1,
          child: { op: 'cells', scale: 9, metric: 'f1', distance: 'manhattan' },
        },
      },
    },
  },
};

/** Dot screen at a snapped 45° angle, driven by a soft warped field. */
const transferPrintSdf: SdfNodeJson = {
  op: 'mix',
  t: 0.15,
  a: {
    op: 'halftone',
    scale: 26,
    angle: Math.PI / 4,
    soft: 0.015,
    child: {
      op: 'warp',
      scale: 5,
      amount: 0.05,
      octaves: 2,
      child: { op: 'noise', scale: 10, octaves: 3 },
    },
  },
  b: { op: 'noise', scale: 12, octaves: 2 },
};

export function defaultMaterials(): MaterialDefinitionJson[] {
  return [
    createMaterialDefinition({
      id: 'material-terracotta',
      name: 'terracotta',
      seed: 11,
      sdf: terracottaSdf,
    }),
    createMaterialDefinition({
      id: 'material-stone',
      name: 'stone',
      seed: 42,
      sdf: stoneSdf,
    }),
    createMaterialDefinition({
      id: 'material-ceramic',
      name: 'ceramic',
      seed: 7,
      sdf: ceramicSdf,
    }),
    createMaterialDefinition({
      id: 'material-marble',
      name: 'marble',
      seed: 23,
      sdf: marbleSdf,
    }),
    createMaterialDefinition({
      id: 'material-terrazzo',
      name: 'terrazzo',
      seed: 5,
      sdf: terrazzoSdf,
    }),
    createMaterialDefinition({
      id: 'material-craquelure',
      name: 'craquelure',
      seed: 91,
      sdf: craquelureSdf,
    }),
    createMaterialDefinition({
      id: 'material-wood',
      name: 'wood',
      seed: 3,
      sdf: woodSdf,
    }),
    createMaterialDefinition({
      id: 'material-azulejo',
      name: 'azulejo',
      seed: 17,
      sdf: azulejoSdf,
    }),
    createMaterialDefinition({
      id: 'material-encaustic',
      name: 'encaustic',
      seed: 64,
      sdf: encausticSdf,
    }),
    createMaterialDefinition({
      id: 'material-concrete',
      name: 'weathered concrete',
      seed: 88,
      sdf: concreteSdf,
    }),
    createMaterialDefinition({
      id: 'material-contour',
      name: 'contour',
      seed: 12,
      sdf: contourSdf,
    }),
    createMaterialDefinition({
      id: 'material-cobblestone',
      name: 'cobblestone',
      seed: 55,
      sdf: cobblestoneSdf,
    }),
    createMaterialDefinition({
      id: 'material-transfer-print',
      name: 'transfer print',
      seed: 39,
      sdf: transferPrintSdf,
    }),
  ];
}

/** Pick or synthesize a material id for a legacy freeform material label. */
export function materialIdForLabel(
  label: string,
  materials: MaterialDefinitionJson[],
): string {
  const normalized = label.trim().toLowerCase();
  const found = materials.find((m) => m.name.toLowerCase() === normalized);
  if (found) return found.id;
  return materials[0]?.id ?? 'material-ceramic';
}
