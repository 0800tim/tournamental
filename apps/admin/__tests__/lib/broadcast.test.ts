/**
 * Unit tests for the broadcast library.
 *
 * Covers: front-matter parsing, template loading from disk, variable
 * substitution, subject derivation, channel filtering, and the
 * per-recipient render shape that the API route depends on.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  parseFrontMatter,
  loadPlaybooks,
  substituteVariables,
  deriveSubject,
  filterChannels,
  renderForRecipient,
} from "@/lib/broadcast";

describe("parseFrontMatter", () => {
  it("parses a header block with strings, booleans and a list", () => {
    const raw = [
      "---",
      "name: Test template",
      "description: A short description",
      "recommended: true",
      "default_channels:",
      "  - whatsapp",
      "  - email",
      "---",
      "",
      "Hi {{owner_handle}}",
    ].join("\n");
    const { meta, body } = parseFrontMatter(raw);
    expect(meta.name).toBe("Test template");
    expect(meta.description).toBe("A short description");
    expect(meta.recommended).toBe(true);
    expect(meta.default_channels).toEqual(["whatsapp", "email"]);
    expect(body.trim().startsWith("Hi {{owner_handle}}")).toBe(true);
  });

  it("returns empty meta when there is no front-matter", () => {
    const { meta, body } = parseFrontMatter("just a body\n");
    expect(meta).toEqual({});
    expect(body).toBe("just a body\n");
  });
});

describe("loadPlaybooks", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "vtorn-playbooks-"));
    await fs.writeFile(
      path.join(dir, "welcome.md"),
      [
        "---",
        "name: Welcome",
        "description: Greet new owners",
        "recommended: true",
        "default_channels:",
        "  - whatsapp",
        "  - email",
        "---",
        "Hi {{owner_handle}}",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(dir, "kickoff.md"),
      [
        "---",
        "name: Kickoff",
        "description: Day-before reminder",
        "default_channels:",
        "  - whatsapp",
        "---",
        "Kickoff tomorrow for {{pool_name}}",
      ].join("\n"),
    );
    // Stray non-markdown file should be ignored.
    await fs.writeFile(path.join(dir, "notes.txt"), "ignore me");
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns one template per .md file, recommended first", async () => {
    const tpls = await loadPlaybooks(dir);
    expect(tpls).toHaveLength(2);
    expect(tpls[0].id).toBe("welcome");
    expect(tpls[0].recommended).toBe(true);
    expect(tpls[0].defaultChannels).toEqual(["whatsapp", "email"]);
    expect(tpls[1].id).toBe("kickoff");
    expect(tpls[1].recommended).toBe(false);
  });

  it("returns [] when the directory does not exist", async () => {
    const tpls = await loadPlaybooks(path.join(dir, "missing"));
    expect(tpls).toEqual([]);
  });
});

describe("substituteVariables", () => {
  it("replaces the four supported placeholders", () => {
    const out = substituteVariables(
      "Hi {{owner_handle}}, your pool {{pool_name}} for {{tournament}} has {{member_count}} members.",
      {
        ownerHandle: "Sam",
        poolName: "Mates Cup",
        tournament: "WC 2026",
        memberCount: 14,
      },
    );
    expect(out).toBe(
      "Hi Sam, your pool Mates Cup for WC 2026 has 14 members.",
    );
  });

  it("leaves unknown placeholders untouched", () => {
    const out = substituteVariables("Hi {{nope}}", {
      ownerHandle: "x",
      poolName: "x",
      tournament: "x",
      memberCount: 0,
    });
    expect(out).toBe("Hi {{nope}}");
  });

  it("handles whitespace inside the placeholder", () => {
    const out = substituteVariables("{{ pool_name }}", {
      ownerHandle: "x",
      poolName: "Cup",
      tournament: "x",
      memberCount: 0,
    });
    expect(out).toBe("Cup");
  });
});

describe("deriveSubject", () => {
  it("uses the first non-empty line and strips heading markers", () => {
    expect(deriveSubject("# Welcome to Mates Cup\n\nbody", "Mates Cup")).toBe(
      "Welcome to Mates Cup",
    );
  });
  it("falls back when the first line is too long", () => {
    const long = "x".repeat(120);
    expect(deriveSubject(long, "Cup")).toBe("Tournamental: Cup");
  });
  it("falls back when the body is empty", () => {
    expect(deriveSubject("   \n  \n", "Cup")).toBe(
      "Tournamental update for Cup",
    );
  });
});

describe("filterChannels", () => {
  it("keeps channels when the address exists, otherwise skips", () => {
    const r = filterChannels(["whatsapp", "email"], {
      ownerPhone: "+6421000000",
      ownerEmail: null,
    });
    expect(r.kept).toEqual(["whatsapp"]);
    expect(r.skipped).toEqual([{ channel: "email", reason: "missing_email" }]);
  });
  it("skips whatsapp when phone missing", () => {
    const r = filterChannels(["whatsapp"], {
      ownerPhone: null,
      ownerEmail: "a@b.com",
    });
    expect(r.kept).toEqual([]);
    expect(r.skipped).toEqual([
      { channel: "whatsapp", reason: "missing_phone" },
    ]);
  });
  it("keeps both when both addresses present", () => {
    const r = filterChannels(["whatsapp", "email"], {
      ownerPhone: "+6421000000",
      ownerEmail: "a@b.com",
    });
    expect(r.kept).toEqual(["whatsapp", "email"]);
    expect(r.skipped).toEqual([]);
  });
});

describe("renderForRecipient", () => {
  it("returns the dry-run shape with substituted body and filtered channels", () => {
    const out = renderForRecipient({
      body: "Hi {{owner_handle}}, {{pool_name}} has {{member_count}}.",
      recipient: {
        slug: "mates-cup",
        poolName: "Mates Cup",
        ownerHandle: "Sam",
        ownerEmail: null,
        ownerPhone: "+6421000000",
        tournament: "WC 2026",
        memberCount: 14,
      },
      channels: ["whatsapp", "email"],
    });
    expect(out.slug).toBe("mates-cup");
    expect(out.body).toBe("Hi Sam, Mates Cup has 14.");
    expect(out.channels).toEqual(["whatsapp"]);
    expect(out.skippedChannels).toEqual([
      { channel: "email", reason: "missing_email" },
    ]);
    expect(typeof out.subject).toBe("string");
    expect(out.subject.length).toBeGreaterThan(0);
  });
});
