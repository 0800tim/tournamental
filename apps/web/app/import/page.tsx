/**
 * /import - the bracket-import wizard (docs/69-bracket-import.md).
 *
 * Server component shell. The interactive wizard is the client
 * island ImportWizard below. We resolve the signed-in user
 * server-side so the page can show a "sign in first" gate or
 * proceed straight to the wizard.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { ImportWizard } from "./ImportWizard";
import "./import.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Import your bracket - Tournamental",
  description:
    "Bring your existing World Cup bracket from Telegraph, ESPN, BBC Predictor, or the FIFA app. Keep every pick, change the rest.",
};

export default function ImportPage(): JSX.Element {
  return (
    <main className="vt-import">
      <header className="vt-import-head">
        <p className="vt-import-eyebrow">Switch in 60 seconds</p>
        <h1 className="vt-import-title">Import your bracket</h1>
        <p className="vt-import-lede">
          Bring your existing picks from Telegraph, ESPN, BBC Predictor, or
          the FIFA app. We keep every pick from matches that have already
          played and credit you the points; picks for matches still to come
          are editable, right up to each match's own kickoff.
        </p>
        <p className="vt-import-meta">
          New here?{" "}
          <Link href="/syndicates/new" className="vt-import-link">
            Make a Tournamental account first
          </Link>
          , then come back to this page.
        </p>
      </header>

      <ImportWizard />

      <footer className="vt-import-foot">
        <p>
          Tournamental is not affiliated with Telegraph, The Telegraph Media
          Group, ESPN, the BBC, FIFA, or any other named platform on this
          page. These names describe interoperability only.
        </p>
      </footer>
    </main>
  );
}
