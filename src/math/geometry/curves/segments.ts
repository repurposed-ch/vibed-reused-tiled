import { Vec2 } from '../../core/vec2';
import { Line2 } from '../primitives/line2';

export function segmentsFromVertices(vertices: readonly Vec2[], closed = false): Line2[] {
  const segments: Line2[] = [];
  const count = closed ? vertices.length : vertices.length - 1;

  for (let i = 0; i < count; i++) {
    segments.push(new Line2(vertices[i]!, vertices[(i + 1) % vertices.length]!));
  }

  return segments;
}
