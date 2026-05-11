#!/usr/bin/env node
// create-tournamental-app — one-command scaffolder for Tournamental
// plugins and extensions. ~120 lines, zero deps beyond node stdlib.
//
// Usage:
//   npm create @tournamental/app
//   pnpm create @tournamental/app
//
//   # non-interactive (CI / AI agents):
//   npx @tournamental/create-app --template plugin-scorer --name foo --dir ./foo
//
// Apache 2.0.

import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { resolve, join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit, stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, "..", "templates");

const args = parseArgs(argv.slice(2));

function parseArgs(rest) {
  const out = { interactive: true };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--template") out.template = rest[++i];
    else if (a === "--name") out.name = rest[++i];
    else if (a === "--dir") out.dir = rest[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  if (out.template && out.name && out.dir) out.interactive = false;
  return out;
}

function help() {
  console.log(`create-tournamental-app — scaffold a Tournamental plugin or extension

Usage (interactive):
  npm create @tournamental/app
  pnpm create @tournamental/app

Usage (non-interactive):
  npx @tournamental/create-app --template <name> --name <pkg> --dir <path>

Available templates:
  plugin-scorer    Minimum viable scorer plugin (50 lines + passing test)

Options:
  --template <name>  Template to use (see list above)
  --name <pkg>       Package name (npm-style; will be slugified)
  --dir <path>       Output directory (will be created if missing)
  -h, --help         Show this help`);
}

async function listTemplates() {
  const entries = await readdir(TEMPLATES_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function prompt(rl, question, defaultValue) {
  const suffix = defaultValue !== undefined ? ` [${defaultValue}]` : "";
  const ans = (await rl.question(`${question}${suffix} > `)).trim();
  return ans === "" && defaultValue !== undefined ? defaultValue : ans;
}

async function interactive(templates) {
  const rl = createInterface({ input: stdin, output: stdout });
  console.log("\nWelcome to create-tournamental-app.\n");
  console.log(`Available templates: ${templates.join(", ")}`);
  const template = await prompt(rl, "Template", templates[0]);
  if (!templates.includes(template)) {
    rl.close();
    throw new Error(`Unknown template: ${template}`);
  }
  const name = await prompt(rl, "Package name (e.g. my-rating-scorer)");
  const dir = await prompt(rl, "Output directory", `./${name}`);
  rl.close();
  return { template, name, dir };
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

async function copyTemplate(srcDir, dstDir, name) {
  const slug = slugify(name);
  const stack = [""];
  while (stack.length) {
    const rel = stack.pop();
    const srcPath = join(srcDir, rel);
    const st = await stat(srcPath);
    if (st.isDirectory()) {
      await mkdir(join(dstDir, rel), { recursive: true });
      const entries = await readdir(srcPath);
      for (const e of entries) stack.push(join(rel, e));
    } else {
      const text = await readFile(srcPath, "utf8");
      const rewritten = text
        .replaceAll("__PKG_NAME__", `@tournamental-plugin/${slug}`)
        .replaceAll("__PKG_SLUG__", slug)
        .replaceAll("__PKG_DISPLAY__", name);
      await writeFile(join(dstDir, rel), rewritten);
    }
  }
}

async function main() {
  if (args.help) {
    help();
    return;
  }

  const templates = await listTemplates();
  if (templates.length === 0) {
    throw new Error("No templates available. The scaffolder is broken.");
  }

  const choice = args.interactive ? await interactive(templates) : args;

  if (!templates.includes(choice.template)) {
    throw new Error(`Unknown template "${choice.template}". Available: ${templates.join(", ")}`);
  }

  const dstDir = resolve(choice.dir);
  console.log(`\nScaffolding ${choice.template} into ${relative(process.cwd(), dstDir) || "."}/ ...`);
  await copyTemplate(join(TEMPLATES_DIR, choice.template), dstDir, choice.name);
  console.log("done.\n");
  console.log("Next steps:");
  console.log(`  cd ${relative(process.cwd(), dstDir) || "."}`);
  console.log("  pnpm install   # or npm install");
  console.log("  pnpm test      # run the example test");
  console.log("");
  console.log("Then edit src/index.ts. The README in the template tells you what to change.");
  console.log("Submit your finished plugin via PR — see CONTRIBUTING.md.");
}

main().catch((e) => {
  console.error("create-tournamental-app:", e.message);
  exit(1);
});
