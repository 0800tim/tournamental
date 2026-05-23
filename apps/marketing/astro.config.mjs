import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

// Honour ASTRO_OUT_DIR so the publish-all orchestrator's smoke step
// can preview a staging-slot build (e.g. dist-staging) instead of the
// default `dist/` (Tim 2026-05-23). Without this the smoke step failed
// with "The output directory dist/ does not exist" because the build
// had emitted to dist-staging/.
const customOutDir = process.env.ASTRO_OUT_DIR
  ? process.env.ASTRO_OUT_DIR
  : undefined;

export default defineConfig({
  site: "https://tournamental.com",
  trailingSlash: "ignore",
  ...(customOutDir ? { outDir: customOutDir } : {}),
  // MDX gives us first-class React-style component embeds inside the
  // /blog/ content collection while keeping the rest of the marketing
  // surface as plain Astro. Sitemap auto-discovers the blog index +
  // every generated post slug; nothing to wire by hand.
  integrations: [tailwind({ applyBaseStyles: false }), mdx(), sitemap()],
  // Suppress Astro's dev toolbar in built output. The toolbar is a
  // dev-only convenience but the prod build was shipping it into the
  // static HTML — visible on every marketing page at launch.
  devToolbar: { enabled: false },
  server: {
    host: "0.0.0.0",
    port: 3320,
  },
  vite: {
    server: {
      allowedHosts: ['tournamental.com', '.tournamental.com', 'vtourn.com', '.vtourn.com', 'localhost'],
    },
    preview: {
      allowedHosts: ['tournamental.com', '.tournamental.com', 'vtourn.com', '.vtourn.com', 'localhost'],
    },
  },
});
