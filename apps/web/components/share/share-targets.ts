/**
 * Share-target deep-link builders.
 *
 * Each entry has:
 *  - `id`: stable, lowercase, also the analytics-tracking event target.
 *  - `label`: button copy.
 *  - `iconKey`: visual key — concrete SVG lives in components/share/icons.
 *  - `buildUrl({ url, text })`: returns the http(s)/mailto/etc. URL to
 *    open when the user taps the button.
 *
 * Character-limit notes:
 *  - X (Twitter): 280 chars total, URLs count as 23 — keep `text` ≤ 250.
 *  - WhatsApp: no documented hard limit; keep ≤ 1000 for paste fidelity.
 *  - Telegram: no documented limit; matches WhatsApp in practice.
 *  - Reddit: title ≤ 300 chars.
 *  - Email subject: many clients truncate at 78 chars — keep titles short.
 */

export type ShareTargetId =
  | "native"
  | "whatsapp"
  | "telegram"
  | "twitter"
  | "facebook"
  | "linkedin"
  | "reddit"
  | "email"
  | "copy"
  | "download";

export interface ShareTargetCtx {
  /** Absolute https URL to the public share page. */
  readonly url: string;
  /** Pre-formatted caption (winner + URL not yet appended). */
  readonly text: string;
  /** Email subject / Reddit title (shorter than `text`). */
  readonly subject: string;
}

export interface ShareTarget {
  readonly id: ShareTargetId;
  readonly label: string;
  readonly iconKey: string;
  /**
   * If true the target opens in a new window/tab. Native + copy +
   * download do not (they're handled inline).
   */
  readonly newTab: boolean;
  readonly buildUrl: (ctx: ShareTargetCtx) => string;
}

/**
 * The 9 deep-link targets exposed by the mission spec. Order matters —
 * it's the display order in the modal (most-used networks first).
 */
export const SHARE_TARGETS: readonly ShareTarget[] = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    iconKey: "whatsapp",
    newTab: true,
    buildUrl: ({ text }) => `https://wa.me/?text=${encodeURIComponent(text)}`,
  },
  {
    id: "telegram",
    label: "Telegram",
    iconKey: "telegram",
    newTab: true,
    buildUrl: ({ url, text }) =>
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  },
  {
    id: "twitter",
    label: "X",
    iconKey: "twitter",
    newTab: true,
    buildUrl: ({ url, text }) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(
        // Trim text to 250 chars to leave room for the URL (X counts URLs
        // as 23 chars but our text already contains the URL — strip it
        // before sending).
        text.replace(url, "").trim().slice(0, 250),
      )}&url=${encodeURIComponent(url)}`,
  },
  {
    id: "facebook",
    label: "Facebook",
    iconKey: "facebook",
    newTab: true,
    buildUrl: ({ url }) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    iconKey: "linkedin",
    newTab: true,
    buildUrl: ({ url }) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  },
  {
    id: "reddit",
    label: "Reddit",
    iconKey: "reddit",
    newTab: true,
    buildUrl: ({ url, subject }) =>
      `https://reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(
        subject.slice(0, 300),
      )}`,
  },
  {
    id: "email",
    label: "Email",
    iconKey: "email",
    newTab: false,
    buildUrl: ({ subject, url, text }) =>
      `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text + "\n\n" + url)}`,
  },
  {
    id: "copy",
    label: "Copy link",
    iconKey: "copy",
    newTab: false,
    buildUrl: ({ url }) => url,
  },
  {
    id: "download",
    label: "Download PNG",
    iconKey: "download",
    newTab: false,
    buildUrl: ({ url }) => url, // overridden by ShareModal (uses OG PNG url)
  },
];

/** Lookup helper. */
export function findShareTarget(id: ShareTargetId): ShareTarget | undefined {
  return SHARE_TARGETS.find((t) => t.id === id);
}
