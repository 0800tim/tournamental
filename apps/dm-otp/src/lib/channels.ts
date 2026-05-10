/**
 * DM-OTP channel registry.
 *
 * The single source of truth for which channels exist, what their
 * deep-link / open-app URL is, and whether they are currently
 * available, partner-gated, or coming-soon. The web UI consumes
 * GET /v1/auth/dm-otp/channels and renders one button per channel
 * with the right deep-link.
 *
 * To add a channel:
 *   1. Add an entry below.
 *   2. Add an outbound reply adapter at lib/replies/<id>.ts.
 *   3. Add an inbound webhook receiver at routes/webhooks/<id>.ts and
 *      register it in src/index.ts.
 *   4. Add tests covering signature verification, inbound parse, and
 *      outbound reply.
 */

export type ChannelStatus = 'available' | 'coming_soon' | 'partner_gated';

export interface ChannelDescriptor {
  /** Stable id used in URLs and config. lower-snake. */
  id: string;
  /** Display label for UI. */
  label: string;
  /** Status flag for the public /channels endpoint. */
  status: ChannelStatus;
  /**
   * The link / URI that opens the chat with the bot pre-filled with
   * "log in" where the platform allows. {{token}} placeholders are
   * substituted server-side from env vars at request time.
   */
  deepLink: string;
  /** Suggested message the user should send. */
  prompt: string;
  /** Free-form note for the website (UX copy). */
  note?: string;
  /** Whether the OTP is delivered as a 6-digit code or a click-link. */
  delivery: 'code' | 'magic_link';
  /** Env var that must be present for the channel to be live. */
  envFlag: string;
}

/**
 * The deep-link template references env vars; resolve() substitutes
 * them at request time so we never bake handles or IDs into the
 * source.
 */
function resolveTemplate(tmpl: string): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key) => process.env[key] ?? '');
}

const CHANNELS: ChannelDescriptor[] = [
  // --- The original four (framework PR) ---
  {
    id: 'telegram',
    label: 'Telegram',
    status: 'available',
    deepLink: 'https://t.me/{{TELEGRAM_BOT_USERNAME}}?start=login',
    prompt: 'log in',
    delivery: 'code',
    envFlag: 'TELEGRAM_BOT_TOKEN',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    status: 'available',
    deepLink:
      'https://wa.me/{{WHATSAPP_BOT_NUMBER}}?text={{LOGIN_PHRASE_ENCODED}}',
    prompt: 'log in',
    delivery: 'code',
    envFlag: 'WHATSAPP_PHONE_NUMBER_ID',
  },
  {
    id: 'messenger',
    label: 'Messenger',
    status: 'available',
    deepLink: 'https://m.me/{{MESSENGER_PAGE_USERNAME}}?ref=login',
    prompt: 'log in',
    delivery: 'code',
    envFlag: 'META_PAGE_ACCESS_TOKEN',
  },
  {
    id: 'instagram',
    label: 'Instagram',
    status: 'available',
    deepLink: 'https://ig.me/m/{{INSTAGRAM_BOT_USERNAME}}',
    prompt: 'log in',
    delivery: 'code',
    envFlag: 'INSTAGRAM_PAGE_ACCESS_TOKEN',
  },

  // --- Channels added by the expansion PR ---
  {
    id: 'discord',
    label: 'Discord',
    status: 'available',
    deepLink: 'discord:///users/{{DISCORD_BOT_USER_ID}}',
    prompt: 'log in',
    note: 'Open Discord, message the bot, and send "log in".',
    delivery: 'code',
    envFlag: 'DISCORD_BOT_TOKEN',
  },
  {
    id: 'x',
    label: 'X (Twitter)',
    status: 'partner_gated',
    deepLink:
      'https://x.com/messages/compose?recipient_id={{X_BOT_USER_ID}}&text={{LOGIN_PHRASE_ENCODED}}',
    prompt: 'log in',
    note: 'Requires X API Pro tier and Account Activity API allow-listing.',
    delivery: 'code',
    envFlag: 'X_BEARER_TOKEN',
  },
  {
    id: 'reddit',
    label: 'Reddit',
    status: 'available',
    deepLink:
      'https://www.reddit.com/message/compose/?to={{REDDIT_BOT_USERNAME}}&subject=login&message={{LOGIN_PHRASE_ENCODED}}',
    prompt: 'log in',
    note: 'Inbox is polled every 30 seconds.',
    delivery: 'code',
    envFlag: 'REDDIT_CLIENT_ID',
  },
  {
    id: 'threads',
    label: 'Threads',
    status: 'available',
    deepLink: 'https://www.threads.net/@{{THREADS_BOT_USERNAME}}',
    prompt: 'log in',
    delivery: 'code',
    envFlag: 'THREADS_PAGE_ACCESS_TOKEN',
  },
  {
    id: 'slack',
    label: 'Slack',
    status: 'available',
    deepLink: 'slack://user?team={{SLACK_WORKSPACE_ID}}&id={{SLACK_BOT_USER_ID}}',
    prompt: 'log in',
    delivery: 'code',
    envFlag: 'SLACK_BOT_TOKEN',
  },
  {
    id: 'mastodon',
    label: 'Mastodon',
    status: 'available',
    deepLink: 'https://{{MASTODON_INSTANCE}}/@{{MASTODON_BOT_USERNAME}}',
    prompt: 'log in',
    note: 'Mention the bot with visibility set to direct.',
    delivery: 'code',
    envFlag: 'MASTODON_ACCESS_TOKEN',
  },
  {
    id: 'line',
    label: 'LINE',
    status: 'available',
    deepLink:
      'https://line.me/R/oaMessage/{{LINE_BOT_BASIC_ID}}/?{{LOGIN_PHRASE_ENCODED}}',
    prompt: 'log in',
    delivery: 'code',
    envFlag: 'LINE_CHANNEL_ACCESS_TOKEN',
  },
  {
    id: 'viber',
    label: 'Viber',
    status: 'available',
    deepLink:
      'viber://pa?chatURI={{VIBER_BOT_URI}}&text={{LOGIN_PHRASE_ENCODED}}',
    prompt: 'log in',
    delivery: 'code',
    envFlag: 'VIBER_AUTH_TOKEN',
  },
  {
    id: 'teams',
    label: 'Microsoft Teams',
    status: 'available',
    deepLink:
      'https://teams.microsoft.com/l/chat/0/0?users=bot:{{TEAMS_BOT_HANDLE}}',
    prompt: 'log in',
    delivery: 'code',
    envFlag: 'MS_BOT_APP_ID',
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    status: 'partner_gated',
    deepLink: 'https://www.linkedin.com/messaging/compose/?recipient={{LINKEDIN_BOT_VANITY}}',
    prompt: 'log in',
    note: 'Requires LinkedIn Marketing Developer Platform partner approval.',
    delivery: 'code',
    envFlag: 'LINKEDIN_ACCESS_TOKEN',
  },
  {
    id: 'signal',
    label: 'Signal',
    status: 'available',
    deepLink: 'https://signal.me/#p/{{SIGNAL_BOT_NUMBER}}',
    prompt: 'log in',
    note: 'Self-hosted signal-cli REST gateway required (one per number).',
    delivery: 'code',
    envFlag: 'SIGNAL_API_URL',
  },
  {
    id: 'email',
    label: 'Email',
    status: 'available',
    deepLink:
      'mailto:{{EMAIL_LOGIN_ADDRESS}}?subject=log%20in&body={{LOGIN_PHRASE_ENCODED}}',
    prompt: 'log in',
    note: 'Reply email contains a one-tap magic link, not a 6-digit code.',
    delivery: 'magic_link',
    envFlag: 'EMAIL_SMTP_HOST',
  },
];

export function listChannels(): Array<
  ChannelDescriptor & { resolvedDeepLink: string; configured: boolean }
> {
  return CHANNELS.map((c) => ({
    ...c,
    resolvedDeepLink: resolveTemplate(c.deepLink),
    configured: Boolean(process.env[c.envFlag]),
  }));
}

export function getChannel(id: string): ChannelDescriptor | undefined {
  return CHANNELS.find((c) => c.id === id);
}

/**
 * Channels that are LIVE for the website's start-info button row:
 * status === "available" AND env-configured (or NODE_ENV !== production
 * so dev shows everything for testing).
 */
export function visibleChannels(): ReturnType<typeof listChannels> {
  const all = listChannels();
  if (process.env.NODE_ENV !== 'production') return all;
  return all.filter((c) => c.status === 'available' && c.configured);
}
