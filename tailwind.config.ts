import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#0B2545",
          deep: "#061530",
          soft: "#13315C",
        },
        teal: {
          DEFAULT: "#3AAFA9",
          deep: "#2B7A78",
          soft: "#8FD9D4",
        },
        cream: {
          DEFAULT: "#F5F1E8",
          soft: "#FBF8F1",
          deep: "#EBE4D2",
        },
      },
      fontFamily: {
        serif: ["var(--font-fraunces)", "Fraunces", "Georgia", "serif"],
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        depth: "0 20px 40px -20px rgba(6, 21, 48, 0.25)",
      },
    },
  },
  plugins: [],
};

export default config;
