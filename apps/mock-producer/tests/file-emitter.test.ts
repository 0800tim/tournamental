/**
 * FileEmitter: writes init.json, chunked NDJSON.gz, and a live.m3u8
 * manifest into the target directory.
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { runSimulation, defaultTeams, FileEmitter } from "../src/index.js";

describe("FileEmitter", () => {
  it("emits init.json + chunked .ndjson.gz + live.m3u8", async () => {
    const r = runSimulation({
      seed: 42,
      matchDurationMs: 5 * 60 * 1000, // 5 min for speed
      teams: defaultTeams(),
    });
    const out = await mkdtemp(join(tmpdir(), "mock-producer-file-"));
    try {
      const emitter = new FileEmitter(
        { init: r.init, messages: r.messages, timeScale: 1 },
        { outDir: out, chunkDurationMs: 30_000 },
      );
      await emitter.run();

      const files = await readdir(out);
      expect(files).toContain("init.json");
      expect(files).toContain("live.m3u8");
      const chunks = files.filter((f) => f.startsWith("chunk-") && f.endsWith(".ndjson.gz"));
      // 5 min / 30s = ~10 chunks
      expect(chunks.length).toBeGreaterThanOrEqual(8);
      expect(chunks.length).toBeLessThanOrEqual(12);

      const init = JSON.parse(await readFile(join(out, "init.json"), "utf8")) as { type: string };
      expect(init.type).toBe("match.init");

      // Verify a chunk decompresses to NDJSON.
      const firstChunk = chunks.sort()[0] as string;
      const gz = await readFile(join(out, firstChunk));
      const ndjson = gunzipSync(gz).toString("utf8");
      const lines = ndjson.trim().split("\n");
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        const parsed = JSON.parse(line) as { type: string };
        expect(typeof parsed.type).toBe("string");
      }

      const manifest = await readFile(join(out, "live.m3u8"), "utf8");
      expect(manifest).toContain("#EXTM3U");
      expect(manifest).toContain("#EXT-X-ENDLIST");
      expect(manifest).toContain(firstChunk);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
