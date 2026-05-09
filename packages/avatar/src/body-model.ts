/**
 * Shared body model loader.
 *
 * Per docs/07-avatars-and-assets.md the renderer reuses one humanoid GLB
 * for every player and differentiates by texture + animation. We load the
 * shared GLB exactly once (the buffer is cached in module scope), then
 * hand each caller a `clone()` they can mutate independently.
 *
 * `clone()` uses three.js's `SkeletonUtils.clone` so skinned meshes share
 * geometry/materials but get an independent skeleton — required for
 * per-player animation playback.
 */
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

const DEFAULT_BODY_URL = "/models/body.glb";

export interface LoadBodyModelOptions {
  /** URL of the shared body GLB. Defaults to `/models/body.glb`. */
  url?: string;
  /** Inject a custom loader (tests / mocked R3F environments). */
  loader?: GLTFLoader;
}

export interface BodyMaterials {
  torso: THREE.Material;
  shorts: THREE.Material;
  socks: THREE.Material;
  /** Slot for the billboard face quad — caller usually swaps this for a sprite. */
  head_billboard: THREE.Material;
}

export interface ClonedBody {
  /** The cloned scene root, ready to add to an R3F group. */
  scene: THREE.Object3D;
  /** Discovered animation clips bundled with the body GLB (usually empty). */
  animations: THREE.AnimationClip[];
  /** Material slots, looked up by sub-mesh name. Mutate `.color`/`.map` etc. */
  materials: Partial<BodyMaterials>;
  /** Sub-meshes by region, looked up by name. */
  meshes: Partial<Record<keyof BodyMaterials, THREE.Mesh>>;
}

let sharedBodyPromise: Promise<GLTF> | null = null;
let sharedBodyUrl: string | null = null;

/**
 * Load (or return the cached) shared body GLB. Subsequent calls hit the
 * shared promise — the GPU buffer is uploaded once.
 */
export function loadSharedBody(options: LoadBodyModelOptions = {}): Promise<GLTF> {
  const url = options.url ?? DEFAULT_BODY_URL;
  if (sharedBodyPromise && sharedBodyUrl === url) return sharedBodyPromise;
  if (sharedBodyPromise && sharedBodyUrl !== url) {
    // URL changed — drop the old cache; rare, mostly for tests.
    sharedBodyPromise = null;
  }
  sharedBodyUrl = url;
  const loader = options.loader ?? new GLTFLoader();
  sharedBodyPromise = new Promise<GLTF>((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
  return sharedBodyPromise;
}

/** Reset the module-level cache. Test-only. */
export function __resetBodyCache(): void {
  sharedBodyPromise = null;
  sharedBodyUrl = null;
}

const REGION_NAMES: Array<keyof BodyMaterials> = ["torso", "shorts", "socks", "head_billboard"];

/** Walk a cloned scene and pull out the named region meshes / materials. */
function indexRegions(root: THREE.Object3D): {
  meshes: Partial<Record<keyof BodyMaterials, THREE.Mesh>>;
  materials: Partial<BodyMaterials>;
} {
  const meshes: Partial<Record<keyof BodyMaterials, THREE.Mesh>> = {};
  const materials: Partial<BodyMaterials> = {};
  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const name = obj.name;
    if ((REGION_NAMES as string[]).includes(name)) {
      const region = name as keyof BodyMaterials;
      const mesh = obj as THREE.Mesh;
      meshes[region] = mesh;
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (mat) materials[region] = mat;
    }
  });
  return { meshes, materials };
}

/**
 * Return an independent `ClonedBody` ready to drop into the scene. The
 * underlying geometry/material instances are shared across clones, but
 * the skeleton is independent so each player can run its own animation.
 */
export async function getBodyClone(options: LoadBodyModelOptions = {}): Promise<ClonedBody> {
  const gltf = await loadSharedBody(options);
  const scene = cloneSkinned(gltf.scene);
  const { meshes, materials } = indexRegions(scene);
  return {
    scene,
    animations: gltf.animations ?? [],
    meshes,
    materials,
  };
}

/**
 * Convenience: paint the torso material with a freshly built jersey
 * texture. Mutates `body.materials.torso` in place if it's a
 * `MeshStandardMaterial` / `MeshBasicMaterial` (the only materials our
 * authored body GLB uses). No-op if the torso slot is missing.
 */
export function applyJersey(body: ClonedBody, texture: THREE.Texture): void {
  const mat = body.materials.torso as
    | THREE.MeshStandardMaterial
    | THREE.MeshBasicMaterial
    | undefined;
  if (!mat) return;
  // Each clone needs its own material so per-player jerseys don't clobber.
  const cloned = mat.clone();
  cloned.map = texture;
  cloned.needsUpdate = true;
  const torso = body.meshes.torso;
  if (torso) torso.material = cloned;
  body.materials.torso = cloned;
}

/**
 * Convenience: paint shorts + socks with a flat colour from the kit's
 * secondary, leaving `torso` for the jersey texture.
 */
export function applyKitColours(body: ClonedBody, primary: string, secondary: string): void {
  const colourise = (slot: keyof BodyMaterials, hex: string) => {
    const mat = body.materials[slot] as THREE.MeshStandardMaterial | undefined;
    if (!mat || !("color" in mat)) return;
    const cloned = mat.clone();
    cloned.color = new THREE.Color(hex);
    cloned.needsUpdate = true;
    const mesh = body.meshes[slot];
    if (mesh) mesh.material = cloned;
    body.materials[slot] = cloned;
  };
  colourise("shorts", secondary);
  colourise("socks", primary);
}
