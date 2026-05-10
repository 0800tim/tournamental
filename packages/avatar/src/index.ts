/**
 * @vtorn/avatar — procedural avatar pipeline for Tournamental renderers.
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
 *  - `MIXAMO_PACK` / `loadMixamoPack` — Phase-1 Mixamo-style pack with
 *    automatic retargeting.
 *  - `RpmAvatarProvider` — Ready Player Me-style avatar GLB loader +
 *    per-player cache, with shared-body fallback.
 *  - `AvatarAnimationStateMachine` — per-player FSM driving an
 *    `AnimationMixer` with crossfade + phase-locked playback.
 *  - `phaseLockRate` / `meanFootSlide` — pure locomotion math.
 *  - `retargetClip` / `findCanonicalBone` / `CANONICAL_BONES` — bone-name
 *    retargeting helpers (Mixamo / RPM / raw → canonical).
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

export {
  AvatarAnimationStateMachine,
  STATE_TABLE,
  CLIP_NATURAL_SPEED_M_S,
  locomotionForSpeed,
  deriveNextState,
  eventToOneShot,
  type AvatarStateConfig,
  type AvatarStateKind,
  type AvatarFsmOptions,
} from "./animation-state-machine.js";

export {
  phaseLockRate,
  meanFootSlide,
  bestLocomotionForSpeed,
  type PhaseLockOptions,
} from "./locomotion.js";

export {
  CANONICAL_BONES,
  detectBoneStyle,
  toCanonicalBoneName,
  buildRetargetMap,
  retargetClip,
  findCanonicalBone,
  type BoneNamingStyle,
  type CanonicalBone,
} from "./retarget.js";

export {
  MIXAMO_PACK,
  PHASE1_TAGS,
  loadMixamoPack,
  packUrl,
  type MixamoClipDescriptor,
  type LoadMixamoPackOptions,
} from "./mixamo-pack.js";

export {
  RpmAvatarProvider,
  __resetRpmCache,
  type RpmAvatarProviderOptions,
  type ClonedRpmAvatar,
} from "./rpm-loader.js";

export {
  FootIK,
  locomotionStance,
  resolveLegBones,
  solveTwoBoneAngles,
  type FootIkOptions,
  type FootSide,
  type LegBones,
  type StanceHint,
} from "./foot-ik.js";

export {
  createFatigueState,
  tickFatigue,
  halfTimeBoost,
  addDirt,
  applySweatToMaterial,
  applyDirtToMaterial,
  fatigueShaderEnabled,
  shouldSuggestSubstitution,
  fatigueSubstitutionBias,
  createSweatUniforms,
  SWEAT_SHADER_FRAGMENT_CHUNK,
  type FatigueState,
  type FatigueOptions,
  type DirtRegion,
  type MaterialLike,
  type SweatUniforms,
} from "./sweat-shader.js";
