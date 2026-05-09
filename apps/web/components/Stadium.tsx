"use client";

/**
 * Cheap procedural stadium: a low-poly bowl ring around the pitch and a
 * billboarded crowd colour-band. No per-spectator geometry, no shadows.
 * Doc 04 says crowd-LOD via sprites only — this is the placeholder.
 */
export function Stadium() {
  return (
    <group>
      {/* Outer bowl walls — eight quad segments forming a stadium ring. */}
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i / 8) * Math.PI * 2;
        const radius = 75;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const yaw = angle + Math.PI / 2;
        return (
          <group key={i} position={[x, 0, z]} rotation={[0, yaw, 0]}>
            <mesh position={[0, 8, 0]}>
              <boxGeometry args={[60, 16, 4]} />
              <meshStandardMaterial color="#23303d" roughness={0.8} />
            </mesh>
            {/* Crowd colour band on the inside-facing edge. */}
            <mesh position={[0, 8, -2.1]}>
              <planeGeometry args={[60, 8]} />
              <meshBasicMaterial color="#3b4f64" />
            </mesh>
          </group>
        );
      })}

      {/* Sky dome (very subtle) — keeps the horizon cohesive. */}
      <mesh>
        <sphereGeometry args={[400, 16, 16]} />
        <meshBasicMaterial color="#0c1722" side={2} />
      </mesh>
    </group>
  );
}
