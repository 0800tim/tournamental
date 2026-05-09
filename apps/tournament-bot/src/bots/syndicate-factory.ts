// Syndicate "factory" — placeholder for Option B (per-syndicate fresh bots
// via BotFather). For v0 we ship Option A only (deep-link param on the main
// bot). This module documents the deep-link contract so the rest of the
// codebase has one place to import from.
//
// Deep-link format:
//   https://t.me/<MAIN_BOT_USERNAME>?start=syn_<slug>
//
// `<slug>` matches the syndicate.slug column in storage.ts. When the main
// bot sees `/start syn_jasonseoffice`, the start handler reads the syndicate
// row and steers the user into the syndicate-flavoured onboarding.

export interface SyndicateDeepLink {
  bot_username: string;
  slug: string;
  url: string;
}

export function buildSyndicateDeepLink(
  bot_username: string,
  slug: string,
): SyndicateDeepLink {
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
    throw new Error(
      `invalid syndicate slug ${JSON.stringify(slug)}; must match /^[a-z0-9-]{2,40}$/`,
    );
  }
  return {
    bot_username,
    slug,
    url: `https://t.me/${bot_username}?start=syn_${slug}`,
  };
}

export function parseStartPayload(payload: string | undefined): {
  kind: "syndicate" | "login" | "invite" | "none";
  value: string | null;
} {
  if (!payload) return { kind: "none", value: null };
  if (payload.startsWith("syn_")) {
    return { kind: "syndicate", value: payload.slice(4) };
  }
  if (payload.startsWith("login_")) {
    return { kind: "login", value: payload.slice(6) };
  }
  if (payload.startsWith("invite_")) {
    return { kind: "invite", value: payload.slice(7) };
  }
  return { kind: "none", value: null };
}

// Stub: future Option B implementation will create a fresh bot via
// BotFather's HTTP-bot-management API once the syndicate count justifies
// the operational toil. Tracked in IDEAS.md.
export async function createSyndicateBotViaBotFather(): Promise<never> {
  throw new Error(
    "Option B (per-syndicate bots) is not implemented in v0. Use deep-link " +
      "Option A via buildSyndicateDeepLink().",
  );
}
