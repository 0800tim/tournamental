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
      // Allow our cloudflared dev hostname to hit the dev server.
      allowedHosts: [
        "vtorn-www.aiva.nz",
        "preview.vtourn.com",
        "vtourn.com",
        "www.vtourn.com",
        "localhost",
      ],
    },
  },
});
