/** Re-exports for material bake / SDF → GLSL pipeline. */
export {
  bakeMaterialTexture,
  disposeBakeContext,
  hashEdgeName,
  parseHexRgb,
  seamError,
  TEXTURE_SIZE,
  type BakeTileInput,
} from './bake';
export {
  buildBakeFragmentShader,
  compileSdfExpression,
  FULLSCREEN_VERT_GLSL,
  snapScreenAngle,
} from './sdf-to-glsl';
export {
  evalSdfNode,
  maxPeriodDelta,
  maxSeamDelta,
  toShade,
  type Vec2,
} from './sdf-cpu';
export {
  seamlessnessReport,
  worstSeverity,
  type SeamIssue,
  type SeamSeverity,
  type SdfSlotKey,
  type TileSize,
} from './seamlessness';
export {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  OP_META,
  opsInCategory,
  thumbnailNode,
  type OpMeta,
  type ParamMeta,
  type SdfCategory,
  type SdfSlot,
} from './op-meta';
export {
  changeOp,
  changeOpAt,
  defaultNodeForOp,
  getNodeAt,
  listNodes,
  paramSummary,
  pathFromKey,
  pathKey,
  pathsEqual,
  replaceNodeAt,
  setParamAt,
  unwrapNodeAt,
  wrapNodeAt,
  type SdfPath,
  type TreeEntry,
} from './sdf-edit';
export {
  bakeInputFromTile,
  clearTextureCache,
  getBakedDataUrl,
  getBakedTexture,
  materialRecipeHash,
  setTextureRepeat,
  setTextureRepeatForTile,
  textureCacheKey,
} from './texture-cache';
