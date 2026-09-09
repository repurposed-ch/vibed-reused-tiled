import { Aabb2 } from '../../bounds/aabb2';
import { Vec2 } from '../../core/vec2';
import { Epsilon } from '../../core/epsilon';
import { GridCell2 } from './grid-cell2';
import { Frame2 } from '../../core/frame2';
import type { Mat3 } from '../../core/mat3';
import { Axis, type AxisJson } from './grid-axis';
import { GridRectangle2 } from '../regions/grid-rectangle2';

export type { AxisJson, AxisKind } from './grid-axis';
export { Axis } from './grid-axis';

/** Which axes carry an index domain. */
export type Grid2Constraint = 'unconstrained' | 'u' | 'v' | 'both';

export type Grid2Options = {
  u?: Axis;
  v?: Axis;
  epsilon?: Epsilon;
  frame?: Frame2;
};

/** Rectilinear grid: U/V axes in local space, posed in the world via `frame`. */
export class Grid2 {
  static readonly type = 'Grid2' as const;

  static readonly minIndex = Axis.limits.min;
  static readonly maxIndex = Axis.limits.max;

  u: Axis;
  v: Axis;
  epsilon: Epsilon;
  frame: Frame2;

  constructor(options: Grid2Options = {}) {
    this.u = options.u ?? Axis.unit();
    this.v = options.v ?? Axis.unit();
    this.epsilon = options.epsilon ?? Epsilon.preferIn;
    this.epsilon.isPositive(Grid2.type, 'constructor');
    this.frame = options.frame ?? Frame2.worldXY();
  }

  /** Unit U and V axes (interval length 1). */
  static unit(options: Omit<Grid2Options, 'u' | 'v'> = {}): Grid2 {
    return new Grid2({ ...options, u: Axis.unit(), v: Axis.unit() });
  }

  /** Uniform U/V with the given interval lengths. */
  static uniform(uSize: number, vSize: number, options: Omit<Grid2Options, 'u' | 'v'> = {}): Grid2 {
    return new Grid2({ ...options, u: Axis.uniform(uSize), v: Axis.uniform(vSize) });
  }

  columnWidth(i: number): number {
    return this.u.size(i);
  }

  rowHeight(j: number): number {
    return this.v.size(j);
  }

  /** Override the width of column `i`. Promotes U to a custom axis when needed. */
  setCustomWidth(i: number, width: number): this {
    this.u.setSize(i, width, this.epsilon);
    return this;
  }

  /** Override the height of row `j`. Promotes V to a custom axis when needed. */
  setCustomHeight(j: number, height: number): this {
    this.v.setSize(j, height, this.epsilon);
    return this;
  }

  /** Local x of the left edge of column `i`. */
  cellX(i: number): number {
    return this.u.edge(i);
  }

  /** Local y of the bottom edge of row `j`. */
  cellY(j: number): number {
    return this.v.edge(j);
  }

  cellLocalBottomLeft(cell: GridCell2): Vec2 {
    return new Vec2(this.cellX(cell.i), this.cellY(cell.j));
  }

  cellDimensions(cell: GridCell2): Vec2 {
    return new Vec2(this.columnWidth(cell.i), this.rowHeight(cell.j));
  }

  cellLocalAabb(cell: GridCell2): Aabb2 {
    const min = this.cellLocalBottomLeft(cell);
    const size = this.cellDimensions(cell);
    return Aabb2.fromMinMax(min, min.add(size));
  }

  cellLocalCenter(cell: GridCell2): Vec2 {
    return this.cellLocalAabb(cell).center();
  }

  /** Frame-transformed cell corners (world space). Prefer this over {@link cellWorldRect} for rendering. */
  cellWorldCorners(cell: GridCell2): Vec2[] {
    const local = this.cellLocalAabb(cell);
    return [
      this.frame.toWorld(local.min()),
      this.frame.toWorld(new Vec2(local.max().x, local.min().y)),
      this.frame.toWorld(local.max()),
      this.frame.toWorld(new Vec2(local.min().x, local.max().y)),
    ];
  }

  /** Axis-aligned envelope of the frame-transformed cell. */
  cellWorldRect(cell: GridCell2): Aabb2 {
    return Aabb2.fromPoints(...this.cellWorldCorners(cell));
  }

  cellWorldCenter(cell: GridCell2): Vec2 {
    return this.frame.toWorld(this.cellLocalCenter(cell));
  }

  /** Map a grid-local point to its cell. Works for negative indices (coords left/below the origin). */
  localToCell(point: Vec2): GridCell2 | null {
    const i = this.u.indexAt(point.x);
    const j = this.v.indexAt(point.y);

    if (i === null || j === null) {
      return null;
    }

    return new GridCell2(i, j);
  }

  worldToCell(point: Vec2): GridCell2 | null {
    return this.localToCell(this.frame.toLocal(point));
  }

  /** True when every U and V interval has length 1. */
  isUnit(): boolean {
    return this.u.isUnit() && this.v.isUnit();
  }

  /** Which axes expose an index domain. */
  constraint(): Grid2Constraint {
    const u = this.u.isConstrained();
    const v = this.v.isConstrained();
    if (u && v) return 'both';
    if (u) return 'u';
    if (v) return 'v';
    return 'unconstrained';
  }

  isConstrained(): boolean {
    return this.constraint() !== 'unconstrained';
  }

  constraintRegion(): GridRectangle2 | null {
    if (this.constraint() === 'unconstrained') {
      return GridRectangle2.fromAxisDomains(this.u.domain()!, this.v.domain()!);
    }
    return null;
  }

  transform(matrix: Mat3): Grid2 {
    const newGrid = this.clone();
    newGrid.frame = this.frame.transform(matrix);
    return newGrid;
  }

  clone(): Grid2 {
    return new Grid2({
      u: this.u.clone(),
      v: this.v.clone(),
      epsilon: this.epsilon,
      frame: this.frame.clone(),
    });
  }

  toJson(): Grid2Json {
    return {
      type: Grid2.type,
      u: this.u.toJson(),
      v: this.v.toJson(),
    };
  }
}

export type Grid2Json = {
  type: typeof Grid2.type;
  u: AxisJson;
  v: AxisJson;
};
