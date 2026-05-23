/**
 * /languages — full language catalogue with large flag tiles.
 *
 * Linked from the global footer. Two short paragraphs explain what
 * the project is doing on i18n, then a grid of every supported
 * locale with a big flag image + the native name + the English name.
 * Tapping a tile sets the vt_locale cookie and reloads; the
 * LocalePicker dropdown in the AppBar is the always-on alternative.
 *
 * Cache: dynamic so we can read the active locale cookie server-side
 * and translate the hero copy. The grid itself is locale-independent.
 *
 * Tim 2026-05-24.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AppShell } from "@/components/shell";

import { LanguagesGrid } from "./LanguagesGrid";

import "./languages.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Languages, Tournamental",
  description:
    "Tournamental speaks every language of every nation playing the FIFA World Cup 2026, plus a couple we asked nicely for. 22 locales, native-speaker translations, open source.",
};

async function safeT(key: string, fallback: string): Promise<string> {
  try {
    const t = await getTranslations();
    const out = t(key);
    return out === key ? fallback : out;
  } catch {
    return fallback;
  }
}

export default async function LanguagesPage(): Promise<JSX.Element> {
  const [eyebrow, headline, intro1, intro2] = await Promise.all([
    safeT("languages.hero.eyebrow", "Languages"),
    safeT("languages.hero.headline", "Tournamental, in your language"),
    safeT(
      "languages.hero.intro1",
      "We auto-detect the right language from your country whenever we can. The picker in the top bar lets you override. The full list of 22 lives here: every nation playing the FIFA World Cup 2026™, plus Hungarian (a big diaspora) and Te Reo Māori (Aotearoa's other official language).",
    ),
    safeT(
      "languages.hero.intro2",
      "Native speakers run the show. The first-pass translations were produced by Claude, but every locale is open to contribution.",
    ),
  ]);

  return (
    <AppShell title={eyebrow}>
      <article className="vt-languages">
        <header className="vt-languages-hero">
          <p className="vt-languages-eyebrow">{eyebrow}</p>
          <h1 className="vt-languages-title">{headline}</h1>
          <p className="vt-languages-lede">{intro1}</p>
          <p className="vt-languages-lede">
            {intro2}{" "}
            <a href="https://github.com/0800tim/tournamental" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>{" "}
            ·{" "}
            <a href="https://github.com/0800tim/tournamental/blob/main/docs/CONTRIBUTING-TRANSLATIONS.md" target="_blank" rel="noopener noreferrer">
              Contributor guide
            </a>
          </p>
        </header>

        <LanguagesGrid />

        <footer className="vt-languages-footer">
          <p className="vt-languages-disclaimer">
            Tournamental is independent and not affiliated with FIFA, the FIFA
            World Cup, or any of its sponsors. FIFA World Cup 2026™ is a
            trademark of Fédération Internationale de Football Association.
          </p>
        </footer>
      </article>
    </AppShell>
  );
}
