// Run with: node --import tsx packages/social-cards/scripts/sample.mjs
// from the repo root. Writes three PNGs and one MP4 to /tmp/.

import { renderBracketShareCard, renderBracketRevealVideo } from "../src/index.ts";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "apps/web/public/flags");
const input = {
  user: { handle: "tim-clarkson", displayName: "Tim" },
  champion: { code: "ARG", name: "Argentina", kit: { primary: "#74acdf" } },
  knockoutPath: [
    { stage: "r16", teamCode: "AUS", teamName: "Australia" },
    { stage: "qf", teamCode: "ESP", teamName: "Spain" },
    { stage: "sf", teamCode: "BRA", teamName: "Brazil" },
    { stage: "final", teamCode: "FRA", teamName: "France" },
  ],
  tournamentName: "FIFA WC 2026",
  pundit: { level: 2 },
  flagsDir: ROOT,
};

for (const size of ["portrait", "landscape", "square"]) {
  const png = await renderBracketShareCard({ ...input, size });
  const out = `/tmp/bracket-share-${size}.png`;
  writeFileSync(out, png);
  console.log("PNG", size, png.length, "bytes →", out);
}

const mp4 = await renderBracketRevealVideo({
  card: input,
  outputPath: "/tmp/bracket-reveal-instagram.mp4",
  fps: 24,
  durationSec: 6,
  format: "instagram",
});
console.log("MP4", mp4);
