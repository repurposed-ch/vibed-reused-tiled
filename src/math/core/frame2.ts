import { Mat3 } from './mat3';
import { Vec2, type Vec2Json } from './vec2';

/** Affine frame mapping grid-local coordinates to world XY. Independent of `Grid2`. */
export class Frame2 {
  static readonly type = 'Frame2' as const;

  origin: Vec2;
  xAxis: Vec2;
  yAxis: Vec2;

  constructor(origin: Vec2 = Vec2.origin(), xAxis: Vec2 = Vec2.baseX(), yAxis: Vec2 = Vec2.baseY()) {
    this.origin = origin.clone();
    this.xAxis = xAxis.clone();
    this.yAxis = yAxis.clone();
  }

  static worldXY(): Frame2 {
    return new Frame2(Vec2.origin(), Vec2.baseX(), Vec2.baseY());
  }

  transform(matrix: Mat3): Frame2 {
    const newOrigin = this.origin.transform(matrix);
    const newXAxis = this.xAxis.transform(matrix).subtract(newOrigin);
    const newYAxis = this.yAxis.transform(matrix).subtract(newOrigin);
    return new Frame2(newOrigin, newXAxis, newYAxis);
  }

  toWorld(local: Vec2): Vec2 {
    return this.origin.add(this.xAxis.scale(local.x)).add(this.yAxis.scale(local.y));
  }

  toLocal(world: Vec2): Vec2 {
    const relative = world.subtract(this.origin);
    const det = this.xAxis.x * this.yAxis.y - this.xAxis.y * this.yAxis.x;

    if (Math.abs(det) < 1e-12) {
      throw new Error('Frame2 axes are degenerate');
    }

    const invDet = 1 / det;
    const localX = (relative.x * this.yAxis.y - relative.y * this.yAxis.x) * invDet;
    const localY = (this.xAxis.x * relative.y - this.xAxis.y * relative.x) * invDet;
    return new Vec2(localX, localY);
  }

  toMat3(): Mat3 {
    return new Mat3(this.xAxis.x, this.yAxis.x, this.origin.x, this.xAxis.y, this.yAxis.y, this.origin.y, 0, 0, 1);
  }

  clone(): Frame2 {
    return new Frame2(this.origin, this.xAxis, this.yAxis);
  }

  toJson(): Frame2Json {
    return {
      type: Frame2.type,
      origin: this.origin.toJson(),
      xAxis: this.xAxis.toJson(),
      yAxis: this.yAxis.toJson(),
    };
  }
}

export type Frame2Json = {
  type: typeof Frame2.type;
  origin: Vec2Json;
  xAxis: Vec2Json;
  yAxis: Vec2Json;
};
