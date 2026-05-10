import { el, type SatoriElement } from "../jsdl.js";
import { cardFrame, clamp } from "../layout.js";
import { palette, type CardSize } from "../theme.js";
import type { ReferralInviteInput } from "../types.js";

export function referralInviteBody(
  input: ReferralInviteInput,
  size: CardSize,
): SatoriElement {
  const { inviteHeadline, bonusTokens, tournamentName, userHandle } = input;
  const isStory = size === "story";

  const headlineSize = isStory ? 110 : 76;
  const subSize = isStory ? 36 : 26;
  const tokenSize = isStory ? 200 : 130;

  const headline =
    inviteHeadline ??
    (tournamentName
      ? `@${userHandle} wants you in for the ${tournamentName}.`
      : `@${userHandle} wants you on Tournamental.`);

  return el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        padding: isStory ? "56px 56px 32px" : "44px 56px 32px",
        gap: 26,
        justifyContent: "center",
      },
    },
    el(
      "div",
      {
        style: {
          display: "flex",
          fontSize: headlineSize,
          fontWeight: 900,
          color: "#fff",
          lineHeight: 1.0,
          letterSpacing: -1,
        },
      },
      clamp(headline, isStory ? 60 : 80),
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 28,
          background: palette.ink[800],
          borderRadius: 24,
          padding: isStory ? 36 : 24,
          alignSelf: "flex-start",
        },
      },
      el(
        "div",
        {
          style: {
            display: "flex",
            fontSize: tokenSize,
            fontWeight: 900,
            color: palette.flame[500],
            lineHeight: 1,
          },
        },
        `+${bonusTokens}`,
      ),
      el(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: 4,
          },
        },
        el(
          "div",
          { style: { display: "flex", fontSize: subSize, color: "#fff", fontWeight: 700 } },
          "bonus tokens on signup",
        ),
        el(
          "div",
          { style: { display: "flex", fontSize: subSize - 4, color: palette.ink[200] } },
          "Use them in any tournament",
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
          lineHeight: 1.35,
          maxWidth: isStory ? 940 : 1040,
        },
      },
      "Predict every match. Watch them play out in 3D. Climb the global leaderboard.",
    ),
  );
}

export function referralInviteCard(
  input: ReferralInviteInput,
  size: CardSize,
): SatoriElement {
  return cardFrame({
    size,
    brandContext: input.tournamentName ?? "Join Tournamental",
    userHandle: input.userHandle,
    userId: input.userId,
    body: referralInviteBody(input, size),
    accentHex: palette.flame[500],
    locale: input.locale,
    pundit: input.pundit,
  });
}
