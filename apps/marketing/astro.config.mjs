import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";

export default defineConfig({
  site: "https://vtourn.com",
  trailingSlash: "ignore",
  integrations: [tailwind()],
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
