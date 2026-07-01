import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#141210",
          soft: "#3B3733",
          muted: "#7A736C",
        },
        paper: {
          DEFAULT: "#F3EDE3",
          soft: "#F8F4EC",
          deep: "#E7DFD1",
        },
        ember: {
          DEFAULT: "#B7532A",
          soft: "#D97742",
          deep: "#8B3E1F",
        },
        moss: {
          DEFAULT: "#4A5D3A",
        },
      },
      fontFamily: {
        serif: ["var(--font-fraunces)", "Fraunces", "Georgia", "serif"],
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
      },
      letterSpacing: {
        "wider-plus": "0.18em",
        widest: "0.28em",
      },
    },
  },
  plugins: [],
};

export default config;
