/**
 * Renderer lighting + camera-angle regression tests.
 *
 * Tim's 2026-05-11 review of the AR-FR 2022 replay flagged:
 *
 *   1. Stadium upper deck + sky blown out to pure white.
 *   2. Pitch crushed dark under the directional shadow.
 *   3. Follow-ball camera banked / rolled so the horizon tilted.
 *
 * Fixes shipped in this PR:
 *
 *   - Canvas gl prop sets ACES filmic + exposure 0.85 + sRGB output.
 *   - Light rig: ambient 0.55 + hemisphere 0.45 + directional 1.05
 *     (sum 2.05, comfortably under the 2.5 mobile budget).
 *   - Crowd / LED-boards drop `toneMapped: false` so ACES can
 *     compress them. Floodlight emissive intensity 2.6 → 0.9.
 *   - Broadcast / follow / top-down camera presets retuned to a
 *     "long lens 36° FOV, look above pitch floor, up=(0,1,0)" shape.
 *
 * These tests pin the values that matter so a future renderer tweak
 * can't silently bring the blowout back.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  broadcastCamera,
  BROADCAST_FOV,
  BROADCAST_HEIGHT,
  BROADCAST_DEPTH,
  BROADCAST_LOOK_HEIGHT,
} from "@/lib/cameras/broadcast-cam";
import { DampedCameraDriver } from "@/lib/cameras/damped-driver";

/**
 * Helper: read the Canvas gl-prop wiring out of MatchScene.tsx as
 * source. We test the *static prop shape* rather than mounting the
 * component, because mounting @react-three/fiber under jsdom requires
 * a WebGL context that the test env doesn't provide.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readMatchScene(): string {
  return readFileSync(
    resolve(__dirname, "..", "components", "MatchScene.tsx"),
    "utf8",
  );
}

describe("renderer tone mapping (MatchScene gl prop)", () => {
  it("sets ACESFilmicToneMapping on the Canvas gl prop", () => {
    const src = readMatchScene();
    // Check both the gl prop AND the onCreated assertion are present.
    expect(src).toMatch(/toneMapping:\s*THREE\.ACESFilmicToneMapping/);
    expect(src).toMatch(/gl\.toneMapping\s*=\s*THREE\.ACESFilmicToneMapping/);
  });

  it("uses exposure 0.85, the single biggest blow-out fix", () => {
    const src = readMatchScene();
    // Both gl-prop and onCreated assertion must agree.
    expect(src).toMatch(/toneMappingExposure:\s*0\.85/);
    expect(src).toMatch(/gl\.toneMappingExposure\s*=\s*0\.85/);
  });

  it("declares SRGBColorSpace output so colours don't double-gamma", () => {
    const src = readMatchScene();
    expect(src).toMatch(/outputColorSpace:\s*THREE\.SRGBColorSpace/);
  });
});

describe("renderer light rig (MatchScene scene contents)", () => {
  it("mounts ambient + hemisphere + directional", () => {
    const src = readMatchScene();
    expect(src).toMatch(/<ambientLight\b/);
    expect(src).toMatch(/<hemisphereLight\b/);
    expect(src).toMatch(/<directionalLight\b/);
  });

  it("keeps total light intensity within the mobile budget (sum <= 2.5)", () => {
    const src = readMatchScene();
    // Pull the three intensities out of the source. The values must
    // sum to <= 2.5, anything more and a mid-range 2022 Android can't
    // keep 60 fps under the post-FX pass.
    const ambient = matchFloat(src, /<ambientLight\s+intensity=\{([\d.]+)\}/);
    // hemisphereLight args={["sky", "ground", intensity]}, the third
    // float in the array is the intensity we care about.
    const hemi = matchFloat(
      src,
      /<hemisphereLight[^/]*args=\{\[[^\]]*?,[^\]]*?,\s*([\d.]+)\s*\]\}/,
    );
    const dir = matchFloat(src, /<directionalLight[\s\S]*?intensity=\{([\d.]+)\}/);
    const sum = ambient + hemi + dir;
    expect(sum).toBeLessThanOrEqual(2.5);
    // And not so low the pitch reads dark.
    expect(sum).toBeGreaterThanOrEqual(1.6);
  });

  it("directional light has a non-zero ambient companion so pitch isn't crushed", () => {
    const src = readMatchScene();
    const ambient = matchFloat(src, /<ambientLight\s+intensity=\{([\d.]+)\}/);
    expect(ambient).toBeGreaterThan(0.3);
  });
});

describe("broadcast camera preset", () => {
  it("uses a tight 36° FOV (long lens, not wide-angle)", () => {
    expect(BROADCAST_FOV).toBe(36);
  });

  it("anchors at 22 m up / 50 m back from pitch centre", () => {
    expect(BROADCAST_HEIGHT).toBe(22);
    expect(BROADCAST_DEPTH).toBe(50);
  });

  it("aims lookAt ABOVE the pitch floor so player heads sit centred", () => {
    expect(BROADCAST_LOOK_HEIGHT).toBeGreaterThan(0);
    const t = broadcastCamera(new THREE.Vector3(10, 0, 5));
    expect(t.lookAt.y).toBeGreaterThan(0.5);
    expect(t.lookAt.y).toBeLessThan(3);
  });

  it("clamps the camera's X follow to a tighter range than before", () => {
    // Ball far down the wing, clamp should stop the camera at ±25,
    // not the old ±30. Position.x = clampedX * 0.5 = ±12.5.
    const farRight = broadcastCamera(new THREE.Vector3(80, 0, 0));
    expect(farRight.position.x).toBeLessThanOrEqual(12.5 + 1e-6);
    const farLeft = broadcastCamera(new THREE.Vector3(-80, 0, 0));
    expect(farLeft.position.x).toBeGreaterThanOrEqual(-12.5 - 1e-6);
  });

  it("returns stable position given a nudged ball position", () => {
    // Tiny ball movements should produce tiny camera-position deltas
    // (the *0.5 factor on tx). This is the "no jitter" guarantee that
    // matters for damping.
    const a = broadcastCamera(new THREE.Vector3(5, 0, 0));
    const b = broadcastCamera(new THREE.Vector3(5.1, 0, 0));
    expect(Math.abs(a.position.x - b.position.x)).toBeLessThan(0.1);
  });
});

describe("camera up-vector is enforced as (0,1,0)", () => {
  it("DampedCameraDriver respects the camera.up vector on lookAt", () => {
    // The driver calls camera.lookAt() under the hood. As long as the
    // caller sets camera.up = (0,1,0) before each update (which both
    // CameraRig and Director do, see source), the resulting
    // orientation has zero roll. We verify that by checking the
    // camera's local "right" axis stays on the world XZ plane (y=0).
    const cam = new THREE.PerspectiveCamera(36, 1, 0.1, 1000);
    cam.up.set(0, 1, 0);
    const drv = new DampedCameraDriver();
    drv.update(
      cam,
      {
        position: new THREE.Vector3(0, 12, 28),
        lookAt: new THREE.Vector3(0, 2, 0),
        fov: 36,
      },
      1 / 60,
    );
    // Camera-space X axis in world coords.
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    expect(Math.abs(right.y)).toBeLessThan(1e-3);
  });

  it("CameraRig source pins camera.up in both the snap effect and the per-frame loop", () => {
    const rig = readFileSync(
      resolve(__dirname, "..", "components", "CameraRig.tsx"),
      "utf8",
    );
    // Two assertions: one in useEffect (mode-switch snap), one in
    // useFrame (per-frame defence against drift).
    const hits = rig.match(/camera\.up\.set\(0,\s*1,\s*0\)/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it("Director source pins camera.up before damper.update", () => {
    const dir = readFileSync(
      resolve(__dirname, "..", "components", "Director.tsx"),
      "utf8",
    );
    expect(dir).toMatch(/camera\.up\.set\(0,\s*1,\s*0\)/);
  });
});

describe("stadium materials don't escape tone mapping", () => {
  it("Crowd no longer overrides toneMapped on the billboard material", () => {
    const crowd = readFileSync(
      resolve(__dirname, "..", "components", "Crowd.tsx"),
      "utf8",
    );
    // We dropped `toneMapped={false}` so ACES can compress the cloud
    // of instances, Tim's blown-out upper-deck cream comes from
    // here.
    const codeOnly = stripLineComments(crowd);
    expect(codeOnly).not.toMatch(/toneMapped=\{false\}/);
  });

  it("LedBoards no longer overrides toneMapped on the LED material", () => {
    const led = readFileSync(
      resolve(__dirname, "..", "components", "LedBoards.tsx"),
      "utf8",
    );
    // Strip line-comments so a comment that mentions the old behaviour
    // doesn't fail the regression test.
    const codeOnly = stripLineComments(led);
    expect(codeOnly).not.toMatch(/toneMapped:\s*false/);
  });

  it("Floodlight emissiveIntensity drops from 2.6 to <= 1.0", () => {
    const stadium = readFileSync(
      resolve(__dirname, "..", "components", "Stadium.tsx"),
      "utf8",
    );
    const intensity = matchFloat(stadium, /emissiveIntensity=\{([\d.]+)\}/);
    expect(intensity).toBeLessThanOrEqual(1.0);
  });
});

function matchFloat(src: string, re: RegExp): number {
  const m = src.match(re);
  if (!m) {
    throw new Error(`pattern not found: ${re}`);
  }
  return Number(m[1]);
}

/**
 * Crude comment stripper. Good enough for asserting that a regression
 * pattern doesn't appear in actual code (vs. a comment). Removes:
 *
 *   - `// ... eol`               line comments
 *   - `/_*_ ... *_/`             block comments (TS / C-style)
 *   - `{/_*_ ... *_/}`           JSX comments
 *
 * (Underscores in this docstring to keep the parser happy.)
 */
function stripLineComments(src: string): string {
  // Strip /* ... */ block comments (greedy across lines, non-greedy
  // body). JSX `{/* ... *\/}` is a subset and is also removed.
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      if (idx < 0) return line;
      return line.slice(0, idx);
    })
    .join("\n");
}
