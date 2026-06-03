// Cross-platform command dispatcher.
//
// Lifts command logic out of the grammY-specific handlers so we can run
// the same flows from any inbound transport (Telegram, WhatsApp via the
// Aiva gateway, Slack later if Tim cares).
//
// Contract: caller passes a normalised inbound message; dispatcher returns
// zero or more `DispatchReply`s. Transport layer is responsible for
// rendering parse-mode and posting outbound (TG markdown vs WA `*bold*`
// formatting differs).

import type { Storage, TgUser } from "../storage.js";
import { parseStartPayload } from "../bots/syndicate-factory.js";
import { parseTeamArg } from "../commands/odds.js";

// ---- types --------------------------------------------------------------

export type Source = "telegram" | "whatsapp";

export interface InboundMessage {
  source: Source;
  /** Telegram chat_id (number) or WhatsApp JID (string). */
  sourceId: number | string;
  /** The literal text the user sent. */
  text: string;
  /** Optional language hint for first-time onboarding (Telegram surfaces this). */
  languageCode?: string | null;
  /** Bot's own username, used to build deep-links in replies. */
  botUsername?: string;
}

export interface DispatchReply {
  text: string;
  /** Telegram-style parse mode. WA adapter strips/translates as needed. */
  parseMode?: "Markdown";
  /** When true, transport should not auto-expand link previews. */
  disableLinkPreview?: boolean;
}

export interface DispatchDeps {
  storage: Storage;
  fetch?: typeof fetch;
  /** Override env-var defaults (test injection). */
  env?: {
    apiBase?: string;
    bracketBaseUrl?: string;
    oddsApiBase?: string;
  };
}

// ---- main entry ---------------------------------------------------------

export async function dispatch(
  msg: InboundMessage,
  deps: DispatchDeps,
): Promise<DispatchReply[]> {
  const text = (msg.text ?? "").trim();
  const user = resolveUser(msg, deps.storage);

  if (!text.startsWith("/")) {
    return [
      {
        text: "Try /help to see what I can do. Free-form chat isn't wired up yet.",
      },
    ];
  }

  // Split "/cmd@bot args..." → ["cmd", "args..."].
  const head = text.split(/\s+/, 1)[0];
  const rest = text.slice(head.length).trim();
  const cmd = head.replace(/^\//, "").split("@", 1)[0].toLowerCase();

  switch (cmd) {
    case "start":
      return handleStart(rest, user, msg, deps);
    case "picks":
      return handlePicks(user, deps);
    case "odds":
      return handleOdds(rest, deps);
    case "leaderboard":
      return handleLeaderboard(rest, user, deps);
    case "syndicate":
      return handleSyndicate(rest, user, msg, deps);
    case "help":
      return handleHelp();
    default:
      return [
        {
          text: "Unknown command. Try /help for the list.",
        },
      ];
  }
}

// ---- user resolution ----------------------------------------------------

/**
 * Map an inbound (source, sourceId) onto a `tg_user` row. WhatsApp JIDs are
 * folded onto a stable negative chat_id to avoid colliding with Telegram's
 * positive integer chat_ids. v0.2 will split this into a proper bot_user
 * table per the session note.
 */
function resolveUser(msg: InboundMessage, storage: Storage): TgUser {
  const chatId = chatIdForSource(msg.source, msg.sourceId);
  return storage.upsertUser({
    chat_id: chatId,
    language_code: msg.languageCode ?? null,
  });
}

export function chatIdForSource(
  source: Source,
  sourceId: number | string,
): number {
  if (source === "telegram") {
    if (typeof sourceId !== "number") {
      throw new Error("telegram source requires numeric chat_id");
    }
    return sourceId;
  }
  // WhatsApp: hash the JID into a deterministic negative int. We reserve the
  // negative-int space so we never collide with Telegram (which uses positive
  // ints for private chats and large negatives for supergroups; we stay below
  // -1e15 to avoid both).
  const jid = String(sourceId);
  return -(1e15 + djb2(jid));
}

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    // eslint-disable-next-line no-bitwise
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

// ---- /start -------------------------------------------------------------

function handleStart(
  argline: string,
  _user: TgUser,
  msg: InboundMessage,
  deps: DispatchDeps,
): DispatchReply[] {
  const payload = parseStartPayload(argline || undefined);

  if (payload.kind === "syndicate" && payload.value) {
    const syn = deps.storage.getSyndicateBySlug(payload.value);
    if (!syn) {
      return [
        {
          text:
            `Welcome. I couldn't find a syndicate with slug "${payload.value}". ` +
            "Check the invite link with whoever shared it.",
        },
      ];
    }
    return [
      {
        text: [
          `Welcome to *${syn.name}* — Tournamental syndicate.`,
          ``,
          `Format: ${formatLabel(syn.format)}`,
          `Privacy: ${syn.privacy === "invite_only" ? "invite-only" : "public"}`,
          ``,
          `Tap /picks to see your bracket, /leaderboard to see where the syndicate stands, /help for the rest.`,
        ].join("\n"),
        parseMode: "Markdown",
      },
    ];
  }

  if (payload.kind === "login" && payload.value) {
    const surface = msg.source === "whatsapp" ? "the web tab" : "the web tab";
    return [
      {
        text: `Logging you in... (code ${payload.value}). Head back to ${surface} — it'll update in a sec.`,
      },
    ];
  }

  if (payload.kind === "invite" && payload.value) {
    return [
      {
        text: `Welcome — you were invited by user ${payload.value}. Tap /picks to make your first bracket pick.`,
      },
    ];
  }

  return [
    {
      text: [
        "Welcome to *Tournamental* — the never-finished bracket game.",
        "",
        "Commands:",
        "  /picks — see your bracket",
        "  /odds team:argentina — current market probability",
        "  /leaderboard — your rank",
        "  /syndicate — manage your syndicate",
        "  /help — full command list",
        "",
        "Tap /picks to start.",
      ].join("\n"),
      parseMode: "Markdown",
    },
  ];
}

function formatLabel(f: string): string {
  switch (f) {
    case "winner_take_all":
      return "winner takes all";
    case "podium":
      return "top 3 share";
    case "points":
      return "points league";
    default:
      return f;
  }
}

// ---- /picks -------------------------------------------------------------

function handlePicks(user: TgUser, deps: DispatchDeps): DispatchReply[] {
  const bracketBase =
    deps.env?.bracketBaseUrl ??
    process.env.TOURNAMENTAL_BRACKET_BASE_URL ??
    "https://play.tournamental.com";

  if (!user.user_id) {
    return [
      {
        text: [
          "You're not paired with a Tournamental account yet.",
          "",
          `Open ${bracketBase} and tap "Sign in", or run /start to get a fresh code.`,
        ].join("\n"),
      },
    ];
  }
  return [
    {
      text: [
        "Your bracket — open in the app:",
        `${bracketBase}/u/${user.user_id}/bracket`,
        "",
        "Once the inline-keyboard pick flow ships (doc 13 § Bot commands), you'll be able to lock picks here without leaving chat.",
      ].join("\n"),
      disableLinkPreview: true,
    },
  ];
}

// ---- /odds --------------------------------------------------------------

async function handleOdds(
  argline: string,
  deps: DispatchDeps,
): Promise<DispatchReply[]> {
  if (!argline) {
    return [
      {
        text: "Usage: /odds team:argentina — current Polymarket probability for a team.",
      },
    ];
  }
  const team = parseTeamArg(argline);
  if (!team) {
    return [
      {
        text: `Couldn't read "${argline}". Try /odds team:argentina or /odds team:france.`,
      },
    ];
  }
  const fetchImpl = deps.fetch ?? fetch;
  const oddsBase =
    deps.env?.oddsApiBase ??
    process.env.TOURNAMENTAL_ODDS_API_BASE ??
    "https://api-dev.tournamental.com";
  try {
    const res = await fetchImpl(
      `${oddsBase}/v1/odds/team/${encodeURIComponent(team)}`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) {
      return [
        {
          text: `Couldn't fetch odds for ${team} right now (HTTP ${res.status}). Try again in a moment.`,
        },
      ];
    }
    const body = (await res.json()) as {
      team_code?: string;
      team_name?: string;
      prob_to_win_group?: number;
      prob_to_win_tournament?: number;
    };
    const lines: string[] = [];
    lines.push(`*${body.team_name ?? team}*`);
    if (typeof body.prob_to_win_group === "number") {
      lines.push(`  Win group: ${(body.prob_to_win_group * 100).toFixed(1)}%`);
    }
    if (typeof body.prob_to_win_tournament === "number") {
      lines.push(
        `  Win tournament: ${(body.prob_to_win_tournament * 100).toFixed(1)}%`,
      );
    }
    if (lines.length === 1) {
      lines.push("  No live market data — try again closer to kickoff.");
    }
    return [
      {
        text: lines.join("\n"),
        parseMode: "Markdown",
        disableLinkPreview: true,
      },
    ];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[dispatch /odds] fetch failed", err);
    return [
      { text: "Couldn't reach the odds service right now. Try again in a moment." },
    ];
  }
}

// ---- /leaderboard -------------------------------------------------------

async function handleLeaderboard(
  argline: string,
  user: TgUser,
  deps: DispatchDeps,
): Promise<DispatchReply[]> {
  const fetchImpl = deps.fetch ?? fetch;
  const apiBase =
    deps.env?.apiBase ??
    process.env.TOURNAMENTAL_API_BASE ??
    "https://api-dev.tournamental.com";
  const scope = (argline.trim().toLowerCase() || "global").split(/\s+/)[0];
  const url = `${apiBase}/v1/leaderboard/${encodeURIComponent(scope)}${
    user.user_id ? `?for=${encodeURIComponent(user.user_id)}` : ""
  }`;
  try {
    const res = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      return [
        {
          text: `Leaderboard service is unhappy (HTTP ${res.status}). Try /leaderboard again shortly.`,
        },
      ];
    }
    const body = (await res.json()) as LeaderboardResponse;
    return [{ text: formatLeaderboard(body, user, scope), parseMode: "Markdown" }];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[dispatch /leaderboard] fetch failed", err);
    return [
      { text: "Couldn't reach the leaderboard service. Try again in a moment." },
    ];
  }
}

export interface LeaderboardResponse {
  scope?: string;
  top?: Array<{ rank: number; name: string; points: number }>;
  me?: { rank: number; points: number } | null;
}

export function formatLeaderboard(
  body: LeaderboardResponse,
  user: TgUser,
  fallbackScope: string,
): string {
  const top = (body.top ?? []).slice(0, 10);
  const lines: string[] = [];
  lines.push(`*Leaderboard — ${body.scope ?? fallbackScope}*`);
  if (top.length === 0) {
    lines.push("_No entries yet — be the first to lock a pick._");
  } else {
    for (const row of top) {
      lines.push(`  ${row.rank}. ${row.name} — ${row.points.toLocaleString()} pts`);
    }
  }
  if (body.me) {
    lines.push(``);
    lines.push(
      `Your rank: *#${body.me.rank}* — ${body.me.points.toLocaleString()} pts`,
    );
  } else if (!user.user_id) {
    lines.push(``);
    lines.push("_Pair your account with /start to see your rank._");
  }
  return lines.join("\n");
}

// ---- /syndicate ---------------------------------------------------------

const SLUG_RE = /^[a-z0-9-]{2,40}$/;

function handleSyndicate(
  argline: string,
  user: TgUser,
  msg: InboundMessage,
  deps: DispatchDeps,
): DispatchReply[] {
  if (!argline) {
    return [
      {
        text: [
          "Syndicate commands:",
          "  /syndicate create <slug> <name>",
          "  /syndicate join <slug>",
          "  /syndicate leave <slug>",
          "  /syndicate list",
        ].join("\n"),
      },
    ];
  }

  const tokens = argline.split(/\s+/);
  const sub = tokens[0]?.toLowerCase();

  if (sub === "list") {
    if (!user.user_id) {
      return [{ text: "Pair your account first with /start." }];
    }
    const memberships = deps.storage.listMemberships(user.user_id);
    if (memberships.length === 0) {
      return [
        {
          text: "You're not in any syndicates yet. Try `/syndicate create <slug> <name>`.",
        },
      ];
    }
    const lines = memberships.map(
      (s) => `  • *${s.name}* (\`${s.slug}\`) — ${s.privacy}`,
    );
    return [
      {
        text: ["*Your syndicates*", ...lines].join("\n"),
        parseMode: "Markdown",
      },
    ];
  }

  if (sub === "create") {
    if (!user.user_id) {
      return [{ text: "Pair your account first with /start." }];
    }
    const rawSlug = tokens[1] ?? "";
    const name = tokens.slice(2).join(" ").slice(0, 80).trim();
    if (!SLUG_RE.test(rawSlug)) {
      return [
        {
          text: "Slug must be 2–40 lowercase letters, digits, or dashes. Example: `jasons-office`.",
        },
      ];
    }
    if (!name) {
      return [
        {
          text: "Give it a name. Example: `/syndicate create jasons-office Jason's Office Sweepstakes`",
        },
      ];
    }
    const existing = deps.storage.getSyndicateBySlug(rawSlug);
    if (existing) {
      return [
        {
          text: `Slug \`${rawSlug}\` is taken. Try another.`,
          parseMode: "Markdown",
        },
      ];
    }
    const id = `syn_${rawSlug}_${Date.now().toString(36)}`;
    const created = deps.storage.createSyndicate({
      id,
      slug: rawSlug,
      name,
      owner_user_id: user.user_id,
      format: "points",
      privacy: "invite_only",
    });
    const inviteLink =
      msg.source === "telegram" && msg.botUsername
        ? `https://t.me/${msg.botUsername}?start=syn_${created.slug}`
        : `Share slug \`${created.slug}\` and ask members to send /start syn_${created.slug}.`;
    return [
      {
        text: [
          `*${created.name}* created.`,
          msg.source === "telegram" ? `Invite link: ${inviteLink}` : inviteLink,
          ``,
          `Default format is "points league" and privacy "invite-only" — change in the web app.`,
        ].join("\n"),
        parseMode: "Markdown",
        disableLinkPreview: true,
      },
    ];
  }

  if (sub === "join") {
    if (!user.user_id) {
      return [{ text: "Pair your account first with /start." }];
    }
    const slug = tokens[1]?.toLowerCase() ?? "";
    if (!SLUG_RE.test(slug)) {
      return [
        { text: "Usage: `/syndicate join <slug>`", parseMode: "Markdown" },
      ];
    }
    const syn = deps.storage.getSyndicateBySlug(slug);
    if (!syn) {
      return [
        {
          text: `No syndicate with slug \`${slug}\`.`,
          parseMode: "Markdown",
        },
      ];
    }
    // Invite-only syndicates can only be joined via the /start deep-link
    // path the owner shares (e.g. `https://t.me/<bot>?start=syn_<slug>`).
    // Bare `/syndicate join <slug>` would otherwise let anyone walk in
    // by guessing a slug. Tracked: SEC-ADMIN-10.
    if (syn.privacy === "invite_only") {
      return [
        {
          text: `*${syn.name}* is invite-only. Ask the owner for an invite link.`,
          parseMode: "Markdown",
        },
      ];
    }
    deps.storage.addMember(syn.id, user.user_id, "member");
    return [
      {
        text: `Joined *${syn.name}*. /leaderboard ${syn.slug} to see standings.`,
        parseMode: "Markdown",
      },
    ];
  }

  if (sub === "leave") {
    if (!user.user_id) {
      return [{ text: "Pair your account first with /start." }];
    }
    const slug = tokens[1]?.toLowerCase() ?? "";
    const syn = deps.storage.getSyndicateBySlug(slug);
    if (!syn) {
      return [
        {
          text: `No syndicate with slug \`${slug}\`.`,
          parseMode: "Markdown",
        },
      ];
    }
    deps.storage.removeMember(syn.id, user.user_id);
    return [{ text: `Left *${syn.name}*.`, parseMode: "Markdown" }];
  }

  return [
    {
      text: "Unknown sub-command. Try /syndicate (no args) for the help list.",
    },
  ];
}

// ---- /help --------------------------------------------------------------

function handleHelp(): DispatchReply[] {
  return [
    {
      text: [
        "*Tournamental — command list*",
        "",
        "  /start — connect your bracket / accept a syndicate invite",
        "  /picks — view your bracket",
        "  /odds team:argentina — live market probability",
        "  /leaderboard — your rank (global by default; pass `country`, `week`, `friends`)",
        "  /syndicate create <slug> <name> — start a private league",
        "  /syndicate join <slug> — join an existing league",
        "  /syndicate leave <slug> — leave",
        "  /syndicate list — your leagues",
        "  /help — this message",
        "",
        "Notification prefs are managed in-app (settings → notifications). The bot honours quiet hours (default 22:00–08:00 in your timezone) and a 3-push-per-day cap unless you enable match-day mode.",
      ].join("\n"),
      parseMode: "Markdown",
      disableLinkPreview: true,
    },
  ];
}
