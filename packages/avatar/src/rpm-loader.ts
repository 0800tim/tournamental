/**
 * Ready Player Me-style avatar GLB loader + cache.
 *
 * docs/27a-fidelity-phase1-mocap-rig.md describes a one-time bake step
 * that POSTs each player's photo to Ready Player Me and writes the
 * returned GLB to `apps/web/public/assets/avatars/<player-id>.glb`.
 *
 * Sandbox note: RPM requires an Adobe-style auth flow that's awkward to
 * automate in OSS CI. Phase 1 ships with the shared CC0 body GLB as the
 * default avatar source for every player and only uses per-player paths
 * if the file actually exists. The hook surface is here so a future
 * agent can plug in the RPM API without touching `Player.tsx`.
 *
 * Usage:
 *
 * ```ts
 * const provider = new RpmAvatarProvider({
 *   resolveUrl: (id) => `/assets/avatars/${id}.glb`,
 *   fallbackUrl: "/models/body.glb",
 * });
 * const cloned = await provider.getClone(player.id);
 * scene.add(cloned.scene);
 * ```
 *
 * The loader memoises the *shared* GLTF per URL (so the GPU buffer
 * uploads once even with 22 players) and hands out independent skeleton
 * clones via `SkeletonUtils.clone`.
 */
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

export interface RpmAvatarProviderOptions {
  /**
   * Map a stable player id → avatar GLB URL. Return `null` to fall back
   * to the shared body. Defaults to always-fallback.
   */
  resolveUrl?: (playerId: string) => string | null;
  /** Shared body GLB URL used when `resolveUrl` returns null. */
  fallbackUrl?: string;
  /** Override the GLTF loader (tests, mock R3F environments). */
  loader?: GLTFLoader;
}

export interface ClonedRpmAvatar {
  /** The cloned scene root, ready to add to an R3F group. */
  scene: THREE.Object3D;
  /** Skeleton root (typically `mixamorigHips`). */
  skeletonRoot: THREE.Object3D | null;
  /** Animation clips bundled with the GLB (usually empty for RPM). */
  animations: THREE.AnimationClip[];
  /** The URL the avatar was loaded from. */
  url: string;
  /** True if this is the shared fallback body, not a per-player avatar. */
  isFallback: boolean;
}

const DEFAULT_FALLBACK_URL = "/models/body.glb";

/**
 * Per-URL cache for the underlying GLTF buffer. Module-level so all
 * <Player> components share it.
 */
const sharedCache = new Map<string, Promise<GLTF>>();

/** Reset the module cache. Test-only. */
export function __resetRpmCache(): void {
  sharedCache.clear();
}

export class RpmAvatarProvider {
  private readonly resolveUrl: (id: string) => string | null;
  private readonly fallbackUrl: string;
  private readonly loader: GLTFLoader;

  constructor(opts: RpmAvatarProviderOptions = {}) {
    this.resolveUrl = opts.resolveUrl ?? (() => null);
    this.fallbackUrl = opts.fallbackUrl ?? DEFAULT_FALLBACK_URL;
    this.loader = opts.loader ?? new GLTFLoader();
  }

  /** Get the URL we'd use for a player. Test-friendly; doesn't load. */
  urlFor(playerId: string): { url: string; isFallback: boolean } {
    const candidate = this.resolveUrl(playerId);
    if (candidate) return { url: candidate, isFallback: false };
    return { url: this.fallbackUrl, isFallback: true };
  }

  /** Load (or retrieve cached) GLTF for `url`. */
  private loadShared(url: string): Promise<GLTF> {
    const cached = sharedCache.get(url);
    if (cached) return cached;
    const promise = new Promise<GLTF>((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => resolve(gltf),
        undefined,
        (err) => reject(err),
      );
    }).catch((err) => {
      // Drop the failed promise so a retry can re-attempt.
      sharedCache.delete(url);
      throw err;
    });
    sharedCache.set(url, promise);
    return promise;
  }

  /** Return an independent clone for `playerId`. */
  async getClone(playerId: string): Promise<ClonedRpmAvatar> {
    const { url, isFallback } = this.urlFor(playerId);
    let gltf: GLTF;
    try {
      gltf = await this.loadShared(url);
    } catch {
      if (isFallback) throw new Error(`[rpm-loader] fallback ${url} failed to load`);
      // Per-player avatar missing — try the shared fallback.
      gltf = await this.loadShared(this.fallbackUrl);
    }
    const sceneClone = cloneSkinned(gltf.scene);
    let skeletonRoot: THREE.Object3D | null = null;
    sceneClone.traverse((obj) => {
      if (skeletonRoot) return;
      if (obj.name === "mixamorigHips" || obj.name === "Hips") skeletonRoot = obj;
    });
    return {
      scene: sceneClone,
      skeletonRoot,
      animations: gltf.animations ?? [],
      url,
      isFallback,
    };
  }

  /** Warm caches for a list of players in parallel. Safe to call eagerly. */
  async preload(playerIds: string[]): Promise<void> {
    const urls = new Set<string>([this.fallbackUrl]);
    for (const id of playerIds) {
      const { url } = this.urlFor(id);
      urls.add(url);
    }
    await Promise.allSettled(Array.from(urls).map((u) => this.loadShared(u)));
  }
}
