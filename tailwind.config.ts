import type { Config } from "tailwindcss";

// High-clarity ERP theme: crisp spacing, enlarged readable typography scale, functional contrast.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Themeable chrome: the values live in CSS variables (src/lib/themes.ts),
        // set per portal on the PortalShell root. The channel-triplet form is
        // what keeps `bg-accent/10` and friends working.
        ink: "rgb(var(--c-ink) / <alpha-value>)",
        paper: "rgb(var(--c-paper) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        "surface-hi": "rgb(var(--c-surface-hi) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        accent: "rgb(var(--c-accent) / <alpha-value>)",
        // Status colours are meaning, not decoration
        good: "#1a7f37",
        warn: "#a35a00",
        bad: "#b3261e",
      },
      fontSize: {
        xs: ["13px", "17px"],
        sm: ["15px", "20px"],
        base: ["17px", "24px"],
        lg: ["19.5px", "26px"],
        xl: ["23px", "29px"],
        "2xl": ["27px", "34px"],
        "3xl": ["33px", "40px"],
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      },
      spacing: {
        "0.5": "2px",
        "1.5": "6px",
      },
      borderRadius: {
        DEFAULT: "4px",
      },
    },
  },
  plugins: [],
};
export default config;
