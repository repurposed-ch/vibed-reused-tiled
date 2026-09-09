import { bresenhamLine } from '../helper/bresenham';
import { GridCell2Collection } from './grid-cell2-collection';
import { GridCell2, type GridCell2Json } from '../core/grid-cell2';
import { GridRectangle2 } from './grid-rectangle2';

/** Grid line between two cell indices; cells follow Bresenham's algorithm. */
export class GridLine2 {
  static readonly type = 'GridLine2' as const;

  readonly from: GridCell2;
  readonly to: GridCell2;

  constructor(from: GridCell2, to: GridCell2) {
    this.from = from.clone();
    this.to = to.clone();
  }

  boundingRectangle(): GridRectangle2 {
    return new GridRectangle2(this.from, this.to);
  }

  cells(): GridCell2[] {
    return bresenhamLine(this);
  }

  contains(cell: GridCell2): boolean {
    return this.toCellCollection().has(cell);
  }

  toCellCollection(): GridCell2Collection {
    return new GridCell2Collection(this.cells());
  }

  clone(): GridLine2 {
    return new GridLine2(this.from, this.to);
  }

  toJson(): GridLine2Json {
    return { type: GridLine2.type, from: this.from.toJson(), to: this.to.toJson() };
  }

  static cellsFromLines(...lines: GridLine2[]): GridCell2Collection {
    return GridCell2Collection.union(...lines.map((line) => line.toCellCollection()));
  }
}

export type GridLine2Json = {
  type: typeof GridLine2.type;
  from: GridCell2Json;
  to: GridCell2Json;
};
