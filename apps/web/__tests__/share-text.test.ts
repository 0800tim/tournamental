/**
 * Vitest, share-text helpers.
 *
 * Pure-function coverage of the URL/text composition layer used by both
 * the inline LockSummary share button and the full Save & share page.
 * Catches regressions in the platform-deep-link patterns (every
 * mainstream sharer requires its own param shape) and confirms the
 * share URL is stable for a given guid.
 */

import { describe, expect, it } from "vitest";

import {
  PLAY_ORIGIN,
  buildOgImageUrl,
  buildShareLinks,
  buildShareText,
  buildShareTitle,
  ogDownloadFilename,
  resolveShareGuid,
  shareDisplayUrlFor,
  shareUrlFor,
} from "../lib/share/share-text";

describe("share URL composition", () => {
  it("shareUrlFor produces a stable play.tournamental.com/s/<guid> URL", () => {
    expect(shareUrlFor("abc123")).toBe(`${PLAY_ORIGIN}/s/abc123`);
  });

  it("URL is stable across calls for the same guid", () => {
    const a = shareUrlFor("alice");
    const b = shareUrlFor("alice");
    expect(a).toBe(b);
  });

  it("URL-encodes unsafe characters in the guid", () => {
    expect(shareUrlFor("user with spaces")).toBe(`${PLAY_ORIGIN}/s/user%20with%20spaces`);
  });

  it("shareDisplayUrlFor strips the protocol for a tidy text-field display", () => {
    expect(shareDisplayUrlFor("abc")).toBe("play.tournamental.com/s/abc");
  });
});

describe("share text composition", () => {
  it("uses the champion-driven copy when bracket is complete", () => {
    const t = buildShareText({ champion: "Argentina", guid: "g1", isComplete: true });
    expect(t).toContain("Argentina");
    expect(t).toContain("Just locked in");
    expect(t).toContain(`${PLAY_ORIGIN}/s/g1`);
  });

  it("uses the building-bracket copy when bracket is incomplete", () => {
    const t = buildShareText({ champion: null, guid: "g2", isComplete: false });
    expect(t).toContain("I'm building");
    expect(t).toContain("play.tournamental.com/world-cup-2026");
  });

  it("falls back to incomplete copy when champion is the TBD sentinel", () => {
    const t = buildShareText({ champion: "TBD", guid: "g3", isComplete: true });
    expect(t).toContain("I'm building");
  });

  it("buildShareTitle returns a stable navigator.share title", () => {
    expect(buildShareTitle()).toBe("My Tournamental World Cup 2026 bracket");
  });
});

describe("platform deep-links", () => {
  const links = buildShareLinks({ champion: "Argentina", guid: "tim", isComplete: true });

  it("WhatsApp follows the wa.me/?text=<encoded> pattern", () => {
    expect(links.whatsapp.startsWith("https://wa.me/?text=")).toBe(true);
    expect(links.whatsapp).toContain(encodeURIComponent(`${PLAY_ORIGIN}/s/tim`));
    expect(links.whatsapp).toContain(encodeURIComponent("Argentina"));
  });

  it("Telegram splits url + text into separate params", () => {
    expect(links.telegram.startsWith("https://t.me/share/url?")).toBe(true);
    expect(links.telegram).toContain(`url=${encodeURIComponent(`${PLAY_ORIGIN}/s/tim`)}`);
    expect(links.telegram).toContain("text=");
  });

  it("X uses twitter.com/intent/tweet with text + url params", () => {
    expect(links.x.startsWith("https://twitter.com/intent/tweet?")).toBe(true);
    expect(links.x).toContain(`url=${encodeURIComponent(`${PLAY_ORIGIN}/s/tim`)}`);
    expect(links.x).toContain("text=");
  });

  it("Facebook sharer takes only `u`", () => {
    expect(links.facebook.startsWith("https://www.facebook.com/sharer/sharer.php?u=")).toBe(true);
    expect(links.facebook).toContain(encodeURIComponent(`${PLAY_ORIGIN}/s/tim`));
  });

  it("Email is a mailto: with subject + body", () => {
    expect(links.email.startsWith("mailto:?")).toBe(true);
    expect(links.email).toContain("subject=");
    expect(links.email).toContain("body=");
  });
});

describe("OG image URL", () => {
  it("includes bracket_id, handle, winner, and size", () => {
    const url = buildOgImageUrl({
      bracketId: "b1",
      handle: "tim",
      winner: "ARG",
      size: "portrait",
    });
    expect(url).toContain("bracket_id=b1");
    expect(url).toContain("handle=tim");
    expect(url).toContain("winner=ARG");
    expect(url).toContain("size=portrait");
    expect(url.startsWith("/api/og/bracket?")).toBe(true);
  });

  it("omits optional params when not given", () => {
    const url = buildOgImageUrl({ bracketId: "b2" });
    expect(url).toBe("/api/og/bracket?bracket_id=b2");
  });

  it("ogDownloadFilename slugifies the handle + tags the size", () => {
    expect(ogDownloadFilename({ bracketId: "b3", handle: "Tim Wells!", size: "square" }))
      .toBe("tournamental-tim-wells-square.png");
  });
});

describe("resolveShareGuid", () => {
  it("prefers the auth user id when present", () => {
    expect(resolveShareGuid({ authUserId: "auth-u", bracketId: "b" })).toBe("auth-u");
  });

  it("falls back to the bracketId when there's no auth", () => {
    expect(resolveShareGuid({ authUserId: null, bracketId: "b-hash" })).toBe("b-hash");
  });

  it("returns the sentinel 'anonymous' when neither is present", () => {
    expect(resolveShareGuid({ authUserId: null, bracketId: null })).toBe("anonymous");
  });

  it("does not regenerate on subsequent calls for the same input (stability)", () => {
    const a = resolveShareGuid({ bracketId: "x" });
    const b = resolveShareGuid({ bracketId: "x" });
    expect(a).toBe(b);
  });
});
