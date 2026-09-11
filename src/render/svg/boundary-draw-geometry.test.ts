import { describe, expect, it } from 'vitest';
import {
  drawWindow,
  gridLines,
  boundariesFromLoops,
  cyclePick,
  isClosable,
  loopsBounds,
  loopsFromBoundaries,
  loopToPolygonJson,
  nearestVertex,
  orientationOf,
  orientLoop,
  pickLoopsAt,
  polygonJsonToLoop,
  reverseLoop,
  signedArea,
  snapToGrid,
  fitView,
  lineSpacingFor,
  MAX_METRES_PER_PIXEL,
  MIN_METRES_PER_PIXEL,
  panView,
  viewBounds,
  worldAtPixel,
  zoomViewAt,
  type Loop,
  type View,
} from '@/render/svg/boundary-draw-geometry';

const lShape: Loop = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 1.5 },
  { x: 2, y: 1.5 },
  { x: 2, y: 3 },
  { x: 0, y: 3 },
];

describe('snapToGrid', () => {
  it('snaps to the nearest intersection', () => {
    expect(snapToGrid({ x: 0.62, y: 1.11 }, 0.25)).toEqual({ x: 0.5, y: 1 });
    expect(snapToGrid({ x: 0.63, y: 1.11 }, 0.25)).toEqual({ x: 0.75, y: 1 });
    // Rounding toward the origin must give 0, not -0: a -0 vertex would not
    // compare equal to one clicked at the same intersection from the other side.
    expect(snapToGrid({ x: -0.12, y: -0.4 }, 0.25)).toEqual({ x: 0, y: -0.5 });
  });

  it('leaves the point alone when the resolution is degenerate', () => {
    expect(snapToGrid({ x: 1.234, y: 5.678 }, 0)).toEqual({ x: 1.234, y: 5.678 });
  });

  it('lands exactly on the grid rather than near it', () => {
    // Floating point makes 0.1 steps drift; the result still has to compare
    // equal to a vertex placed by an earlier click at the same intersection.
    const a = snapToGrid({ x: 0.30000000000000004, y: 0.7 }, 0.1);
    const b = snapToGrid({ x: 0.2999, y: 0.7001 }, 0.1);
    expect(a.x).toBeCloseTo(b.x, 12);
    expect(a.y).toBeCloseTo(b.y, 12);
  });
});

describe('loopsBounds', () => {
  it('spans every loop', () => {
    expect(loopsBounds([lShape])).toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 3 });
    expect(
      loopsBounds([lShape, [{ x: -1, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 6 }]]),
    ).toEqual({ minX: -1, minY: 0, maxX: 4, maxY: 6 });
  });

  it('is null with nothing drawn', () => {
    expect(loopsBounds([])).toBeNull();
    expect(loopsBounds([[]])).toBeNull();
  });
});

describe('drawWindow', () => {
  it('leaves room around the drawing to extend into', () => {
    const w = drawWindow(loopsBounds([lShape]), 0.25);
    expect(w.minX).toBeLessThan(0);
    expect(w.maxX).toBeGreaterThan(4);
    expect(w.maxY).toBeGreaterThan(3);
  });

  it('always keeps the origin in view', () => {
    const w = drawWindow({ minX: 10, minY: 10, maxX: 12, maxY: 12 }, 0.5);
    expect(w.minX).toBeLessThanOrEqual(0);
    expect(w.minY).toBeLessThanOrEqual(0);
  });

  it('falls back to a usable area when nothing is drawn yet', () => {
    const w = drawWindow(null, 0.25);
    expect(w.maxX - w.minX).toBeGreaterThan(1);
    expect(w.maxY - w.minY).toBeGreaterThan(1);
  });

  it('thins the drawn grid when the resolution would flood it', () => {
    // 0.01 m across ~20 m is 2000 lines per axis: a solid field, and thousands
    // of nodes. Snapping still uses the true resolution.
    const dense = drawWindow({ minX: 0, minY: 0, maxX: 20, maxY: 20 }, 0.01);
    expect(dense.resolution).toBeCloseTo(0.01, 9);
    expect(dense.lineSpacing).toBeGreaterThan(0.01);
    expect((dense.maxX - dense.minX) / dense.lineSpacing).toBeLessThanOrEqual(200);

    const coarse = drawWindow({ minX: 0, minY: 0, maxX: 8, maxY: 4 }, 0.5);
    expect(coarse.lineSpacing).toBeCloseTo(0.5, 9);
  });

  it('snaps the window out to whole steps', () => {
    const w = drawWindow({ minX: 0.13, minY: 0.13, maxX: 3.87, maxY: 3.87 }, 0.5);
    expect(w.minX / 0.5).toBeCloseTo(Math.round(w.minX / 0.5), 9);
    expect(w.maxX / 0.5).toBeCloseTo(Math.round(w.maxX / 0.5), 9);
  });
});

describe('gridLines', () => {
  it('covers the span inclusively', () => {
    expect(gridLines(0, 1, 0.25)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('handles a negative start', () => {
    expect(gridLines(-0.5, 0.5, 0.5)).toEqual([-0.5, 0, 0.5]);
  });

  it('is empty for a degenerate spacing', () => {
    expect(gridLines(0, 10, 0)).toEqual([]);
  });
});

describe('nearestVertex', () => {
  it('finds the vertex under the pointer', () => {
    expect(nearestVertex([lShape], { x: 3.95, y: 0.05 }, 0.2)).toEqual({ loop: 0, index: 1 });
  });

  it('returns null beyond the tolerance', () => {
    expect(nearestVertex([lShape], { x: 3, y: 3 }, 0.2)).toBeNull();
  });

  it('reports which loop the vertex belongs to', () => {
    const hole: Loop = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
    ];
    expect(nearestVertex([lShape, hole], { x: 2, y: 2 }, 0.2)).toEqual({ loop: 1, index: 2 });
  });
});

describe('isClosable', () => {
  it('needs three vertices, because a polygon does', () => {
    expect(isClosable([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe(false);
    expect(isClosable([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }])).toBe(true);
  });
});

describe('signedArea', () => {
  it('is positive counter-clockwise', () => {
    expect(signedArea(lShape)).toBeGreaterThan(0);
    expect(signedArea([...lShape].reverse())).toBeLessThan(0);
  });
});

describe('polygon json round trip', () => {
  it('converts a loop to Polygon2 json and back', () => {
    const json = loopToPolygonJson(lShape);
    expect(json).not.toBeNull();
    expect(json?.type).toBe('Polygon2');
    expect(polygonJsonToLoop(json)).toEqual(lShape);
  });

  it('refuses a loop that is not a polygon', () => {
    expect(loopToPolygonJson([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
  });

  it('reads an Aabb2 as its four corners', () => {
    expect(
      polygonJsonToLoop({ type: 'Aabb2', min: { x: 0, y: 0 }, max: { x: 2, y: 1 } }),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
    ]);
  });

  it('yields nothing for geometry the app cannot draw', () => {
    // The boundary schema is a passthrough over `{ type: string }`, so anything
    // can be stored. The draw tool has to notice rather than show a blank grid.
    expect(polygonJsonToLoop({ type: 'Circle2', centre: { x: 0, y: 0 }, radius: 1 })).toEqual([]);
    expect(polygonJsonToLoop({ type: 'Polygon2' })).toEqual([]);
    expect(polygonJsonToLoop(null)).toEqual([]);
  });
});

describe('orientation', () => {
  const square: Loop = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
  ];

  it('reverses into the opposite orientation and back', () => {
    expect(orientationOf(square)).toBe('ccw');
    expect(orientationOf(reverseLoop(square))).toBe('cw');
    expect(signedArea(reverseLoop(square))).toBeCloseTo(-signedArea(square), 9);
    expect(reverseLoop(reverseLoop(square))).toEqual(square);
  });

  it('orients a loop only when it is not already that way', () => {
    expect(orientLoop(square, 'ccw')).toBe(square);
    expect(orientationOf(orientLoop(square, 'cw'))).toBe('cw');
  });
});

describe('boundary lists', () => {
  const base = { type: 'BoundaryConditions', outers: [] as unknown[], holes: [] as unknown[], guides: [] };
  const solid: Loop = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }];
  const hole: Loop = reverseLoop([{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }]);

  it('files loops by orientation and reads them back in step', () => {
    const written = boundariesFromLoops([solid, hole], base);
    expect(written.outers).toHaveLength(1);
    expect(written.holes).toHaveLength(1);

    const read = loopsFromBoundaries(written);
    expect(read.map(orientationOf)).toEqual(['ccw', 'cw']);
    expect(read[0]).toEqual(solid);
    expect(read[1]).toEqual(hole);
  });

  it('reads a clockwise loop stored in outers as solid', () => {
    // Projects saved before orientation became the role: the list wins.
    const legacy = { ...base, outers: [loopToPolygonJson(reverseLoop(solid))] };
    expect(loopsFromBoundaries(legacy).map(orientationOf)).toEqual(['ccw']);
  });

  it('leaves out loops that are not polygons yet', () => {
    const written = boundariesFromLoops([solid, [{ x: 0, y: 0 }, { x: 1, y: 1 }]], base);
    expect(written.outers).toHaveLength(1);
    expect(written.holes).toHaveLength(0);
  });
});

describe('picking', () => {
  const big: Loop = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const small: Loop = [{ x: 4, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 6 }, { x: 4, y: 6 }];

  it('returns every containing loop, smallest first', () => {
    expect(pickLoopsAt([big, small], { x: 5, y: 5 })).toEqual([1, 0]);
    expect(pickLoopsAt([big, small], { x: 1, y: 1 })).toEqual([0]);
    expect(pickLoopsAt([big, small], { x: 20, y: 20 })).toEqual([]);
  });

  it('ignores a loop still being drawn', () => {
    expect(pickLoopsAt([[{ x: 0, y: 0 }, { x: 10, y: 10 }]], { x: 5, y: 5 })).toEqual([]);
  });

  it('cycles through candidates on repeated clicks', () => {
    expect(cyclePick([1, 0], null)).toBe(1);
    expect(cyclePick([1, 0], 1)).toBe(0);
    expect(cyclePick([1, 0], 0)).toBe(1); // wraps
    expect(cyclePick([1, 0], 7)).toBe(1); // restarts when current is not a candidate
    expect(cyclePick([], 1)).toBeNull();
  });
});

describe('view', () => {
  it('fits the drawing and the origin, at the canvas aspect ratio', () => {
    const view = fitView({ minX: 2, minY: 1, maxX: 10, maxY: 5 }, 800, 400, 0.25);
    const b = viewBounds(view, 800, 400);
    expect(b.minX).toBeLessThanOrEqual(0);
    expect(b.minY).toBeLessThanOrEqual(0);
    expect(b.maxX).toBeGreaterThanOrEqual(10);
    expect(b.maxY).toBeGreaterThanOrEqual(5);
    expect((b.maxX - b.minX) / (b.maxY - b.minY)).toBeCloseTo(2, 9);
  });

  it('fits an empty drawing around the origin', () => {
    const b = viewBounds(fitView(null, 600, 300, 0.1), 600, 300);
    expect(b.minX).toBeLessThanOrEqual(0);
    expect(b.maxX).toBeGreaterThan(0);
  });

  it('maps pixels to world with +Y up', () => {
    const view: View = { centerX: 1, centerY: 2, metresPerPixel: 0.01 };
    expect(worldAtPixel(view, 800, 400, 400, 200)).toEqual({ x: 1, y: 2 });
    const b = viewBounds(view, 800, 400);
    const topLeft = worldAtPixel(view, 800, 400, 0, 0);
    expect(topLeft.x).toBeCloseTo(b.minX, 12);
    expect(topLeft.y).toBeCloseTo(b.maxY, 12);
  });

  it('zooms around the anchor', () => {
    const view: View = { centerX: 1, centerY: 2, metresPerPixel: 0.01 };
    const anchor = { x: 4, y: -1 };
    const pixelOffset = (v: View) => [
      (anchor.x - v.centerX) / v.metresPerPixel,
      (anchor.y - v.centerY) / v.metresPerPixel,
    ];
    const zoomed = zoomViewAt(view, anchor, 0.5);
    expect(zoomed.metresPerPixel).toBeCloseTo(0.005, 12);
    expect(pixelOffset(zoomed)[0]).toBeCloseTo(pixelOffset(view)[0]!, 9);
    expect(pixelOffset(zoomed)[1]).toBeCloseTo(pixelOffset(view)[1]!, 9);
  });

  it('clamps at both limits without sliding the anchor', () => {
    const view: View = { centerX: 0, centerY: 0, metresPerPixel: 0.01 };
    const anchor = { x: 3, y: 2 };
    const inward = zoomViewAt(view, anchor, 1e-6);
    expect(inward.metresPerPixel).toBe(MIN_METRES_PER_PIXEL);
    expect((anchor.x - inward.centerX) / inward.metresPerPixel).toBeCloseTo(
      (anchor.x - view.centerX) / view.metresPerPixel,
      6,
    );
    expect(zoomViewAt(view, anchor, 1e6).metresPerPixel).toBe(MAX_METRES_PER_PIXEL);
  });

  it('pans so content follows the pointer', () => {
    const moved = panView({ centerX: 0, centerY: 0, metresPerPixel: 0.01 }, 100, 50);
    // Dragged right: the view looks further left. Dragged down: further up.
    expect(moved.centerX).toBeCloseTo(-1, 12);
    expect(moved.centerY).toBeCloseTo(0.5, 12);
  });

  it('thins grid lines past the cap', () => {
    expect(lineSpacingFor(6, 0.25)).toBe(0.25);
    // 2000 lines over 20 m at 1 cm is past the cap of 160: every 13th line.
    expect(lineSpacingFor(20, 0.01)).toBeCloseTo(0.13, 12);
  });
});
