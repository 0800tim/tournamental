import { el, type SatoriElement } from "../jsdl.js";
import { cardFrame, clamp } from "../layout.js";
import { palette, type CardSize } from "../theme.js";
import type { TournamentRecapInput } from "../types.js";

const HIGHLIGHT_LIMIT = 3;

export function tournamentRecapBody(
  input: TournamentRecapInput,
  size: CardSize,
): SatoriElement {
  const {
    tournamentName,
    predictionsLocked,
    correctPredictions,
    pointsEarned,
    rankFinal,
    totalEntrants,
    highlights,
    userHandle,
  } = input;
  const isStory = size === "story";

  const titleSize = isStory ? 84 : 60;
  const statSize = isStory ? 96 : 64;
  const labelSize = isStory ? 28 : 22;
  const subLabelSize = isStory ? 24 : 18;

  const accuracy =
    predictionsLocked > 0 ? Math.round((correctPredictions / predictionsLocked) * 100) : 0;

  const visibleHighlights = (highlights ?? []).slice(0, HIGHLIGHT_LIMIT);

  return el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        padding: isStory ? "56px 56px 32px" : "44px 56px 32px",
        gap: 22,
      },
    },
    el(
      "div",
      { style: { display: "flex", fontSize: labelSize, color: palette.ink[200], textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 700 } },
      "Tournament recap",
    ),
    el(
      "div",
      { style: { display: "flex", fontSize: titleSize, fontWeight: 900, color: "#fff", lineHeight: 1.0 } },
      clamp(tournamentName, 32),
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          gap: 18,
          flexWrap: "wrap",
        },
      },
      stat(`${pointsEarned}`, "points", statSize, labelSize, palette.flame[500]),
      stat(`${accuracy}%`, "accuracy", statSize, labelSize, palette.accent[400]),
      stat(`#${rankFinal}`, `of ${formatNumber(totalEntrants)}`, statSize, labelSize, palette.emerald[500]),
      stat(`${correctPredictions}/${predictionsLocked}`, "predictions", statSize, labelSize, "#fff"),
    ),
    visibleHighlights.length > 0
      ? el(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: 8,
              background: palette.ink[800],
              borderRadius: 20,
              padding: 22,
            },
          },
          el(
            "div",
            { style: { display: "flex", fontSize: subLabelSize, color: palette.ink[200], textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 } },
            `Highlights for @${userHandle}`,
          ),
          ...visibleHighlights.map((h) =>
            el(
              "div",
              {
                style: {
                  display: "flex",
                  fontSize: labelSize + 4,
                  color: "#fff",
                  fontWeight: 600,
                },
              },
              `• ${clamp(h, 80)}`,
            ),
          ),
        )
      : null,
  );
}

function stat(
  value: string,
  label: string,
  valueSize: number,
  labelSize: number,
  colour: string,
): SatoriElement {
  return el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        background: palette.ink[800],
        borderRadius: 18,
        padding: "16px 22px",
        minWidth: 220,
        gap: 4,
      },
    },
    el(
      "div",
      {
        style: {
          display: "flex",
          fontSize: valueSize,
          fontWeight: 900,
          color: colour,
          lineHeight: 1,
        },
      },
      value,
    ),
    el(
      "div",
      { style: { display: "flex", fontSize: labelSize, color: palette.ink[200] } },
      label,
    ),
  );
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function tournamentRecapCard(
  input: TournamentRecapInput,
  size: CardSize,
): SatoriElement {
  return cardFrame({
    size,
    brandContext: input.tournamentName,
    userHandle: input.userHandle,
    userId: input.userId,
    body: tournamentRecapBody(input, size),
    accentHex: palette.accent[500],
    locale: input.locale,
    pundit: input.pundit,
  });
}
