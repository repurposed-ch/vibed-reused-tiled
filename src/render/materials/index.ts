/** Re-exports for material bake / SDF → GLSL pipeline. */
export {
  bakeMaterialTexture,
  disposeBakeContext,
  seamError,
  TEXTURE_SIZE,
} from './bake';
export {
  buildBakeFragmentShader,
  compileSdfExpression,
  FULLSCREEN_VERT_GLSL,
} from './sdf-to-glsl';
export {
  clearTextureCache,
  getBakedDataUrl,
  getBakedTexture,
  materialRecipeHash,
  setTextureRepeat,
  textureCacheKey,
} from './texture-cache';
