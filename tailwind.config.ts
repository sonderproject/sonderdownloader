import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0A0A09",
          soft: "#121418",
          deep: "#04121C",
        },
        text: {
          DEFAULT: "#EDE9E3",
          dim: "rgba(237,233,227,0.62)",
          subtle: "rgba(237,233,227,0.22)",
        },
        accent: {
          DEFAULT: "#3E9BD4",
          bright: "#6FC3F0",
          ink: "#04121C",
        },
      },
      fontFamily: {
        display: ["var(--font-outfit)", "Outfit", "system-ui", "sans-serif"],
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        sonder: "4px",
        "sonder-lg": "8px",
      },
      letterSpacing: {
        "wider-plus": "0.12em",
        widest: "0.24em",
      },
    },
  },
  plugins: [],
};

export default config;
