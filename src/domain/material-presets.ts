import { createMaterialDefinition, type MaterialDefinitionJson, type SdfNodeJson } from './material';

const terracottaSdf: SdfNodeJson = {
  op: 'mix',
  t: 0.55,
  a: { op: 'noise', scale: 6, octaves: 4 },
  b: {
    op: 'mul',
    a: { op: 'noise', scale: 18, octaves: 2 },
    b: { op: 'fill', soft: 0.02, child: { op: 'circle', radius: 0.08, center: [0.15, 0.2] } },
  },
};

const stoneSdf: SdfNodeJson = {
  op: 'mix',
  t: 0.45,
  a: { op: 'voronoi', scale: 5, edgeWidth: 0.08 },
  b: { op: 'noise', scale: 12, octaves: 3 },
};

const ceramicSdf: SdfNodeJson = {
  op: 'mix',
  t: 0.35,
  a: { op: 'noise', scale: 3, octaves: 2 },
  b: {
    op: 'band',
    width: 0.04,
    soft: 0.01,
    child: {
      op: 'brick',
      brickW: 0.15,
      brickH: 0.08,
      mortar: 0.012,
      offset: 0.5,
    },
  },
};

export function defaultMaterials(): MaterialDefinitionJson[] {
  return [
    createMaterialDefinition({
      id: 'material-terracotta',
      name: 'terracotta',
      seed: 11,
      periodMeters: 0.3,
      sdf: terracottaSdf,
    }),
    createMaterialDefinition({
      id: 'material-stone',
      name: 'stone',
      seed: 42,
      periodMeters: 0.4,
      sdf: stoneSdf,
    }),
    createMaterialDefinition({
      id: 'material-ceramic',
      name: 'ceramic',
      seed: 7,
      periodMeters: 0.3,
      sdf: ceramicSdf,
    }),
  ];
}

/** Pick or synthesize a material id for a legacy freeform material label. */
export function materialIdForLabel(
  label: string,
  materials: MaterialDefinitionJson[],
): string {
  const normalized = label.trim().toLowerCase();
  const found = materials.find((m) => m.name.toLowerCase() === normalized);
  if (found) return found.id;
  return materials[0]?.id ?? 'material-ceramic';
}
