import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        saffron: "#ff9933",
        "saffron-light": "#ffaa4d",
        "ink": "#0c0a09",
        "ink-soft": "#1a1613",
        "ink-line": "#2a2524",
        "cream": "#f3ead9",
        "cream-muted": "#9a9490",
        "cream-dim": "#6b6460",
      },
      fontFamily: {
        headline: ["Newsreader", "serif"],
        body: ["Noto Sans Devanagari", "Inter", "sans-serif"],
        devanagari: ["Noto Sans Devanagari", "sans-serif"],
        display: ["Teko", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      borderRadius: {
        lg: "0.5rem",
        xl: "0.75rem",
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
