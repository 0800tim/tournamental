#!/usr/bin/env node
// Replaces `astro preview` because Astro 4.x's static-preview-server.js
// calls vite.preview({ configFile: false }) without allowedHosts, causing
// 403 errors for every Cloudflare-tunnelled request (non-localhost Host).
//
// Also adds a trailing-slash normaliser so /path serves /path/index.html
// (Vite's sirv doesn't redirect bare directory paths by default).
//
// Vite is not a direct dep of the marketing app — resolve it via Astro,
// which depends on Vite and IS a direct dep of this app.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('.', import.meta.url))
const port = parseInt(process.env.PORT ?? '3320', 10)
const host = process.env.HOST ?? '0.0.0.0'

// Resolve vite via astro (astro is a direct dep; vite is astro's dep).
// Use the package root, not index.cjs, so Node picks the ESM export.
const astroPkg = require.resolve('astro/package.json')
const astroRequire = createRequire(astroPkg)
const viteRoot = astroRequire.resolve('vite/package.json').replace('/package.json', '')
const { preview } = await import(`${viteRoot}/dist/node/index.js`)

const trailingSlashPlugin = {
  name: 'vt-trailing-slash',
  configurePreviewServer(server) {
    // Rewrite /path → /path/ so sirv finds /path/index.html.
    // configurePreviewServer runs before Vite's static middleware, so
    // mutating req.url here is picked up by sirv on the same request.
    server.middlewares.use((req, res, next) => {
      const raw = req.url ?? '/'
      const [pathname, query] = raw.split('?')
      if (pathname !== '/' && !pathname.endsWith('/') && !pathname.includes('.')) {
        req.url = pathname + '/' + (query ? '?' + query : '')
      }
      next()
    })
  },
}

await preview({
  configFile: false,
  root,
  appType: 'mpa',
  build: { outDir: resolve(root, 'dist') },
  plugins: [trailingSlashPlugin],
  preview: {
    host,
    port,
    allowedHosts: [
      'tournamental.com',
      '.tournamental.com',
      'vtourn.com',
      '.vtourn.com',
      'localhost',
      '127.0.0.1',
      'clawdia',
    ],
  },
})
