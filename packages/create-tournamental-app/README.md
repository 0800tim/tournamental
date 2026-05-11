# @tournamental/create-app

One-command scaffolder for new Tournamental plugins and extensions.

```bash
# pnpm
pnpm create @tournamental/app

# npm
npm create @tournamental/app

# yarn
yarn create @tournamental/app
```

You'll be prompted for a template, a package name, and a destination
directory. The scaffolder copies a known-good template, rewrites the
package name, installs nothing (you do that next), and prints the
three commands to get to a passing test.

## Templates

| Template | What it gives you |
| --- | --- |
| `plugin-scorer` | A minimum-viable [scorer plugin](https://github.com/0800tim/tournamental/tree/main/examples/hello-plugin-scorer) — 50 lines, one passing vitest. |

More templates land as the platform's extension points get used in the
wild. Open a [PR](https://github.com/0800tim/tournamental/pulls) with
your own template and we'll add it.

## Non-interactive mode (CI / agents)

```bash
npx @tournamental/create-app \
  --template plugin-scorer \
  --name my-rating-scorer \
  --dir ./plugins/my-rating-scorer
```

Designed so an AI agent can pick a template via flag rather than
prompt; no readline needed.

## What this is not (yet)

- Not a full app generator (no Next.js / Astro / Cloudflare Worker
  templates yet — open an issue if you want one).
- Not a deploy-button (Vercel-style template marketplace launch is a
  separate workstream).
- Not a sandboxed env. The scaffolder writes files to your filesystem;
  inspect the template under `templates/<name>/` before running if you
  don't trust an upstream tag.

## License

Apache 2.0.
