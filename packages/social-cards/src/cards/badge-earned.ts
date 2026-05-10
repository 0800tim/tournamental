import { el, type SatoriElement } from "../jsdl.js";
import { cardFrame, clamp } from "../layout.js";
import { palette, type CardSize } from "../theme.js";
import type { BadgeEarnedInput } from "../types.js";

const TIER_COLOURS: Record<BadgeEarnedInput["badgeTier"], string> = {
  bronze: "#a86b3c",
  silver: "#bfc7d2",
  gold: "#e7b53a",
  platinum: "#cfd6e0",
  mythic: "#b266ff",
};

const TIER_LABELS: Record<BadgeEarnedInput["badgeTier"], string> = {
  bronze: "Bronze badge",
  silver: "Silver badge",
  gold: "Gold badge",
  platinum: "Platinum badge",
  mythic: "Mythic badge",
};

export function badgeEarnedBody(
  input: BadgeEarnedInput,
  size: CardSize,
): SatoriElement {
  const { badgeTitle, badgeTier, badgeDescription, userHandle } = input;
  const isStory = size === "story";

  const titleSize = isStory ? 110 : 76;
  const tierSize = isStory ? 36 : 26;
  const descSize = isStory ? 32 : 26;

  const tierColour = TIER_COLOURS[badgeTier];

  return el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        padding: isStory ? "56px 56px 32px" : "44px 56px 32px",
        gap: 24,
        justifyContent: "center",
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
        },
      },
      el(
        "div",
        {
          style: {
            display: "flex",
            background: tierColour,
            color: palette.ink[900],
            padding: "8px 18px",
            borderRadius: 999,
            fontSize: tierSize,
            fontWeight: 900,
            letterSpacing: 0.8,
            textTransform: "uppercase",
          },
        },
        TIER_LABELS[badgeTier],
      ),
      el(
        "div",
        { style: { display: "flex", color: palette.ink[200], fontSize: tierSize } },
        `Awarded to @${userHandle}`,
      ),
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          fontSize: titleSize,
          fontWeight: 900,
          color: "#fff",
          lineHeight: 1.0,
          letterSpacing: -1,
        },
      },
      clamp(badgeTitle, 24),
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          fontSize: descSize,
          color: palette.ink[200],
          lineHeight: 1.35,
          maxWidth: isStory ? 940 : 1040,
        },
      },
      clamp(badgeDescription, isStory ? 220 : 160),
    ),
  );
}

export function badgeEarnedCard(
  input: BadgeEarnedInput,
  size: CardSize,
): SatoriElement {
  return cardFrame({
    size,
    brandContext: TIER_LABELS[input.badgeTier],
    userHandle: input.userHandle,
    userId: input.userId,
    body: badgeEarnedBody(input, size),
    accentHex: TIER_COLOURS[input.badgeTier],
    locale: input.locale,
    pundit: input.pundit,
  });
}

export const _internal = { TIER_COLOURS, TIER_LABELS };
