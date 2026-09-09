import { mooreNeighborCellHashes, vonNeumannNeighborCellHashes } from '../../hash/neighbors';
import { dehash2, hash2 } from '../../hash/core';
import { Grid2 } from './grid2';

/** Integer grid index pair. World position is derived via `Grid2` + `Frame2`. */
export class GridCell2 {
  static readonly type = 'GridCell2' as const;

  constructor(
    public readonly i: number,
    public readonly j: number,
  ) {
    if (i < Grid2.minIndex || i > Grid2.maxIndex || j < Grid2.minIndex || j > Grid2.maxIndex) {
      throw new Error('Grid cell index out of bounds');
    }
  }

  equals(other: GridCell2): boolean {
    return this.i === other.i && this.j === other.j;
  }

  add(delta: GridCell2): GridCell2 {
    return new GridCell2(this.i + delta.i, this.j + delta.j);
  }

  subtract(other: GridCell2): GridCell2 {
    return new GridCell2(this.i - other.i, this.j - other.j);
  }

  neighbors(count = 1, type: 'vonNeumann' | 'moore' = 'vonNeumann'): GridCell2[] {
    if (type === 'vonNeumann') return vonNeumannNeighborCellHashes(this.hash(), count).map(GridCell2.fromHash);
    return mooreNeighborCellHashes(this.hash(), count).map(GridCell2.fromHash);
  }

  hash(): number {
    return hash2(this.i - Grid2.minIndex, this.j - Grid2.minIndex);
  }

  clone(): GridCell2 {
    return new GridCell2(this.i, this.j);
  }

  toJson(): GridCell2Json {
    return { type: GridCell2.type, i: this.i, j: this.j };
  }

  static fromHash(hash: number): GridCell2 {
    const [i, j] = dehash2(hash);
    return new GridCell2(i + Grid2.minIndex, j + Grid2.minIndex);
  }

  static cellsHashSet(cells: Iterable<GridCell2>): Set<number> {
    return new Set(Array.from(cells).map((cell) => cell.hash()));
  }

  static filterDuplicates(cells: Iterable<GridCell2>): GridCell2[] {
    return Array.from(GridCell2.cellsHashSet(cells)).map((hash) => GridCell2.fromHash(hash));
  }

  static cellsContain(cells: Iterable<GridCell2>, cell: GridCell2): boolean {
    return GridCell2.cellsHashSet(cells).has(cell.hash());
  }
}

export type GridCell2Json = {
  type: typeof GridCell2.type;
  i: number;
  j: number;
};
