import { GridCell2, type GridCell2Json } from '../core/grid-cell2';

/** Explicit set of grid cells; a first-class grid region alongside lines, polygons, and rectangles. */
export class GridCell2Collection {
  static readonly type = 'CellCollection' as const;

  private readonly cells: GridCell2[];
  private readonly hashes: ReadonlySet<number>;

  constructor(cells: Iterable<GridCell2> = []) {
    this.cells = GridCell2.filterDuplicates(cells);
    this.hashes = GridCell2.cellsHashSet(this.cells);
  }

  static union(...collections: GridCell2Collection[]): GridCell2Collection {
    const hashSet = new Set<number>();
    for (const collection of collections) {
      for (const hash of collection.hashes) hashSet.add(hash);
    }
    return GridCell2Collection.fromHashSet(hashSet);
  }

  static intersection(...collections: GridCell2Collection[]): GridCell2Collection {
    if (collections.length === 0) {
      return new GridCell2Collection();
    }

    let hashSet = new Set(collections[0]!.hashes);

    for (let i = 1; i < collections.length; i++) {
      const other = collections[i]!.hashes;
      const next = new Set<number>();
      for (const hash of hashSet) {
        if (other.has(hash)) next.add(hash);
      }
      hashSet = next;
    }

    return GridCell2Collection.fromHashSet(hashSet);
  }

  /** Cells in `a` that are not in `b`. */
  static difference(a: GridCell2Collection, b: GridCell2Collection): GridCell2Collection {
    const hashSet = new Set<number>();
    for (const hash of a.hashes) {
      if (!b.hashes.has(hash)) hashSet.add(hash);
    }
    return GridCell2Collection.fromHashSet(hashSet);
  }

  /** Cells that belong to exactly one of `a` or `b`. */
  static xor(a: GridCell2Collection, b: GridCell2Collection): GridCell2Collection {
    return GridCell2Collection.difference(GridCell2Collection.union(a, b), GridCell2Collection.intersection(a, b));
  }

  toCellCollection(): GridCell2Collection {
    return this.clone();
  }

  intersect(...others: GridCell2Collection[]): GridCell2Collection {
    return GridCell2Collection.intersection(this, ...others);
  }

  subtract(other: GridCell2Collection): GridCell2Collection {
    return GridCell2Collection.difference(this, other);
  }

  xor(other: GridCell2Collection): GridCell2Collection {
    return GridCell2Collection.xor(this, other);
  }

  /** Keep cells that satisfy `predicate`. */
  filter(predicate: (cell: GridCell2) => boolean): GridCell2Collection {
    return new GridCell2Collection(this.cells.filter(predicate));
  }

  /** True when every cell of `other` is in this collection. */
  containsAll(other: GridCell2Collection): boolean {
    for (const cell of other.cells) {
      if (!this.has(cell)) {
        return false;
      }
    }
    return true;
  }

  toArray(): GridCell2[] {
    return this.cells.map((cell) => cell.clone());
  }

  size(): number {
    return this.cells.length;
  }

  has(cell: GridCell2): boolean {
    return this.hashes.has(cell.hash());
  }

  [Symbol.iterator](): Iterator<GridCell2> {
    return this.toArray()[Symbol.iterator]();
  }

  clone(): GridCell2Collection {
    return new GridCell2Collection(this.cells);
  }

  toJson(): CellCollectionJson {
    return { type: GridCell2Collection.type, cells: this.cells.map((cell) => cell.toJson()) };
  }

  private static fromHashSet(hashSet: Set<number>): GridCell2Collection {
    return new GridCell2Collection([...hashSet].map(GridCell2.fromHash));
  }
}

export type CellCollectionJson = {
  type: typeof GridCell2Collection.type;
  cells: GridCell2Json[];
};
