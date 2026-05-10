#!/usr/bin/env tsx
/**
 * Build the bundled offline shell for the Capacitor app.
 *
 * Capacitor *requires* a `webDir` to exist with at least an `index.html`,
 * even when the WebView is configured to load a remote URL via
 * `server.url`. This script writes a minimal `www/index.html` that's only
 * shown if the device is offline at first launch (or for app-store
 * review builds where reviewers may sandbox the network).
 *
 * The shell is a static "VTourn — open the app" placeholder; no JS, no
 * external assets, < 4kb.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const WWW = resolve(ROOT, 'www');

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
    <title>VTourn</title>
    <style>
      :root { color-scheme: dark; }
      html, body { margin: 0; padding: 0; height: 100%;
        background: #0c1722; color: #e6edf3;
        font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
      }
      .wrap { display: grid; place-items: center; min-height: 100%; padding: 24px; text-align: center; }
      h1 { font-size: 28px; margin: 0 0 12px; letter-spacing: -0.02em; }
      p  { font-size: 16px; opacity: 0.75; max-width: 30ch; line-height: 1.45; }
      .v {
        width: 96px; height: 96px; border-radius: 22px;
        background: #1f6feb; display: grid; place-items: center;
        margin: 0 auto 20px;
      }
      .v svg { width: 56px; height: 56px; }
      a.btn {
        display: inline-block; margin-top: 20px; padding: 12px 20px;
        background: #facc15; color: #0c1722; border-radius: 12px;
        font-weight: 600; text-decoration: none;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div>
        <div class="v" aria-hidden="true">
          <svg viewBox="0 0 100 100"><path d="M 20 25 L 50 80 L 80 25"
            fill="none" stroke="#facc15" stroke-width="14"
            stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <h1>VTourn</h1>
        <p>You're offline or this is a sandboxed review build. Reconnect to load the live app.</p>
        <a class="btn" href="https://vtourn.com">Open vtourn.com</a>
      </div>
    </div>
  </body>
</html>
`;

async function main(): Promise<void> {
  await mkdir(WWW, { recursive: true });
  await writeFile(resolve(WWW, 'index.html'), HTML, 'utf8');
  process.stdout.write('wrote www/index.html\n');
}

await main();
