import type { Interval2 } from '../../bounds/interval2';
import { GridCell2, type GridCell2Json } from '../core/grid-cell2';
import { GridCell2Collection } from './grid-cell2-collection';
import { GridLine2 } from './grid-line2';
import { GridPolygon2 } from './grid-polygon2';

/** Axis-aligned grid rectangle defined by bottom-left and top-right cell indices. */
export class GridRectangle2 {
  static readonly type = 'GridRectangle2' as const;

  readonly bottomLeft: GridCell2;
  readonly topRight: GridCell2;

  constructor(bottomLeft: GridCell2, topRight: GridCell2) {
    [this.bottomLeft, this.topRight] = GridRectangle2.validateValues(bottomLeft, topRight);
  }

  cells(): GridCell2[] {
    const cells: GridCell2[] = [];
    for (let i = this.bottomLeft.i; i <= this.topRight.i; i++) {
      for (let j = this.bottomLeft.j; j <= this.topRight.j; j++) {
        cells.push(new GridCell2(i, j));
      }
    }
    return cells;
  }

  outlineCellCollection(): GridCell2Collection {
    return GridLine2.cellsFromLines(...this.edges());
  }

  bounds(): GridRectangle2 {
    return this.clone();
  }

  contains(cell: GridCell2): boolean {
    return (
      cell.i >= this.bottomLeft.i &&
      cell.i <= this.topRight.i &&
      cell.j >= this.bottomLeft.j &&
      cell.j <= this.topRight.j
    );
  }

  /** Inclusive cell count along the column axis. */
  columnCount(): number {
    return this.topRight.i - this.bottomLeft.i + 1;
  }

  /** Inclusive cell count along the row axis. */
  rowCount(): number {
    return this.topRight.j - this.bottomLeft.j + 1;
  }

  corners(): [GridCell2, GridCell2, GridCell2, GridCell2] {
    return [
      this.bottomLeft.clone(),
      new GridCell2(this.topRight.i, this.bottomLeft.j),
      this.topRight.clone(),
      new GridCell2(this.bottomLeft.i, this.topRight.j),
    ];
  }

  gridPolygon(): GridPolygon2 {
    return new GridPolygon2(this.corners());
  }

  edges(): GridLine2[] {
    const [bottomLeft, bottomRight, topRight, topLeft] = this.corners();

    return [
      new GridLine2(bottomLeft, bottomRight),
      new GridLine2(bottomRight, topRight),
      new GridLine2(topRight, topLeft),
      new GridLine2(topLeft, bottomLeft),
    ];
  }

  toCellCollection(): GridCell2Collection {
    return new GridCell2Collection(this.cells());
  }

  clone(): GridRectangle2 {
    return new GridRectangle2(this.bottomLeft, this.topRight);
  }

  static fromAxisDomains(uDomain: Interval2, vDomain: Interval2): GridRectangle2 {
    return new GridRectangle2(new GridCell2(uDomain.min, vDomain.min), new GridCell2(uDomain.max, vDomain.max));
  }

  static validateValues(bottomLeft: GridCell2, topRight: GridCell2): [GridCell2, GridCell2] {
    return [
      new GridCell2(Math.min(bottomLeft.i, topRight.i), Math.min(bottomLeft.j, topRight.j)),
      new GridCell2(Math.max(bottomLeft.i, topRight.i), Math.max(bottomLeft.j, topRight.j)),
    ];
  }

  static fromVertices(vertices: readonly GridCell2[]): GridRectangle2 {
    const bottomLeft = new GridCell2(Math.min(...vertices.map((v) => v.i)), Math.min(...vertices.map((v) => v.j)));
    const topRight = new GridCell2(Math.max(...vertices.map((v) => v.i)), Math.max(...vertices.map((v) => v.j)));
    return new GridRectangle2(bottomLeft, topRight);
  }

  toJson(): GridRectangle2Json {
    return {
      type: GridRectangle2.type,
      bottomLeft: this.bottomLeft.toJson(),
      topRight: this.topRight.toJson(),
    };
  }
}

export type GridRectangle2Json = {
  type: typeof GridRectangle2.type;
  bottomLeft: GridCell2Json;
  topRight: GridCell2Json;
};
