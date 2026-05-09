/**
 * LED ad-board layout — pure module.
 *
 * 32 boards around the pitch perimeter, set at the touchline. The
 * boards are short (1.0 m tall), wide (5.0 m), facing the pitch.
 *
 * Pure data so the test suite can assert on count + position.
 */

export const AD_BOARD_COUNT = 32;
export const AD_BOARD_HEIGHT = 1.0;
export const AD_BOARD_WIDTH = 5.0;
export const AD_BOARD_OFFSET = 1.6; // metres outside the touchline
/** Board cycle period — texture rotates every N seconds. */
export const AD_CYCLE_SECONDS = 15;

/** Sponsor placeholders. Tim said sponsor logos are TBD; these read
 *  as broadcast filler. */
export const AD_BOARD_NAMES = [
  "VTOURN",
  "AIVA",
  "Drips",
  "FairPlay",
  "Boyz Coffee",
  "Sdeal",
  "Fortune",
  "Greenjoy",
  "Coffeebean",
  "Unrot",
  "0800TIM",
  "Clawdia",
  "Safehaven",
  "MoneyHub",
  "Uno",
  "Bracket",
];

/** Sponsor brand colour pairs (bg / fg). */
export const AD_BOARD_COLOURS: Array<{ bg: string; fg: string }> = [
  { bg: "#0b3d91", fg: "#ffffff" }, // VTOURN navy
  { bg: "#7c3aed", fg: "#ffffff" }, // AIVA violet
  { bg: "#0e7490", fg: "#e0f2fe" }, // Drips teal
  { bg: "#a16207", fg: "#fef3c7" }, // FairPlay gold
  { bg: "#3f2c1c", fg: "#f5e9d6" }, // Boyz Coffee brown
  { bg: "#0f172a", fg: "#fbbf24" }, // Sdeal slate
  { bg: "#9d174d", fg: "#fce7f3" }, // Fortune magenta
  { bg: "#166534", fg: "#dcfce7" }, // Greenjoy green
  { bg: "#7c2d12", fg: "#ffedd5" }, // Coffeebean amber
  { bg: "#171717", fg: "#fef08a" }, // Unrot black
  { bg: "#1e3a8a", fg: "#dbeafe" }, // 0800TIM blue
  { bg: "#4c1d95", fg: "#ddd6fe" }, // Clawdia indigo
  { bg: "#0c4a6e", fg: "#bae6fd" }, // Safehaven cyan
  { bg: "#374151", fg: "#f3f4f6" }, // MoneyHub gray
  { bg: "#dc2626", fg: "#fee2e2" }, // Uno red
  { bg: "#0d9488", fg: "#ccfbf1" }, // Bracket teal
];

export interface AdBoard {
  position: [number, number, number];
  yaw: number;
  size: [number, number];
  /** Index of the *initial* tile shown on this board. */
  initialTile: number;
}

export interface AdBoardLayoutInput {
  pitchLength?: number;
  pitchWidth?: number;
  /** Override count (must be multiple of 4 for clean per-side splits). */
  count?: number;
}

export function buildAdBoardLayout(
  input: AdBoardLayoutInput = {},
): AdBoard[] {
  const pitchLength = input.pitchLength ?? 100;
  const pitchWidth = input.pitchWidth ?? 64;
  const count = input.count ?? AD_BOARD_COUNT;

  const halfL = pitchLength / 2;
  const halfW = pitchWidth / 2;
  // Distribute boards: 10 on each long side + 6 on each short side = 32.
  const longSide = Math.floor(count * (10 / 32));
  const shortSide = Math.floor(count * (6 / 32));

  const boards: AdBoard[] = [];
  let ti = 0;

  // North long side (positive Z).
  for (let i = 0; i < longSide; i++) {
    const t = (i + 0.5) / longSide;
    const x = -halfL + t * pitchLength;
    boards.push({
      position: [x, AD_BOARD_HEIGHT / 2, halfW + AD_BOARD_OFFSET],
      yaw: Math.PI,
      size: [AD_BOARD_WIDTH, AD_BOARD_HEIGHT],
      initialTile: ti++ % AD_BOARD_NAMES.length,
    });
  }

  // South long side (negative Z).
  for (let i = 0; i < longSide; i++) {
    const t = (i + 0.5) / longSide;
    const x = -halfL + t * pitchLength;
    boards.push({
      position: [x, AD_BOARD_HEIGHT / 2, -(halfW + AD_BOARD_OFFSET)],
      yaw: 0,
      size: [AD_BOARD_WIDTH, AD_BOARD_HEIGHT],
      initialTile: ti++ % AD_BOARD_NAMES.length,
    });
  }

  // East short side (positive X).
  for (let i = 0; i < shortSide; i++) {
    const t = (i + 0.5) / shortSide;
    const z = -halfW + t * pitchWidth;
    boards.push({
      position: [halfL + AD_BOARD_OFFSET, AD_BOARD_HEIGHT / 2, z],
      yaw: -Math.PI / 2,
      size: [AD_BOARD_WIDTH, AD_BOARD_HEIGHT],
      initialTile: ti++ % AD_BOARD_NAMES.length,
    });
  }

  // West short side (negative X).
  for (let i = 0; i < shortSide; i++) {
    const t = (i + 0.5) / shortSide;
    const z = -halfW + t * pitchWidth;
    boards.push({
      position: [-(halfL + AD_BOARD_OFFSET), AD_BOARD_HEIGHT / 2, z],
      yaw: Math.PI / 2,
      size: [AD_BOARD_WIDTH, AD_BOARD_HEIGHT],
      initialTile: ti++ % AD_BOARD_NAMES.length,
    });
  }

  return boards;
}
