import { el, type SatoriElement } from "../jsdl.js";
import { cardFrame, clamp } from "../layout.js";
import { palette, type CardSize } from "../theme.js";
import type { GoalClipInput } from "../types.js";

export function goalClipBody(
  input: GoalClipInput,
  size: CardSize,
): SatoriElement {
  const {
    matchLabel,
    scorer,
    scoreTeam0,
    scoreTeam1,
    team0Code,
    team1Code,
    minute,
    predictedByUser,
    userHandle,
  } = input;

  const isStory = size === "story";
  const goalSize = isStory ? 220 : 160;
  const scoreSize = isStory ? 120 : 84;
  const teamSize = isStory ? 56 : 40;
  const scorerSize = isStory ? 64 : 44;

  return el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        padding: isStory ? "56px 56px 32px" : "32px 56px 32px",
        gap: 22,
      },
    },
    // GOAL banner
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
        },
      },
      el(
        "div",
        {
          style: {
            display: "flex",
            background: palette.emerald[500],
            color: "#fff",
            padding: "10px 22px",
            borderRadius: 999,
            fontSize: isStory ? 36 : 26,
            fontWeight: 900,
            letterSpacing: 1,
            textTransform: "uppercase",
          },
        },
        `Goal • ${minute}'`,
      ),
      el(
        "div",
        { style: { display: "flex", fontSize: isStory ? 30 : 22, color: palette.ink[200] } },
        clamp(matchLabel, 26),
      ),
    ),
    // GOAL block
    el(
      "div",
      {
        style: {
          display: "flex",
          alignSelf: "flex-start",
          fontSize: goalSize,
          fontWeight: 900,
          color: palette.flame[500],
          lineHeight: 1,
          letterSpacing: -2,
        },
      },
      "GOAL.",
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          fontSize: scorerSize,
          fontWeight: 900,
          color: "#fff",
          lineHeight: 1.05,
        },
      },
      clamp(scorer, 28),
    ),
    // scoreboard
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 36,
          background: palette.ink[800],
          borderRadius: 24,
          padding: isStory ? 36 : 24,
        },
      },
      teamCol(team0Code, scoreTeam0, scoreTeam1, teamSize, scoreSize),
      el(
        "div",
        { style: { display: "flex", color: palette.ink[200], fontSize: teamSize, fontWeight: 700 } },
        "—",
      ),
      teamCol(team1Code, scoreTeam1, scoreTeam0, teamSize, scoreSize),
    ),
    predictedByUser
      ? el(
          "div",
          {
            style: {
              display: "flex",
              background: palette.accent[700],
              color: "#fff",
              padding: "14px 22px",
              borderRadius: 16,
              fontSize: isStory ? 32 : 24,
              fontWeight: 700,
              alignSelf: "flex-start",
            },
          },
          `@${userHandle} called this goal.`,
        )
      : null,
  );
}

function teamCol(
  code: string,
  scoreSelf: number,
  scoreOther: number,
  teamSize: number,
  scoreSize: number,
): SatoriElement {
  const winning = scoreSelf > scoreOther;
  return el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
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
      String(scoreSelf),
    ),
  );
}

export function goalClipCard(
  input: GoalClipInput,
  size: CardSize,
): SatoriElement {
  return cardFrame({
    size,
    brandContext: input.tournamentName,
    userHandle: input.userHandle,
    userId: input.userId,
    body: goalClipBody(input, size),
    accentHex: palette.emerald[500],
    locale: input.locale,
    pundit: input.pundit,
  });
}
