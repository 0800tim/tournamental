/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      colors: {
        ink: {
          900: "#0a0e1a",
          800: "#101626",
          700: "#1a2238",
          600: "#293352",
          500: "#3e4a72",
          200: "#cdd5e7",
          100: "#e7ecf7",
          50:  "#f5f7fc",
        },
        accent: {
          // Sky-blue (Argentina / pitch sky) primary
          400: "#7eb6e8",
          500: "#5a96d8",
          600: "#3f7cc4",
          700: "#2a5fa1",
        },
        flame: {
          400: "#ffb37a",
          500: "#ff8a3d",
          600: "#e76b15",
        },
        emerald: {
          // Pitch grass
          500: "#21a34a",
          600: "#1a8038",
        },
      },
      fontFamily: {
        // Inter Variable is self-hosted from /public/fonts/. The
        // system-font fallback chain matches the previous default so
        // first-paint stays clean while the woff2 streams in.
        sans: ["Inter Variable", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        display: ["Inter Variable", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "Menlo", "Monaco", "monospace"],
      },
      maxWidth: {
        prose: "68ch",
      },
    },
  },
  plugins: [],
};
