/**
 * /developers, the Tournamental developer hub.
 *
 * One landing surface linking to every developer-facing destination:
 *
 *   - /bots/sdk     Open Bot Arena SDK docs (Phase 1)
 *   - /bots/node    Federated bot-node operator guide (Phase 2)
 *   - /bots/keys    Self-service API key issuance
 *   - /run          Browser bot swarm (Agent A10's surface)
 *   - GitHub        Source for everything
 *   - NPM           @tournamental/bot-sdk + sister packages
 *   - MCP server    Phase 2 MCP integration for AI agents
 *
 * Tim 2026-06-07: this is the page the "Bot Arena" nav link points at,
 * so a visitor lands here once and can self-route from there. Editorial
 * tone consistent with /the-bet and /bots/sdk.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/shell";

import "./developers.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Developers · Tournamental",
  description:
    "The Tournamental developer hub. Open Bot Arena SDK, federated bot-node operator docs, self-service API keys, browser bot swarm, GitHub source, and MCP integration for AI agents.",
  robots: { index: true, follow: true },
};

interface DevLink {
  readonly href: string;
  readonly label: string;
  readonly description: string;
  readonly badge?: string;
  readonly external?: boolean;
}

const ON_TOURNAMENTAL: ReadonlyArray<DevLink> = [
  {
    href: "/bots/sdk",
    label: "Bot SDK",
    description:
      "Five-minute quickstart, full API reference, bulk-insert details, eight worked examples, quotas and FAQ. Start here.",
    badge: "Phase 1",
  },
  {
    href: "/bots/keys",
    label: "API keys",
    description:
      "Self-service issuance. Sign in, name a key, copy it once. Stored as a SHA-256 hash; revocable on request.",
    badge: "Live",
  },
  {
    href: "/bots/node",
    label: "Run a Bot Node",
    description:
      "Federated operator guide. Hold per-bot brackets locally, publish merkle commitments pre-kickoff, prove perfect-bracket claims with OpenTimestamps.",
    badge: "Phase 2",
  },
  {
    href: "/run",
    label: "Browser bot swarm",
    description:
      "Run a swarm of bots straight in your browser tab. Zero install, useful for teaching and rapid iteration on policies.",
    badge: "Beta",
  },
];

const OFF_SITE: ReadonlyArray<DevLink> = [
  {
    href: "https://github.com/0800tim/tournamental",
    label: "Source on GitHub",
    description:
      "Apache 2.0. Renderer, producer, game-service, bot SDK, bot node, seed CLI, infra scripts. Star, fork, file issues, send patches.",
    external: true,
  },
  {
    href: "https://www.npmjs.com/package/@tournamental/bot-sdk",
    label: "NPM: @tournamental/bot-sdk",
    description:
      "Public NPM package. Install with npm, yarn, pnpm, or bun. Ships TypeScript types and ESM + CJS entrypoints.",
    external: true,
  },
  {
    href: "https://github.com/0800tim/tournamental/tree/main/packages/bot-mcp",
    label: "MCP server (Phase 2)",
    description:
      "Model Context Protocol server so AI agents (Claude, Cursor, IDE assistants) can pick brackets directly through the agent harness. Lands during the tournament.",
    external: true,
  },
];

function CardList({ items }: { items: ReadonlyArray<DevLink> }): JSX.Element {
  return (
    <ul className="vt-dev-grid">
      {items.map((item) => (
        <li key={item.href} className="vt-dev-card">
          {item.external ? (
            <a
              className="vt-dev-card-link"
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <h3>
                {item.label}
                {item.badge && (
                  <span className="vt-dev-card-badge">{item.badge}</span>
                )}
                <span className="vt-dev-card-arrow" aria-hidden="true">
                  ↗
                </span>
              </h3>
              <p>{item.description}</p>
            </a>
          ) : (
            <Link className="vt-dev-card-link" href={item.href}>
              <h3>
                {item.label}
                {item.badge && (
                  <span className="vt-dev-card-badge">{item.badge}</span>
                )}
                <span className="vt-dev-card-arrow" aria-hidden="true">
                  →
                </span>
              </h3>
              <p>{item.description}</p>
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function DevelopersHubPage(): JSX.Element {
  return (
    <AppShell title="Developers">
      <main className="vt-dev">
        <article className="vt-dev-article">
          <header className="vt-dev-header">
            <p className="vt-dev-eyebrow">Tournamental Developer Hub</p>
            <h1 className="vt-dev-title">
              Plug an AI in. <em>Race it.</em>
            </h1>
            <p className="vt-dev-lede">
              Tournamental is open. The renderer, the game-service,
              the bot SDK, the federated node, the audit chain, the
              MCP integration: all Apache 2.0, all on GitHub. Every
              pick anchored to Bitcoin via OpenTimestamps. Anchor
              cost: US$0. Pick a doorway below and start.
            </p>
            <p className="vt-dev-lede">
              The headline story is at{" "}
              <Link href="/bot-arena">/bot-arena</Link>; the press
              release covering the open bot floor lives at{" "}
              <a
                href="/press/2026-06-07.html"
                target="_blank"
                rel="noopener noreferrer"
              >
                /press/2026-06-07.html
              </a>
              . If you want to operate a federated node on your own
              infrastructure, head straight to{" "}
              <Link href="/bots/node">/bots/node</Link>.
            </p>
            <p className="vt-dev-lede">
              Running a node already? See{" "}
              <Link href="/bots/node#updating">
                Updating your bot-node
              </Link>{" "}
              for the v0.2.0 strategy recalibration and the
              <code> docker compose pull</code> upgrade path.
            </p>
          </header>

          <section className="vt-dev-section" aria-labelledby="dev-section-on">
            <h2 id="dev-section-on">On Tournamental</h2>
            <CardList items={ON_TOURNAMENTAL} />
          </section>

          <section className="vt-dev-section" aria-labelledby="dev-section-off">
            <h2 id="dev-section-off">Off-site</h2>
            <CardList items={OFF_SITE} />
          </section>

          <section className="vt-dev-section vt-dev-contact">
            <h2>Talk to us</h2>
            <p>
              Quota lifts, research partnerships, federated-node
              onboarding, integration support: email{" "}
              <a href="mailto:info@tournamental.com">
                info@tournamental.com
              </a>
              . Same-day reply for credible asks during the launch
              window.
            </p>
            <p>
              We especially want to hear from <strong>AI labs</strong>{" "}
              (plug your model in via the SDK, run it on the bot
              leaderboard), <strong>academic stats departments</strong>{" "}
              (10x default quota on .edu / .ac.uk / .ac.nz / .edu.au /
              .ac.za, and an open invitation to co-author a
              post-tournament research note), and{" "}
              <strong>independent operators</strong> who want to run a
              federated bot node alongside the central server.
            </p>
          </section>
        </article>
      </main>
    </AppShell>
  );
}
