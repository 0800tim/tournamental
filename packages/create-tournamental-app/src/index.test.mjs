// Minimum-viable scaffolder test using node:test.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "index.mjs");

test("scaffolds the plugin-scorer template non-interactively", async () => {
  const work = await mkdtemp(join(tmpdir(), "create-tournamental-app-"));
  try {
    const dst = join(work, "my-scorer");
    const r = spawnSync(
      process.execPath,
      [CLI, "--template", "plugin-scorer", "--name", "my-scorer", "--dir", dst],
      { encoding: "utf8" },
    );
    if (r.status !== 0) {
      throw new Error(`scaffolder exited ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    }
    const files = await readdir(dst, { recursive: true });
    assert.ok(files.includes("package.json"), "package.json should be written");
    assert.ok(files.includes("plugin.json"), "plugin.json should be written");
    const pkg = JSON.parse(await readFile(join(dst, "package.json"), "utf8"));
    assert.equal(pkg.name, "@tournamental-plugin/my-scorer");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("rejects an unknown template", async () => {
  const work = await mkdtemp(join(tmpdir(), "create-tournamental-app-"));
  try {
    const r = spawnSync(
      process.execPath,
      [CLI, "--template", "no-such-template", "--name", "x", "--dir", join(work, "x")],
      { encoding: "utf8" },
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Unknown template/);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
