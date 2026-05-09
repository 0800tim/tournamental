"use client";

import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import { useRendererStream, useMatch } from "@/lib/store";
import { Pitch } from "./Pitch";
import { Stadium } from "./Stadium";
import { Players } from "./Players";
import { Ball } from "./Ball";
import { CameraRig, type CameraMode } from "./CameraRig";
import { HUD } from "./HUD";
import { DebugPanel } from "./DebugPanel";
import { OddsHUD } from "./OddsHUD";

export interface MatchSceneProps {
  /** Stream URL or `synthetic` (default). */
  source?: string;
  /** Match id passed in via the route — informational only at this layer. */
  matchId?: string;
}

/**
 * Top-level renderer mount. Owns:
 *   - The Zustand match store (via useRendererStream).
 *   - The R3F Canvas + scene contents.
 *   - The 2D HUD overlay (DOM, not WebGL).
 *   - The camera-mode toggle UI.
 *
 * Everything React-render-driven (HUD score / clock) reads via useMatch.
 * Everything 60fps-driven (player positions, ball) reads from the store
 * inside useFrame to avoid React re-renders on every state frame.
 */
export function MatchScene({ source, matchId }: MatchSceneProps) {
  const store = useRendererStream(source);
  const init = useMatch(store, (s) => s.init);
  const [mode, setMode] = useState<CameraMode>("broadcast");

  return (
    <div className="match-scene">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 25, 60], fov: 45 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <color attach="background" args={["#0c1722"]} />
        <fog attach="fog" args={["#0c1722", 80, 220]} />

        <hemisphereLight args={["#9fc4ff", "#1a2230", 0.6]} />
        <directionalLight
          position={[40, 60, 20]}
          intensity={1.1}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />

        <CameraRig store={store} mode={mode} />
        <Pitch />
        <Stadium />
        <ContactShadows position={[0, 0.01, 0]} opacity={0.45} blur={2.4} far={50} />

        {init ? <Players store={store} /> : null}
        {init ? <Ball store={store} /> : null}
      </Canvas>

      <HUD store={store} />
      <OddsHUD store={store} />
      <DebugPanel store={store} matchId={matchId} mode={mode} />

      <div className="camera-toggle">
        <button
          type="button"
          className={mode === "broadcast" ? "active" : ""}
          onClick={() => setMode("broadcast")}
        >
          Broadcast
        </button>
        <button
          type="button"
          className={mode === "tactical" ? "active" : ""}
          onClick={() => setMode("tactical")}
        >
          Top-down
        </button>
        <button
          type="button"
          className={mode === "follow" ? "active" : ""}
          onClick={() => setMode("follow")}
        >
          Follow ball
        </button>
      </div>
    </div>
  );
}
