import { GROUT_MATERIAL_ID } from './joint';
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

/**
 * A field squashed `k`× along y, so its features read as horizontal streaks — bedding planes,
 * laminations, trowel drag.
 *
 * The remap is not decoration: `scale` also multiplies the value it returns by min(factor), which
 * is right for a signed distance and wrong for a 0..1 shade. Without the remap a 1/6 squash comes
 * back at 1/6 the contrast, which is what makes a stretched field look washed out. `k` must be an
 * integer: only a 1/integer factor keeps the field periodic on the tile.
 */
function streaked(k: number, child: SdfNodeJson): SdfNodeJson {
  return { op: 'remap', inMin: 0, inMax: 1 / k, outMin: 0, outMax: 1, child: { op: 'scale', factor: [1, 1 / k], child } };
}

/**
 * Speckled granite: two tones of feldspar matrix with dark biotite flecks punched out of it.
 * Crystals are ~6 mm (scale 170) and the flecks ~8 mm (scale 120) — the size real granite runs
 * at, and the reason the three layers use different scales rather than one shared lattice.
 */
const graniteSdf: SdfNodeJson = {
  op: 'mul',
  a: {
    op: 'mix',
    t: 0.3,
    a: { op: 'remap', inMin: 0.1, inMax: 0.9, outMin: 0.62, outMax: 1, child: { op: 'cells', scale: 170, metric: 'id' } },
    b: { op: 'remap', inMin: 0.1, inMax: 0.9, outMin: 0.7, outMax: 1, child: { op: 'cells', scale: 60, metric: 'id' } },
  },
  b: {
    op: 'invert',
    child: { op: 'threshold', level: 0.86, soft: 0.04, child: { op: 'cells', scale: 120, metric: 'id' } },
  },
};

/**
 * Travertine: bedding planes as horizontal banding, with elongated voids drifting along them.
 * `screen` against a broad streaked field is what clusters the pores — one pore per lattice cell,
 * evenly spread, reads as a printed dash pattern rather than stone.
 */
const travertineSdf: SdfNodeJson = {
  op: 'mul',
  a: {
    op: 'remap',
    inMin: 0.25,
    inMax: 0.95,
    outMin: 0.62,
    outMax: 1,
    child: {
      op: 'mix',
      t: 0.35,
      a: streaked(6, { op: 'noise', scale: 12, octaves: 3 }),
      b: streaked(3, { op: 'noise', scale: 22, octaves: 2 }),
    },
  },
  b: {
    op: 'remap',
    inMin: 0,
    inMax: 1,
    outMin: 0.45,
    outMax: 1,
    child: {
      op: 'screen',
      a: { op: 'threshold', level: 0.3, soft: 0.05, child: streaked(3, { op: 'cells', scale: 34, metric: 'f1', jitter: 1 }) },
      b: { op: 'remap', inMin: 0.35, inMax: 0.8, outMin: 0, outMax: 1, child: streaked(6, { op: 'noise', scale: 9, octaves: 2 }) },
    },
  },
};

/** Riven slate: fine laminations along the cleavage, over broad stepped plates. */
const slateSdf: SdfNodeJson = {
  op: 'mul',
  a: { op: 'remap', inMin: 0.2, inMax: 0.8, outMin: 0.42, outMax: 1, child: streaked(8, { op: 'noise', scale: 55, octaves: 4 }) },
  b: {
    op: 'remap',
    inMin: 0.15,
    inMax: 0.85,
    outMin: 0.5,
    outMax: 1,
    child: {
      op: 'posterize',
      steps: 4,
      child: { op: 'warp', scale: 3, amount: 0.08, octaves: 2, child: streaked(2, { op: 'noise', scale: 7, octaves: 3 }) },
    },
  },
};

/**
 * Lava stone: vesicles at two sizes, ~17 mm and ~8 mm. One lattice alone gives a dot screen —
 * every pit the same size, one per cell — which no volcanic rock looks like.
 */
const basaltSdf: SdfNodeJson = {
  op: 'mul',
  a: { op: 'remap', inMin: 0.1, inMax: 0.9, outMin: 0.62, outMax: 1, child: { op: 'noise', scale: 14, octaves: 4 } },
  b: {
    op: 'remap',
    inMin: 0,
    inMax: 1,
    outMin: 0.32,
    outMax: 1,
    child: {
      op: 'mul',
      a: { op: 'threshold', level: 0.24, soft: 0.07, child: { op: 'cells', scale: 60, metric: 'f1', jitter: 1 } },
      b: { op: 'threshold', level: 0.2, soft: 0.06, child: { op: 'cells', scale: 130, metric: 'f1', jitter: 1 } },
    },
  },
};

/** Zellige: pooled, uneven glaze over a fine 9 mm crazing (scale 110), the size real crackle runs at. */
const zelligeSdf: SdfNodeJson = {
  op: 'mul',
  a: {
    op: 'remap',
    inMin: 0.15,
    inMax: 0.9,
    outMin: 0.5,
    outMax: 1,
    child: { op: 'warp', scale: 3, amount: 0.12, octaves: 2, child: { op: 'noise', scale: 7, octaves: 3 } },
  },
  b: {
    op: 'remap',
    inMin: 0,
    inMax: 1,
    outMin: 0.62,
    outMax: 1,
    child: {
      op: 'threshold',
      level: 0.07,
      soft: 0.02,
      child: { op: 'warp', scale: 6, amount: 0.012, octaves: 2, child: { op: 'cells', scale: 110, metric: 'f2f1', jitter: 1 } },
    },
  },
};

/**
 * Penny round mosaic on a sheet: 21.6 mm discs on a 25 mm lattice, so the joint is ~3 mm.
 * The period has to divide the tile or the sheet seams; 0.025 m does for every usual format.
 */
const pennyMosaicSdf: SdfNodeJson = {
  op: 'mix',
  t: 0.1,
  a: {
    op: 'remap',
    inMin: 0,
    inMax: 1,
    outMin: 0.32,
    outMax: 1,
    child: {
      op: 'fill',
      soft: 0.0012,
      child: { op: 'repeat', period: [0.025, 0.025], child: { op: 'circle', radius: 0.0108, center: [0, 0] } },
    },
  },
  b: { op: 'noise', scale: 50, octaves: 2 },
};

/**
 * Fluted panel: 30 mm half-round ribs. The albedo is deliberately near-flat (0.72..1) — a rib
 * is a shape, not a stripe of paint, so the relief and its normal map do the work.
 */
const flutedSdf: SdfNodeJson = {
  op: 'mix',
  t: 0.15,
  a: {
    op: 'remap',
    inMin: 0,
    inMax: 1,
    outMin: 0.72,
    outMax: 1,
    child: { op: 'stripe', axis: 'x', spacing: 0.03, duty: 0.5, soft: 0.015 },
  },
  b: { op: 'noise', scale: 45, octaves: 2 },
};

/** Polished plaster: broad warped clouding with the drag of the trowel across it. */
const polishedPlasterSdf: SdfNodeJson = {
  op: 'mix',
  t: 0.3,
  a: {
    op: 'remap',
    inMin: 0.25,
    inMax: 0.8,
    outMin: 0.5,
    outMax: 1,
    child: { op: 'warp', scale: 2, amount: 0.2, octaves: 2, child: { op: 'noise', scale: 5, octaves: 3 } },
  },
  b: { op: 'remap', inMin: 0.25, inMax: 0.75, outMin: 0.55, outMax: 1, child: streaked(4, { op: 'noise', scale: 26, octaves: 3 }) },
};

/**
 * Imported from a hand-tuned project: a hard threshold over warped fbm mixed with thresholded
 * cells, which breaks into broad spalled blotches rather than the fine grain of fired clay.
 *
 * The author's graph wrapped this in `mirror` on x. That is a no-op at the root — p is
 * non-negative there, so abs(p) == p — and it is dropped here: baking both ways gives
 * pixel-identical output on square and rectangular tiles, and the mirror only raised a
 * seamlessness warning.
 */
const wornTerracottaSdf: SdfNodeJson = {
  op: 'threshold',
  level: 0.24,
  soft: 0.463,
  child: {
    op: 'mix',
    t: 0.45,
    a: {
      op: 'warp',
      scale: 4,
      amount: 0.05,
      octaves: 3,
      child: { op: 'noise', scale: 12, octaves: 4, variant: 'fbm' },
    },
    b: {
      op: 'threshold',
      level: 0.6,
      soft: 0.1,
      child: { op: 'cells', scale: 50, metric: 'f1', jitter: 0.9, distance: 'euclidean' },
    },
  },
};

/**
 * Imported: bold continuous veining — thresholded ridged noise under a heavy warp — over a
 * soft fbm ground. Far more graphic than `marble`, which is why it carries a marble type name
 * of its own rather than replacing it.
 */
const arabescatoSdf: SdfNodeJson = {
  op: 'mix',
  t: 0.56,
  a: { op: 'noise', scale: 19, octaves: 4, variant: 'fbm' },
  b: {
    op: 'threshold',
    level: 0.5,
    soft: 0.05,
    child: {
      op: 'warp',
      scale: 3,
      amount: 0.15,
      octaves: 3,
      child: { op: 'noise', scale: 15, octaves: 3, variant: 'ridged' },
    },
  },
};

/**
 * Imported: turbulent mottling crossed by a fine voronoi crack network — the look of a flamed
 * granite surface rather than the crystal speckle of `granite`.
 */
const flamedGraniteSdf: SdfNodeJson = {
  op: 'mix',
  t: 0.35,
  a: { op: 'noise', scale: 25, octaves: 5, variant: 'turbulence' },
  b: { op: 'voronoi', scale: 18, edgeWidth: 0.05 },
};

/**
 * Grout: fine, even sand. Scales are chosen for the 0.5 m period the joint bakes at — noise
 * at 160/m gives 80 cells across a bake (about 13 px each at 1024²) — and both land on whole
 * cells for the usual 0.6 × 0.3 tile too, so it is seamless there as well.
 */
const groutSdf: SdfNodeJson = {
  op: 'remap',
  inMin: 0,
  inMax: 1,
  outMin: 0.3,
  outMax: 0.8,
  child: {
    op: 'mix',
    t: 0.4,
    a: { op: 'noise', scale: 160, octaves: 2 },
    b: { op: 'cells', scale: 100, metric: 'f1', jitter: 1 },
  },
};

/** The joint's default material. Also appended to older projects that gain a joint. */
export function groutMaterial(): MaterialDefinitionJson {
  return createMaterialDefinition({
    id: GROUT_MATERIAL_ID,
    name: 'grout',
    seed: 19,
    sdf: groutSdf,
    // matte and nearly flat: the joint's recess, not its texture, makes it read
    relief: 0.0003,
    roughness: [0.95, 0.85],
  });
}

export function defaultMaterials(): MaterialDefinitionJson[] {
  return [
    createMaterialDefinition({
      id: 'material-terracotta',
      name: 'terracotta',
      seed: 11,
      sdf: terracottaSdf,
      // unglazed fired clay: matte, soft low-frequency lumps
      relief: 0.004,
      roughness: [0.95, 0.8],
    }),
    createMaterialDefinition({
      id: 'material-stone',
      name: 'stone',
      seed: 42,
      sdf: stoneSdf,
      // negative: the bright voronoi seams sink into joints
      relief: -0.002,
      roughness: [0.9, 0.75],
    }),
    createMaterialDefinition({
      id: 'material-ceramic',
      name: 'ceramic',
      seed: 7,
      sdf: ceramicSdf,
      // semi-gloss glaze over soft undulation
      relief: 0.004,
      roughness: [0.55, 0.4],
    }),
    createMaterialDefinition({
      id: 'material-marble',
      name: 'marble',
      seed: 23,
      sdf: marbleSdf,
      // polished: nearly flat and glossy, so specular carries it
      relief: 0.0005,
      roughness: [0.2, 0.3],
    }),
    createMaterialDefinition({
      id: 'material-terrazzo',
      name: 'terrazzo',
      seed: 5,
      sdf: terrazzoSdf,
      // ground and polished flat
      relief: 0.0006,
      roughness: [0.35, 0.2],
    }),
    createMaterialDefinition({
      id: 'material-craquelure',
      name: 'craquelure',
      seed: 91,
      sdf: craquelureSdf,
      // glossy glaze; the dark cracks sit low and rough
      relief: 0.0008,
      roughness: [0.6, 0.1],
    }),
    createMaterialDefinition({
      id: 'material-wood',
      name: 'wood',
      seed: 3,
      sdf: woodSdf,
      // open grain
      relief: 0.003,
      roughness: [0.8, 0.6],
    }),
    createMaterialDefinition({
      id: 'material-azulejo',
      name: 'azulejo',
      seed: 17,
      sdf: azulejoSdf,
      // glazed tile with slightly raised line work
      relief: 0.0008,
      roughness: [0.35, 0.2],
    }),
    createMaterialDefinition({
      id: 'material-encaustic',
      name: 'encaustic',
      seed: 64,
      sdf: encausticSdf,
      // cement tile: flat and matte
      relief: 0.0006,
      roughness: [0.85, 0.7],
    }),
    createMaterialDefinition({
      id: 'material-concrete',
      name: 'weathered concrete',
      seed: 88,
      sdf: concreteSdf,
      // pitted and scratched; dark wear sits low
      relief: 0.003,
      roughness: [0.95, 0.8],
    }),
    createMaterialDefinition({
      id: 'material-contour',
      name: 'contour',
      seed: 12,
      sdf: contourSdf,
      // terraced steps
      relief: 0.004,
      roughness: [0.8, 0.6],
    }),
    createMaterialDefinition({
      id: 'material-cobblestone',
      name: 'cobblestone',
      seed: 55,
      sdf: cobblestoneSdf,
      // domed setts, recessed joints
      relief: 0.005,
      roughness: [0.95, 0.7],
    }),
    createMaterialDefinition({
      id: 'material-transfer-print',
      name: 'transfer print',
      seed: 39,
      sdf: transferPrintSdf,
      // a print has no relief; the glaze does the work
      relief: 0.0003,
      roughness: [0.3, 0.2],
    }),
    createMaterialDefinition({
      id: 'material-granite',
      name: 'granite',
      seed: 71,
      sdf: graniteSdf,
      // honed slab: crystals are colour, not bumps
      relief: 0.0006,
      roughness: [0.5, 0.3],
    }),
    createMaterialDefinition({
      id: 'material-travertine',
      name: 'travertine',
      seed: 29,
      sdf: travertineSdf,
      // the voids are real holes, so they sink and stay rough
      relief: 0.0025,
      roughness: [0.9, 0.55],
    }),
    createMaterialDefinition({
      id: 'material-slate',
      name: 'slate',
      seed: 47,
      sdf: slateSdf,
      // riven face: the laminations are the relief
      relief: 0.0035,
      roughness: [0.9, 0.75],
    }),
    createMaterialDefinition({
      id: 'material-basalt',
      name: 'lava stone',
      seed: 83,
      sdf: basaltSdf,
      // vesicles sink; matte throughout
      relief: 0.003,
      roughness: [0.95, 0.8],
    }),
    createMaterialDefinition({
      id: 'material-zellige',
      name: 'zellige',
      seed: 37,
      sdf: zelligeSdf,
      // thick glossy glaze with a slight pooling undulation
      relief: 0.0012,
      roughness: [0.3, 0.1],
    }),
    createMaterialDefinition({
      id: 'material-penny-mosaic',
      name: 'penny mosaic',
      seed: 61,
      sdf: pennyMosaicSdf,
      // discs stand proud of their joints, and are the glossy part
      relief: 0.0025,
      roughness: [0.85, 0.25],
    }),
    createMaterialDefinition({
      id: 'material-fluted',
      name: 'fluted',
      seed: 13,
      sdf: flutedSdf,
      // deepest of the set: the ribs only exist in the normal map
      relief: 0.005,
      roughness: [0.6, 0.45],
    }),
    createMaterialDefinition({
      id: 'material-polished-plaster',
      name: 'polished plaster',
      seed: 97,
      sdf: polishedPlasterSdf,
      // burnished: nearly flat, low roughness
      relief: 0.0008,
      roughness: [0.45, 0.25],
    }),
    // Imported from a hand-tuned project; surface values are the author's own.
    createMaterialDefinition({
      id: 'material-worn-terracotta',
      name: 'worn terracotta',
      seed: 42,
      sdf: wornTerracottaSdf,
      relief: 0.00375,
      roughness: [0.07, 0.07],
    }),
    createMaterialDefinition({
      id: 'material-arabescato',
      name: 'arabescato',
      seed: 42,
      sdf: arabescatoSdf,
      // negative: the bright veins sink
      relief: -0.00115,
      roughness: [0.37, 0.77],
    }),
    createMaterialDefinition({
      id: 'material-flamed-granite',
      name: 'flamed granite',
      seed: 108,
      sdf: flamedGraniteSdf,
      relief: 0.0015,
      roughness: [0.9, 0.5],
    }),
    // Last, so materials[0] — the fallback when a material is deleted — is unchanged.
    groutMaterial(),
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
