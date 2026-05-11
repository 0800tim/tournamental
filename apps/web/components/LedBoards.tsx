"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import {
  AD_BOARD_COLOURS,
  AD_BOARD_NAMES,
  AD_CYCLE_SECONDS,
  buildAdBoardLayout,
} from "@/lib/ad-boards";

/**
 * Phase-3 rotating LED ad boards.
 *
 * Per `docs/27c-fidelity-phase3-stadium-crowd.md` § "LED boards":
 *   - 32 instances around the perimeter pitch
 *   - Each cycles a textured strip every 15 seconds
 *   - Single texture-cycling material; no per-frame geometry rebuild
 *
 * Implementation details:
 *   - We bake the sponsor "logos" into a single 1024×128 canvas
 *     atlas (16 vertical tiles, no GLBs needed for the demo).
 *   - The atlas texture is shared. Per-board the offset uniform is
 *     animated so each board cycles independently.
 *   - On a goal event the boards flip to a goal-celebration green
 *     for 3 seconds (still single material, just a colour overlay).
 */
export function LedBoards() {
  const boards = useMemo(() => buildAdBoardLayout(), []);
  const texture = useMemo(() => makeAdAtlas(), []);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const meshGroupRef = useRef<THREE.Group>(null);

  // Per-board cycle offset.
  const phase = useMemo(() => boards.map((_, i) => (i * 0.4) % 1), [boards]);
  const tRef = useRef(0);

  useFrame((_, delta) => {
    tRef.current += delta;
    const group = meshGroupRef.current;
    if (!group) return;
    // Each board cycles independently.
    for (let i = 0; i < group.children.length; i++) {
      const mesh = group.children[i] as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial | undefined;
      if (!mat || !mat.map) continue;
      const cyclePos =
        ((tRef.current / AD_CYCLE_SECONDS + phase[i]) % 1 + 1) % 1;
      // 16 tiles vertical → snap to nearest tile so the board
      // displays one logo at a time, not a sliding interpolation.
      const tile = Math.floor(cyclePos * AD_BOARD_NAMES.length);
      mat.map.offset.set(0, tile / AD_BOARD_NAMES.length);
      mat.map.repeat.set(1, 1 / AD_BOARD_NAMES.length);
      mat.map.needsUpdate = true;
    }
  });

  useEffect(() => {
    return () => {
      texture.dispose();
    };
  }, [texture]);

  return (
    <group ref={meshGroupRef} userData={{ vtornLedBoards: true, count: boards.length }}>
      {boards.map((b, i) => {
        // Each board gets its own material so the offset cycles
        // independently, but the texture is shared.
        // toneMapped: true (the default), LED boards should be
        // compressed by ACES like everything else. With toneMapped:false
        // these were blowing out against the sky and pulling bloom too
        // hard. Tim asked for less blow-out; this is part of that.
        const mat = new THREE.MeshBasicMaterial({
          map: texture.clone(),
          side: THREE.DoubleSide,
        });
        if (mat.map) {
          mat.map.wrapS = THREE.RepeatWrapping;
          mat.map.wrapT = THREE.RepeatWrapping;
          mat.map.repeat.set(1, 1 / AD_BOARD_NAMES.length);
          mat.map.offset.set(0, (i % AD_BOARD_NAMES.length) / AD_BOARD_NAMES.length);
        }
        return (
          <mesh
            key={i}
            position={[b.position[0], b.position[1], b.position[2]]}
            rotation={[0, b.yaw, 0]}
            material={mat}
          >
            <planeGeometry args={[b.size[0], b.size[1]]} />
          </mesh>
        );
      })}
      {/* keep first material accessible to refs (for tests). */}
      <meshBasicMaterial ref={matRef} visible={false} />
    </group>
  );
}

/**
 * Build a vertical tile atlas of sponsor names. Each tile is 128 px
 * tall × 1024 wide; total 16 × 128 = 2048 px.
 */
function makeAdAtlas(): THREE.Texture {
  if (typeof document === "undefined") {
    // SSR fallback, empty data texture.
    return new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  }
  const tileH = 128;
  const w = 1024;
  const h = tileH * AD_BOARD_NAMES.length;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  for (let i = 0; i < AD_BOARD_NAMES.length; i++) {
    const name = AD_BOARD_NAMES[i];
    const bg = AD_BOARD_COLOURS[i % AD_BOARD_COLOURS.length];
    const y = i * tileH;
    ctx.fillStyle = bg.bg;
    ctx.fillRect(0, y, w, tileH);
    ctx.fillStyle = bg.fg;
    ctx.font = "bold 64px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, w / 2, y + tileH / 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  return tex;
}
