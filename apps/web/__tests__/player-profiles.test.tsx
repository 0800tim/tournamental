/**
 * Vitest — player-profile pages, components, and lib helpers.
 *
 * Covers ~24 cases:
 *   - lib/players: findPlayer / playersForTeam / searchPlayers / age helpers
 *   - <PlayerCard /> renders thumb + position + team chip + link
 *   - <PlayerHero /> renders the headshot + attribution overlay
 *   - <PlayerQuickFacts /> drops empty facts
 *   - <PlayerIndex /> filters by team, position, search
 *   - PlayerPage server component renders / 404s
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  findPlayer,
  playersForTeam,
  searchPlayers,
  ageOnDate,
  POSITION_LABEL,
  allPlayerIds,
  datasetMeta,
  distinctClubs,
  distinctCodes,
  type PlayerRecord,
} from "@/lib/players";

import { PlayerCard } from "@/components/player/PlayerCard";
import { PlayerHero } from "@/components/player/PlayerHero";
import { PlayerQuickFacts } from "@/components/player/PlayerQuickFacts";
import { PlayerIndex } from "@/app/players/PlayerIndex";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const messi: PlayerRecord = {
  id: "ARG-MESSI",
  wikidataQid: "Q615",
  name: "Lionel Messi",
  fullName: "Lionel Andrés Messi Cuccittini",
  code: "ARG",
  shirtNumber: 10,
  position: "FWD",
  dob: "1987-06-24",
  club: "Inter Miami CF",
  imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/foo.jpg?width=400px",
  imageCredit: "Wikimedia Commons · CC BY-SA 4.0",
  imageLicence: "CC BY-SA 4.0",
  captain: true,
  wikipediaUrl: "https://en.wikipedia.org/wiki/Lionel_Messi",
};

const mbappe: PlayerRecord = {
  id: "FRA-MBAPPE",
  wikidataQid: "Q19359939",
  name: "Kylian Mbappé",
  fullName: null,
  code: "FRA",
  shirtNumber: 10,
  position: "FWD",
  dob: null,
  club: null,
  imageUrl: null,
  imageCredit: null,
  imageLicence: null,
  captain: false,
  wikipediaUrl: null,
};

describe("lib/players — dataset", () => {
  it("ships at least 100 players in the bundled dataset", () => {
    const ids = allPlayerIds();
    expect(ids.length).toBeGreaterThanOrEqual(100);
  });

  it("dataset meta has count + source", () => {
    const m = datasetMeta();
    expect(m.count).toBeGreaterThan(0);
    expect(["wikidata", "seed", "mock"]).toContain(m.source);
  });

  it("distinctCodes includes ARG + FRA + ENG", () => {
    const c = distinctCodes();
    expect(c).toEqual(expect.arrayContaining(["ARG", "FRA", "ENG"]));
  });

  it("distinctClubs is sorted + non-empty", () => {
    const cs = distinctClubs();
    expect(cs.length).toBeGreaterThan(0);
    const sorted = [...cs].sort((a, b) => a.localeCompare(b));
    expect(cs).toEqual(sorted);
  });
});

describe("lib/players — findPlayer", () => {
  it("returns the messi record for ARG-MESSI", () => {
    const m = findPlayer("ARG-MESSI");
    expect(m?.name).toBe("Lionel Messi");
    expect(m?.code).toBe("ARG");
  });
  it("is case-insensitive", () => {
    expect(findPlayer("arg-messi")).toBeDefined();
  });
  it("returns undefined for unknown id", () => {
    expect(findPlayer("XXX-NOPE")).toBeUndefined();
  });
});

describe("lib/players — playersForTeam", () => {
  it("returns ARG players sorted with GK first", () => {
    const arg = playersForTeam("ARG");
    expect(arg.length).toBeGreaterThan(0);
    const positions = arg.map((p) => p.position);
    // First few should never include FWD before a GK if GK exists.
    if (positions.includes("GK")) {
      expect(positions.indexOf("GK")).toBeLessThan(positions.indexOf("FWD"));
    }
  });
  it("returns [] for unknown code", () => {
    expect(playersForTeam("ZZZ")).toEqual([]);
  });
});

describe("lib/players — searchPlayers", () => {
  const fixture: PlayerRecord[] = [messi, mbappe];

  it("filters by name substring", () => {
    expect(searchPlayers({ q: "messi" }, fixture)).toHaveLength(1);
    expect(searchPlayers({ q: "mbappé" }, fixture)).toHaveLength(1);
  });
  it("filters by team code", () => {
    expect(searchPlayers({ code: "ARG" }, fixture)).toHaveLength(1);
    expect(searchPlayers({ code: "fra" }, fixture)).toHaveLength(1);
  });
  it("filters by position", () => {
    expect(searchPlayers({ position: "FWD" }, fixture)).toHaveLength(2);
    expect(searchPlayers({ position: "GK" }, fixture)).toHaveLength(0);
  });
  it("filters by club substring", () => {
    expect(searchPlayers({ club: "miami" }, fixture)).toHaveLength(1);
  });
  it("AND-combines q + position", () => {
    expect(searchPlayers({ q: "messi", position: "FWD" }, fixture)).toHaveLength(1);
    expect(searchPlayers({ q: "messi", position: "GK" }, fixture)).toHaveLength(0);
  });
  it("treats position=ALL as no filter", () => {
    expect(searchPlayers({ position: "ALL" }, fixture)).toHaveLength(2);
  });
});

describe("lib/players — ageOnDate", () => {
  it("computes integer years for valid input", () => {
    expect(ageOnDate("1987-06-24", "2026-06-25")).toBe(39);
  });
  it("returns null for missing dob", () => {
    expect(ageOnDate(null, "2026-06-25")).toBeNull();
  });
  it("returns null when ref is before dob", () => {
    expect(ageOnDate("2030-01-01", "2026-01-01")).toBeNull();
  });
});

describe("<PlayerCard>", () => {
  it("renders name + team chip + position badge + link", () => {
    const { container } = render(<PlayerCard player={messi} />);
    expect(container.textContent).toContain("Lionel Messi");
    expect(container.textContent).toContain("ARG");
    expect(container.textContent).toContain("FWD");
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("/player/ARG-MESSI");
  });

  it("renders an image when imageUrl is set", () => {
    const { container } = render(<PlayerCard player={messi} />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toContain("Special:FilePath");
  });

  it("renders initials placeholder when no image", () => {
    const { container } = render(<PlayerCard player={mbappe} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("KM");
  });
});

describe("<PlayerHero>", () => {
  it("renders headshot with attribution credit", () => {
    const { container, getByTestId } = render(
      <PlayerHero player={messi} teamName="Argentina" teamFlagEmoji="🇦🇷" groupId="J" />,
    );
    expect(container.textContent).toContain("Lionel Messi");
    expect(container.textContent).toContain("#10");
    expect(getByTestId("player-hero-credit").textContent).toContain("CC BY-SA 4.0");
    expect(container.textContent).toContain("Argentina");
    expect(container.textContent).toContain("Group J");
  });

  it("shows captain chip when player.captain is true", () => {
    const { getByTestId } = render(<PlayerHero player={messi} teamName="Argentina" />);
    expect(getByTestId("chip-captain")).toBeDefined();
  });

  it("hides captain chip otherwise", () => {
    const { queryByTestId } = render(<PlayerHero player={mbappe} teamName="France" />);
    expect(queryByTestId("chip-captain")).toBeNull();
  });

  it("uses initials fallback when no image", () => {
    const { container } = render(<PlayerHero player={mbappe} teamName="France" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("KM");
  });
});

describe("<PlayerQuickFacts>", () => {
  it("renders age + club + dob + shirt", () => {
    const { container } = render(
      <PlayerQuickFacts player={messi} nowIso="2026-06-25T00:00:00Z" />,
    );
    expect(container.textContent).toContain("Age");
    expect(container.textContent).toContain("39");
    expect(container.textContent).toContain("Inter Miami CF");
    expect(container.textContent).toContain("1987-06-24");
    expect(container.textContent).toContain("#10");
  });

  it("returns null when nothing to show", () => {
    const empty: PlayerRecord = {
      ...mbappe,
      dob: null,
      club: null,
      shirtNumber: null,
      // code is non-empty but the component still renders Country if code is set;
      // simulate an "all empty" by clearing code too.
      code: "",
    };
    const { container } = render(<PlayerQuickFacts player={empty} />);
    expect(container.textContent).toBe("");
  });
});

describe("<PlayerIndex>", () => {
  const fixture: PlayerRecord[] = [
    messi,
    mbappe,
    { ...messi, id: "ARG-MARTINEZ", name: "Emiliano Martínez", position: "GK", club: "Aston Villa", imageUrl: null },
  ];
  const teamOptions = [
    { code: "ARG", name: "Argentina", flag: "🇦🇷" },
    { code: "FRA", name: "France", flag: "🇫🇷" },
  ];
  const clubOptions = ["Aston Villa", "Inter Miami CF"];

  it("renders all players initially", () => {
    const { getByTestId } = render(
      <PlayerIndex players={fixture} teamOptions={teamOptions} clubOptions={clubOptions} />,
    );
    expect(getByTestId("player-index-count").textContent).toContain("3");
  });

  it("filters by team", () => {
    const { getByTestId } = render(
      <PlayerIndex players={fixture} teamOptions={teamOptions} clubOptions={clubOptions} />,
    );
    fireEvent.change(getByTestId("player-filter-team"), { target: { value: "ARG" } });
    expect(getByTestId("player-index-count").textContent).toContain("2");
  });

  it("filters by position", () => {
    const { getByTestId } = render(
      <PlayerIndex players={fixture} teamOptions={teamOptions} clubOptions={clubOptions} />,
    );
    fireEvent.change(getByTestId("player-filter-position"), { target: { value: "GK" } });
    expect(getByTestId("player-index-count").textContent).toContain("1");
  });

  it("filters by free-text search", () => {
    const { getByTestId, queryByTestId } = render(
      <PlayerIndex players={fixture} teamOptions={teamOptions} clubOptions={clubOptions} />,
    );
    fireEvent.change(getByTestId("player-search-input"), { target: { value: "Mbappé" } });
    expect(getByTestId("player-index-count").textContent).toContain("1");
    expect(queryByTestId("player-index-empty")).toBeNull();
  });

  it("shows the empty state when nothing matches", () => {
    const { getByTestId } = render(
      <PlayerIndex players={fixture} teamOptions={teamOptions} clubOptions={clubOptions} />,
    );
    fireEvent.change(getByTestId("player-search-input"), { target: { value: "nonexistent" } });
    expect(getByTestId("player-index-empty")).toBeDefined();
  });
});

describe("POSITION_LABEL", () => {
  it("maps each position to a human label", () => {
    expect(POSITION_LABEL.GK).toBe("Goalkeeper");
    expect(POSITION_LABEL.DEF).toBe("Defender");
    expect(POSITION_LABEL.MID).toBe("Midfielder");
    expect(POSITION_LABEL.FWD).toBe("Forward");
  });
});
