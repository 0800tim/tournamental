import { el, type SatoriElement } from "../jsdl.js";
import { cardFrame, clamp } from "../layout.js";
import { palette, type CardSize } from "../theme.js";
import type { LeaderboardRankInput } from "../types.js";

export function leaderboardRankBody(
  input: LeaderboardRankInput,
  size: CardSize,
): SatoriElement {
  const { scopeLabel, rank, totalEntrants, weeklyMove, userHandle } = input;
  const isStory = size === "story";

  const rankSize = isStory ? 360 : 240;
  const labelSize = isStory ? 36 : 26;
  const headlineSize = isStory ? 80 : 56;

  const moveBadge =
    weeklyMove !== undefined && weeklyMove !== 0
      ? el(
          "div",
          {
            style: {
              display: "flex",
              background: weeklyMove > 0 ? palette.emerald[500] : palette.flame[600],
              color: "#fff",
              padding: "10px 20px",
              borderRadius: 999,
              fontSize: labelSize,
              fontWeight: 800,
              alignSelf: "flex-start",
            },
          },
          weeklyMove > 0 ? `▲ ${weeklyMove} this week` : `▼ ${Math.abs(weeklyMove)} this week`,
        )
      : null;

  return el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        padding: isStory ? "56px 56px 32px" : "44px 56px 32px",
        gap: 22,
        justifyContent: "center",
      },
    },
    el(
      "div",
      { style: { display: "flex", fontSize: labelSize, color: palette.ink[200], textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 700 } },
      `${clamp(scopeLabel, 28)} leaderboard`,
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          alignItems: "baseline",
          gap: 24,
        },
      },
      el(
        "div",
        {
          style: {
            display: "flex",
            fontSize: rankSize,
            fontWeight: 900,
            color: palette.flame[500],
            lineHeight: 0.95,
            letterSpacing: -4,
          },
        },
        `#${rank}`,
      ),
      el(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            color: palette.ink[200],
            fontSize: labelSize,
            gap: 4,
          },
        },
        el("div", { style: { display: "flex" } }, `of ${formatNumber(totalEntrants)}`),
        el("div", { style: { display: "flex", color: "#fff", fontWeight: 700 } }, `@${userHandle}`),
      ),
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          fontSize: headlineSize,
          fontWeight: 900,
          color: "#fff",
          lineHeight: 1.05,
        },
      },
      "Catch me.",
    ),
    moveBadge,
  );
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function leaderboardRankCard(
  input: LeaderboardRankInput,
  size: CardSize,
): SatoriElement {
  return cardFrame({
    size,
    brandContext: input.scopeLabel,
    userHandle: input.userHandle,
    userId: input.userId,
    body: leaderboardRankBody(input, size),
    accentHex: palette.flame[500],
    locale: input.locale,
    pundit: input.pundit,
  });
}
