import { z } from 'zod';
import { TileColorJsonSchema, type TileColorJson } from './tile';

/**
 * How the grout between tiles looks.
 *
 * The joint's WIDTH is not here: it is a tiling parameter and lives on the tile grid
 * (`TileGrid.joint`), where it sets the cell pitch. This is the appearance only — which is
 * why it sits at the project level, so every layout draws grout, including one solved from a
 * design family with no tile schema at all.
 */

export const GROUT_MATERIAL_ID = 'material-grout';
export const DEFAULT_JOINT_DEPTH = 0.0015;
export const MAX_JOINT_DEPTH = 0.02;
export const DEFAULT_JOINT_COLOR: TileColorJson = { mode: 'brightness', color: '#b8b0a3' };

export const ProjectJointJsonSchema = z.object({
  /** References `TilingProjectJson.materials[].id`. */
  materialId: z.string().min(1),
  color: TileColorJsonSchema,
  /** How far the grout surface sits below the tile top, in metres. */
  depth: z.number().min(0).max(MAX_JOINT_DEPTH).default(DEFAULT_JOINT_DEPTH),
});

export type ProjectJointJson = z.infer<typeof ProjectJointJsonSchema>;

export function defaultJoint(): ProjectJointJson {
  return {
    materialId: GROUT_MATERIAL_ID,
    color: { ...DEFAULT_JOINT_COLOR },
    depth: DEFAULT_JOINT_DEPTH,
  };
}
