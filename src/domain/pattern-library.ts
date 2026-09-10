/**
 * Curated tile patterns in the compact notation, used two ways: as worked
 * examples in the LLM prompt, and as "start from a known bond" presets in the
 * tile-schema editor.
 *
 * They are stored as notation rather than `TileSchemaJson` because the notation
 * is what goes in a prompt, and because a wall of JSON is not reviewable — the
 * point of a curated library is that a person can see at a glance what each
 * entry is.
 *
 * Every entry is parsed and resolved by `pattern-library.test.ts`, the way
 * `seamlessness.test.ts` runs every material preset. A pattern that stops tiling
 * cannot ship, so the model is only ever shown examples that work.
 *
 * Letters follow `patternLegend`: `a` is the first format in the catalogue, `b`
 * the second, and so on. Sizes in the notation are written for a two-format
 * catalogue of a large square and a unit square; `patternFor` rescales the cell
 * to whatever the project actually holds.
 */

/**
 * Footprints, in cells, that the library patterns are drawn for.
 *
 * A pattern's drawing encodes footprints, so an entry only makes sense for a
 * catalogue whose formats have these shapes — `patternWithCell` can rescale the
 * cell but not a block. Callers use this to offer only the patterns a given set
 * of formats can actually build.
 */
export const NOMINAL_FOOTPRINTS: Record<string, { iSpan: number; jSpan: number }> = {
  a: { iSpan: 3, jSpan: 3 },
  b: { iSpan: 1, jSpan: 1 },
  c: { iSpan: 2, jSpan: 1 },
};

export type LibraryPattern = {
  id: string;
  name: string;
  /** One line, used as the preset label and the example caption in the prompt. */
  description: string;
  notation: string;
};

/** Every cell one unit format. The plainest possible repeat. */
const stackBond = `cell 0.15
u 1,0
v 0,1
b`;

/** One slab, with the half-tile offset carried by the lattice rather than by the
 *  cells — v steps one cell sideways as it steps a course up. */
const runningBond = `cell 0.15
u 2,0
v 1,1
c c`;

/** Pairs of slabs alternating direction. Uppercase is the turned orientation, so
 *  each 2×2 quarter is either two flat slabs or two on end. */
const basketweave = `cell 0.15
u 4,0
v 0,4
C C c c
C C c c
c c C C
c c C C`;

/** One large square with a course of units wrapping two sides. */
const blockAndCourse = `cell 0.15
u 4,0
v 0,4
b b b b
a a a b
a a a b
a a a b`;

/** Large squares climbing diagonally, the repeat carried by a sheared lattice.
 *  The blanks are not holes — neighbouring copies cover them. */
const staircase = `cell 0.15
u 4,4
v 7,1
_ b b b
a a a b
a a a b
a a a b
a a a _
a a a _
a a a _`;

export function patternLibrary(): LibraryPattern[] {
  return [
    {
      id: 'pattern-stack-bond',
      name: 'Stack bond',
      description: 'Every cell the unit format, courses aligned.',
      notation: stackBond,
    },
    {
      id: 'pattern-running-bond',
      name: 'Running bond',
      description: 'Slabs offset half a tile each course.',
      notation: runningBond,
    },
    {
      id: 'pattern-basketweave',
      name: 'Basketweave',
      description: 'Pairs of slabs alternating direction.',
      notation: basketweave,
    },
    {
      id: 'pattern-block-and-course',
      name: 'Block and course',
      description: 'One large square with a course of units wrapping two sides.',
      notation: blockAndCourse,
    },
    {
      id: 'pattern-staircase',
      name: 'Staircase',
      description: 'Large squares climbing diagonally on a sheared lattice.',
      notation: staircase,
    },
  ];
}

/** How many cells a pattern's grid draws, used to skip degenerate examples. */
export function patternCellCount(pattern: LibraryPattern): number {
  const body = pattern.notation
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^(name|cell|joint|u|v|mirror|fallback)\b/.test(line));
  return body.reduce((total, line) => {
    const tokens = /\s/.test(line) ? line.split(/\s+/) : line.split('');
    return total + tokens.length;
  }, 0);
}

/** Letters a pattern uses, so a catalogue can be checked against it. */
export function patternLetters(pattern: LibraryPattern): string[] {
  const body = pattern.notation
    .split('\n')
    .filter((line) => !/^(name|cell|joint|u|v|mirror|fallback)\b/.test(line.trim()));
  const letters = new Set<string>();
  for (const line of body) {
    for (const token of line.trim().split(/\s+/)) {
      if (/^[a-z]$/i.test(token)) letters.add(token.toLowerCase());
    }
  }
  return [...letters].sort();
}

/**
 * A library entry rewritten for the project's own cell size.
 *
 * The notation carries a nominal cell; a real catalogue rarely matches it, so the
 * header is replaced with one derived from the tiles the pattern will actually
 * use. Footprints cannot be rescaled this way — they are what the drawing
 * encodes — which is why {@link NOMINAL_FOOTPRINTS} exists.
 */
export function patternWithCell(pattern: LibraryPattern, cellX: number, cellY: number): string {
  const scaled = cellX === cellY ? `cell ${cellX}` : `cell ${cellX} ${cellY}`;
  return pattern.notation.replace(/^cell .*$/m, scaled);
}
