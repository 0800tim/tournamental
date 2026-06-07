/**
 * Vitest, /bots/sdk page renders the eight section anchors.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §10
 * Eight sections must be present so the on-page TOC anchors resolve
 * and the developer-doc surface stays predictable. We assert on
 * stable element ids rather than copy so editorial polish doesn't
 * keep breaking the test.
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// AppShell mounts an extensive header / nav surface that pulls in
// next-intl + auth chips + locale picker. None of that is interesting
// for "did the SDK page mount its eight sections", so stub it to a
// thin pass-through. Same trick used by other page-level renderer tests
// in this suite.
vi.mock("@/components/shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import BotsSdkPage from "@/app/bots/sdk/page";

describe("/bots/sdk page", () => {
  it("renders the eight TOC sections by stable id", () => {
    const { container } = render(<BotsSdkPage />);
    const expectedIds = [
      "quickstart",
      "architecture",
      "api-reference",
      "bulk-insert",
      "quotas",
      "feeds",
      "examples",
      "faq",
    ] as const;
    for (const id of expectedIds) {
      const el = container.querySelector(`#${id}`);
      expect(el, `expected #${id} to exist`).toBeTruthy();
    }
  });

  it("links to the keys issuance page", () => {
    const { container } = render(<BotsSdkPage />);
    const link = container.querySelector("a[href='/bots/keys']");
    expect(link).toBeTruthy();
  });

  it("links to the federated bot-node docs", () => {
    const { container } = render(<BotsSdkPage />);
    const link = container.querySelector("a[href='/bots/node']");
    expect(link).toBeTruthy();
  });

  it("includes the Humanness 50 disclaimer in the FAQ", () => {
    const { container } = render(<BotsSdkPage />);
    expect(container.textContent).toMatch(/Humanness Score of 50 or higher/i);
  });
});
