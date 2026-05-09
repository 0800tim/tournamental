/**
 * @vtorn/avatar — procedural avatar pipeline for VTorn renderers.
 *
 * Public surface:
 *
 *  - `makeJerseyTexture` / `JerseyTextureCache` — runtime canvas-textured
 *    torso jerseys with team colours and player numbers.
 *  - `BillboardFace` / `deriveInitials` — camera-facing face quad with an
 *    initials-disc fallback.
 *  - `loadSharedBody` / `getBodyClone` / `applyJersey` / `applyKitColours`
 *    — shared low-poly humanoid GLB with per-clone skeleton and per-region
 *    materials (torso / shorts / socks / head_billboard).
 *  - `ANIMATION_FILES` / `loadAnimationClip` / `loadAnimationLibrary` —
 *    Mixamo-style animation manifest + loader.
 *
 * The package is renderer-host agnostic: it ships peer-deps for `three`,
 * `@react-three/fiber`, `@react-three/drei`, and `react`. Consumers
 * (`apps/web`) own the versions.
 */
export {
  makeJerseyTexture,
  jerseyCacheKey,
  JerseyTextureCache,
  type MakeJerseyTextureOptions,
} from "./jersey-texture.js";

export { BillboardFace, deriveInitials, type BillboardFaceProps } from "./billboard-face.js";

export {
  loadSharedBody,
  getBodyClone,
  applyJersey,
  applyKitColours,
  __resetBodyCache,
  type LoadBodyModelOptions,
  type ClonedBody,
  type BodyMaterials,
} from "./body-model.js";

export {
  ANIMATION_FILES,
  SHIPPED_ANIMATIONS,
  loadAnimationClip,
  loadAnimationLibrary,
  type LoadAnimationOptions,
} from "./animations.js";
