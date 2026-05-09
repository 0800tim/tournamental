/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  // Dark theme by default per spec.
  darkMode: "class",
  theme: {
    extend: {
      // Mirrors the marketing palette so admin stays on-brand.
      // See apps/marketing/tailwind.config.mjs.
      colors: {
        ink: {
          900: "#0a0e1a",
          800: "#101626",
          700: "#1a2238",
          600: "#293352",
          500: "#3e4a72",
          200: "#cdd5e7",
          100: "#e7ecf7",
          50: "#f5f7fc",
        },
        accent: {
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
          500: "#21a34a",
          600: "#1a8038",
        },
        danger: {
          500: "#e85a5a",
          600: "#c43f3f",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        display: ["ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "Menlo", "Monaco", "monospace"],
      },
    },
  },
  plugins: [],
};
