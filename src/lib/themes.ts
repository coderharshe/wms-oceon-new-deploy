/**
 * Portal colour themes (PRD §5 "Manage system settings").
 *
 * The whole UI paints from seven CSS variables that tailwind.config.ts wires
 * into the colour utilities, so a theme is just seven values — no per-page
 * colour code anywhere. Managers pick one per portal; the choice is stored as
 * SystemSetting THEME_MANAGER / THEME_FINANCE and applied server-side in the
 * portal layout, so the page never flashes the wrong colour on load.
 *
 * Presets, not a free colour picker, on purpose: every value here is chosen
 * against the others so text stays readable on its background. A hex box would
 * let a counter screen end up grey-on-grey, and the till is the last place to
 * discover that.
 */

/** Channel triplets ("R G B") — tailwind wraps them so bg-accent/10 still works. */
export type ThemeTokens = {
  /** Cards, header, footer, inputs — the raised surfaces. */
  paper: string;
  /** The page behind the cards; also table headers and plain buttons. */
  surface: string;
  /** Hover/active on anything sitting on `surface`, and the focused bill row. */
  "surface-hi": string;
  /** Body text. */
  ink: string;
  /** Borders, badge fills, skeletons. */
  line: string;
  /** Secondary text. */
  muted: string;
  /** Focus rings and the primary button fill (always with white text). */
  accent: string;
};

export const TOKEN_KEYS = ["paper", "surface", "surface-hi", "ink", "line", "muted", "accent"] as const;

export const THEMES = {
  default: {
    label: "Default Grey",
    tokens: {
      paper: "255 255 255",
      surface: "249 250 251",
      "surface-hi": "243 244 246",
      ink: "26 26 26",
      line: "216 216 216",
      muted: "107 107 107",
      accent: "31 95 191",
    },
  },
  slate: {
    label: "Slate Blue",
    tokens: {
      paper: "255 255 255",
      surface: "238 242 247",
      "surface-hi": "226 232 242",
      ink: "15 23 42",
      line: "203 213 225",
      muted: "85 101 125",
      accent: "31 95 191",
    },
  },
  sand: {
    label: "Warm Sand",
    tokens: {
      paper: "255 253 248",
      surface: "246 239 226",
      "surface-hi": "236 226 208",
      ink: "42 33 24",
      line: "219 205 180",
      muted: "122 106 85",
      accent: "154 91 22",
    },
  },
  forest: {
    label: "Forest Green",
    tokens: {
      paper: "255 255 255",
      surface: "234 243 236",
      "surface-hi": "219 233 222",
      ink: "18 38 26",
      line: "188 212 194",
      muted: "79 107 87",
      accent: "20 110 68",
    },
  },
  ocean: {
    label: "Ocean Indigo",
    tokens: {
      paper: "255 255 255",
      surface: "237 245 254",
      "surface-hi": "220 235 252",
      ink: "12 28 50",
      line: "193 214 240",
      muted: "68 96 130",
      accent: "14 90 200",
    },
  },
  sunset: {
    label: "Sunset Amber",
    tokens: {
      paper: "255 254 250",
      surface: "253 244 232",
      "surface-hi": "249 231 210",
      ink: "48 24 10",
      line: "230 205 175",
      muted: "128 90 60",
      accent: "190 70 15",
    },
  },
  emerald: {
    label: "Emerald Mint",
    tokens: {
      paper: "255 255 255",
      surface: "235 247 240",
      "surface-hi": "215 240 225",
      ink: "10 40 25",
      line: "180 215 195",
      muted: "65 110 85",
      accent: "15 125 75",
    },
  },
  dark: {
    label: "Charcoal Dark",
    tokens: {
      paper: "30 30 30",
      surface: "20 20 20",
      "surface-hi": "48 48 48",
      ink: "237 237 237",
      line: "64 64 64",
      muted: "160 160 160",
      accent: "59 125 221",
    },
  },
  midnight: {
    label: "Midnight OLED",
    tokens: {
      paper: "18 24 38",
      surface: "10 14 24",
      "surface-hi": "28 38 58",
      ink: "240 244 250",
      line: "45 60 90",
      muted: "140 160 190",
      accent: "56 130 246",
    },
  },
  contrast: {
    label: "High Contrast",
    tokens: {
      paper: "255 255 255",
      surface: "255 255 255",
      "surface-hi": "224 224 224",
      ink: "0 0 0",
      line: "0 0 0",
      muted: "51 51 51",
      accent: "0 51 204",
    },
  },
} satisfies Record<string, { label: string; tokens: ThemeTokens }>;

export const DEFAULT_THEME = "default";
export const THEME_NAMES: string[] = Object.keys(THEMES);

export type FontFamilyKey = "inter" | "outfit" | "roboto" | "poppins" | "mono" | "system";

export const FONT_FAMILIES: Record<FontFamilyKey, { label: string; family: string; desc: string }> = {
  inter: {
    label: "Inter",
    family: "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif",
    desc: "Modern, clean, balanced typography",
  },
  outfit: {
    label: "Outfit",
    family: "'Outfit', ui-sans-serif, system-ui, -apple-system, sans-serif",
    desc: "Geometric, contemporary tech look",
  },
  roboto: {
    label: "Roboto",
    family: "'Roboto', ui-sans-serif, system-ui, -apple-system, sans-serif",
    desc: "Crisp, standard industrial legibility",
  },
  poppins: {
    label: "Poppins",
    family: "'Poppins', ui-sans-serif, system-ui, -apple-system, sans-serif",
    desc: "Friendly, open, high-impact curves",
  },
  mono: {
    label: "JetBrains Mono",
    family: "'JetBrains Mono', ui-monospace, monospace",
    desc: "Technical monospace font for POS data",
  },
  system: {
    label: "System UI",
    family: "ui-sans-serif, system-ui, -apple-system, Arial, sans-serif",
    desc: "Native operating system default",
  },
};

export const ACCENT_COLOR_PRESETS = [
  { label: "Classic Blue", rgb: "31 95 191", hex: "#1f5fbf" },
  { label: "Indigo", rgb: "79 70 229", hex: "#4f46e5" },
  { label: "Ocean Teal", rgb: "13 148 136", hex: "#0d9488" },
  { label: "Emerald Green", rgb: "16 185 129", hex: "#10b981" },
  { label: "Amber Gold", rgb: "217 119 6", hex: "#d97706" },
  { label: "Crimson Rose", rgb: "225 29 72", hex: "#e11d48" },
  { label: "Purple Violet", rgb: "147 51 234", hex: "#9333ea" },
  { label: "Electric Cyan", rgb: "6 182 212", hex: "#06b6d4" },
];

/** Converts Hex #RRGGBB to "R G B" triplet. */
export function hexToRgbTriplet(hex: string): string | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!match || !match[1] || !match[2] || !match[3]) return null;
  return `${parseInt(match[1], 16)} ${parseInt(match[2], 16)} ${parseInt(match[3], 16)}`;
}

/** Converts "R G B" triplet to Hex #RRGGBB. */
export function rgbTripletToHex(rgb: string): string {
  const parts = rgb.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return "#1f5fbf";
  return "#" + parts.map((n) => n.toString(16).padStart(2, "0")).join("");
}

/** An unset or stale setting falls back to the default rather than blanking the UI. */
export function themeVars(name: string | undefined | null, customAccent?: string | null): React.CSSProperties {
  const theme = (THEMES as Record<string, { tokens: ThemeTokens }>)[name || ""] ?? THEMES.default;
  const entries: [string, string][] = TOKEN_KEYS.map((k) => [`--c-${k}`, theme.tokens[k]]);
  
  if (customAccent) {
    const customRgb = customAccent.includes(" ") ? customAccent : hexToRgbTriplet(customAccent);
    if (customRgb) {
      const idx = entries.findIndex(([k]) => k === "--c-accent");
      if (idx >= 0) entries[idx] = ["--c-accent", customRgb];
      else entries.push(["--c-accent", customRgb]);
    }
  }

  return Object.fromEntries(entries) as React.CSSProperties;
}

/** Full style variables including theme tokens and custom font family. */
export function fullThemeStyle(
  themeName?: string | null,
  customAccent?: string | null,
  fontFamilyKey?: string | null
): React.CSSProperties {
  const base = themeVars(themeName, customAccent);
  const fontKey = (fontFamilyKey || "inter").toLowerCase() as FontFamilyKey;
  const fontDef = FONT_FAMILIES[fontKey] ?? FONT_FAMILIES.inter;
  
  return {
    ...base,
    fontFamily: fontDef.family,
  };
}

/** WCAG relative luminance of an "R G B" triplet. */
export function luminance(rgb: string): number {
  const ch = rgb.split(/\s+/).map((n) => {
    const c = Number(n) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
}

/** WCAG contrast ratio between two "R G B" triplets. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
