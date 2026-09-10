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
} from './sdf-to-glsl';
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
