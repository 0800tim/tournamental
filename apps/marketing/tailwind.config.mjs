/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      colors: {
        // Repalleted 2026-05-20: dark canvas was navy-tinted slate
        // (#0a0e1a → #293352). New scale is a neutral charcoal so the
        // gold ball-mark + gold editorial accents sit on a true-grey
        // backdrop. Light tints (50/100/200) keep the cool ink cast so
        // light-theme surfaces still feel branded.
        ink: {
          900: "#15151a",
          800: "#1c1c22",
          700: "#26262c",
          600: "#3a3a44",
          500: "#52525c",
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
        // Brand gold, pulled directly from the new ball mark.
        // 400/500 are the body-readable tones used for accents,
        // 200 lights up on dark surfaces for hairline highlights.
        gold: {
          50:  "#fcf2d4",
          100: "#fcebb2",
          200: "#f0d27a",
          300: "#e6bf5e",
          400: "#dca94b",
          500: "#c08a26",
          600: "#9a6a17",
          700: "#6b4708",
        },
      },
      fontFamily: {
        // Inter Variable is self-hosted from /public/fonts/. The
        // system-font fallback chain matches the previous default so
        // first-paint stays clean while the woff2 streams in.
        sans: ["Inter Variable", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        // `display` keeps the existing Inter binding so legacy markup
        // doesn't shift. New editorial work uses `editorial` (Fraunces),
        // which is a serif with optical-size + softness axes designed
        // for magazine-style settings.
        display: ["Inter Variable", "ui-sans-serif", "system-ui", "sans-serif"],
        editorial: [
          "Fraunces",
          "ui-serif",
          "Charter",
          "Georgia",
          "Cambria",
          "Times New Roman",
          "serif",
        ],
        mono: ["ui-monospace", "Menlo", "Monaco", "monospace"],
      },
      maxWidth: {
        prose: "68ch",
      },
    },
  },
  plugins: [],
};
