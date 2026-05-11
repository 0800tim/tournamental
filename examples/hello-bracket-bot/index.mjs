#!/usr/bin/env node
// hello-bracket-bot — submit a randomised 2026 World Cup bracket using
// a personal API key. ~80 lines, zero deps beyond node:fetch.
//
// Mint a key at https://play.tournamental.com/profile/api-keys and
// `export TOURNAMENTAL_API_KEY=tnm_live_...` before running.
//
// Apache 2.0.

const GAME_URL = process.env.TOURNAMENTAL_GAME_URL ?? "https://game.tournamental.com";
const KEY = process.env.TOURNAMENTAL_API_KEY;

if (!KEY) {
  console.error("Missing TOURNAMENTAL_API_KEY. Mint one at https://play.tournamental.com/profile/api-keys");
  process.exit(1);
}

const log = (msg) => console.log(`[hello-bracket-bot] ${msg}`);

async function publicGet(path) {
  const r = await fetch(`${GAME_URL}${path}`);
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}

async function authedPost(path, body) {
  const r = await fetch(`${GAME_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`${path} -> HTTP ${r.status} ${text}`);
  }
  return r.json();
}

function pickRandom(arr, n) {
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < n; i++) {
    const j = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(j, 1)[0]);
  }
  return out;
}

async function main() {
  log("fetching 48-team field…");
  const { teams } = await publicGet("/v1/teams?tournament=fifa-wc-2026");
  log(`resolved ${teams.length} teams`);

  const { groups } = await publicGet("/v1/fixtures/2026/groups");
  log(`fetched ${groups.length} groups`);

  // Pick a random winner + runner-up per group.
  const picks = {};
  for (const group of groups) {
    const [winner, runnerUp] = pickRandom(group.teams, 2);
    picks[group.id] = {
      winner: winner.code,
      runnerUp: runnerUp.code,
    };
  }
  log("picked random group winners + runners-up");

  // Submit the picks. The server's bracket-engine cascades through
  // R32 → R16 → QF → SF → Final and returns the champion + final-four.
  log("submitting to " + GAME_URL + "…");
  const result = await authedPost("/v1/bracket", {
    tournament: "fifa-wc-2026",
    picks,
  });

  log(`champion: ${result.champion}  runner-up: ${result.runnerUp}  third-place: ${result.thirdPlace}`);
  log(`saved as bracket ${result.bracketId}`);
  log(`shareable at https://play.tournamental.com/s/${result.guid}`);
}

main().catch((e) => {
  console.error(`[hello-bracket-bot] ${e.message}`);
  process.exit(1);
});
