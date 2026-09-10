import type { TileDefinitionJson } from './tile';
import {
  createMasterGrid,
  createTileGrid,
  createTileGridInstance,
  createTileSchema,
  spanFor,
  type IntVec2,
  type MirrorRule,
  type TileGridInstanceJson,
  type TileSchemaJson,
} from './tile-grid';

/**
 * Compact text notation for a tile pattern.
 *
 * ```
 * cell 0.15
 * u 4,4
 * v 7,1
 * _ b b b
 * a a a b
 * a a a b
 * a a a b
 * a a a _
 * a a a _
 * a a a _
 * ```
 *
 * This is the notation the staircase repeat was originally specified in, and it
 * exists because `TileSchemaJson` is a poor thing to put in a prompt: one
 * staircase runs to 2–3 KB, so a handful of worked examples exceeds the context
 * of the small models this app defaults to before the request is even added. The
 * same pattern here is a couple of hundred bytes, and a model that miscounts a
 * row produces a parse error naming the cell rather than malformed JSON.
 *
 * Rules:
 * - **Rows read top-down**, so the first grid line is the highest `j`. Cell
 *   indices still count from the bottom left, matching the lattice.
 * - One letter per tile format; `_` marks a cell belonging to a neighbouring
 *   copy of the repeat.
 * - **An uppercase letter means the turned orientation**, which is what makes a
 *   non-square format unambiguous.
 * - Headers before the grid: `cell` (required), `joint`, `u`, `v`, `mirror`,
 *   `fallback`. `u` and `v` default to the axis-aligned extent.
 */

export type PatternLegendEntry = {
  letter: string;
  tile: TileDefinitionJson;
};

export type ParsePatternResult =
  | { ok: true; schema: TileSchemaJson }
  | { ok: false; error: string };

const HEADER_KEYS = ['cell', 'joint', 'u', 'v', 'mirror', 'fallback', 'name'] as const;

function parseVec(text: string): IntVec2 | null {
  const parts = text.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isInteger(n))) return null;
  return { i: parts[0]!, j: parts[1]! };
}

/**
 * Assign letters to formats: `a`, `b`, `c`… in catalogue order. Callers put this
 * in the prompt legend so a reply's letters are unambiguous.
 */
export function patternLegend(tiles: readonly TileDefinitionJson[]): PatternLegendEntry[] {
  return tiles.map((tile, index) => ({
    letter: String.fromCharCode(97 + index),
    tile,
  }));
}

export function parsePattern(
  text: string,
  legend: readonly PatternLegendEntry[],
): ParsePatternResult {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  const headers = new Map<string, string>();
  const rows: string[][] = [];

  for (const line of lines) {
    const key = line.split(/\s+/)[0]?.toLowerCase() ?? '';
    if ((HEADER_KEYS as readonly string[]).includes(key) && rows.length === 0) {
      headers.set(key, line.slice(key.length).trim());
      continue;
    }
    // Tokens may be spaced or packed: "a a a b" and "aaab" both work.
    const tokens = line.includes(' ') ? line.split(/\s+/) : line.split('');
    rows.push(tokens);
  }

  if (rows.length === 0) return { ok: false, error: 'No grid rows found.' };

  const width = rows[0]!.length;
  const badRow = rows.findIndex((row) => row.length !== width);
  if (badRow >= 0) {
    return {
      ok: false,
      error: `Row ${badRow + 1} has ${rows[badRow]!.length} cells but row 1 has ${width}. Every row must be the same width.`,
    };
  }

  const cellText = headers.get('cell');
  if (!cellText) return { ok: false, error: 'Missing "cell <size>" header.' };
  const cellParts = cellText.split(/\s+/).map(Number);
  const cellX = cellParts[0];
  const cellY = cellParts[1] ?? cellParts[0];
  if (!cellX || !cellY || cellX <= 0 || cellY <= 0) {
    return { ok: false, error: `Could not read cell size from "cell ${cellText}".` };
  }

  const joint = headers.has('joint') ? Number(headers.get('joint')) : 0;
  if (!Number.isFinite(joint) || joint < 0) {
    return { ok: false, error: `Could not read joint from "joint ${headers.get('joint')}".` };
  }

  const iCount = width;
  const jCount = rows.length;

  // Grid lines run top-down, so the first line is the highest j.
  const at = (i: number, j: number): string => rows[jCount - 1 - j]![i]!;

  const byLetter = new Map(legend.map((entry) => [entry.letter.toLowerCase(), entry.tile]));

  const claimed = new Set<string>();
  const instances: TileGridInstanceJson[] = [];

  // Bottom-up, because an occurrence is anchored at its bottom-left cell: the
  // first unclaimed cell of a block encountered this way is its origin.
  for (let j = 0; j < jCount; j += 1) {
    for (let i = 0; i < iCount; i += 1) {
      const key = `${i}:${j}`;
      if (claimed.has(key)) continue;
      const token = at(i, j);
      if (token === '_' || token === '.') continue;

      const tile = byLetter.get(token.toLowerCase());
      if (!tile) {
        return { ok: false, error: `Unknown format "${token}" at column ${i + 1}, row ${jCount - j}.` };
      }

      // Case carries the orientation; the footprint itself is never a choice —
      // it follows from the tile's real size, so a region that does not match it
      // is an error rather than something to round off.
      const rotated = token !== token.toLowerCase();
      const span = spanFor(tile, { x: cellX, y: cellY }, joint, rotated);
      if (!span) {
        return {
          ok: false,
          error: `${tile.name} is ${tile.length}×${tile.width} m, which is not a whole number of ${cellX}×${cellY} m cells.`,
        };
      }

      if (i + span.iSpan > iCount || j + span.jSpan > jCount) {
        return {
          ok: false,
          error: `"${token}" at column ${i + 1}, row ${jCount - j} needs ${span.iSpan}×${span.jSpan} cells but runs off the grid.`,
        };
      }

      for (let di = 0; di < span.iSpan; di += 1) {
        for (let dj = 0; dj < span.jSpan; dj += 1) {
          const cell = `${i + di}:${j + dj}`;
          if (claimed.has(cell) || at(i + di, j + dj) !== token) {
            return {
              ok: false,
              error: `"${token}" at column ${i + 1}, row ${jCount - j} covers ${span.iSpan}×${span.jSpan} cells, but the grid does not show that block.`,
            };
          }
          claimed.add(cell);
        }
      }

      instances.push(
        createTileGridInstance(tile.id, i, j, span.iSpan, span.jSpan, rotated),
      );
    }
  }

  if (instances.length === 0) return { ok: false, error: 'The grid claims no cells.' };

  const u = headers.has('u') ? parseVec(headers.get('u')!) : { i: iCount, j: 0 };
  const v = headers.has('v') ? parseVec(headers.get('v')!) : { i: 0, j: jCount };
  if (!u || !v) return { ok: false, error: 'u and v must be two whole numbers, like "u 4,4".' };

  const mirrorText = (headers.get('mirror') ?? '').toLowerCase();
  const mirror: { x: MirrorRule; y: MirrorRule } = {
    x: mirrorText.includes('x') ? 'alternate' : 'none',
    y: mirrorText.includes('y') ? 'alternate' : 'none',
  };

  const fallbackLetter = headers.get('fallback')?.trim().toLowerCase();
  const fallbackTile = fallbackLetter ? byLetter.get(fallbackLetter) : undefined;
  const unitInstance = instances.find((i) => i.iSpan === 1 && i.jSpan === 1);
  const fallbackTileDefinitionId =
    fallbackTile?.id ?? unitInstance?.tileDefinitionId ?? instances[0]!.tileDefinitionId;

  const tileGrid = createTileGrid({
    name: headers.get('name') || 'Pattern',
    cell: { x: cellX, y: cellY },
    joint,
    extent: { iCount, jCount },
    instances,
    fallbackTileDefinitionId,
  });
  const masterGrid = createMasterGrid({
    name: 'Master',
    childId: tileGrid.id,
    u,
    v,
    mirror,
  });

  return {
    ok: true,
    schema: createTileSchema({
      name: headers.get('name') || 'Pattern',
      tileGrids: [tileGrid],
      masterGrids: [masterGrid],
      rootMasterGridId: masterGrid.id,
    }),
  };
}

/** The inverse: render a single-level schema back into the notation. */
export function formatPattern(
  schema: TileSchemaJson,
  legend: readonly PatternLegendEntry[],
): string {
  const tileGrid = schema.tileGrids[0];
  const master = schema.masterGrids.find((m) => m.id === schema.rootMasterGridId);
  if (!tileGrid || !master) return '';

  const letterFor = new Map(legend.map((entry) => [entry.tile.id, entry.letter]));
  const { iCount, jCount } = tileGrid.extent;
  const grid: string[][] = Array.from({ length: jCount }, () =>
    Array.from({ length: iCount }, () => '_'),
  );

  for (const instance of tileGrid.instances) {
    const base = letterFor.get(instance.tileDefinitionId) ?? '?';
    const token = instance.rotated ? base.toUpperCase() : base;
    for (let di = 0; di < instance.iSpan; di += 1) {
      for (let dj = 0; dj < instance.jSpan; dj += 1) {
        const row = grid[instance.j + dj];
        if (row) row[instance.i + di] = token;
      }
    }
  }

  const headers = [
    `name ${schema.name}`,
    tileGrid.cell.x === tileGrid.cell.y
      ? `cell ${tileGrid.cell.x}`
      : `cell ${tileGrid.cell.x} ${tileGrid.cell.y}`,
  ];
  if (tileGrid.joint > 0) headers.push(`joint ${tileGrid.joint}`);
  headers.push(`u ${master.u.i},${master.u.j}`, `v ${master.v.i},${master.v.j}`);
  const mirrorAxes = `${master.mirror.x === 'alternate' ? 'x' : ''}${master.mirror.y === 'alternate' ? 'y' : ''}`;
  if (mirrorAxes) headers.push(`mirror ${mirrorAxes}`);
  const fallbackLetter = letterFor.get(tileGrid.fallbackTileDefinitionId);
  if (fallbackLetter) headers.push(`fallback ${fallbackLetter}`);

  // Rows top-down, highest j first.
  const body = grid
    .slice()
    .reverse()
    .map((row) => row.join(' '));

  return [...headers, ...body].join('\n');
}
