"use client";

import { useState } from "react";
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
import { DebugPanel } from "./DebugPanel";
import { OddsHUD } from "./OddsHUD";
import { TimelineScrubber } from "./TimelineScrubber";
import { PerfMonitor } from "./PerfMonitor";

export interface MatchSceneProps {
  /** Stream URL or `synthetic` (default). */
  source?: string;
  /** Match id passed in via the route — informational only at this layer. */
  matchId?: string;
}

/**
 * Top-level renderer mount. Owns:
 *   - The Zustand match store + (in manifest mode) the playback controller.
 *   - The R3F Canvas + scene contents.
 *   - The 2D HUD overlay (DOM, not WebGL).
 *   - The camera-mode toggle UI + (in manifest mode) the timeline scrubber.
 *
 * Lighting rig: hemisphere (sky/ground) + directional (sun) with PCF soft
 * shadows enabled at the renderer level. Sky comes from drei's
 * procedural `<Sky/>`. Players + ball cast shadows; pitch receives.
 *
 * Everything React-render-driven (HUD score / clock) reads via useMatch.
 * Everything 60fps-driven reads from the store inside useFrame to avoid
 * React re-renders on every state frame.
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

  return (
    <FaceProvider>
      <div className="match-scene">
        <Canvas
          shadows="soft"
          dpr={[1, 2]}
          camera={{ position: [0, 25, 60], fov: 45 }}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          onCreated={({ gl }) => {
            gl.shadowMap.type = THREE.PCFSoftShadowMap;
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.05;
          }}
        >
          {/* Procedural sky — gives a lived-in horizon under the stadium ring. */}
          <Sky
            distance={4500}
            sunPosition={[40, 60, 20]}
            inclination={0.49}
            azimuth={0.25}
            mieCoefficient={0.005}
            mieDirectionalG={0.85}
            rayleigh={2.5}
            turbidity={6}
          />
          <fog attach="fog" args={["#cdd9e6", 110, 320]} />

          {/* Lighting rig: hemisphere + sun. */}
          <hemisphereLight args={["#cfe2ff", "#1a2230", 0.55]} />
          <directionalLight
            position={[40, 60, 20]}
            intensity={1.4}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-camera-near={1}
            shadow-camera-far={220}
            shadow-camera-left={-90}
            shadow-camera-right={90}
            shadow-camera-top={70}
            shadow-camera-bottom={-70}
            shadow-bias={-0.0001}
          />

          {directorEnabled ? null : <CameraRig store={store} mode={mode} />}
          <Director store={store} enabled={directorEnabled} />
          <Pitch />
          <Stadium />
          <ContactShadows position={[0, 0.01, 0]} opacity={0.35} blur={2.4} far={50} />

          {init ? <Players store={store} /> : null}
          {init ? <Ball store={store} /> : null}
          <PerfMonitor />
        </Canvas>

        <HUD store={store} />
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
