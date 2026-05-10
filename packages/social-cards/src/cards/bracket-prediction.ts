import { el, type SatoriElement } from "../jsdl.js";
import { cardFrame, clamp } from "../layout.js";
import { palette, type CardSize } from "../theme.js";
import type { BracketPredictionInput } from "../types.js";

const PICK_LIMIT = 16;

export function bracketPredictionBody(
  input: BracketPredictionInput,
  size: CardSize,
): SatoriElement {
  const { tournamentName, picks, predictionIq, userHandle } = input;
  const visible = picks.slice(0, PICK_LIMIT);
  const overflow = Math.max(0, picks.length - PICK_LIMIT);

  const titleSize = size === "story" ? 88 : 64;
  const subSize = size === "story" ? 36 : 28;

  return el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        padding: size === "story" ? "56px 56px 32px" : "44px 56px 32px",
        gap: 24,
      },
    },
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        },
      },
      el(
        "div",
        {
          style: {
            display: "flex",
            background: palette.flame[500],
            color: palette.ink[900],
            padding: "6px 14px",
            borderRadius: 999,
            fontSize: subSize - 4,
            fontWeight: 900,
            letterSpacing: 0.6,
            textTransform: "uppercase",
          },
        },
        "Bracket Saved",
      ),
      predictionIq !== undefined
        ? el(
            "div",
            {
              style: {
                display: "flex",
                color: palette.accent[400],
                fontSize: subSize,
                fontWeight: 700,
              },
            },
            `Prediction IQ ${predictionIq.toFixed(1)}`,
          )
        : null,
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: 6,
        },
      },
      el(
        "div",
        { style: { display: "flex", fontSize: titleSize, fontWeight: 900, color: "#fff", lineHeight: 1.05 } },
        `@${userHandle}'s ${clamp(tournamentName, 24)}`,
      ),
      el(
        "div",
        { style: { display: "flex", fontSize: subSize, color: palette.ink[200] } },
        "bracket — saved. Beat it.",
      ),
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          flex: 1,
          background: palette.ink[800],
          borderRadius: 24,
          padding: 28,
          gap: 8,
          minHeight: 0,
        },
      },
      ...visible.map((p) =>
        el(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: size === "story" ? 28 : 22,
            },
          },
          el(
            "div",
            { style: { display: "flex", color: palette.ink[200] } },
            clamp(p.round, 22),
          ),
          el(
            "div",
            { style: { display: "flex", color: "#fff", fontWeight: 700 } },
            clamp(p.pick, 22),
          ),
        ),
      ),
      overflow > 0
        ? el(
            "div",
            { style: { display: "flex", color: palette.ink[200], fontSize: 20, marginTop: 8 } },
            `+${overflow} more picks`,
          )
        : null,
    ),
  );
}

export function bracketPredictionCard(
  input: BracketPredictionInput,
  size: CardSize,
): SatoriElement {
  return cardFrame({
    size,
    brandContext: input.tournamentName,
    userHandle: input.userHandle,
    userId: input.userId,
    body: bracketPredictionBody(input, size),
    accentHex: palette.flame[500],
    locale: input.locale,
    pundit: input.pundit,
  });
}
