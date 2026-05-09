"use client";

/**
 * Cheap procedural stadium: a low-poly bowl ring around the pitch and a
 * billboarded crowd colour band. No per-spectator geometry. Doc 04 calls
 * for crowd-LOD via sprites only — this is the placeholder.
 *
 * The previous sky-dome here has been removed in favour of drei's `<Sky/>`
 * (mounted in `MatchScene`) — keeping a sphere here would clip with the
 * procedural sky.
 */
export function Stadium() {
  return (
    <group>
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i / 8) * Math.PI * 2;
        const radius = 75;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const yaw = angle + Math.PI / 2;
        return (
          <group key={i} position={[x, 0, z]} rotation={[0, yaw, 0]}>
            <mesh position={[0, 8, 0]} receiveShadow>
              <boxGeometry args={[60, 16, 4]} />
              <meshStandardMaterial color="#23303d" roughness={0.85} />
            </mesh>
            {/* Crowd colour band on the inside-facing edge. */}
            <mesh position={[0, 8, -2.1]}>
              <planeGeometry args={[60, 8]} />
              <meshBasicMaterial color="#3b4f64" />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
