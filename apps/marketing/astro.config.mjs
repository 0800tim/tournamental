import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://vtourn.com",
  trailingSlash: "ignore",
  // MDX gives us first-class React-style component embeds inside the
  // /blog/ content collection while keeping the rest of the marketing
  // surface as plain Astro. Sitemap auto-discovers the blog index +
  // every generated post slug; nothing to wire by hand.
  integrations: [tailwind(), mdx(), sitemap()],
  server: {
    host: "0.0.0.0",
    port: 3320,
  },
  vite: {
    server: {
      // Dev only: accept any Host header so the cloudflared tunnel
      // (vtorn-www.aiva.nz today, vtourn.com tomorrow) can hit us
      // without per-host config drift.
      allowedHosts: true,
    },
    preview: {
      allowedHosts: true,
    },
  },
});
