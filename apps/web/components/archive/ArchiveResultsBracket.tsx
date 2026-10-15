"use client";

/**
 * Archive wrapper around the share-landing ReadOnlyBracket: renders the
 * official results bracket with an archive header and no owner CTAs.
 */

import type { Bracket } from "@tournamental/bracket-engine";

import { ReadOnlyBracket } from "@/components/share-landing/ReadOnlyBracket";

import "@/components/share-landing/share-landing.css";
import "./archive-bracket.css";

export function ArchiveResultsBracket({ bracket }: { bracket: Bracket }) {
  return (
    <section className="vt-arcb">
      <header className="vt-arcb-head">
        <p className="vt-arcb-dateline">FIFA World Cup 2026™ · Official results · Archived</p>
        <h1 className="vt-arcb-title">The bracket, as it finished.</h1>
        <p className="vt-arcb-lede">
          Every group table and every knockout, from the recorded results. Open a match for the
          line-ups and the picks people made before kickoff.
        </p>
        <nav className="vt-arcb-actions" aria-label="Archive navigation">
          <a className="vt-arc-btn vt-arc-btn-ghost" href="/world-cup-2026/calendar">All 104 results</a>
          <a className="vt-arc-btn vt-arc-btn-ghost" href="/#standings">Final standings</a>
        </nav>
      </header>
      <ReadOnlyBracket bracket={bracket} ownerUserId={null} ownerHandle="tournamental" title="Official results bracket" />
    </section>
  );
}
