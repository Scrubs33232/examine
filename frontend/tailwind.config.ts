import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#05070a",
        surface: "#0b0f16",
        "surface-raised": "#111722",
        border: "#1e2632",
        foreground: "#e6ebf2",
        muted: "#7c8798",
        bull: {
          DEFAULT: "#22e0a0",
          dim: "#0f5e46",
          bg: "#0a1f19",
        },
        bear: {
          DEFAULT: "#ff5c72",
          dim: "#6e1f2c",
          bg: "#22111a",
        },
        accent: "#3b82f6",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)"],
        mono: ["var(--font-geist-mono)"],
      },
      boxShadow: {
        glow: "0 0 24px -6px rgb(34 224 160 / 0.35)",
        "glow-bear": "0 0 24px -6px rgb(255 92 114 / 0.35)",
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        "scan-line": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
        "grow-bar": {
          "0%": { width: "0%" },
        },
      },
      animation: {
        "pulse-soft": "pulse-soft 1.6s ease-in-out infinite",
        "scan-line": "scan-line 1.8s linear infinite",
      },
    },
  },
  plugins: [],
};
export default config;
