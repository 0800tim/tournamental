import { describe, expect, it } from "vitest";

import { loadDataPack } from "../src/data.js";
import {
  classifyMarket,
  fixtureForPair,
  impliedFromYesPrice,
  medianProbs,
  normaliseString,
  pairFromMatchQuestion,
  stripVig,
  teamCodeFromLabel,
} from "../src/normalise.js";

const data = loadDataPack();

describe("normaliseString", () => {
  it("collapses whitespace and lowercases", () => {
    expect(normaliseString("  Argentina   ")).toBe("argentina");
    expect(normaliseString("ARGENTINA\nFC")).toBe("argentina fc");
  });

  it("normalises smart quotes and dashes", () => {
    expect(normaliseString("Côte d’Ivoire")).toBe("côte d'ivoire");
    expect(normaliseString("ARG — FRA")).toBe("arg - fra");
  });
});

describe("teamCodeFromLabel", () => {
  it("resolves all 48 confirmed teams by their canonical name", () => {
    let resolved = 0;
    for (const t of data.teams) {
      const code = teamCodeFromLabel(t.name, data);
      expect(code).toBe(t.code);
      resolved += 1;
    }
    expect(resolved).toBe(48);
  });

  it("resolves common alias names used by external feeds", () => {
    expect(teamCodeFromLabel("United States", data)).toBe("USA");
    expect(teamCodeFromLabel("South Korea", data)).toBe("KOR");
    expect(teamCodeFromLabel("Czech Republic", data)).toBe("CZE");
    expect(teamCodeFromLabel("Iran", data)).toBe("IRN");
    expect(teamCodeFromLabel("Saudi Arabia", data)).toBe("KSA");
    expect(teamCodeFromLabel("South Africa", data)).toBe("RSA");
    expect(teamCodeFromLabel("Cote d'Ivoire", data)).toBe("CIV");
  });

  it("resolves Polymarket-shaped questions for short / non-canonical labels", () => {
    // These all hit Polymarket as 2026-05 markets and used to fall through.
    expect(teamCodeFromLabel("Will USA win the 2026 FIFA World Cup?", data)).toBe("USA");
    expect(teamCodeFromLabel("Will Netherlands win the 2026 FIFA World Cup?", data)).toBe("NED");
    expect(teamCodeFromLabel("Will Czechia win the 2026 FIFA World Cup?", data)).toBe("CZE");
    expect(teamCodeFromLabel("Will Turkiye win the 2026 FIFA World Cup?", data)).toBe("TUR");
    expect(teamCodeFromLabel("Will Bosnia-Herzegovina win the 2026 FIFA World Cup?", data)).toBe(
      "BIH",
    );
    expect(teamCodeFromLabel("Will Congo DR win the 2026 FIFA World Cup?", data)).toBe("COD");
  });

  it("resolves three-letter FIFA codes directly", () => {
    expect(teamCodeFromLabel("ARG", data)).toBe("ARG");
    expect(teamCodeFromLabel("BRA", data)).toBe("BRA");
    expect(teamCodeFromLabel("usa", data)).toBe("USA");
  });

  it("returns null for unrecognisable labels", () => {
    expect(teamCodeFromLabel("Atlantis", data)).toBeNull();
    expect(teamCodeFromLabel("", data)).toBeNull();
    expect(teamCodeFromLabel("ZZZ", data)).toBeNull();
  });

  it("picks the longest team-name match when a label contains text", () => {
    expect(teamCodeFromLabel("Will Argentina win the 2026 FIFA World Cup?", data)).toBe("ARG");
  });
});

describe("classifyMarket", () => {
  it("classifies tournament-winner questions", () => {
    expect(classifyMarket("Will Argentina win the 2026 FIFA World Cup?")?.kind).toBe(
      "tournament_winner",
    );
    expect(classifyMarket("Brazil to win World Cup 2026?")?.kind).toBe("tournament_winner");
  });

  it("classifies group-winner questions", () => {
    expect(classifyMarket("Will Brazil win Group C?")?.kind).toBe("group_winner");
    expect(classifyMarket("Argentina to win Group A?")?.kind).toBe("group_winner");
  });

  it("classifies match moneyline questions", () => {
    expect(classifyMarket("Will Argentina beat France?")?.kind).toBe("match_moneyline");
    expect(classifyMarket("Argentina vs France")?.kind).toBe("match_moneyline");
  });

  it("classifies top-scorer questions", () => {
    expect(classifyMarket("Will Mbappé be top scorer?")?.kind).toBe("top_scorer");
    expect(classifyMarket("World Cup Golden Boot winner")?.kind).toBe("top_scorer");
  });

  it("returns null for off-topic questions", () => {
    expect(classifyMarket("Will it rain on Tuesday?")).toBeNull();
  });
});

describe("pairFromMatchQuestion", () => {
  it("extracts (A, B) from 'Will A beat B?' style questions", () => {
    const pair = pairFromMatchQuestion("Will Argentina beat France?", data);
    expect(pair).toEqual({ teamA: "ARG", teamB: "FRA" });
  });

  it("handles 'A vs B'", () => {
    const pair = pairFromMatchQuestion("Brazil vs Spain", data);
    expect(pair).toEqual({ teamA: "BRA", teamB: "ESP" });
  });

  it("returns null when both sides cannot be resolved", () => {
    expect(pairFromMatchQuestion("Atlantis vs Mu", data)).toBeNull();
  });
});

describe("fixtureForPair", () => {
  it("matches a real group-stage pair from fixtures.json regardless of order", () => {
    // Match #1: MEX vs RSA (home/away).
    const f1 = fixtureForPair("MEX", "RSA", data);
    expect(f1?.match_number).toBe(1);
    const f1Reversed = fixtureForPair("RSA", "MEX", data);
    expect(f1Reversed?.match_number).toBe(1);
  });

  it("returns null for a pair that never plays", () => {
    expect(fixtureForPair("ARG", "BRA", data)).toBeNull();
  });
});

describe("stripVig + medianProbs", () => {
  it("stripVig produces probabilities that sum to 1", () => {
    const probs = stripVig([2.1, 3.5, 3.8]);
    const sum = probs.reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(probs.every((p) => p > 0 && p < 1)).toBe(true);
  });

  it("medianProbs across multiple books produces normalised probabilities", () => {
    const books = [
      [2.0, 3.5, 4.0],
      [2.05, 3.4, 4.1],
      [1.95, 3.6, 3.9],
    ];
    const probs = medianProbs(books);
    expect(probs.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 5);
    expect(probs[0]).toBeGreaterThan(probs[2]);
  });

  it("medianProbs returns empty when no books supplied", () => {
    expect(medianProbs([])).toEqual([]);
  });
});

describe("impliedFromYesPrice", () => {
  it("clamps to [0, 1]", () => {
    expect(impliedFromYesPrice(0.42)).toBeCloseTo(0.42);
    expect(impliedFromYesPrice(1.5)).toBe(1);
    expect(impliedFromYesPrice(-0.2)).toBe(0);
    expect(impliedFromYesPrice(NaN)).toBe(0);
  });
});
