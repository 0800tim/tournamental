/**
 * Crowd instance generation, pure module.
 *
 * The crowd is a single `InstancedMesh` split conceptually into 4
 * stands (north / south / east / west). Each stand is a 3-tier ring
 * of seats with deterministic positions, plus a small per-instance
 * jitter to break the regular grid.
 *
 * Why pure: the renderer rebuilds the matrices once on mount, and the
 * test suite asserts the layout against fixed seed values.
 */

export const CROWD_DEFAULT_COUNT = 5000;
/** Conceptual subdivisions, used by the celebration shader-uniform. */
export const CROWD_TIERS = ["north", "south", "east", "west"] as const;
export type CrowdStand = (typeof CROWD_TIERS)[number];

export interface CrowdInstance {
  /** World-space x. */
  x: number;
  /** Eye height above pitch level. */
  y: number;
  /** World-space z. */
  z: number;
  /** Yaw, billboards face roughly toward the pitch centre. */
  yaw: number;
  /** Which stand this instance belongs to. */
  stand: CrowdStand;
  /** Tier index 0 (front) … 2 (back). */
  tier: number;
  /** Hex jersey colour (one of 3 per stand). */
  colourHex: number;
  /** Per-instance phase offset for the bob animation. */
  phase: number;
}

export interface BuildCrowdInput {
  count: number;
  pitchLength: number;
  pitchWidth: number;
  seed: number;
}

export interface BuildCrowdOutput {
  matrices: CrowdInstance[];
  countsPerStand: Record<CrowdStand, number>;
}

/**
 * Mulberry32, small + deterministic PRNG. Adequate for layout
 * jitter; not crypto.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build crowd instance positions.
 *
 * Stand layout (top-down, pitch centre = origin):
 *   - north stand: positive Z, parallel to long axis
 *   - south stand: negative Z, parallel to long axis
 *   - east stand : positive X, parallel to short axis
 *   - west stand : negative X, parallel to short axis
 *
 * Each stand gets `count / 4` instances, distributed across 3 tiers
 * with the back tier holding ~ 50% of the seats and the front holding
 * ~ 20%. Tier height steps up 4 m per row.
 */
export function buildCrowdInstanceData(input: BuildCrowdInput): BuildCrowdOutput {
  const { count, pitchLength, pitchWidth, seed } = input;
  const rng = mulberry32(seed);

  const halfL = pitchLength / 2;
  const halfW = pitchWidth / 2;
  // Inner edge of stand starts ~ 4 m beyond the touchline.
  const insetLong = halfL + 4;
  const insetShort = halfW + 4;

  const TIER_DEPTH = 6; // metres of depth per tier
  const TIER_RISE = 4; // metres of rise per tier
  const TIER_DIST: Record<number, number> = { 0: 0.2, 1: 0.3, 2: 0.5 };

  const STAND_COLOURS: Record<CrowdStand, number[]> = {
    north: [0x1c5fbf, 0x2880e0, 0x5fa3ee], // home blues
    south: [0xc02427, 0xe14245, 0xf7706f], // away reds
    east: [0xe9a200, 0xf7c64a, 0xfddc8a], // mixed gold
    west: [0xe9a200, 0xf7c64a, 0xfddc8a],
  };

  const perStand = Math.floor(count / 4);
  const matrices: CrowdInstance[] = [];
  const countsPerStand: Record<CrowdStand, number> = {
    north: 0,
    south: 0,
    east: 0,
    west: 0,
  };

  function pushStand(stand: CrowdStand, axis: "long" | "short", sign: 1 | -1) {
    const coloursForStand = STAND_COLOURS[stand];
    for (let i = 0; i < perStand; i++) {
      const r = rng();
      // Pick a tier weighted by TIER_DIST.
      const tier = r < TIER_DIST[0] ? 0 : r < TIER_DIST[0] + TIER_DIST[1] ? 1 : 2;

      const tierOffsetIn = tier * TIER_DEPTH;
      const y = 1.4 + tier * TIER_RISE;

      // Pick a slot along the stand length.
      const standLength = axis === "long" ? pitchLength + 8 : pitchWidth + 8;
      const u = (rng() - 0.5) * standLength;
      // Slight in/out jitter so it doesn't look gridlike.
      const jitter = (rng() - 0.5) * 0.6;

      let x: number;
      let z: number;
      let yaw: number;

      if (axis === "long") {
        // North/south stand, parallel to X axis.
        x = u + jitter;
        z = sign * (insetShort + tierOffsetIn + jitter);
        yaw = sign === 1 ? Math.PI : 0;
      } else {
        // East/west stand, parallel to Z axis.
        x = sign * (insetLong + tierOffsetIn + jitter);
        z = u + jitter;
        yaw = sign === 1 ? -Math.PI / 2 : Math.PI / 2;
      }

      const colourHex =
        coloursForStand[Math.floor(rng() * coloursForStand.length)];

      matrices.push({
        x,
        y,
        z,
        yaw,
        stand,
        tier,
        colourHex,
        phase: rng(),
      });
      countsPerStand[stand]++;
    }
  }

  pushStand("north", "long", 1);
  pushStand("south", "long", -1);
  pushStand("east", "short", 1);
  pushStand("west", "short", -1);

  return { matrices, countsPerStand };
}
