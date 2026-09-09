import { GridCell2Collection } from './grid-cell2-collection';
import { GridCell2, type GridCell2Json } from '../core/grid-cell2';
import { GridLine2 } from './grid-line2';
import { GridRectangle2 } from './grid-rectangle2';

/** Closed polyline through grid cell indices with interior fill. */
export class GridPolygon2 {
  static readonly type = 'GridPolygon2' as const;

  readonly vertices: readonly GridCell2[];

  constructor(vertices: GridCell2[]) {
    if (vertices.length < 3) {
      throw new Error('GridPolygon2 requires at least three vertices');
    }

    this.vertices = vertices.map((v) => v.clone());
  }

  edges(): GridLine2[] {
    const edges: GridLine2[] = [];
    for (let i = 0; i < this.vertices.length; i++) {
      edges.push(new GridLine2(this.vertices[i]!, this.vertices[(i + 1) % this.vertices.length]!));
    }
    return edges;
  }

  boundingRectangle(): GridRectangle2 {
    return GridRectangle2.fromVertices(this.vertices);
  }

  /** Even-odd point-in-polygon over vertex indices (cell centers as lattice points). */
  contains(cell: GridCell2): boolean {
    let inside = false;

    for (let edge = 0; edge < this.vertices.length; edge++) {
      const a = this.vertices[edge]!;
      const b = this.vertices[(edge + 1) % this.vertices.length]!;

      const intersects = a.j > cell.j !== b.j > cell.j && cell.i < ((b.i - a.i) * (cell.j - a.j)) / (b.j - a.j) + a.i;

      if (intersects) {
        inside = !inside;
      }
    }

    return inside;
  }

  innerCells(): GridCell2Collection {
    return this.boundingRectangle()
      .toCellCollection()
      .filter((cell) => this.contains(cell));
  }

  outlineCells(): GridCell2Collection {
    return GridLine2.cellsFromLines(...this.edges());
  }

  /** Edge cells plus interior fill via scanline. */
  toCellCollection(): GridCell2Collection {
    return GridCell2Collection.union(this.outlineCells(), this.innerCells());
  }

  outlineCellCollection(): GridCell2Collection {
    return this.outlineCells();
  }

  clone(): GridPolygon2 {
    return new GridPolygon2([...this.vertices]);
  }

  toJson(): GridPolygon2Json {
    return { type: GridPolygon2.type, vertices: this.vertices.map((v) => v.toJson()) };
  }
}

export type GridPolygon2Json = {
  type: typeof GridPolygon2.type;
  vertices: GridCell2Json[];
};
