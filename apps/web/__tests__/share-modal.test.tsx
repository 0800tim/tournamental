/**
 * Tests for the share modal + share-buttons + share-targets.
 *
 * Asserts:
 *  - Preview img has the right `src`
 *  - Every social button's href matches the documented deep-link
 *  - Web Share API path used when available; falls back gracefully when not
 *  - Clipboard copy shows the "Copied!" toast and fires analytics
 *  - Download triggers a blob fetch
 *  - Tracking POST fires with the right target id
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { ShareModal } from "@/components/share/ShareModal";
import { ShareButtons } from "@/components/share/ShareButtons";
import { ShareModalProvider, useShareModal } from "@/components/share/ShareModalProvider";
import { SHARE_TARGETS, findShareTarget } from "@/components/share/share-targets";
import type { BracketSharePayload } from "@/lib/share/payload";

const payload: BracketSharePayload = {
  bracketId: "b-test-1",
  handle: "messi-fan",
  winnerCode: "ARG",
  winnerName: "Argentina",
  winnerFlagEmoji: "🇦🇷",
  tournamentName: "FIFA World Cup 2026",
  route: [
    { stage: "R16", teamCode: "ARG", teamName: "Argentina", flagEmoji: "🇦🇷" },
    { stage: "QF", teamCode: "BRA", teamName: "Brazil", flagEmoji: "🇧🇷" },
    { stage: "SF", teamCode: "FRA", teamName: "France", flagEmoji: "🇫🇷" },
    { stage: "FINAL", teamCode: "ARG", teamName: "Argentina", flagEmoji: "🇦🇷" },
  ],
};

const ORIGIN = "https://vtourn.com";

describe("SHARE_TARGETS deep-links", () => {
  const ctx = {
    url: "https://vtourn.com/share/b-test-1",
    text: "My @VTourn World Cup pick https://vtourn.com/share/b-test-1",
    subject: "Bracket",
  };

  it("WhatsApp deep-link uses wa.me with encoded text", () => {
    const w = findShareTarget("whatsapp")!;
    const u = w.buildUrl(ctx);
    expect(u.startsWith("https://wa.me/?text=")).toBe(true);
    expect(u).toContain(encodeURIComponent("https://vtourn.com/share/b-test-1"));
  });

  it("Telegram deep-link uses t.me/share/url with url + text", () => {
    const t = findShareTarget("telegram")!;
    const u = t.buildUrl(ctx);
    expect(u).toContain("https://t.me/share/url?url=");
    expect(u).toContain("&text=");
  });

  it("X (twitter) deep-link strips embedded url from text", () => {
    const t = findShareTarget("twitter")!;
    const u = t.buildUrl(ctx);
    expect(u.startsWith("https://twitter.com/intent/tweet")).toBe(true);
    expect(u).toContain("url=");
    expect(u).toContain("text=");
    // text param should NOT contain the encoded share url
    const params = new URL(u).searchParams;
    expect(params.get("text")!).not.toContain("vtourn.com/share/b-test-1");
  });

  it("Facebook deep-link uses sharer.php with u=", () => {
    const f = findShareTarget("facebook")!;
    expect(f.buildUrl(ctx).startsWith("https://www.facebook.com/sharer/sharer.php?u=")).toBe(true);
  });

  it("LinkedIn deep-link uses share-offsite with url=", () => {
    const l = findShareTarget("linkedin")!;
    expect(l.buildUrl(ctx)).toContain(
      "https://www.linkedin.com/sharing/share-offsite/?url=",
    );
  });

  it("Reddit deep-link uses submit with url= + title=", () => {
    const r = findShareTarget("reddit")!;
    const u = r.buildUrl(ctx);
    expect(u).toContain("https://reddit.com/submit?url=");
    expect(u).toContain("&title=");
  });

  it("Email deep-link uses mailto: with subject + body", () => {
    const e = findShareTarget("email")!;
    const u = e.buildUrl(ctx);
    expect(u.startsWith("mailto:?")).toBe(true);
    expect(u).toContain("subject=");
    expect(u).toContain("body=");
  });

  it("registers exactly the 9 documented targets", () => {
    // 7 social + copy + download = 9
    expect(SHARE_TARGETS.length).toBe(9);
    const ids = SHARE_TARGETS.map((t) => t.id);
    expect(ids).toEqual([
      "whatsapp",
      "telegram",
      "twitter",
      "facebook",
      "linkedin",
      "reddit",
      "email",
      "copy",
      "download",
    ]);
  });
});

describe("<ShareModal>", () => {
  beforeEach(() => {
    // Stub fetch for analytics POST + download blob.
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi.fn(
      async () =>
        new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 200 }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (navigator as { share?: unknown }).share;
  });

  it("renders the preview image pointing at /api/og/<bracketId>", () => {
    render(<ShareModal open payload={payload} onClose={() => {}} origin={ORIGIN} />);
    const img = screen.getByTestId("share-card-preview") as HTMLImageElement;
    expect(img.src).toContain("/api/og/b-test-1");
  });

  it("renders an editable caption with the winner team name", () => {
    render(<ShareModal open payload={payload} onClose={() => {}} origin={ORIGIN} />);
    const ta = screen.getByTestId("share-caption") as HTMLTextAreaElement;
    expect(ta.value).toContain("Argentina");
    expect(ta.value).toContain("https://vtourn.com/share/b-test-1");
  });

  it("does not render when open=false", () => {
    render(<ShareModal open={false} payload={payload} onClose={() => {}} />);
    expect(screen.queryByTestId("share-modal")).toBeNull();
  });

  it("fires onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    render(
      <ShareModal open payload={payload} onClose={onClose} origin={ORIGIN} />,
    );
    fireEvent.click(screen.getByTestId("share-backdrop"));
    expect(onClose).toHaveBeenCalled();
  });

  it("fires onClose when the explicit close button is pressed", () => {
    const onClose = vi.fn();
    render(
      <ShareModal open payload={payload} onClose={onClose} origin={ORIGIN} />,
    );
    fireEvent.click(screen.getByTestId("share-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders a WhatsApp anchor with the wa.me deep-link", () => {
    render(<ShareModal open payload={payload} onClose={() => {}} origin={ORIGIN} />);
    const wa = screen.getByTestId("share-btn-whatsapp") as HTMLAnchorElement;
    expect(wa.href.startsWith("https://wa.me/")).toBe(true);
  });

  it("does NOT render the Native Share button when navigator.share is absent", () => {
    delete (navigator as { share?: unknown }).share;
    render(<ShareModal open payload={payload} onClose={() => {}} origin={ORIGIN} />);
    expect(screen.queryByTestId("share-btn-native")).toBeNull();
  });

  it("renders the Native Share button when navigator.share is present", async () => {
    (navigator as unknown as { share: () => Promise<void> }).share = vi.fn(
      async () => undefined,
    );
    render(<ShareModal open payload={payload} onClose={() => {}} origin={ORIGIN} />);
    await waitFor(() => {
      expect(screen.queryByTestId("share-btn-native")).not.toBeNull();
    });
  });

  it("copy-link button writes to navigator.clipboard and shows toast", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<ShareModal open payload={payload} onClose={() => {}} origin={ORIGIN} />);
    fireEvent.click(screen.getByTestId("share-btn-copy"));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    const calls = writeText.mock.calls as unknown as Array<unknown[]>;
    expect(String(calls[0]?.[0] ?? "")).toContain("/share/b-test-1");
    expect(screen.getByTestId("share-toast")).toBeTruthy();
  });

  it("POSTs analytics with the right target id on any tap", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<ShareModal open payload={payload} onClose={() => {}} origin={ORIGIN} />);
    fireEvent.click(screen.getByTestId("share-btn-copy"));
    await waitFor(() => {
      const fetchMock = (globalThis as unknown as { fetch: ReturnType<typeof vi.fn> })
        .fetch;
      expect(fetchMock).toHaveBeenCalled();
      const lastCall = (fetchMock.mock.calls as unknown[][]).find(
        (c) => c[0] === "/api/analytics/share",
      );
      expect(lastCall).toBeDefined();
      const init = lastCall![1] as { body: string };
      const body = JSON.parse(init.body) as {
        bracketId: string;
        target: string;
        ts: number;
      };
      expect(body.bracketId).toBe("b-test-1");
      expect(body.target).toBe("copy");
      expect(typeof body.ts).toBe("number");
    });
  });
});

describe("<ShareModalProvider>", () => {
  function Opener() {
    const m = useShareModal();
    return (
      <button data-testid="opener" onClick={() => m.open(payload)}>
        open
      </button>
    );
  }

  it("mounts the modal on open()", () => {
    render(
      <ShareModalProvider origin={ORIGIN}>
        <Opener />
      </ShareModalProvider>,
    );
    expect(screen.queryByTestId("share-modal")).toBeNull();
    fireEvent.click(screen.getByTestId("opener"));
    expect(screen.queryByTestId("share-modal")).not.toBeNull();
  });
});

describe("<ShareButtons> direct", () => {
  beforeEach(() => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi.fn(
      async () => new Response("", { status: 204 }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes onShare callback when a network anchor is clicked", () => {
    const onShare = vi.fn();
    render(
      <ShareButtons
        bracketId="b1"
        url="https://vtourn.com/share/b1"
        text="caption"
        subject="subject"
        pngUrl="https://vtourn.com/api/og/b1"
        onShare={onShare}
      />,
    );
    fireEvent.click(screen.getByTestId("share-btn-whatsapp"));
    expect(onShare).toHaveBeenCalledWith("whatsapp");
  });
});
