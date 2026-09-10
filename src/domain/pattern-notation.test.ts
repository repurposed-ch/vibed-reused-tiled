import { describe, expect, it } from 'vitest';
import { patternLibrary, patternWithCell } from '@/domain/pattern-library';
import { formatPattern, parsePattern, patternLegend } from '@/domain/pattern-notation';
import { createTileDefinition } from '@/domain/tile';
import { tileGridCells } from '@/domain/tile-grid';
import { resolveSchema, tryResolveSchema } from '@/workflow/tile-grid-lattice';

const CELL = 0.15;

/** a is three cells square, b is one — the pair the library is written for. */
const large = createTileDefinition({ id: 'a', name: 'Large', length: CELL * 3, width: CELL * 3 });
const unit = createTileDefinition({ id: 'b', name: 'Unit', length: CELL, width: CELL });
const slab = createTileDefinition({ id: 'c', name: 'Slab', length: CELL * 2, width: CELL });

/** The nominal catalogue the library is drawn for: 3×3, 1×1 and 2×1 cells. */
const legend = patternLegend([large, unit, slab]);

describe('parsePattern', () => {
  it('reads the staircase exactly as it was originally specified', () => {
    const result = parsePattern(
      `cell 0.15
u 4,4
v 7,1
_ b b b
a a a b
a a a b
a a a b
a a a _
a a a _
a a a _`,
      legend,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const grid = result.schema.tileGrids[0]!;
    expect(grid.extent).toEqual({ iCount: 4, jCount: 7 });
    expect(tileGridCells(grid)).toHaveLength(24);
    expect(result.schema.masterGrids[0]!.u).toEqual({ i: 4, j: 4 });
    expect(result.schema.masterGrids[0]!.v).toEqual({ i: 7, j: 1 });

    const resolved = resolveSchema(result.schema);
    expect(resolved.cells).toHaveLength(24);
  });

  it('reads rows top-down, so the first line is the highest j', () => {
    // The art is written the way text is read; the indices still count from the
    // bottom left. Getting this backwards flips every pattern vertically.
    const result = parsePattern(
      `cell 0.15
b b b b
a a a b
a a a b
a a a b`,
      legend,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const grid = result.schema.tileGrids[0]!;
    const largeInstance = grid.instances.find((i) => i.tileDefinitionId === 'a');
    // The a block sits on the three *lower* rows of the drawing.
    expect(largeInstance).toMatchObject({ i: 0, j: 0, iSpan: 3, jSpan: 3 });
    // The row of units is the top one, j = 3.
    expect(grid.instances.filter((i) => i.tileDefinitionId === 'b' && i.j === 3)).toHaveLength(4);
  });

  it('defaults the lattice to the extent when u and v are omitted', () => {
    const result = parsePattern(`cell 0.15\nb b\nb b`, legend);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schema.masterGrids[0]!.u).toEqual({ i: 2, j: 0 });
    expect(result.schema.masterGrids[0]!.v).toEqual({ i: 0, j: 2 });
  });

  it('treats an uppercase letter as the turned orientation', () => {
    // c is a 2×1 slab; C is the same slab on end, 1×2.
    const result = parsePattern(`cell 0.15\nc c\nC b\nC b`, legend);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const turned = result.schema.tileGrids[0]!.instances.find((i) => i.rotated);
    expect(turned).toMatchObject({ iSpan: 1, jSpan: 2, rotated: true });
  });

  it('accepts packed rows as well as spaced ones', () => {
    const spaced = parsePattern(`cell 0.15\nb b b b\na a a b\na a a b\na a a b`, legend);
    const packed = parsePattern(`cell 0.15\nbbbb\naaab\naaab\naaab`, legend);
    expect(spaced.ok && packed.ok).toBe(true);
    if (!spaced.ok || !packed.ok) return;
    expect(tileGridCells(packed.schema.tileGrids[0]!)).toHaveLength(
      tileGridCells(spaced.schema.tileGrids[0]!).length,
    );
  });

  it('rejects a block that does not match the format real size', () => {
    // a is 3×3 cells. Drawing it 2×2 would claim the wrong cells and open a gap
    // no validator downstream could see, so it is caught at the door.
    const result = parsePattern(`cell 0.15\nb b b b\nb b b b\na a b b\na a b b`, legend);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/does not show that block/);
  });

  it('rejects a block that runs off the grid', () => {
    const result = parsePattern(`cell 0.15\na a\na a`, legend);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/runs off the grid/);
  });

  it('names an unknown letter with its position', () => {
    const result = parsePattern(`cell 0.15\nb z\nb b`, legend);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Unknown format "z" at column 2/);
  });

  it('rejects ragged rows', () => {
    const result = parsePattern(`cell 0.15\nb b b\nb b`, legend);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Row 2 has 2 cells but row 1 has 3/);
  });

  it('requires a cell size', () => {
    const result = parsePattern(`b b\nb b`, legend);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Missing "cell/);
  });

  it('reports a format that is not a whole number of cells', () => {
    const odd = createTileDefinition({ id: 'a', name: 'Odd', length: 0.3, width: 0.3 });
    const result = parsePattern(`cell 0.25\na`, patternLegend([odd]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not a whole number of/);
  });

  it('carries mirror and joint headers through', () => {
    const result = parsePattern(`cell 0.15\njoint 0.01\nmirror xy\nb`, legend);
    expect(result.ok).toBe(false); // 0.15 cell with a 0.01 joint needs a 0.14 tile
    const sized = createTileDefinition({ id: 'b', name: 'Unit', length: 0.14, width: 0.14 });
    const ok = parsePattern(`cell 0.15\njoint 0.01\nmirror xy\na`, patternLegend([sized]));
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.schema.tileGrids[0]!.joint).toBeCloseTo(0.01, 9);
    expect(ok.schema.masterGrids[0]!.mirror).toEqual({ x: 'alternate', y: 'alternate' });
  });
});

describe('formatPattern', () => {
  it('round-trips a parsed pattern', () => {
    const source = `cell 0.15
u 4,4
v 7,1
_ b b b
a a a b
a a a b
a a a b
a a a _
a a a _
a a a _`;
    const parsed = parsePattern(source, legend);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const printed = formatPattern(parsed.schema, legend);
    const reparsed = parsePattern(printed, legend);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;

    // The grids must be identical cell for cell.
    const a = tileGridCells(parsed.schema.tileGrids[0]!).map((c) => `${c.i}:${c.j}`).sort();
    const b = tileGridCells(reparsed.schema.tileGrids[0]!).map((c) => `${c.i}:${c.j}`).sort();
    expect(b).toEqual(a);
    expect(reparsed.schema.masterGrids[0]!.u).toEqual({ i: 4, j: 4 });
    expect(reparsed.schema.masterGrids[0]!.v).toEqual({ i: 7, j: 1 });
  });
});

describe('pattern library', () => {
  const entries = patternLibrary();

  it('is not empty', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  // Table-driven over every entry, the way seamlessness.test.ts covers every
  // material preset: a pattern that stops tiling cannot ship, which is what
  // makes it safe to put these in front of a model as worked examples.
  it.each(entries.map((p) => [p.name, p] as const))('%s parses and tiles', (_name, pattern) => {
    const result = parsePattern(patternWithCell(pattern, CELL, CELL), legend);
    if (!result.ok) throw new Error(`${pattern.name}: ${result.error}`);

    const resolution = tryResolveSchema(result.schema);
    if (!resolution.ok) throw new Error(`${pattern.name}: ${resolution.reason}`);
    expect(resolution.resolved.cells.length).toBeGreaterThan(0);
  });

  it.each(entries.map((p) => [p.name, p] as const))('%s round-trips', (_name, pattern) => {
    const legendFor = legend;
    const parsed = parsePattern(patternWithCell(pattern, CELL, CELL), legendFor);
    if (!parsed.ok) throw new Error(parsed.error);
    const reparsed = parsePattern(formatPattern(parsed.schema, legendFor), legendFor);
    expect(reparsed.ok).toBe(true);
  });

  it('gives every entry a distinct id and a description', () => {
    expect(new Set(entries.map((p) => p.id)).size).toBe(entries.length);
    expect(entries.every((p) => p.description.length > 0)).toBe(true);
  });
});
