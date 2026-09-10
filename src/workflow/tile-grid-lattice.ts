import {
  findMasterGrid,
  findTileGrid,
  instanceCells,
  type IntVec2,
  type MasterGridJson,
  type MirrorJson,
  type TileGridInstanceJson,
  type TileGridJson,
  type TileSchemaJson,
} from '@/domain/tile-grid';

/**
 * Integer lattice arithmetic for the two-level tile schema.
 *
 * Everything here is exact integer work — no floats, no epsilon. A fundamental
 * domain of N labelled cells tiles the plane under lattice (u, v) exactly when
 * |det(u, v)| = N and the N cells fall into N distinct residue classes modulo the
 * lattice. That single test is what makes an authored pattern verifiable rather
 * than merely plausible, and it is why lattice vectors are free to point outside
 * the domain's own bounding box — a staircase bond needs generators that do.
 *
 * Nesting is handled by flattening. A chain of master grids composes to one
 * lattice over base cells (each level's basis multiplies into the next), so the
 * whole hierarchy is enumerated once into a composite domain and every later
 * lookup is a single map hit. Mirroring is applied during that enumeration, in
 * each level's own index space where the extent is always rectangular.
 */

export type Mirror = { x: boolean; y: boolean };

export type Extent = { iCount: number; jCount: number };

/** One cell of the composite fundamental domain, in base-cell coordinates. */
export type ResolvedCell = {
  cell: IntVec2;
  instance: TileGridInstanceJson;
  /** Bottom-left cell of the occurrence, in base-cell coordinates. */
  originCell: IntVec2;
  /** Footprint after any mirroring — spans swap only under rotation, never mirroring. */
  iSpan: number;
  jSpan: number;
  /** Identifies the occurrence within the composite domain. */
  instanceKey: string;
  flip: Mirror;
};

export type ResolvedSchema = {
  tileGrid: TileGridJson;
  /** Tiling lattice in base-cell space. */
  u: IntVec2;
  v: IntVec2;
  cells: ResolvedCell[];
  byClass: Map<string, ResolvedCell>;
};

export type LatticeValidation =
  | { ok: true; det: number }
  | { ok: false; reason: string; collisions: IntVec2[] };

/** 2D cross product; the z-component of a × b. */
export function cross(a: IntVec2, b: IntVec2): number {
  return a.i * b.j - a.j * b.i;
}

export function latticeDet(u: IntVec2, v: IntVec2): number {
  return cross(u, v);
}

function mod(value: number, n: number): number {
  return ((value % n) + n) % n;
}

/**
 * Canonical residue class of a cell modulo the lattice. Two cells share a key
 * exactly when they differ by an integer combination of u and v.
 */
export function residueClass(cell: IntVec2, u: IntVec2, v: IntVec2): string {
  const det = Math.abs(latticeDet(u, v));
  const a = cell.i * v.j - cell.j * v.i;
  const b = cell.j * u.i - cell.i * u.j;
  return `${mod(a, det)}:${mod(b, det)}`;
}

/**
 * Exact integer (m, n) with `cell − representative = m·u + n·v`. Defined only for
 * cells in the same residue class, where both quotients divide out evenly.
 */
export function copyIndex(
  cell: IntVec2,
  representative: IntVec2,
  u: IntVec2,
  v: IntVec2,
): IntVec2 {
  const det = latticeDet(u, v);
  const d: IntVec2 = { i: cell.i - representative.i, j: cell.j - representative.j };
  return { i: cross(d, v) / det, j: cross(u, d) / det };
}

/** Offset of lattice copy (m, n), in base cells. */
export function latticeOffset(copy: IntVec2, u: IntVec2, v: IntVec2): IntVec2 {
  return { i: copy.i * u.i + copy.j * v.i, j: copy.i * u.j + copy.j * v.j };
}

/**
 * Does this domain tile the plane under (u, v)? Reports the cells that collide so
 * a rejected pattern points at its own overlap instead of just failing.
 */
export function validateLattice(
  cells: readonly IntVec2[],
  u: IntVec2,
  v: IntVec2,
): LatticeValidation {
  const det = latticeDet(u, v);
  if (det === 0) {
    return { ok: false, reason: 'Lattice vectors are parallel', collisions: [] };
  }
  if (Math.abs(det) !== cells.length) {
    return {
      ok: false,
      reason: `Lattice covers ${Math.abs(det)} cells per repeat but the domain labels ${cells.length}`,
      collisions: [],
    };
  }

  const seen = new Map<string, IntVec2>();
  const collisions: IntVec2[] = [];
  for (const cell of cells) {
    const key = residueClass(cell, u, v);
    const previous = seen.get(key);
    if (previous) {
      collisions.push(previous, cell);
      continue;
    }
    seen.set(key, cell);
  }

  if (collisions.length > 0) {
    return {
      ok: false,
      reason: 'Two domain cells share a residue class, so copies would overlap',
      collisions,
    };
  }
  return { ok: true, det };
}

function candidateVectors(range: number): IntVec2[] {
  const out: IntVec2[] = [];
  for (let i = -range; i <= range; i += 1) {
    for (let j = -range; j <= range; j += 1) {
      if (i === 0 && j === 0) continue;
      out.push({ i, j });
    }
  }
  // Short, axis-aligned generators first: they read best in the UI and keep the
  // master grid rectangular whenever the pattern allows one.
  out.sort((a, b) => {
    const na = a.i * a.i + a.j * a.j;
    const nb = b.i * b.i + b.j * b.j;
    if (na !== nb) return na - nb;
    if (a.i !== b.i) return b.i - a.i;
    return b.j - a.j;
  });
  return out;
}

/**
 * Find a lattice the domain tiles under, when none is authored or the authored
 * one is rejected. Returns null when the cells admit no exact cover at all.
 */
export function deriveLattice(cells: readonly IntVec2[]): { u: IntVec2; v: IntVec2 } | null {
  if (cells.length === 0) return null;

  let maxI = 0;
  let maxJ = 0;
  for (const cell of cells) {
    maxI = Math.max(maxI, Math.abs(cell.i) + 1);
    maxJ = Math.max(maxJ, Math.abs(cell.j) + 1);
  }
  const range = Math.max(maxI, maxJ, Math.ceil(Math.sqrt(cells.length))) * 2;
  const vectors = candidateVectors(range);

  for (const u of vectors) {
    for (const v of vectors) {
      if (Math.abs(latticeDet(u, v)) !== cells.length) continue;
      if (validateLattice(cells, u, v).ok) return { u, v };
    }
  }
  return null;
}

/** Parity rule: an 'alternate' axis flips on odd copy indices. */
export function mirrorParity(mirror: MirrorJson, copy: IntVec2): Mirror {
  return {
    x: mirror.x === 'alternate' && mod(copy.i, 2) === 1,
    y: mirror.y === 'alternate' && mod(copy.j, 2) === 1,
  };
}

export function xorMirror(a: Mirror, b: Mirror): Mirror {
  return { x: a.x !== b.x, y: a.y !== b.y };
}

/** Reflect an index inside a rectangular extent. Involutive. */
export function applyMirror(cell: IntVec2, extent: Extent, flip: Mirror): IntVec2 {
  return {
    i: flip.x ? extent.iCount - 1 - cell.i : cell.i,
    j: flip.y ? extent.jCount - 1 - cell.j : cell.j,
  };
}

/** Reflect a spanning block inside a rectangular extent, keeping it contiguous. */
function mirrorInstance(
  instance: TileGridInstanceJson,
  extent: Extent,
  flip: Mirror,
): TileGridInstanceJson {
  return {
    ...instance,
    i: flip.x ? extent.iCount - instance.i - instance.iSpan : instance.i,
    j: flip.y ? extent.jCount - instance.j - instance.jSpan : instance.j,
  };
}

/** 2×2 integer basis, columns u and v, mapping a level's step space to base cells. */
type Basis = { u: IntVec2; v: IntVec2 };

const IDENTITY_BASIS: Basis = { u: { i: 1, j: 0 }, v: { i: 0, j: 1 } };

function applyBasis(basis: Basis, step: IntVec2): IntVec2 {
  return {
    i: step.i * basis.u.i + step.j * basis.v.i,
    j: step.i * basis.u.j + step.j * basis.v.j,
  };
}

function composeBasis(outer: Basis, inner: Basis): Basis {
  return { u: applyBasis(outer, inner.u), v: applyBasis(outer, inner.v) };
}

function extentCells(extent: Extent): IntVec2[] {
  const out: IntVec2[] = [];
  for (let i = 0; i < extent.iCount; i += 1) {
    for (let j = 0; j < extent.jCount; j += 1) out.push({ i, j });
  }
  return out;
}

type Expansion = {
  /** Cells of one block, in base-cell coordinates. */
  cells: ResolvedCell[];
  /** Maps this level's step space to base cells. */
  basis: Basis;
  tileGrid: TileGridJson;
};

/**
 * Expand one master-grid level into base-cell space, top-down. Mirroring is
 * resolved here, in each level's own rectangular index space, so the flags that
 * reach a placement are already final.
 */
function expandMaster(
  schema: TileSchemaJson,
  master: MasterGridJson,
  flip: Mirror,
  keyPrefix: string,
  depth: number,
): Expansion {
  if (depth > 8) {
    throw new Error('TileSchema master grids nest more than 8 levels deep');
  }

  const childTileGrid = findTileGrid(schema, master.childId);
  const childMaster = findMasterGrid(schema, master.childId);
  if (!childTileGrid && !childMaster) {
    throw new Error(`TileSchema master grid "${master.name}" references unknown child "${master.childId}"`);
  }

  const levelBasis: Basis = { u: master.u, v: master.v };

  // Copies of the child inside this block. A root level has no extent: it tiles
  // the plane, so its block holds exactly one child.
  const blockExtent: Extent = master.extent ?? { iCount: 1, jCount: 1 };
  const copies = extentCells(blockExtent);

  if (childTileGrid) {
    const basis = levelBasis;
    const cells: ResolvedCell[] = [];
    for (const copy of copies) {
      const localCopy = applyMirror(copy, blockExtent, flip);
      const copyFlip = xorMirror(flip, mirrorParity(master.mirror, localCopy));
      const offset = applyBasis(basis, localCopy);
      for (const instance of childTileGrid.instances) {
        const placed = mirrorInstance(instance, childTileGrid.extent, copyFlip);
        const originCell: IntVec2 = { i: offset.i + placed.i, j: offset.j + placed.j };
        const instanceKey = `${keyPrefix}/${localCopy.i},${localCopy.j}/${instance.id}`;
        for (const cell of instanceCells(placed)) {
          cells.push({
            cell: { i: offset.i + cell.i, j: offset.j + cell.j },
            instance,
            originCell,
            iSpan: placed.iSpan,
            jSpan: placed.jSpan,
            instanceKey,
            flip: copyFlip,
          });
        }
      }
    }
    return { cells, basis, tileGrid: childTileGrid };
  }

  // Child is another master grid: expand it once per copy and translate through
  // the child's own basis, then compose the bases for this level.
  const cells: ResolvedCell[] = [];
  let childBasis: Basis = IDENTITY_BASIS;
  let tileGrid: TileGridJson | null = null;

  for (const copy of copies) {
    const localCopy = applyMirror(copy, blockExtent, flip);
    const copyFlip = xorMirror(flip, mirrorParity(master.mirror, localCopy));
    const expanded = expandMaster(
      schema,
      childMaster!,
      copyFlip,
      `${keyPrefix}/${localCopy.i},${localCopy.j}`,
      depth + 1,
    );
    childBasis = expanded.basis;
    tileGrid = expanded.tileGrid;

    const offset = applyBasis(expanded.basis, applyBasis(levelBasis, localCopy));
    for (const resolved of expanded.cells) {
      cells.push({
        ...resolved,
        cell: { i: offset.i + resolved.cell.i, j: offset.j + resolved.cell.j },
        originCell: { i: offset.i + resolved.originCell.i, j: offset.j + resolved.originCell.j },
      });
    }
  }

  return { cells, basis: composeBasis(childBasis, levelBasis), tileGrid: tileGrid! };
}

/**
 * Flatten a schema into its composite fundamental domain plus the lattice that
 * repeats it. Throws when the result is not an exact cover — a schema that
 * cannot tile is a definition error, not a fill-time surprise.
 */
export function resolveSchema(schema: TileSchemaJson): ResolvedSchema {
  const root = findMasterGrid(schema, schema.rootMasterGridId);
  if (!root) {
    throw new Error(`TileSchema root master grid "${schema.rootMasterGridId}" not found`);
  }
  if (root.extent) {
    throw new Error('TileSchema root master grid must be unbounded (omit its extent)');
  }

  // An alternating mirror doubles the visual period, so the fundamental domain
  // has to double with it. Rather than make `mirror` a silent no-op on the
  // unbounded root, wrap it: the root becomes a finite 2×1 / 1×2 block holding
  // the pattern next to its reflection, and an implicit outer level repeats that.
  const mirrorsX = root.mirror.x === 'alternate';
  const mirrorsY = root.mirror.y === 'alternate';
  const effectiveRoot: MasterGridJson =
    mirrorsX || mirrorsY
      ? {
          type: 'MasterGrid',
          id: `${root.id}:mirrored`,
          name: root.name,
          childId: root.id,
          u: { i: mirrorsX ? 2 : 1, j: 0 },
          v: { i: 0, j: mirrorsY ? 2 : 1 },
          mirror: { x: 'none', y: 'none' },
        }
      : root;

  const searchSchema: TileSchemaJson =
    effectiveRoot === root
      ? schema
      : {
          ...schema,
          masterGrids: [
            ...schema.masterGrids.map((m) =>
              m.id === root.id
                ? { ...m, extent: { iCount: mirrorsX ? 2 : 1, jCount: mirrorsY ? 2 : 1 } }
                : m,
            ),
            effectiveRoot,
          ],
        };

  const expansion = expandMaster(searchSchema, effectiveRoot, { x: false, y: false }, 'root', 0);
  const { u, v } = expansion.basis;

  const validation = validateLattice(
    expansion.cells.map((c) => c.cell),
    u,
    v,
  );
  if (!validation.ok) {
    throw new Error(`TileSchema "${schema.name}" does not tile: ${validation.reason}`);
  }

  const byClass = new Map<string, ResolvedCell>();
  for (const cell of expansion.cells) {
    byClass.set(residueClass(cell.cell, u, v), cell);
  }

  return { tileGrid: expansion.tileGrid, u, v, cells: expansion.cells, byClass };
}

export type CellResolution = {
  resolved: ResolvedCell;
  /** Which lattice copy this cell sits in. */
  copy: IntVec2;
  /** Names the tile occurrence uniquely across the plane. */
  occurrenceKey: string;
  /** Bottom-left cell of that occurrence, in world cell coordinates. */
  originCell: IntVec2;
};

/** Which tile occurrence covers a given cell of the base grid. */
export function resolveCell(resolved: ResolvedSchema, cell: IntVec2): CellResolution | null {
  const hit = resolved.byClass.get(residueClass(cell, resolved.u, resolved.v));
  if (!hit) return null;

  const copy = copyIndex(cell, hit.cell, resolved.u, resolved.v);
  const offset = latticeOffset(copy, resolved.u, resolved.v);
  return {
    resolved: hit,
    copy,
    occurrenceKey: `${hit.instanceKey}@${copy.i},${copy.j}`,
    originCell: { i: hit.originCell.i + offset.i, j: hit.originCell.j + offset.j },
  };
}
