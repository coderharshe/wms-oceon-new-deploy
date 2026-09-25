import type { Config } from "tailwindcss";

// Minimal ERP theme: no gradients, no shadows-as-decoration, dense spacing scale.
// Colors are functional (status/action), not brand decoration.
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
        // Status colours are meaning, not decoration — a theme must not repaint
        // "this order failed" into something calmer. Always used as a solid fill
        // with white text, so they read on any background.
        good: "#1a7f37",
        warn: "#a35a00",
        bad: "#b3261e",
      },
      fontSize: {
        xs: ["11px", "14px"],
        sm: ["12.5px", "16px"],
        base: ["13.5px", "18px"],
        lg: ["16px", "20px"],
        xl: ["20px", "24px"],
      },
      spacing: {
        "0.5": "2px",
        "1.5": "6px",
      },
      borderRadius: {
        DEFAULT: "3px",
      },
    },
  },
  plugins: [],
};
export default config;
