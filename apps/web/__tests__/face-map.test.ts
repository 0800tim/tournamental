import { describe, expect, it } from "vitest";
import {
  buildFaceLookup,
  indexFacesByPlayerId,
  normaliseName,
  parseFaceCsv,
} from "@/lib/face-map";
import type { Player } from "@tournamental/spec";

const SAMPLE_CSV = `player_id,name,number,country,wikidata_q,image_url,attribution
5503,Lionel Andrés Messi Cuccittini,10,Argentina,Q615,https://example.com/messi.jpg,CC
3009,Kylian Mbappé Lottin,10,France,Q19330496,https://example.com/mbappe.jpg,CC
2995,Ángel Fabián Di María Hernández,11,Argentina,Q189071,https://example.com/dimaria.jpg,CC
3099,Hugo Lloris,1,France,Q183714,https://example.com/lloris.jpg,CC
`;

describe("normaliseName", () => {
  it("lowers and strips accents", () => {
    expect(normaliseName("Ángel Di María")).toBe("angel di maria");
    expect(normaliseName(" Mbappé ")).toBe("mbappe");
  });
});

describe("parseFaceCsv", () => {
  it("returns one row per body line", () => {
    const rows = parseFaceCsv(SAMPLE_CSV);
    expect(rows.length).toBe(4);
    expect(rows[0]?.name).toContain("Messi");
    expect(rows[0]?.image_url).toBe("https://example.com/messi.jpg");
  });

  it("returns [] for header-only or empty CSV", () => {
    expect(parseFaceCsv("")).toEqual([]);
    expect(parseFaceCsv("player_id,name\n")).toEqual([]);
  });
});

describe("buildFaceLookup", () => {
  const rows = parseFaceCsv(SAMPLE_CSV);
  const lookup = buildFaceLookup(rows);

  const messi: Player = { id: "ARG_10", name: "Messi", number: 10, position: "ST" };
  const mbappe: Player = { id: "FRA_10", name: "Mbappé", number: 10, position: "ST" };
  const dimaria: Player = { id: "ARG_9", name: "Di María", number: 11, position: "RW" };
  const ghost: Player = { id: "X_99", name: "Nobody Here", number: 99, position: "ST" };

  it("matches by short name even when CSV uses the full name", () => {
    expect(lookup(messi)).toContain("messi.jpg");
    expect(lookup(mbappe)).toContain("mbappe.jpg");
  });

  it("matches with diacritics stripped", () => {
    expect(lookup(dimaria)).toContain("dimaria.jpg");
  });

  it("returns undefined when no match", () => {
    expect(lookup(ghost)).toBeUndefined();
  });
});

describe("indexFacesByPlayerId", () => {
  it("builds a map keyed by spec player id", () => {
    const rows = parseFaceCsv(SAMPLE_CSV);
    const players: Player[] = [
      { id: "ARG_10", name: "Messi", number: 10, position: "ST" },
      { id: "FRA_10", name: "Mbappé", number: 10, position: "ST" },
    ];
    const map = indexFacesByPlayerId(players, rows);
    expect(map.ARG_10).toContain("messi.jpg");
    expect(map.FRA_10).toContain("mbappe.jpg");
  });
});
