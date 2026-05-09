import { el, type SatoriElement } from "../jsdl.js";
import { cardFrame, clamp } from "../layout.js";
import { palette, type CardSize } from "../theme.js";
import type { MatchResultInput } from "../types.js";

export function matchResultBody(
  input: MatchResultInput,
  size: CardSize,
): SatoriElement {
  const {
    matchLabel,
    team0Code,
    team1Code,
    scoreTeam0,
    scoreTeam1,
    predictedScoreTeam0,
    predictedScoreTeam1,
    pointsEarned,
    userHandle,
  } = input;

  const isStory = size === "story";
  const headlineSize = isStory ? 88 : 60;
  const scoreSize = isStory ? 220 : 150;
  const teamSize = isStory ? 80 : 56;
  const labelSize = isStory ? 32 : 24;

  const exact =
    predictedScoreTeam0 !== undefined &&
    predictedScoreTeam1 !== undefined &&
    predictedScoreTeam0 === scoreTeam0 &&
    predictedScoreTeam1 === scoreTeam1;

  const correctSide =
    predictedScoreTeam0 !== undefined && predictedScoreTeam1 !== undefined
      ? Math.sign(predictedScoreTeam0 - predictedScoreTeam1) ===
        Math.sign(scoreTeam0 - scoreTeam1)
      : false;

  const headline = exact
    ? "Exact score. Called it."
    : correctSide
      ? "Result called."
      : pointsEarned > 0
        ? "Points banked."
        : "On to the next.";

  return el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        padding: isStory ? "56px 56px 32px" : "44px 56px 32px",
        gap: 24,
      },
    },
    el(
      "div",
      { style: { display: "flex", fontSize: labelSize, color: palette.ink[200] } },
      `Full-time • ${clamp(matchLabel, 36)}`,
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 56,
          background: palette.ink[800],
          borderRadius: 28,
          padding: isStory ? 48 : 28,
        },
      },
      teamColumn(team0Code, scoreTeam0, scoreTeam0 > scoreTeam1, teamSize, scoreSize),
      el(
        "div",
        { style: { display: "flex", color: palette.ink[200], fontSize: teamSize, fontWeight: 700 } },
        "—",
      ),
      teamColumn(team1Code, scoreTeam1, scoreTeam1 > scoreTeam0, teamSize, scoreSize),
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          fontSize: headlineSize,
          fontWeight: 900,
          color: exact ? palette.flame[500] : correctSide ? palette.emerald[500] : "#fff",
          lineHeight: 1.05,
        },
      },
      headline,
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 18,
          flexWrap: "wrap",
        },
      },
      el(
        "div",
        {
          style: {
            display: "flex",
            background: palette.accent[700],
            color: "#fff",
            padding: "10px 20px",
            borderRadius: 999,
            fontSize: labelSize,
            fontWeight: 700,
          },
        },
        `+${pointsEarned} pts to @${userHandle}`,
      ),
      predictedScoreTeam0 !== undefined && predictedScoreTeam1 !== undefined
        ? el(
            "div",
            {
              style: {
                display: "flex",
                color: palette.ink[200],
                fontSize: labelSize,
              },
            },
            `Predicted ${predictedScoreTeam0}–${predictedScoreTeam1}`,
          )
        : null,
    ),
  );
}

function teamColumn(
  code: string,
  score: number,
  winning: boolean,
  teamSize: number,
  scoreSize: number,
): SatoriElement {
  return el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      },
    },
    el(
      "div",
      {
        style: {
          display: "flex",
          fontSize: teamSize,
          fontWeight: 700,
          letterSpacing: 1.4,
          color: palette.ink[200],
        },
      },
      code,
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          fontSize: scoreSize,
          fontWeight: 900,
          color: winning ? palette.flame[500] : "#fff",
          lineHeight: 1,
        },
      },
      String(score),
    ),
  );
}

export function matchResultCard(
  input: MatchResultInput,
  size: CardSize,
): SatoriElement {
  return cardFrame({
    size,
    brandContext: input.tournamentName,
    userHandle: input.userHandle,
    userId: input.userId,
    body: matchResultBody(input, size),
    accentHex: palette.accent[500],
    locale: input.locale,
  });
}
