"use client";

import { useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { ContactShadows, Sky } from "@react-three/drei";
import { useRendererStream, useMatch } from "@/lib/store";
import { FaceProvider } from "@/lib/face-context";
import { Pitch } from "./Pitch";
import { Stadium } from "./Stadium";
import { Players } from "./Players";
import { Ball } from "./Ball";
import { CameraRig, type CameraMode } from "./CameraRig";
import { Director } from "./Director";
import { HUD } from "./HUD";
import { MatchStatsHUD } from "./MatchStatsHUD";
import { ReplayHUD } from "./ReplayHUD";
import { DebugPanel } from "./DebugPanel";
import { OddsHUD } from "./OddsHUD";
import { TimelineScrubber } from "./TimelineScrubber";
import { PerfMonitor } from "./PerfMonitor";
import { PostFX } from "./PostFX";
import { CommentaryAudio } from "./CommentaryAudio";
import { resolveCurrentQuality } from "@/lib/quality";
import { useStateFrameBuffer } from "@/lib/replay/use-state-frame-buffer";
import { StateFrameBufferProvider } from "@/lib/replay/buffer-context";

export interface MatchSceneProps {
  /** Stream URL or `synthetic` (default). */
  source?: string;
  /** Match id passed in via the route — informational only at this layer. */
  matchId?: string;
}

/**
 * Top-level renderer mount.
 *
 * Phase-3 additions:
 *   - Resolves the URL `?quality=` + `?fx=off` flags into a
 *     `QualityProfile` once on mount; passes it to `<PostFX />`.
 *   - Mounts `<Stadium />` (now with tiered seating + crowd + LED
 *     boards), `<PostFX />` (effect composer), `<CommentaryAudio />`
 *     (mixer + ducking) inside the Canvas.
 *
 * Owns: the Zustand match store + (in manifest mode) the playback
 * controller; the R3F Canvas + scene contents; the 2D HUD overlay
 * (DOM, not WebGL); the camera-mode toggle UI + (in manifest mode)
 * the timeline scrubber.
 *
 * Lighting rig: hemisphere (sky/ground) + directional (sun) with PCF
 * soft shadows enabled at the renderer level. Shadow-map size now
 * scales with the quality profile (1024 / 2048 / 4096).
 *
 * Everything React-render-driven (HUD score / clock) reads via
 * useMatch. Everything 60fps-driven reads from the store inside
 * useFrame to avoid React re-renders on every state frame.
 */
export function MatchScene({ source, matchId }: MatchSceneProps) {
  const { store, controller } = useRendererStream(source);
  const init = useMatch(store, (s) => s.init);
  // Default to "director" — Phase 2 ships the auto-director on by
  // default. Manual modes (broadcast / tactical / follow) remain
  // available via the toggle. The CameraRig no-ops while
  // `director` is selected so the two systems don't fight.
  const [mode, setMode] = useState<CameraMode>("director");
  const directorEnabled = mode === "director";
  // Resolve quality once at mount. We don't react to URL changes mid-
  // session; the player must reload to switch presets (a sensible
  // tradeoff vs. tearing down + rebuilding the post-FX stack live).
  const profile = useMemo(() => resolveCurrentQuality(), []);
  const shadowMapSize = profile.shadowMapSize;
  // Single shared StateFrameBuffer for all renderer subscribers
  // (Player, Ball, Director, CameraRig). Match-time-aware interp
  // smooths burst-batched sources like the synthetic AR-FR producer.
  const sceneBuffer = useStateFrameBuffer(store);
  // Mobile-aware DPR cap. PostFX path renders at backbuffer resolution
  // anyway, but capping DPR keeps us under the fillrate budget on
  // mid-range Android.
  const dprMax =
    profile.preset === "low" ? 1.0 : profile.preset === "high" ? 1.75 : 1.5;

  return (
    <FaceProvider>
      <div className="match-scene" data-quality={profile.preset ?? "off"}>
        <Canvas
          shadows="soft"
          dpr={[1, dprMax]}
          camera={{ position: [0, 25, 60], fov: 45 }}
          gl={{
            antialias: profile.preset !== "low",
            powerPreference: "high-performance",
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 0.85,
            outputColorSpace: THREE.SRGBColorSpace,
          }}
          onCreated={({ gl }) => {
            gl.shadowMap.type = THREE.PCFSoftShadowMap;
            // Defensive: a few R3F versions don't honour `gl.toneMapping`
            // when passed through the prop, so re-assert here. Exposure
            // 0.85 is the single biggest fix for Tim's blown-out roof —
            // it compresses the highlights so the upper deck reads at
            // ~30% brightness instead of pure white.
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 0.85;
            gl.outputColorSpace = THREE.SRGBColorSpace;
          }}
        >
          <StateFrameBufferProvider buffer={sceneBuffer}>
            {/* Procedural sky — softened so the upper stadium silhouette
             *  doesn't blow out against pure white. Higher turbidity
             *  pushes more scattering haze in front of the sun, and
             *  pulling rayleigh down avoids the deep-blue saturation
             *  that makes the dark stand below read as crushed maroon. */}
            <Sky
              distance={4500}
              sunPosition={[40, 60, 20]}
              inclination={0.49}
              azimuth={0.25}
              mieCoefficient={0.004}
              mieDirectionalG={0.78}
              rayleigh={1.6}
              turbidity={10}
            />
            <fog attach="fog" args={["#aab6c4", 90, 280]} />

            {/* Lighting rig: ambient + hemisphere + sun. Total intensity
             *  budget ≤ 2.5 so the scene reads at mid-grey instead of
             *  blown-out white (Tim's three screenshots showed the upper
             *  deck pinned to 1.0). Previously the rig was 0 + 0.55 + 1.4
             *  = 1.95 with NO ambient fill, which is why the pitch
             *  crushed dark under the directional shadow. */}
            <ambientLight intensity={0.55} color="#ffffff" />
            <hemisphereLight args={["#bcd1ff", "#3a4d2a", 0.45]} />
            <directionalLight
              position={[40, 60, 30]}
              intensity={1.05}
              castShadow
              shadow-mapSize={[shadowMapSize, shadowMapSize]}
              shadow-camera-near={1}
              shadow-camera-far={220}
              shadow-camera-left={-90}
              shadow-camera-right={90}
              shadow-camera-top={70}
              shadow-camera-bottom={-70}
              shadow-bias={-0.0005}
            />

            {directorEnabled ? null : <CameraRig store={store} mode={mode} />}
            <Director store={store} enabled={directorEnabled} />
            <Pitch />
            <Stadium />
            <ContactShadows position={[0, 0.01, 0]} opacity={0.35} blur={2.4} far={50} />

            {init ? <Players store={store} /> : null}
            {init ? <Ball store={store} /> : null}
            <PerfMonitor />
            <CommentaryAudio />
            {profile.fxOff ? null : <PostFX profile={profile} />}
          </StateFrameBufferProvider>
        </Canvas>

        <HUD store={store} />
        <MatchStatsHUD store={store} />
        <ReplayHUD />
        <OddsHUD store={store} />
        <DebugPanel store={store} matchId={matchId} mode={mode} />

        <div className="camera-toggle">
          <button
            type="button"
            className={mode === "director" ? "active" : ""}
            onClick={() => setMode("director")}
            data-cam="director"
          >
            Director
          </button>
          <button
            type="button"
            className={mode === "broadcast" ? "active" : ""}
            onClick={() => setMode("broadcast")}
            data-cam="broadcast"
          >
            Broadcast
          </button>
          <button
            type="button"
            className={mode === "tactical" ? "active" : ""}
            onClick={() => setMode("tactical")}
            data-cam="tactical"
          >
            Top-down
          </button>
          <button
            type="button"
            className={mode === "follow" ? "active" : ""}
            onClick={() => setMode("follow")}
            data-cam="follow"
          >
            Follow ball
          </button>
        </div>

        {controller ? <TimelineScrubber controller={controller} /> : null}
      </div>
    </FaceProvider>
  );
}
