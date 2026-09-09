import type { Vec2 } from '../../core/vec2';

export class NGonMesh {
  constructor(
    public vertices: Vec2[],
    public faces: number[][],
  ) {}
}
