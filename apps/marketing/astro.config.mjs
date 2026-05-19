import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://tournamental.com",
  trailingSlash: "ignore",
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
