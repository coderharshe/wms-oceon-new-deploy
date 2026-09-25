"use client";

import { useEffect, useState } from "react";
import {
  THEMES,
  THEME_NAMES,
  FONT_FAMILIES,
  ACCENT_COLOR_PRESETS,
  fullThemeStyle,
  contrast,
  rgbTripletToHex,
  hexToRgbTriplet,
  type FontFamilyKey,
} from "@/lib/themes";
import { useEscapeKey } from "@/lib/keynav";

export type UserPreferences = {
  id: string;
  staffId: string;
  name: string;
  role?: string;
  theme: string | null;
  accentColor: string | null;
  fontFamily: string | null;
  fontSize: string | null;
};

const FONT_SIZES = [
  { id: "sm", label: "Small", desc: "15px compact for high density" },
  { id: "standard", label: "Standard", desc: "17px default warehouse standard" },
  { id: "lg", label: "Large", desc: "19px touch screen friendly" },
  { id: "xl", label: "Extra Large", desc: "21px kiosk & far view" },
];

export function ThemeStudioModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved?: (prefs: UserPreferences) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [prefs, setPrefs] = useState<UserPreferences>({
    id: "",
    staffId: "",
    name: "",
    theme: "default",
    accentColor: null,
    fontFamily: "inter",
    fontSize: "standard",
  });

  useEscapeKey(() => onClose());

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/user/preferences");
        if (res.ok) {
          const data = await res.json();
          setPrefs({
            id: data.id || "",
            staffId: data.staffId || "",
            name: data.name || "",
            role: data.role || "",
            theme: data.theme || "default",
            accentColor: data.accentColor || null,
            fontFamily: data.fontFamily || "inter",
            fontSize: data.fontSize || "standard",
          });
        }
      } catch {
        // fallback
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSave() {
    setSaving(true);
    setSavedSuccess(false);
    try {
      const res = await fetch("/api/user/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme: prefs.theme,
          accentColor: prefs.accentColor,
          fontFamily: prefs.fontFamily,
          fontSize: prefs.fontSize,
        }),
      });

      if (res.ok) {
        setSavedSuccess(true);
        // Persist to localStorage for immediate cross-tab sync
        if (typeof window !== "undefined") {
          localStorage.setItem("wms_user_theme", prefs.theme || "default");
          localStorage.setItem("wms_user_accent", prefs.accentColor || "");
          localStorage.setItem("wms_user_font", prefs.fontFamily || "inter");
          localStorage.setItem("wms_user_fontsize", prefs.fontSize || "standard");
          window.dispatchEvent(new Event("wms_theme_updated"));
        }
        if (onSaved) onSaved(prefs);
        setTimeout(() => {
          onClose();
          window.location.reload();
        }, 600);
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  const activeThemeKey = prefs.theme && THEME_NAMES.includes(prefs.theme) ? prefs.theme : "default";
  const activeFontKey = (prefs.fontFamily || "inter").toLowerCase() as FontFamilyKey;
  const currentTheme = THEMES[activeThemeKey as keyof typeof THEMES] || THEMES.default;
  const previewStyle = fullThemeStyle(prefs.theme, prefs.accentColor, prefs.fontFamily);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card max-h-[92vh] w-full max-w-4xl space-y-4 overflow-y-auto shadow-2xl border-2 border-line bg-paper text-ink p-4 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">🎨</span>
            <div>
              <h2 className="text-base font-bold text-ink">Personal Theme & Typography Studio</h2>
              <p className="text-xs text-muted">
                Customizing visual style for Staff ID: <strong className="text-ink">{prefs.staffId || "Current User"}</strong> ({prefs.name || "Loading..."})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-muted hover:text-ink hover:bg-surface-hi text-sm"
            title="Close"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-muted">Loading your preferences…</div>
        ) : (
          <div className="space-y-6">
            {/* Live Interactive Preview Box */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted">
                  Live Real-Time Preview
                </span>
                <span className="text-[11px] text-muted font-mono">
                  Font: {FONT_FAMILIES[activeFontKey]?.label || "Inter"} · Size: {prefs.fontSize}
                </span>
              </div>

              <div
                style={previewStyle}
                className={`rounded-xl border border-line bg-surface p-4 shadow-inner transition-all ${
                  prefs.fontSize && prefs.fontSize !== "standard" ? "font-size-" + prefs.fontSize : ""
                }`}
              >
                <div className="rounded-lg border border-line bg-paper p-3 shadow-sm space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full bg-accent" />
                      <span className="font-bold text-sm text-ink">Taresh Warehouse Management</span>
                      <span className="badge bg-surface-hi text-muted text-[11px] border border-line">v2.4</span>
                    </div>
                    <span className="badge bg-good/15 text-good font-semibold text-xs">● Active Session</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="p-2.5 rounded bg-surface border border-line">
                      <span className="text-[11px] text-muted block">Today&apos;s Billing</span>
                      <span className="text-sm font-bold text-ink">₹1,42,850.00</span>
                    </div>
                    <div className="p-2.5 rounded bg-surface border border-line">
                      <span className="text-[11px] text-muted block">Dispatch Orders</span>
                      <span className="text-sm font-bold text-ink">48 Units Ready</span>
                    </div>
                    <div className="p-2.5 rounded bg-surface border border-line">
                      <span className="text-[11px] text-muted block">Active Cashier</span>
                      <span className="text-sm font-bold text-ink">{prefs.name || "Staff Member"}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button type="button" className="btn-primary text-xs px-3 py-1.5 shadow-sm font-semibold">
                      Primary Action
                    </button>
                    <button type="button" className="btn text-xs px-3 py-1.5 font-medium">
                      Secondary
                    </button>
                    <span className="badge bg-accent/15 text-accent font-semibold text-xs border border-accent/30">
                      Accent Tag
                    </span>
                    <span className="text-xs text-muted ml-auto">
                      WCAG Contrast: {contrast(currentTheme.tokens.ink, currentTheme.tokens.surface).toFixed(1)}:1
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Section 1: Color Themes */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-ink block">
                1. Select Color Palette ({THEME_NAMES.length} Presets)
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {Object.entries(THEMES).map(([key, t]) => {
                  const isSelected = prefs.theme === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPrefs({ ...prefs, theme: key })}
                      style={fullThemeStyle(key, null, prefs.fontFamily)}
                      className={`overflow-hidden rounded-lg border text-left p-2.5 transition-all bg-surface ${
                        isSelected ? "ring-2 ring-accent border-accent shadow-md scale-[1.02]" : "border-line hover:border-ink/50"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-ink truncate">{t.label}</span>
                        {isSelected && <span className="text-[10px] text-accent font-bold">✓</span>}
                      </div>
                      <div className="flex gap-1 h-3.5">
                        <span className="flex-1 rounded bg-paper border border-line" />
                        <span className="w-4 rounded bg-accent" />
                        <span className="w-3 rounded bg-surface-hi" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Section 2: Accent Color */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-ink block">
                2. Highlight & Accent Color
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {ACCENT_COLOR_PRESETS.map((preset) => {
                  const isSelected =
                    prefs.accentColor === preset.rgb ||
                    prefs.accentColor === preset.hex ||
                    (!prefs.accentColor && currentTheme.tokens.accent === preset.rgb);
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setPrefs({ ...prefs, accentColor: preset.rgb })}
                      title={preset.label}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                        isSelected
                          ? "ring-2 ring-accent border-accent bg-paper shadow-sm"
                          : "border-line bg-surface hover:bg-surface-hi text-muted"
                      }`}
                    >
                      <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: preset.hex }} />
                      <span>{preset.label}</span>
                    </button>
                  );
                })}

                {/* Custom Color Input */}
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-line bg-surface ml-auto">
                  <label htmlFor="custom-accent-color" className="text-[11px] text-muted font-medium">Custom:</label>
                  <input
                    id="custom-accent-color"
                    type="color"
                    className="h-6 w-7 cursor-pointer rounded border border-line p-0 bg-transparent"
                    value={
                      prefs.accentColor
                        ? prefs.accentColor.includes(" ")
                          ? rgbTripletToHex(prefs.accentColor)
                          : prefs.accentColor
                        : rgbTripletToHex(currentTheme.tokens.accent)
                    }
                    onChange={(e) => {
                      const rgb = hexToRgbTriplet(e.target.value);
                      if (rgb) setPrefs({ ...prefs, accentColor: rgb });
                    }}
                  />
                  {prefs.accentColor && (
                    <button
                      type="button"
                      onClick={() => setPrefs({ ...prefs, accentColor: null })}
                      className="text-[10px] text-muted hover:text-bad underline ml-1"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Section 3: Typography & Google Font Family */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-ink block">
                3. Text Font Family (Google Fonts)
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Object.entries(FONT_FAMILIES).map(([key, f]) => {
                  const isSelected = activeFontKey === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPrefs({ ...prefs, fontFamily: key })}
                      style={{ fontFamily: f.family }}
                      className={`p-3 rounded-lg border text-left transition-all ${
                        isSelected
                          ? "ring-2 ring-accent border-accent bg-accent/10 text-ink shadow-sm"
                          : "border-line bg-surface hover:bg-surface-hi text-muted"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-ink">{f.label}</span>
                        {isSelected && <span className="text-xs text-accent font-bold">✓</span>}
                      </div>
                      <p className="text-[11px] text-muted mt-0.5 leading-snug">{f.desc}</p>
                      <p className="text-xs font-medium text-ink mt-1">Aa Bb Cc 123 ₹450</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Section 4: Font Sizing */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-ink block">
                4. Interface Scaling & Font Size
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {FONT_SIZES.map((size) => {
                  const isSelected = (prefs.fontSize || "standard") === size.id;
                  return (
                    <button
                      key={size.id}
                      type="button"
                      onClick={() => setPrefs({ ...prefs, fontSize: size.id })}
                      className={`p-2.5 rounded-lg border text-left transition-all ${
                        isSelected
                          ? "ring-2 ring-accent border-accent bg-accent/10 text-ink shadow-sm"
                          : "border-line bg-surface hover:bg-surface-hi text-muted"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-ink">{size.label}</span>
                        {isSelected && <span className="text-xs text-accent font-bold">✓</span>}
                      </div>
                      <span className="text-[11px] text-muted block mt-0.5">{size.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-line pt-3">
          <div className="flex items-center gap-2">
            {savedSuccess && (
              <span className="badge bg-good/15 text-good font-bold text-xs flex items-center gap-1">
                ✓ Preferences Saved & Applied!
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn text-xs px-4 py-2" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary text-xs px-5 py-2 font-bold shadow-md"
              onClick={handleSave}
              disabled={saving || loading}
            >
              {saving ? "Saving Preferences…" : "💾 Save & Apply My Theme"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
