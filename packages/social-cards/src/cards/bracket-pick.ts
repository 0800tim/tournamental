/**
 * `bracket-pick` — viral share card.
 *
 * Distinct from `bracket-prediction` (the long-list-of-picks card). This
 * one is a compact, social-friendly hero: the user's predicted **winner**
 * front-and-centre, with their R16 → QF → SF → FINAL route shown as a
 * horizontal flag-strip beneath.
 *
 * The card is intentionally low-information-density. The viral hypothesis
 * is "I picked France to win the World Cup, make yours" — friends should
 * grok the headline in 1.5 seconds while scrolling a feed.
 */

import { el, type SatoriElement } from "../jsdl.js";
import { cardFrame, clamp } from "../layout.js";
import { palette, type CardSize } from "../theme.js";
import type { BracketPickInput } from "../types.js";

const STAGE_LABEL: Record<BracketPickInput["route"][number]["stage"], string> = {
  R16: "Round of 16",
  QF: "Quarter-final",
  SF: "Semi-final",
  FINAL: "Final",
};

const STAGE_SHORT: Record<BracketPickInput["route"][number]["stage"], string> = {
  R16: "R16",
  QF: "QF",
  SF: "SF",
  FINAL: "F",
};

export function bracketPickBody(
  input: BracketPickInput,
  size: CardSize,
): SatoriElement {
  const {
    tournamentName,
    userHandle,
    winnerName,
    winnerFlagEmoji,
    route,
    tagline,
    longShotCount,
  } = input;

  const isStory = size === "story";
  const titleSize = isStory ? 84 : 60;
  const winnerSize = isStory ? 132 : 108;
  const flagSize = isStory ? 110 : 90;
  const subSize = isStory ? 36 : 28;
  const stageSize = isStory ? 28 : 22;
  const stageNameSize = isStory ? 36 : 28;

  const headline = tagline ?? `Picked ${winnerName} to lift the trophy`;

  // The Final is rendered last + bigger via the route loop; non-Final
  // stages render smaller / muted.
  const stagesInOrder = route.slice(0, 4);

  return el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        padding: isStory ? "60px 60px 32px" : "48px 60px 32px",
        gap: isStory ? 32 : 22,
      },
    },
    // Top eyebrow: tournament + "@handle's pick"
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
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
        "My Pick",
      ),
      el(
        "div",
        {
          style: {
            display: "flex",
            color: palette.ink[200],
            fontSize: subSize,
            fontWeight: 600,
          },
        },
        `${clamp(tournamentName, 28)} - predicted by @${clamp(userHandle, 18)}`,
      ),
    ),
    // Winner spotlight
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: 10,
        },
      },
      el(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 22,
          },
        },
        winnerFlagEmoji
          ? el(
              "div",
              {
                style: {
                  display: "flex",
                  fontSize: flagSize,
                  lineHeight: 1,
                },
              },
              winnerFlagEmoji,
            )
          : null,
        el(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
            },
          },
          el(
            "div",
            {
              style: {
                display: "flex",
                fontSize: titleSize,
                fontWeight: 900,
                color: "#fff",
                lineHeight: 1,
                letterSpacing: -1,
              },
            },
            clamp(winnerName, 18),
          ),
          el(
            "div",
            {
              style: {
                display: "flex",
                fontSize: subSize,
                color: palette.flame[400],
                fontWeight: 700,
                marginTop: 6,
                letterSpacing: 0.4,
                textTransform: "uppercase",
              },
            },
            "to lift the trophy",
          ),
        ),
      ),
      el(
        "div",
        {
          style: {
            display: "flex",
            fontSize: subSize,
            color: palette.ink[200],
          },
        },
        clamp(headline, 64),
      ),
    ),
    // Route strip — R16 -> QF -> SF -> FINAL
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          alignItems: "stretch",
          gap: 12,
          marginTop: 4,
        },
      },
      ...stagesInOrder.map((step, idx) => {
        const isFinal = step.stage === "FINAL";
        return el(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
              flex: 1,
              padding: "16px 12px",
              background: isFinal
                ? palette.flame[600]
                : palette.ink[800],
              borderRadius: 16,
              border: isFinal
                ? `2px solid ${palette.flame[400]}`
                : `1px solid ${palette.ink[700]}`,
            },
          },
          el(
            "div",
            {
              style: {
                display: "flex",
                fontSize: stageSize,
                color: isFinal ? "#fff" : palette.ink[200],
                fontWeight: 700,
                letterSpacing: 0.4,
                textTransform: "uppercase",
              },
            },
            STAGE_SHORT[step.stage] ?? STAGE_LABEL[step.stage] ?? "?",
          ),
          el(
            "div",
            {
              style: {
                display: "flex",
                fontSize: isFinal ? stageNameSize + 6 : stageNameSize,
                color: "#fff",
                fontWeight: 900,
                lineHeight: 1.05,
                textAlign: "center",
              },
            },
            clamp(step.teamCode || step.teamName, 6),
          ),
          step.flagEmoji
            ? el(
                "div",
                {
                  style: {
                    display: "flex",
                    fontSize: isFinal ? 44 : 32,
                    lineHeight: 1,
                  },
                },
                step.flagEmoji,
              )
            : null,
          // Add arrow separator to non-final cells (only conceptual; in
          // satori we keep cells equal width with gap so no arrow node).
          idx === stagesInOrder.length - 1 ? null : null,
        );
      }),
    ),
    longShotCount !== undefined && longShotCount > 0
      ? el(
          "div",
          {
            style: {
              display: "flex",
              fontSize: subSize - 6,
              color: palette.accent[400],
              fontWeight: 700,
            },
          },
          `+${longShotCount} long-shot ${longShotCount === 1 ? "pick" : "picks"} - more points if they hit`,
        )
      : null,
  );
}

export function bracketPickCard(
  input: BracketPickInput,
  size: CardSize,
): SatoriElement {
  return cardFrame({
    size,
    brandContext: input.tournamentName,
    userHandle: input.userHandle,
    userId: input.userId,
    body: bracketPickBody(input, size),
    accentHex: palette.flame[500],
    locale: input.locale,
    pundit: input.pundit,
  });
}
