// Worker thread for scorer.mjs. Given a slice of swarms and the settled
// matches (chronological), regenerate each bot's pick per match with
// early-exit at the first miss, and build a first-wrong histogram. Pure
// CPU: no SQLite, no network.

import { parentPort, workerData } from "node:worker_threads";

import { chalkStrategy, regenerateBotPickForMatch } from "@tournamental/bot-node";

const { swarms, settled } = workerData;
const K = settled.length;
const hist = new Array(K + 2).fill(0);
let total = 0;
let regens = 0;
let sinceReport = 0;

for (const [seed, n] of swarms) {
  for (let i = 0; i < n; i++) {
    let w = K + 1; // survived all
    for (let k = 0; k < K; k++) {
      regens++;
      if (
        regenerateBotPickForMatch(seed, i, chalkStrategy, settled[k].match)
          .outcome !== settled[k].outcome
      ) {
        w = k + 1;
        break;
      }
    }
    hist[w]++;
    total++;
    if (++sinceReport >= 1_000_000) {
      sinceReport = 0;
      parentPort.postMessage({ type: "progress", done: total });
    }
  }
}

parentPort.postMessage({ type: "done", hist, total, regens });
