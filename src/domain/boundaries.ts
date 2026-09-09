import { z } from 'zod';

/** Math geometry blob — validated loosely; Deserialise handles typed parse later. */
export const MathGeometryJsonSchema = z
  .object({
    type: z.string().min(1),
  })
  .passthrough();

export const NamedGuideJsonSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  geometry: MathGeometryJsonSchema,
});

export const BoundaryConditionsJsonSchema = z.object({
  type: z.literal('BoundaryConditions'),
  outers: z.array(MathGeometryJsonSchema),
  holes: z.array(MathGeometryJsonSchema),
  guides: z.array(NamedGuideJsonSchema),
});

export type NamedGuideJson = z.infer<typeof NamedGuideJsonSchema>;
export type BoundaryConditionsJson = z.infer<typeof BoundaryConditionsJsonSchema>;

/** Default rectangular outer boundary in meters (Polygon2-compatible JSON). */
export function defaultBoundaries(): BoundaryConditionsJson {
  return {
    type: 'BoundaryConditions',
    outers: [
      {
        type: 'Polygon2',
        vertices: [
          { type: 'Vec2', x: 0, y: 0 },
          { type: 'Vec2', x: 4, y: 0 },
          { type: 'Vec2', x: 4, y: 3 },
          { type: 'Vec2', x: 0, y: 3 },
        ],
      },
    ],
    holes: [],
    guides: [
      {
        id: crypto.randomUUID(),
        name: 'baseline',
        geometry: {
          type: 'Line2',
          from: { type: 'Vec2', x: 0, y: 0 },
          to: { type: 'Vec2', x: 4, y: 0 },
        },
      },
    ],
  };
}
