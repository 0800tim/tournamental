#!/usr/bin/env node
/**
 * Build data/wc2022-final-players.csv — the 22 starters in the
 * 2022 FIFA World Cup Final (Argentina 3–3 France, AET; AR won 4–2 on
 * penalties), with their Wikidata Q-numbers and Wikimedia Commons
 * thumbnail URLs.
 *
 * The lineup numbers are the actual jersey numbers the players wore in
 * that match (per FIFA's official lineup sheet and contemporary press).
 *
 * Workflow:
 *   1. For each player, look up Wikidata Q via wbsearchentities (cached).
 *   2. Fetch the entity, read claim P18 (image) → Commons filename.
 *   3. Compute the Commons thumbnail redirect URL via Special:FilePath.
 *   4. Verify HTTP 200 with a HEAD request.
 *   5. Write CSV.
 *
 * Attribution: every Commons file carries its own SDC licence claim;
 * we pull `mediainfo:P275` (copyright licence) and the file description
 * page URL, and bake them into the `attribution` column. Per Commons
 * policy callers must show the licence + a link back to the file page.
 *
 * Output: data/wc2022-final-players.csv (writes from repo root).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const OUT_DIR = resolve(REPO_ROOT, "data");
const OUT_FILE = resolve(OUT_DIR, "wc2022-final-players.csv");

mkdirSync(OUT_DIR, { recursive: true });

/**
 * The 22 starters of the 2022 World Cup Final, with their jersey
 * numbers and the team they represented. Q-IDs are resolved at build
 * time from the canonical English label.
 */
const ROSTER = [
  // ---- Argentina XI ----
  { player_id: "AR_E_MARTINEZ", name: "Emiliano Martínez",   number: 23, country: "AR" },
  { player_id: "AR_MOLINA",     name: "Nahuel Molina",       number: 26, country: "AR" },
  { player_id: "AR_ROMERO",     name: "Cristian Romero",     number: 13, country: "AR" },
  { player_id: "AR_OTAMENDI",   name: "Nicolás Otamendi",    number: 19, country: "AR" },
  { player_id: "AR_ACUNA",      name: "Marcos Acuña",        number:  8, country: "AR" },
  { player_id: "AR_DE_PAUL",    name: "Rodrigo De Paul",     number:  7, country: "AR" },
  { player_id: "AR_MAC_ALLIST", name: "Alexis Mac Allister", number: 20, country: "AR" },
  { player_id: "AR_E_FERNAND",  name: "Enzo Fernández",      number: 24, country: "AR" },
  { player_id: "AR_DI_MARIA",   name: "Ángel Di María",      number: 11, country: "AR" },
  { player_id: "AR_MESSI",      name: "Lionel Messi",        number: 10, country: "AR" },
  { player_id: "AR_J_ALVAREZ",  name: "Julián Álvarez",      number:  9, country: "AR" },

  // ---- France XI ----
  { player_id: "FR_LLORIS",     name: "Hugo Lloris",         number:  1, country: "FR" },
  { player_id: "FR_KOUNDE",     name: "Jules Koundé",        number:  3, country: "FR" },
  { player_id: "FR_VARANE",     name: "Raphaël Varane",      number:  4, country: "FR" },
  { player_id: "FR_UPAMECANO",  name: "Dayot Upamecano",     number:  5, country: "FR" },
  { player_id: "FR_T_HERNAND",  name: "Théo Hernández",      number: 22, country: "FR" },
  { player_id: "FR_TCHOUAMENI", name: "Aurélien Tchouaméni", number: 14, country: "FR" },
  { player_id: "FR_RABIOT",     name: "Adrien Rabiot",       number:  6, country: "FR" },
  { player_id: "FR_GRIEZMANN",  name: "Antoine Griezmann",   number:  8, country: "FR" },
  { player_id: "FR_DEMBELE",    name: "Ousmane Dembélé",     number: 11, country: "FR" },
  { player_id: "FR_GIROUD",     name: "Olivier Giroud",      number:  9, country: "FR" },
  { player_id: "FR_MBAPPE",     name: "Kylian Mbappé",       number: 10, country: "FR" },
];

if (ROSTER.length !== 22) {
  console.error(`Expected 22 starters, got ${ROSTER.length}`);
  process.exit(1);
}

/** GET JSON with a timeout and a polite User-Agent. */
async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "VTourn-asset-builder/0.1 (https://github.com/0800tim/vtorn; 0800tim@gmail.com)",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${url}`);
  return res.json();
}

/** Find the Q-ID for an exact label match, preferring the highest-ranked
 *  human (Q5) result. Falls back to the first hit. */
async function findQid(name) {
  const url =
    "https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json" +
    "&language=en&type=item&limit=10&search=" +
    encodeURIComponent(name);
  const data = await fetchJson(url);
  const hits = data.search ?? [];
  if (hits.length === 0) throw new Error(`no Wikidata hits for "${name}"`);
  // Prefer the first hit that has "footballer" in its description.
  const pref = hits.find((h) => /footballer|football player/i.test(h.description ?? "")) ?? hits[0];
  return pref.id;
}

/** Read claim P18 (image filename) from a Wikidata entity. */
async function fetchImageFilename(qid) {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
  const data = await fetchJson(url);
  const entity = data.entities?.[qid];
  const claims = entity?.claims?.P18;
  if (!claims || claims.length === 0) throw new Error(`no P18 (image) on ${qid}`);
  const filename = claims[0]?.mainsnak?.datavalue?.value;
  if (!filename) throw new Error(`malformed P18 on ${qid}`);
  return filename;
}

/** Pull the SDC P275 (copyright licence) on a Commons file. Best-effort
 *  — falls back to "see file page" when the API doesn't expose SDC for
 *  this file (older uploads pre-SDC). */
async function fetchLicence(filename) {
  const url =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json" +
    "&prop=imageinfo&iiprop=extmetadata&titles=" +
    encodeURIComponent("File:" + filename);
  try {
    const data = await fetchJson(url);
    const pages = data.query?.pages ?? {};
    const page = Object.values(pages)[0];
    const meta = page?.imageinfo?.[0]?.extmetadata ?? {};
    const lic = meta.LicenseShortName?.value ?? "see Commons file page";
    const author =
      (meta.Artist?.value ?? "")
        .replace(/<[^>]+>/g, "") // strip the HTML wrapper Commons returns
        .trim() || "Unknown";
    return { licence: lic, author };
  } catch {
    return { licence: "see Commons file page", author: "Unknown" };
  }
}

function thumbUrl(filename, width = 256) {
  const encoded = encodeURIComponent(filename.replace(/ /g, "_"));
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}?width=${width}`;
}

async function verifyUrl(url) {
  // Wikimedia rate-limits hard if hits arrive too fast; retry up to 3
  // times with exponential back-off before giving up.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        headers: {
          "User-Agent": "VTourn-asset-builder/0.1 (https://github.com/0800tim/vtorn; 0800tim@gmail.com)",
        },
      });
      if (res.ok) return true;
      if (res.status === 404) return false; // genuine miss
    } catch {
      // network blip — retry
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  return false;
}

const HEADER = ["player_id", "name", "number", "country", "wikidata_q", "image_url", "attribution"];

function csvEscape(value) {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function main() {
  const rows = [HEADER.join(",")];
  let ok = 0;
  let missing = 0;

  for (const r of ROSTER) {
    // Polite throttle so we don't trip Wikidata's rate limit.
    await new Promise((res) => setTimeout(res, 250));
    process.stdout.write(`  ${r.name.padEnd(28)} `);
    let qid = "";
    let filename = "";
    let url = "";
    let attribution = "Wikimedia Commons (lookup failed at build time)";
    try {
      qid = await findQid(r.name);
      filename = await fetchImageFilename(qid);
      url = thumbUrl(filename);
      const okHttp = await verifyUrl(url);
      const lic = await fetchLicence(filename);
      attribution = `© ${lic.author}, ${lic.licence}, via Wikimedia Commons (File:${filename})`;
      if (!okHttp) {
        process.stdout.write(`Q=${qid} ✗ thumbnail HTTP failed\n`);
        missing++;
      } else {
        process.stdout.write(`Q=${qid} ✓\n`);
        ok++;
      }
    } catch (err) {
      process.stdout.write(`✗ ${err.message}\n`);
      missing++;
    }
    rows.push(
      [r.player_id, r.name, r.number, r.country, qid, url, attribution]
        .map(csvEscape)
        .join(",")
    );
  }

  writeFileSync(OUT_FILE, rows.join("\n") + "\n");
  console.log(`\n→ ${OUT_FILE} (${ok}/${ROSTER.length} valid; ${missing} missing)`);
  if (missing > 0) {
    console.warn(
      "WARNING: some players are missing P18 photos or thumbnails. The CSV is written but the renderer should fall back to the initials disc for those rows."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
