import { GridCell2Collection } from './grid-cell2-collection';
import { GridCell2, type GridCell2Json } from '../core/grid-cell2';
import { GridLine2 } from './grid-line2';
import { GridRectangle2 } from './grid-rectangle2';

/** Open polyline through grid cell indices. */
export class GridPolyline2 {
  static readonly type = 'GridPolyline2' as const;

  readonly vertices: readonly GridCell2[];

  constructor(vertices: GridCell2[]) {
    if (vertices.length < 2) {
      throw new Error('GridPolyline2 requires at least two vertices');
    }

    this.vertices = vertices.map((v) => v.clone());
  }

  segments(): GridLine2[] {
    const segments: GridLine2[] = [];
    for (let i = 0; i < this.vertices.length - 1; i++) {
      segments.push(new GridLine2(this.vertices[i]!, this.vertices[i + 1]!));
    }
    return segments;
  }

  boundingRectangle(): GridRectangle2 {
    return GridRectangle2.fromVertices(this.vertices);
  }

  toCellCollection(): GridCell2Collection {
    return GridLine2.cellsFromLines(...this.segments());
  }

  contains(cell: GridCell2): boolean {
    return this.toCellCollection().has(cell);
  }

  clone(): GridPolyline2 {
    return new GridPolyline2([...this.vertices]);
  }

  toJson(): GridPolyline2Json {
    return { type: GridPolyline2.type, vertices: this.vertices.map((v) => v.toJson()) };
  }
}

export type GridPolyline2Json = {
  type: typeof GridPolyline2.type;
  vertices: GridCell2Json[];
};
