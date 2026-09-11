import { describe, expect, it } from 'vitest';
import { patternLibrary, patternWithCell } from '@/domain/pattern-library';
import { formatPattern, parsePattern, patternLegend } from '@/domain/pattern-notation';
import { createTileDefinition } from '@/domain/tile';

const CELL = 0.15;
const JOINT = 0.01;

/** The library catalogue, sized for a 0.15 m cell with a 0.01 m joint. */
const large = createTileDefinition({ id: 'a', name: 'Large', length: 3 * CELL - JOINT, width: 3 * CELL - JOINT });
const unit = createTileDefinition({ id: 'b', name: 'Unit', length: CELL - JOINT, width: CELL - JOINT });
const slab = createTileDefinition({ id: 'c', name: 'Slab', length: 2 * CELL - JOINT, width: CELL - JOINT });
const legend = patternLegend([large, unit, slab]);

describe('notation with a joint', () => {
  it('accepts an undersized tile', () => {
    // A one-tile legend labels that tile "a".
    const result = parsePattern('cell 0.15\na', patternLegend([unit]));
    expect(result.ok).toBe(true);
  });

  it('names the excess of a tile too large for its footprint', () => {
    const tooBig = createTileDefinition({ id: 'b', name: 'Unit', length: CELL, width: CELL });
    const result = parsePattern('cell 0.15\njoint 0.01\na', patternLegend([tooBig]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/10(\.0)? mm larger than its 1×1 footprint/);
  });

  it('applies a default joint when the notation has no header', () => {
    const result = parsePattern('cell 0.15\nb', legend, { joint: JOINT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schema.tileGrids[0]!.joint).toBeCloseTo(JOINT, 9);
  });

  it('lets a joint header win over the default', () => {
    const result = parsePattern('cell 0.16\njoint 0.02\nb', legend, { joint: JOINT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schema.tileGrids[0]!.joint).toBeCloseTo(0.02, 9);
  });

  // Without the joint header every preset tile would read as undersized by exactly the joint.
  it.each(patternLibrary().map((p) => [p.name, p] as const))('parses %s at cell + joint', (_name, pattern) => {
    const text = patternWithCell(pattern, CELL, CELL, JOINT);
    expect(text).toMatch(/^joint 0\.01$/m);
    const parsed = parsePattern(text, legend);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.schema.tileGrids[0]!.joint).toBeCloseTo(JOINT, 9);

    const again = parsePattern(formatPattern(parsed.schema, legend), legend, { joint: JOINT });
    expect(again.ok).toBe(true);
  });
});
