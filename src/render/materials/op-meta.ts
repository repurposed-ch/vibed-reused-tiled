import type { SdfNodeJson, SdfOp } from '@/domain/material';

/**
 * Authoring metadata for every SDF op: what it does, what its parameters mean and
 * what range they want, and a worked example.
 *
 * This is the only place the op language is described in human terms — the zod schema
 * pins types and a few bounds, but says nothing about intent or usable ranges. The
 * `Record<SdfOp, OpMeta>` type makes `tsc` fail if an op is added without an entry.
 */

export type SdfCategory = 'field' | 'pattern' | 'shape' | 'transform' | 'shade' | 'combine';

export const CATEGORY_ORDER: readonly SdfCategory[] = [
  'field',
  'pattern',
  'shape',
  'transform',
  'shade',
  'combine',
];

export const CATEGORY_LABEL: Record<SdfCategory, string> = {
  field: 'Procedural fields',
  pattern: 'Lattice patterns',
  shape: 'Shapes & distance',
  transform: 'Transforms',
  shade: 'Shaping a field',
  combine: 'Combining',
};

export type ParamMeta =
  | {
      key: string;
      kind: 'number';
      label: string;
      min: number;
      max: number;
      step: number;
      fallback: number;
      hint?: string;
    }
  | { key: string; kind: 'int'; label: string; min: number; max: number; fallback: number; hint?: string }
  | { key: string; kind: 'enum'; label: string; options: readonly string[]; fallback: string; hint?: string }
  | { key: string; kind: 'bool'; label: string; fallback: boolean; hint?: string }
  | { key: string; kind: 'vec2'; label: string; step: number; fallback: [number, number]; hint?: string }
  /** `scale.factor` is `number | [number, number]` — uniform or per-axis. */
  | { key: string; kind: 'scaleFactor'; label: string; fallback: number; hint?: string }
  /** `rotate.angle` — constrained to lattice-safe quarter turns. */
  | { key: string; kind: 'quarterTurn'; label: string; fallback: number; hint?: string };

export type SdfSlot = 'child' | 'a' | 'b';

export type OpMeta = {
  label: string;
  category: SdfCategory;
  /** One line: what it does and what it is for. */
  summary: string;
  /**
   * Shade ops return 0..1. Distance ops return a signed distance in meters and are
   * normally wrapped in `fill` or `band` before being combined with a shade.
   */
  returns: 'shade' | 'distance';
  slots: readonly SdfSlot[];
  params: readonly ParamMeta[];
  /** A valid, representative node. Used by the gallery's Insert action. */
  example: () => SdfNodeJson;
  /**
   * Thumbnail override, for ops whose bare form shows nothing on its own.
   * Only `mirror` needs this — at the root `p` is non-negative, so `abs(p) == p`.
   */
  demo?: () => SdfNodeJson;
};

// Scales are chosen to land on whole cells for the usual 0.6 x 0.3 tile (multiples of
// 10 give 6 x 3), and high enough to avoid the degenerate 2x1-cell case that renders flat.
const noise = (scale = 10, octaves = 3): SdfNodeJson => ({ op: 'noise', scale, octaves });
const disc = (cx: number, cy: number, radius = 0.08): SdfNodeJson => ({
  op: 'circle',
  radius,
  center: [cx, cy],
});

export const OP_META: Record<SdfOp, OpMeta> = {
  // ---------------------------------------------------------------- fields
  noise: {
    label: 'noise',
    category: 'field',
    summary:
      'Tileable fractal value noise. The workhorse base for grain, mottling and variation. `ridged` and `turbulence` give erosion and cloud; `billow` gives soft lumps.',
    returns: 'shade',
    slots: [],
    params: [
      { key: 'scale', kind: 'number', label: 'Scale', min: 1, max: 64, step: 1, fallback: 10, hint: 'Cells across the tile. Below ~4 the field degenerates and renders flat.' },
      { key: 'octaves', kind: 'int', label: 'Octaves', min: 1, max: 8, fallback: 3, hint: 'Layers of detail, each twice as fine at half the amplitude.' },
      { key: 'variant', kind: 'enum', label: 'Variant', options: ['fbm', 'ridged', 'turbulence', 'billow'], fallback: 'fbm' },
    ],
    example: () => ({ op: 'noise', scale: 10, octaves: 4 }),
  },
  voronoi: {
    label: 'voronoi',
    category: 'field',
    summary: 'Cell-edge distance as a shade — bright seams between cells. Kept for compatibility; `cells` with metric `f2f1` is the same thing with more control.',
    returns: 'shade',
    slots: [],
    params: [
      { key: 'scale', kind: 'number', label: 'Scale', min: 1, max: 48, step: 1, fallback: 10 },
      { key: 'edgeWidth', kind: 'number', label: 'Edge width', min: 0.01, max: 0.5, step: 0.01, fallback: 0.08 },
    ],
    example: () => ({ op: 'voronoi', scale: 10, edgeWidth: 0.08 }),
  },
  cells: {
    label: 'cells',
    category: 'field',
    summary:
      'Worley cells. `id` gives each cell its own random value — the one thing that makes terrazzo chips, cobble setts and crackle plates possible. `f1` domes, `f2f1` outlines.',
    returns: 'shade',
    slots: [],
    params: [
      { key: 'scale', kind: 'number', label: 'Scale', min: 1, max: 48, step: 1, fallback: 10 },
      { key: 'metric', kind: 'enum', label: 'Metric', options: ['f1', 'f2f1', 'id'], fallback: 'f1', hint: 'f1 = distance to nearest point, f2f1 = cell borders, id = flat random per cell.' },
      { key: 'jitter', kind: 'number', label: 'Jitter', min: 0, max: 1, step: 0.05, fallback: 1, hint: '0 collapses to a regular grid. Above 1 points escape their cell, so it is capped.' },
      { key: 'distance', kind: 'enum', label: 'Distance', options: ['euclidean', 'manhattan', 'chebyshev'], fallback: 'euclidean', hint: 'manhattan and chebyshev give angular, chipped cells.' },
    ],
    example: () => ({ op: 'cells', scale: 10, metric: 'id' }),
  },

  // ---------------------------------------------------------------- lattice patterns
  brick: {
    label: 'brick',
    category: 'pattern',
    summary: 'Running bond: flat faces separated by mortar joints, alternate rows offset. Widths snap so both columns and row pairs divide the tile.',
    returns: 'shade',
    slots: [],
    params: [
      { key: 'brickW', kind: 'number', label: 'Brick width (m)', min: 0.01, max: 0.5, step: 0.005, fallback: 0.15 },
      { key: 'brickH', kind: 'number', label: 'Brick height (m)', min: 0.01, max: 0.5, step: 0.005, fallback: 0.075 },
      { key: 'mortar', kind: 'number', label: 'Mortar (m)', min: 0, max: 0.05, step: 0.001, fallback: 0.008 },
      { key: 'offset', kind: 'number', label: 'Row offset', min: 0, max: 1, step: 0.05, fallback: 0.5 },
    ],
    example: () => ({ op: 'brick', brickW: 0.15, brickH: 0.075, mortar: 0.008, offset: 0.5 }),
  },
  truchet: {
    label: 'truchet',
    category: 'pattern',
    summary: 'Randomly flipped quarter-arc tiles. Strokes meet at every cell edge midpoint, so the curves always join — including across the tile wrap. Classic azulejo maze.',
    returns: 'shade',
    slots: [],
    params: [
      { key: 'scale', kind: 'number', label: 'Scale', min: 1, max: 32, step: 1, fallback: 10 },
      { key: 'thickness', kind: 'number', label: 'Thickness', min: 0.02, max: 0.5, step: 0.01, fallback: 0.26, hint: 'In cell units, not meters. Above 0.5 the strokes merge.' },
      { key: 'variant', kind: 'enum', label: 'Variant', options: ['arcs', 'diagonals'], fallback: 'arcs' },
      { key: 'soft', kind: 'number', label: 'Edge softness', min: 0.002, max: 0.2, step: 0.002, fallback: 0.012 },
    ],
    example: () => ({ op: 'truchet', scale: 10, thickness: 0.26, variant: 'arcs', soft: 0.012 }),
  },
  stripe: {
    label: 'stripe',
    category: 'pattern',
    summary: 'Axis-aligned bands. Spacing snaps to a whole number of bands across the tile. Warp it for wood grain.',
    returns: 'shade',
    slots: [],
    params: [
      { key: 'axis', kind: 'enum', label: 'Axis', options: ['x', 'y'], fallback: 'x' },
      { key: 'spacing', kind: 'number', label: 'Spacing (m)', min: 0.005, max: 0.5, step: 0.005, fallback: 0.06 },
      { key: 'duty', kind: 'number', label: 'Duty', min: 0, max: 1, step: 0.05, fallback: 0.5, hint: 'Fraction of each period that is "on".' },
      { key: 'soft', kind: 'number', label: 'Edge softness', min: 0.002, max: 0.5, step: 0.002, fallback: 0.02 },
    ],
    example: () => ({ op: 'stripe', axis: 'x', spacing: 0.06, duty: 0.5, soft: 0.02 }),
  },
  checker: {
    label: 'checker',
    category: 'pattern',
    summary: 'Hard two-tone checkerboard. The cell count snaps to an even number — an odd one would flip colour at every tile wrap.',
    returns: 'shade',
    slots: [],
    params: [{ key: 'scale', kind: 'number', label: 'Scale', min: 1, max: 32, step: 1, fallback: 10 }],
    example: () => ({ op: 'checker', scale: 10 }),
  },
  halftone: {
    label: 'halftone',
    category: 'pattern',
    summary: 'Dot screen driven by a child field — dot area tracks the field value. Transfer-print and Delft looks. The angle snaps to one the dot lattice can actually close on.',
    returns: 'shade',
    slots: ['child'],
    params: [
      { key: 'scale', kind: 'number', label: 'Screen scale', min: 4, max: 64, step: 1, fallback: 26 },
      { key: 'angle', kind: 'number', label: 'Angle (rad)', min: 0, max: Math.PI / 2, step: 0.01, fallback: Math.PI / 4, hint: 'Snapped to the nearest Gaussian-integer rotation; a free angle would seam.' },
      { key: 'soft', kind: 'number', label: 'Dot softness', min: 0.002, max: 0.2, step: 0.002, fallback: 0.015 },
    ],
    example: () => ({ op: 'halftone', scale: 26, angle: Math.PI / 4, soft: 0.015, child: noise(10, 3) }),
  },

  // ---------------------------------------------------------------- shapes (distance)
  circle: {
    label: 'circle',
    category: 'shape',
    summary: 'Signed distance to a circle. Wrap in `fill` for a disc or `band` for a ring outline. Not periodic on its own — keep it away from the tile edge.',
    returns: 'distance',
    slots: [],
    params: [
      { key: 'radius', kind: 'number', label: 'Radius (m)', min: 0.005, max: 0.4, step: 0.005, fallback: 0.08 },
      { key: 'center', kind: 'vec2', label: 'Center (m)', step: 0.01, fallback: [0.3, 0.15] },
    ],
    example: () => disc(0.3, 0.15),
  },
  box: {
    label: 'box',
    category: 'shape',
    summary: 'Signed distance to an axis-aligned rectangle, given as half-extents.',
    returns: 'distance',
    slots: [],
    params: [
      { key: 'halfExtents', kind: 'vec2', label: 'Half extents (m)', step: 0.01, fallback: [0.12, 0.06] },
      { key: 'center', kind: 'vec2', label: 'Center (m)', step: 0.01, fallback: [0.3, 0.15] },
    ],
    example: () => ({ op: 'box', halfExtents: [0.12, 0.06], center: [0.3, 0.15] }),
  },
  ring: {
    label: 'ring',
    category: 'shape',
    summary: 'Signed distance to an annulus — a circle outline with real thickness.',
    returns: 'distance',
    slots: [],
    params: [
      { key: 'radius', kind: 'number', label: 'Radius (m)', min: 0.01, max: 0.4, step: 0.005, fallback: 0.1 },
      { key: 'thickness', kind: 'number', label: 'Thickness (m)', min: 0.002, max: 0.2, step: 0.002, fallback: 0.02 },
      { key: 'center', kind: 'vec2', label: 'Center (m)', step: 0.01, fallback: [0.3, 0.15] },
    ],
    example: () => ({ op: 'ring', radius: 0.1, thickness: 0.02, center: [0.3, 0.15] }),
  },
  line: {
    label: 'line',
    category: 'shape',
    summary: 'Signed distance to a thick line segment between two points.',
    returns: 'distance',
    slots: [],
    params: [
      { key: 'a', kind: 'vec2', label: 'From (m)', step: 0.01, fallback: [0.05, 0.05] },
      { key: 'b', kind: 'vec2', label: 'To (m)', step: 0.01, fallback: [0.55, 0.25] },
      { key: 'thickness', kind: 'number', label: 'Thickness (m)', min: 0.002, max: 0.2, step: 0.002, fallback: 0.02 },
    ],
    example: () => ({ op: 'line', a: [0.05, 0.05], b: [0.55, 0.25], thickness: 0.02 }),
  },
  scratches: {
    label: 'scratches',
    category: 'shape',
    summary:
      'Random directional streaks — wear, patina, brushed glaze. Returns distance, so wrap it in `fill` (usually inverted) and multiply into a base. Longer scratches need a LOWER scale.',
    returns: 'distance',
    slots: [],
    params: [
      { key: 'count', kind: 'int', label: 'Per cell', min: 1, max: 6, fallback: 3 },
      { key: 'length', kind: 'number', label: 'Length (m)', min: 0.005, max: 0.3, step: 0.005, fallback: 0.05, hint: 'Clamped to one cell, so raise it by lowering the scale.' },
      { key: 'width', kind: 'number', label: 'Width (m)', min: 0.0005, max: 0.02, step: 0.0005, fallback: 0.003 },
      { key: 'scale', kind: 'number', label: 'Scale', min: 1, max: 48, step: 1, fallback: 10 },
      { key: 'angle', kind: 'number', label: 'Mean angle (rad)', min: -Math.PI, max: Math.PI, step: 0.05, fallback: 0.4 },
      { key: 'spread', kind: 'number', label: 'Angle spread', min: 0, max: Math.PI * 2, step: 0.05, fallback: 1.2, hint: 'Small spread reads as directional wear; 2π is isotropic scribble.' },
    ],
    example: () => ({ op: 'scratches', count: 3, length: 0.05, width: 0.003, scale: 10, angle: 0.4, spread: 1.2 }),
  },

  // ---------------------------------------------------------------- transforms
  translate: {
    label: 'translate',
    category: 'transform',
    summary: 'Shift the child. Always seamless.',
    returns: 'shade',
    slots: ['child'],
    params: [{ key: 'offset', kind: 'vec2', label: 'Offset (m)', step: 0.01, fallback: [0.15, 0.05] }],
    example: () => ({ op: 'translate', offset: [0.15, 0.05], child: disc(0.15, 0.1) }),
  },
  rotate: {
    label: 'rotate',
    category: 'transform',
    summary:
      'Rotate the child. Only quarter turns keep a periodic field seamless — and 90°/270° need a square tile, since they swap axes whose periods differ.',
    returns: 'shade',
    slots: ['child'],
    params: [{ key: 'angle', kind: 'quarterTurn', label: 'Angle', fallback: 0 }],
    // The child's center is in the ROTATED frame: rotate maps p -> (p.y, -p.x) at 90°,
    // so [0.15, -0.3] lands on the tile centre and the "tall" box renders as a wide bar.
    // A non-periodic child is used deliberately — rotating a periodic one would seam.
    example: () => ({
      op: 'rotate',
      angle: Math.PI / 2,
      child: { op: 'box', halfExtents: [0.03, 0.12], center: [0.15, -0.3] },
    }),
  },
  scale: {
    label: 'scale',
    category: 'transform',
    summary: 'Scale the child. Only 1/integer factors stay seamless. Use a per-axis factor to stretch a field into anisotropic grain.',
    returns: 'shade',
    slots: ['child'],
    params: [{ key: 'factor', kind: 'scaleFactor', label: 'Factor', fallback: 0.5 }],
    example: () => ({ op: 'scale', factor: 0.5, child: noise(10, 3) }),
  },
  repeat: {
    label: 'repeat',
    category: 'transform',
    summary: 'Tile the child on its own grid. The period must divide the tile size on both axes or the phase mismatches at the wrap.',
    returns: 'shade',
    slots: ['child'],
    params: [{ key: 'period', kind: 'vec2', label: 'Period (m)', step: 0.005, fallback: [0.15, 0.15] }],
    example: () => ({ op: 'repeat', period: [0.15, 0.15], child: { op: 'circle', radius: 0.045 } }),
  },
  mirror: {
    label: 'mirror',
    category: 'transform',
    summary:
      'Fold the child across an axis. Does nothing at the root — p is non-negative there, so abs(p) == p. Only meaningful beneath a translate or repeat.',
    returns: 'shade',
    slots: ['child'],
    params: [{ key: 'axis', kind: 'enum', label: 'Axis', options: ['x', 'y', 'xy'], fallback: 'x' }],
    example: () => ({ op: 'mirror', axis: 'x', child: disc(0.06, 0.06, 0.05) }),
    // Shown under a repeat, which is the only place the fold does anything visible.
    demo: () => ({
      op: 'repeat',
      period: [0.15, 0.15],
      child: { op: 'mirror', axis: 'xy', child: { op: 'circle', radius: 0.035, center: [0.05, 0.05] } },
    }),
  },
  warp: {
    label: 'warp',
    category: 'transform',
    summary:
      'Push the child around with a noise field. The single biggest upgrade to any material — veining, wood grain, crackle, flow. Provably seamless for any amount.',
    returns: 'shade',
    slots: ['child'],
    params: [
      { key: 'scale', kind: 'number', label: 'Warp scale', min: 1, max: 32, step: 1, fallback: 5, hint: 'Low = broad undulation, high = fine jitter.' },
      { key: 'amount', kind: 'number', label: 'Amount (m)', min: 0, max: 0.5, step: 0.005, fallback: 0.06, hint: 'Above ~0.25x the child feature size, a band below it will visibly breathe.' },
      { key: 'octaves', kind: 'int', label: 'Octaves', min: 1, max: 8, fallback: 3 },
    ],
    example: () => ({
      op: 'warp',
      scale: 5,
      amount: 0.06,
      octaves: 3,
      child: { op: 'stripe', axis: 'y', spacing: 0.05, duty: 0.5, soft: 0.15 },
    }),
  },

  // ---------------------------------------------------------------- shaping
  band: {
    label: 'band',
    category: 'shade',
    summary: 'Bright band at a fixed distance either side of the child surface. Turns a distance into an outline.',
    returns: 'shade',
    slots: ['child'],
    params: [
      { key: 'width', kind: 'number', label: 'Width (m)', min: 0.001, max: 0.2, step: 0.001, fallback: 0.02 },
      { key: 'soft', kind: 'number', label: 'Softness (m)', min: 0.001, max: 0.1, step: 0.001, fallback: 0.005 },
    ],
    example: () => ({ op: 'band', width: 0.02, soft: 0.005, child: disc(0.3, 0.15, 0.1) }),
  },
  fill: {
    label: 'fill',
    category: 'shade',
    summary: 'Solid inside the child surface. The usual way to turn a distance node into something you can multiply or mix.',
    returns: 'shade',
    slots: ['child'],
    params: [
      { key: 'soft', kind: 'number', label: 'Edge softness (m)', min: 0.0005, max: 0.1, step: 0.0005, fallback: 0.005 },
      { key: 'invert', kind: 'bool', label: 'Invert', fallback: false },
    ],
    example: () => ({ op: 'fill', soft: 0.005, child: disc(0.3, 0.15, 0.1) }),
  },
  curve: {
    label: 'curve',
    category: 'shade',
    summary: 'Gamma curve. Below 1 brightens and lifts midtones, above 1 darkens and deepens contrast in the highlights.',
    returns: 'shade',
    slots: ['child'],
    params: [{ key: 'gamma', kind: 'number', label: 'Gamma', min: 0.1, max: 4, step: 0.05, fallback: 2.2 }],
    example: () => ({ op: 'curve', gamma: 2.2, child: noise(10, 4) }),
  },
  posterize: {
    label: 'posterize',
    category: 'shade',
    summary: 'Flatten into discrete steps. Contour bands from noise, flat colour steps for encaustic tile.',
    returns: 'shade',
    slots: ['child'],
    params: [{ key: 'steps', kind: 'int', label: 'Steps', min: 2, max: 64, fallback: 5 }],
    example: () => ({ op: 'posterize', steps: 5, child: noise(10, 4) }),
  },
  threshold: {
    label: 'threshold',
    category: 'shade',
    summary: 'Hard cut at a level, with a soft edge. Turns a field into a mask — cracks, veins, pitting.',
    returns: 'shade',
    slots: ['child'],
    params: [
      { key: 'level', kind: 'number', label: 'Level', min: 0, max: 1, step: 0.01, fallback: 0.5, hint: 'Must sit inside the child range or the result is constant.' },
      { key: 'soft', kind: 'number', label: 'Softness', min: 0.001, max: 0.5, step: 0.001, fallback: 0.02 },
    ],
    example: () => ({ op: 'threshold', level: 0.5, soft: 0.02, child: noise(10, 4) }),
  },
  remap: {
    label: 'remap',
    category: 'shade',
    summary:
      'Stretch an input range onto an output range. Use it when a field only spans part of 0..1 — the usual fix for a preset that renders flat.',
    returns: 'shade',
    slots: ['child'],
    params: [
      { key: 'inMin', kind: 'number', label: 'In min', min: 0, max: 1, step: 0.01, fallback: 0.2 },
      { key: 'inMax', kind: 'number', label: 'In max', min: 0, max: 1, step: 0.01, fallback: 0.8 },
      { key: 'outMin', kind: 'number', label: 'Out min', min: 0, max: 1, step: 0.01, fallback: 0 },
      { key: 'outMax', kind: 'number', label: 'Out max', min: 0, max: 1, step: 0.01, fallback: 1 },
    ],
    example: () => ({ op: 'remap', inMin: 0.2, inMax: 0.8, outMin: 0, outMax: 1, child: noise(10, 4) }),
  },
  invert: {
    label: 'invert',
    category: 'shade',
    summary: 'One minus the child.',
    returns: 'shade',
    slots: ['child'],
    params: [],
    example: () => ({ op: 'invert', child: noise(10, 4) }),
  },

  // ---------------------------------------------------------------- combining
  mix: {
    label: 'mix',
    category: 'combine',
    summary: 'Linear blend between two fields. The most common way to lay detail over a base.',
    returns: 'shade',
    slots: ['a', 'b'],
    params: [{ key: 't', kind: 'number', label: 'Blend', min: 0, max: 1, step: 0.01, fallback: 0.5, hint: '0 is all A, 1 is all B.' }],
    example: () => ({ op: 'mix', t: 0.5, a: noise(10, 4), b: { op: 'voronoi', scale: 10, edgeWidth: 0.08 } }),
  },
  mul: {
    label: 'mul',
    category: 'combine',
    summary: 'Multiply. Darkens — the standard way to punch a mask (grout, wear) into a base.',
    returns: 'shade',
    slots: ['a', 'b'],
    params: [],
    example: () => ({ op: 'mul', a: noise(10, 3), b: { op: 'voronoi', scale: 10, edgeWidth: 0.1 } }),
  },
  add: {
    label: 'add',
    category: 'combine',
    summary: 'Sum. Remap the inputs first — a sum above 1 is reinterpreted as a distance and hard-thresholded to black.',
    returns: 'shade',
    slots: ['a', 'b'],
    params: [],
    example: () => ({
      op: 'add',
      a: { op: 'remap', inMin: 0, inMax: 1, outMin: 0, outMax: 0.5, child: noise(10, 3) },
      b: { op: 'remap', inMin: 0, inMax: 1, outMin: 0, outMax: 0.5, child: noise(30, 2) },
    }),
  },
  overlay: {
    label: 'overlay',
    category: 'combine',
    summary: 'Photoshop overlay: multiplies the darks, screens the lights. Keeps contrast where mix would wash it out.',
    returns: 'shade',
    slots: ['a', 'b'],
    params: [],
    example: () => ({ op: 'overlay', a: noise(10, 4), b: { op: 'checker', scale: 10 } }),
  },
  screen: {
    label: 'screen',
    category: 'combine',
    summary: 'Inverse multiply. Lightens — good for adding highlights without clipping.',
    returns: 'shade',
    slots: ['a', 'b'],
    params: [],
    example: () => ({ op: 'screen', a: noise(10, 3), b: { op: 'voronoi', scale: 10, edgeWidth: 0.08 } }),
  },
  union: {
    label: 'union',
    category: 'combine',
    summary: 'Distance union — nearest of the two surfaces. For shapes, not shades.',
    returns: 'distance',
    slots: ['a', 'b'],
    params: [],
    example: () => ({ op: 'union', a: disc(0.22, 0.15), b: disc(0.38, 0.15) }),
  },
  subtract: {
    label: 'subtract',
    category: 'combine',
    summary: 'Distance subtraction — A with B cut out of it.',
    returns: 'distance',
    slots: ['a', 'b'],
    params: [],
    example: () => ({ op: 'subtract', a: disc(0.3, 0.15, 0.12), b: disc(0.38, 0.15) }),
  },
  intersect: {
    label: 'intersect',
    category: 'combine',
    summary: 'Distance intersection — only where both overlap. A lens from two circles.',
    returns: 'distance',
    slots: ['a', 'b'],
    params: [],
    example: () => ({ op: 'intersect', a: disc(0.24, 0.15, 0.12), b: disc(0.36, 0.15, 0.12) }),
  },
  smoothUnion: {
    label: 'smoothUnion',
    category: 'combine',
    summary: 'Union with a soft fillet where the surfaces meet. `k` is the blend radius in meters.',
    returns: 'distance',
    slots: ['a', 'b'],
    params: [{ key: 'k', kind: 'number', label: 'Blend k (m)', min: 0.002, max: 0.2, step: 0.002, fallback: 0.05 }],
    example: () => ({ op: 'smoothUnion', k: 0.05, a: disc(0.22, 0.15), b: disc(0.38, 0.15) }),
  },
};

/** Ops in a category, in registry order. */
export function opsInCategory(category: SdfCategory): SdfOp[] {
  return (Object.keys(OP_META) as SdfOp[]).filter((op) => OP_META[op].category === category);
}

/** The node a gallery tile should render — `demo` when the bare op would show nothing. */
export function thumbnailNode(op: SdfOp): SdfNodeJson {
  const meta = OP_META[op];
  return (meta.demo ?? meta.example)();
}
