/**
 * Stadium geometry, pure module.
 *
 * Builds parametric "tier of seating" descriptors that the React
 * component then renders with vanilla Three meshes. Pure data so
 * tests can assert on slice counts, positions, and the inset radii.
 */

export interface SeatingTierInput {
  /** Inner radius along the long (X) axis. Inner edge of the front
   *  row of seats. */
  innerRadiusLong: number;
  /** Inner radius along the short (Z) axis. */
  innerRadiusShort: number;
  /** Tier depth (m), how far back the tier reads. */
  depth: number;
  /** Tier rise (m), how tall the tier is. */
  rise: number;
  /** Y of the bottom of the tier. */
  baseY: number;
  /** Tilt (radians) of the seating face. */
  tilt: number;
  /** Number of slices around the pitch (12 = 30° each). */
  segments: number;
  /** Hex/CSS colour for the seat material. */
  seatColour: string;
}

export interface SeatingSlice {
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number, number];
}

export interface SeatingTier {
  segments: number;
  baseY: number;
  rise: number;
  depth: number;
  seatColour: string;
  slices: SeatingSlice[];
}

/**
 * Build the slice list for one tier, around an elliptical ring whose
 * radii are `innerRadiusLong` (along X) and `innerRadiusShort` (along
 * Z). Each slice is one tilted box; the slices together approximate
 * a continuous tier.
 */
export function buildSeatingTier(input: SeatingTierInput): SeatingTier {
  const {
    innerRadiusLong,
    innerRadiusShort,
    depth,
    rise,
    baseY,
    tilt,
    segments,
    seatColour,
  } = input;

  const slices: SeatingSlice[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Place the box centre on the tier's mid-radius (inner + depth/2).
    const cx = cos * (innerRadiusLong + depth / 2);
    const cz = sin * (innerRadiusShort + depth / 2);

    // Slice arc length (tangential), width of the box.
    const tangentialLen =
      ((innerRadiusLong + innerRadiusShort) / 2) *
      ((Math.PI * 2) / segments) *
      1.05; // 5% overlap so slices butt up cleanly
    const radialLen = depth;

    // Box size: width = tangential, height = rise, depth = radial.
    const size: [number, number, number] = [tangentialLen, rise, radialLen];

    // Yaw the slice so its long axis is tangent to the ring.
    const yaw = angle + Math.PI / 2;

    // Tilt the slice slightly back so the front face is angled in.
    const rotX = -tilt;

    slices.push({
      position: [cx, baseY + rise / 2, cz],
      rotation: [rotX, yaw, 0],
      size,
    });
  }

  return { segments, baseY, rise, depth, seatColour, slices };
}
