"use client";

import { useEffect } from "react";
import { fullThemeStyle, type FontFamilyKey, FONT_FAMILIES } from "@/lib/themes";

export function ThemeApplier() {
  useEffect(() => {
    function applyUserTheme() {
      try {
        const theme = localStorage.getItem("wms_user_theme");
        const accent = localStorage.getItem("wms_user_accent");
        const font = localStorage.getItem("wms_user_font");
        const size = localStorage.getItem("wms_user_fontsize");

        if (theme || accent || font) {
          const styles = fullThemeStyle(theme, accent, font);
          const root = document.documentElement;
          for (const [prop, val] of Object.entries(styles)) {
            if (prop.startsWith("--")) {
              root.style.setProperty(prop, String(val));
            }
          }
          if (font) {
            const fontDef = FONT_FAMILIES[font.toLowerCase() as FontFamilyKey];
            if (fontDef) {
              document.body.style.fontFamily = fontDef.family;
            }
          }
        }

        if (size && size !== "standard") {
          document.documentElement.classList.remove("font-size-sm", "font-size-lg", "font-size-xl");
          document.documentElement.classList.add(`font-size-${size}`);
        }
      } catch {
        // localStorage not accessible
      }
    }

    applyUserTheme();
    window.addEventListener("wms_theme_updated", applyUserTheme);
    return () => window.removeEventListener("wms_theme_updated", applyUserTheme);
  }, []);

  return null;
}

export default ThemeApplier;
