/**
 * /languages — full language catalogue with large flag tiles.
 *
 * Linked from the global footer. Two short paragraphs explain what
 * the project is doing on i18n, then a grid of every supported
 * locale with a big flag image + the native name + the English name.
 * Tapping a tile sets the vt_locale cookie and reloads with the new
 * locale prefix; the LocalePicker dropdown in the AppBar is the
 * always-on alternative.
 *
 * Cache: marketing-flavoured, identical for every visitor (the
 * choice happens client-side after this static page paints).
 *
 * Tim 2026-05-24.
 */

import type { Metadata } from "next";

import { AppShell } from "@/components/shell";

import { LanguagesGrid } from "./LanguagesGrid";

import "./languages.css";

export const dynamic = "force-static";
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Languages, Tournamental",
  description:
    "Tournamental speaks every language of every nation playing the FIFA World Cup 2026, plus a couple we asked nicely for. 22 locales, native-speaker translations, open source.",
};

export default function LanguagesPage(): JSX.Element {
  return (
    <AppShell title="Languages">
      <article className="vt-languages">
        <header className="vt-languages-hero">
          <p className="vt-languages-eyebrow">Languages</p>
          <h1 className="vt-languages-title">
            Tournamental speaks 22 languages.
          </h1>
          <p className="vt-languages-lede">
            We auto-detect the right language from your country whenever we
            can. The picker in the top bar lets you override. The full list of
            22 lives here: every nation playing the FIFA World Cup 2026™, plus
            Hungarian (a big diaspora) and Te Reo Māori (Aotearoa&apos;s other
            official language).
          </p>
          <p className="vt-languages-lede">
            Native speakers run the show. The first-pass translations were
            produced by Claude, but every locale is open to contribution.
            Spot something that reads weird? Open a pull request on{" "}
            <a href="https://github.com/0800tim/tournamental" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>{" "}
            and your name lands in the repo on the next deploy. See the{" "}
            <a href="https://github.com/0800tim/tournamental/blob/main/docs/CONTRIBUTING-TRANSLATIONS.md" target="_blank" rel="noopener noreferrer">
              contributor guide
            </a>{" "}
            for the four-line how-to.
          </p>
        </header>

        <LanguagesGrid />

        <footer className="vt-languages-footer">
          <p>
            Don't see your language? Open a{" "}
            <a href="https://github.com/0800tim/tournamental/discussions" target="_blank" rel="noopener noreferrer">
              discussion on GitHub
            </a>{" "}
            and propose it. The architecture supports unlimited additional
            locales; nothing in the code hardcodes the 22 number.
          </p>
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
