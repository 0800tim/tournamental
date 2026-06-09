/**
 * /opening-ceremonies, a short guide to the three FIFA World Cup 2026
 * host-nation opening games and the ceremony that precedes each one.
 *
 * Deliberately basic: who is playing, when the ceremony starts (90
 * minutes before kick-off), how long it runs, what to expect, and the
 * headline performers. Times are local to each host city.
 *
 * Source: FIFA and reporting as of June 2026 (incl. Al Jazeera,
 * 9 June 2026).
 */

import type { Metadata } from "next";

import { AppShell } from "@/components/shell";

import "./opening-ceremonies.css";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Opening Ceremonies · Tournamental",
  description:
    "The three FIFA World Cup 2026 opening games and the ceremony before each one: who is playing, when the show starts, and what to expect in Mexico City, Toronto and Los Angeles.",
  robots: { index: true, follow: true },
};

interface Team {
  readonly code: string;
  readonly name: string;
}

interface Ceremony {
  readonly host: string;
  readonly city: string;
  readonly stadium: string;
  readonly date: string;
  readonly home: Team;
  readonly away: Team;
  readonly kickoffLocal: string;
  readonly ceremonyStartLocal: string;
  readonly duration: string;
  readonly expect: string;
  readonly performers: readonly string[];
}

const CEREMONIES: readonly Ceremony[] = [
  {
    host: "Mexico",
    city: "Mexico City",
    stadium: "Estadio Azteca",
    date: "Thursday 11 June 2026",
    home: { code: "MEX", name: "Mexico" },
    away: { code: "RSA", name: "South Africa" },
    kickoffLocal: "1:00 PM",
    ceremonyStartLocal: "11:00 AM",
    duration: "about 16 minutes",
    expect:
      "A celebration of Mexican culture: Indigenous performers, folkloric dance and papel picado, before the hosts open the tournament.",
    performers: [
      "Shakira",
      "Maná",
      "Alejandro Fernández",
      "J Balvin",
      "Los Ángeles Azules",
      "Lila Downs",
      "Belinda",
      "Danny Ocean",
      "Burna Boy",
      "Tyla",
    ],
  },
  {
    host: "Canada",
    city: "Toronto",
    stadium: "BMO Field",
    date: "Friday 12 June 2026",
    home: { code: "CAN", name: "Canada" },
    away: { code: "BIH", name: "Bosnia and Herzegovina" },
    kickoffLocal: "3:00 PM",
    ceremonyStartLocal: "1:30 PM",
    duration: "about 13 minutes",
    expect:
      "A cultural mosaic and a musical journey across Canada, from coast to coast to coast.",
    performers: [
      "Michael Bublé",
      "Alanis Morissette",
      "Alessia Cara",
      "Jessie Reyez",
      "William Prince",
      "Elyanna",
      "Nora Fatehi",
      "Sanjoy",
      "Vegedream",
    ],
  },
  {
    host: "United States",
    city: "Los Angeles",
    stadium: "SoFi Stadium",
    date: "Friday 12 June 2026",
    home: { code: "USA", name: "United States" },
    away: { code: "PAR", name: "Paraguay" },
    kickoffLocal: "6:00 PM",
    ceremonyStartLocal: "4:30 PM",
    duration: "about 13 minutes",
    expect:
      "A large-scale spectacle of US pop culture, with immersive visuals and global pop power.",
    performers: ["Katy Perry", "Future", "Anitta", "LISA", "Rema", "Tyla"],
  },
];

function TeamSide({ team, side }: { team: Team; side: "left" | "right" }): JSX.Element {
  const flag = (
    <img
      className="vt-oc-flag"
      src={`/flags/${team.code}.svg`}
      alt={team.name}
      width={44}
      height={44}
      loading="lazy"
    />
  );
  const code = <span className="vt-oc-code">{team.code}</span>;
  return (
    <span className="vt-oc-team" data-side={side}>
      {side === "left" ? (
        <>
          {code}
          {flag}
        </>
      ) : (
        <>
          {flag}
          {code}
        </>
      )}
    </span>
  );
}

export default function OpeningCeremoniesPage(): JSX.Element {
  return (
    <AppShell title="Opening Ceremonies">
      <main className="vt-oc">
        <article className="vt-oc-article">
          <header className="vt-oc-header">
            <p className="vt-oc-eyebrow">World Cup 2026 · 11 to 12 June</p>
            <h1 className="vt-oc-title">Opening Ceremonies</h1>
            <p className="vt-oc-lede">
              Three host nations, three opening games, three shows. Each
              ceremony starts 90 minutes before kick-off. Here is who is
              playing, when the show starts and what to expect. All times are
              local to the host city.
            </p>
          </header>

          <ol className="vt-oc-list">
            {CEREMONIES.map((c) => (
              <li key={c.city} className="vt-oc-card">
                <p className="vt-oc-card-eyebrow">
                  {c.host} · {c.city} · {c.date}
                </p>

                <div className="vt-oc-match">
                  <TeamSide team={c.home} side="left" />
                  <span className="vt-oc-vs">VS</span>
                  <TeamSide team={c.away} side="right" />
                </div>

                <dl className="vt-oc-meta">
                  <div className="vt-oc-meta-row">
                    <dt>Kick-off</dt>
                    <dd>
                      {c.kickoffLocal} · {c.stadium}
                    </dd>
                  </div>
                  <div className="vt-oc-meta-row">
                    <dt>Ceremony</dt>
                    <dd>
                      {c.ceremonyStartLocal} ({c.duration})
                    </dd>
                  </div>
                </dl>

                <p className="vt-oc-expect">{c.expect}</p>

                <div className="vt-oc-performers">
                  <span className="vt-oc-performers-label">Performing</span>
                  <ul className="vt-oc-chips">
                    {c.performers.map((p) => (
                      <li key={p} className="vt-oc-chip">
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>

          <footer className="vt-oc-foot">
            <p>
              How to watch: USA on FOX, FS1 and Telemundo (free stream on
              Tubi); Canada on CTV and TSN; Mexico on Televisa and TV Azteca;
              UK on BBC and ITV.
            </p>
            <p className="vt-oc-foot-source">
              Line-ups and timings per FIFA and reporting as of June 2026.
            </p>
          </footer>
        </article>
      </main>
    </AppShell>
  );
}
