"use client";

import { useEffect, useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { Skeleton, SkeletonCard } from "@/components/Skeleton";
import { fmtDateTime } from "@/lib/fmt";
import { useRouter } from "next/navigation";
import {
  THEMES,
  THEME_NAMES,
  DEFAULT_THEME,
  FONT_FAMILIES,
  ACCENT_COLOR_PRESETS,
  fullThemeStyle,
  themeVars,
  contrast,
  rgbTripletToHex,
  hexToRgbTriplet,
  type FontFamilyKey,
} from "@/lib/themes";
import { isGstin, panOfGstin, stateCodeOfGstin, stateName } from "@/lib/gst";

type Backup = { key: string; size: number; uploaded: string };

type UserRecord = {
  id: string;
  staffId: string;
  name: string;
  role: string;
  active: boolean;
  warehouseId: string | null;
  warehouse?: { name: string } | null;
  plainPassword?: string | null;
  theme?: string | null;
  accentColor?: string | null;
  fontFamily?: string | null;
  fontSize?: string | null;
};

const TABS = [
  { id: "general", label: "Business & GST", icon: "🏢" },
  { id: "billing", label: "Billing & Printing", icon: "🧾" },
  { id: "studio", label: "My Theme & Font Studio", icon: "🎨" },
  { id: "users_themes", label: "User Themes Manager", icon: "👥" },
  { id: "qc", label: "QC & Workflow", icon: "🔍" },
  { id: "governance", label: "Governance & Approvals", icon: "⚖️" },
  { id: "maintenance", label: "Maintenance & Backup", icon: "🛡️" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const FONT_SIZES = [
  { id: "sm", label: "Small (Compact)", desc: "15px compact" },
  { id: "standard", label: "Standard (Default)", desc: "17px default" },
  { id: "lg", label: "Large (Touch Friendly)", desc: "19px touch" },
  { id: "xl", label: "Extra Large (Kiosk / Counter)", desc: "21px kiosk" },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("general");
  const { data, error, loading, reload } = useApiGet<Record<string, string>>("/api/admin/settings");
  const [values, setValues] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  
  // Users list for the User Themes Manager
  const { data: usersData, reload: reloadUsers } = useApiGet<UserRecord[]>("/api/admin/users");
  const users = usersData ?? [];
  const [userFilter, setUserFilter] = useState("");
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [savedUserId, setSavedUserId] = useState<string | null>(null);

  // Current logged in user personal preferences
  const { data: myPrefs, reload: reloadMyPrefs } = useApiGet<UserRecord>("/api/user/preferences");
  const [myTheme, setMyTheme] = useState("default");
  const [myAccent, setMyAccent] = useState<string | null>(null);
  const [myFont, setMyFont] = useState<FontFamilyKey>("inter");
  const [myFontSize, setMyFontSize] = useState("standard");
  const [savingMyPrefs, setSavingMyPrefs] = useState(false);
  const [savedMyPrefsSuccess, setSavedMyPrefsSuccess] = useState(false);

  const { data: backupsData, reload: reloadBackups } = useApiGet<Backup[]>("/api/admin/backup");
  const backups = backupsData ?? [];
  const [backingUp, setBackingUp] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (data) setValues(data);
  }, [data]);

  useEffect(() => {
    if (myPrefs) {
      setMyTheme(myPrefs.theme || "default");
      setMyAccent(myPrefs.accentColor || null);
      setMyFont(((myPrefs.fontFamily || "inter").toLowerCase() as FontFamilyKey) in FONT_FAMILIES ? (myPrefs.fontFamily!.toLowerCase() as FontFamilyKey) : "inter");
      setMyFontSize(myPrefs.fontSize || "standard");
    }
  }, [myPrefs]);

  async function save(key: string, customValue?: string) {
    const val = customValue !== undefined ? customValue : values[key] ?? "";
    setSavingKey(key);
    setSavedKey(null);
    try {
      await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: val }),
      });
      setSavedKey(key);
      setTimeout(() => setSavedKey((curr) => (curr === key ? null : curr)), 3000);
    } catch {
      // ignore
    } finally {
      setSavingKey(null);
    }
  }

  async function saveAndRefresh(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    await save(key, value);
    router.refresh();
  }

  async function saveUserTheme(userId: string, partial: { theme?: string; accentColor?: string | null; fontFamily?: string; fontSize?: string }) {
    setSavingUserId(userId);
    setSavedUserId(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      if (res.ok) {
        setSavedUserId(userId);
        reloadUsers();
        setTimeout(() => setSavedUserId((curr) => (curr === userId ? null : curr)), 2500);
      }
    } catch {
      // ignore
    } finally {
      setSavingUserId(null);
    }
  }

  async function applyBulkThemeToRole(role: string, theme: string, font: string, fontSize: string) {
    const targets = users.filter((u) => u.role === role);
    if (!targets.length) return;
    for (const u of targets) {
      await fetch(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme, fontFamily: font, fontSize }),
      });
    }
    reloadUsers();
  }

  async function saveMyPreferences() {
    setSavingMyPrefs(true);
    setSavedMyPrefsSuccess(false);
    try {
      const res = await fetch("/api/user/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme: myTheme,
          accentColor: myAccent,
          fontFamily: myFont,
          fontSize: myFontSize,
        }),
      });
      if (res.ok) {
        setSavedMyPrefsSuccess(true);
        if (typeof window !== "undefined") {
          localStorage.setItem("wms_user_theme", myTheme);
          localStorage.setItem("wms_user_accent", myAccent || "");
          localStorage.setItem("wms_user_font", myFont);
          localStorage.setItem("wms_user_fontsize", myFontSize);
          window.dispatchEvent(new Event("wms_theme_updated"));
        }
        reloadMyPrefs();
        setTimeout(() => setSavedMyPrefsSuccess(false), 3000);
      }
    } catch {
      // ignore
    } finally {
      setSavingMyPrefs(false);
    }
  }

  async function exportBackup() {
    setBackingUp(true);
    await fetch("/api/admin/backup", { method: "POST", signal: AbortSignal.timeout(10 * 60_000) });
    setBackingUp(false);
    reloadBackups();
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-7 w-48" />
        <SkeletonCard lines={4} />
      </div>
    );
  }
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;

  const filteredUsers = users.filter((u) => {
    if (!userFilter) return true;
    const q = userFilter.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      u.staffId.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q) ||
      (u.warehouse?.name && u.warehouse.name.toLowerCase().includes(q))
    );
  });

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      {/* Header */}
      <div className="border-b border-line pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-ink">System Settings & Visual Customization</h1>
            <p className="text-xs text-muted">
              Configure global business parameters, POS receipts, QC bounds, and custom themes & Google fonts for every user.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="badge bg-surface-2 text-ink border border-line text-xs font-mono">
              Role: ADMIN
            </span>
          </div>
        </div>
      </div>

      {/* Horizontal Tabs Navigation */}
      <div className="sticky top-0 z-20 bg-surface/90 backdrop-blur-md border-b border-line pb-2 pt-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-semibold transition-all ${
              activeTab === t.id
                ? "bg-accent text-white shadow-sm ring-1 ring-accent"
                : "text-muted hover:text-ink hover:bg-surface-hi border border-transparent"
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* ─────────────────────── TAB 1: GENERAL & GST ─────────────────────── */}
      {activeTab === "general" && (
        <div className="space-y-4">
          <div className="card space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <h2 className="text-sm font-bold text-ink flex items-center gap-2">
                <span>🏢</span>
                <span>Business Profile & Statutory Identification</span>
              </h2>
              <span className="text-[11px] text-muted">Printed on B2B / B2C Invoices & UPI QR</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink">
                  Business / Trading Name <span className="text-muted font-normal">(Header on thermal & tax bills)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    className="input flex-1 text-xs"
                    placeholder="e.g. Taresh Wholesale Traders"
                    value={values.BUSINESS_NAME ?? ""}
                    onChange={(e) => setValues({ ...values, BUSINESS_NAME: e.target.value })}
                  />
                  <button
                    className="btn text-xs px-3"
                    disabled={savingKey === "BUSINESS_NAME"}
                    onClick={() => save("BUSINESS_NAME")}
                  >
                    {savingKey === "BUSINESS_NAME" ? "Saving…" : "Save"}
                  </button>
                </div>
                {savedKey === "BUSINESS_NAME" && <p className="text-[11px] text-good mt-0.5">Saved successfully</p>}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-ink">
                  UPI VPA Payment ID <span className="text-muted font-normal">(Counter dynamic QR destination)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    className="input flex-1 text-xs font-mono"
                    placeholder="e.g. hub@upi or merchant@icici"
                    value={values.UPI_VPA ?? ""}
                    onChange={(e) => setValues({ ...values, UPI_VPA: e.target.value })}
                  />
                  <button
                    className="btn text-xs px-3"
                    disabled={savingKey === "UPI_VPA"}
                    onClick={() => save("UPI_VPA")}
                  >
                    {savingKey === "UPI_VPA" ? "Saving…" : "Save"}
                  </button>
                </div>
                {savedKey === "UPI_VPA" && <p className="text-[11px] text-good mt-0.5">Saved successfully</p>}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-ink">
                Business GSTIN <span className="text-muted font-normal">(Statutory 15-character GST number)</span>
              </label>
              <div className="flex gap-2">
                <input
                  className="input flex-1 text-xs font-mono uppercase tracking-wider"
                  placeholder="e.g. 06AQNPG1418P1ZK"
                  maxLength={15}
                  value={values.BUSINESS_GSTIN ?? ""}
                  onChange={(e) => setValues({ ...values, BUSINESS_GSTIN: e.target.value.toUpperCase() })}
                />
                <button
                  className="btn text-xs px-3"
                  disabled={savingKey === "BUSINESS_GSTIN"}
                  onClick={() => save("BUSINESS_GSTIN")}
                >
                  {savingKey === "BUSINESS_GSTIN" ? "Saving…" : "Save"}
                </button>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs">
                {values.BUSINESS_GSTIN ? (
                  isGstin(values.BUSINESS_GSTIN) ? (
                    <span className="badge bg-good/10 text-good font-medium">
                      ✓ Valid GSTIN: {stateName(stateCodeOfGstin(values.BUSINESS_GSTIN))} · PAN {panOfGstin(values.BUSINESS_GSTIN)}
                    </span>
                  ) : (
                    <span className="badge bg-bad/10 text-bad font-medium">
                      ✕ Invalid GSTIN format or checksum mismatch
                    </span>
                  )
                ) : (
                  <span className="text-muted">Enter a valid 15-character Indian GSTIN</span>
                )}
                {savedKey === "BUSINESS_GSTIN" && <span className="text-good font-medium">Saved</span>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink">
                  Physical Hub / Business Address <span className="text-muted font-normal">(Printed on Tax Invoices)</span>
                </label>
                <textarea
                  className="input w-full text-xs"
                  rows={3}
                  placeholder="Street, City, State, PIN Code"
                  value={values.BUSINESS_ADDRESS ?? ""}
                  onChange={(e) => setValues({ ...values, BUSINESS_ADDRESS: e.target.value })}
                />
                <div className="mt-1 flex justify-between items-center">
                  <span className="text-[11px] text-muted">Required on official B2B invoices</span>
                  <button
                    className="btn text-xs px-3"
                    disabled={savingKey === "BUSINESS_ADDRESS"}
                    onClick={() => save("BUSINESS_ADDRESS")}
                  >
                    {savingKey === "BUSINESS_ADDRESS" ? "Saving…" : "Save"}
                  </button>
                </div>
                {savedKey === "BUSINESS_ADDRESS" && <p className="text-[11px] text-good mt-0.5">Saved successfully</p>}
              </div>

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink">
                    Official Contact Email <span className="text-muted font-normal">(Header & Receipts)</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      className="input flex-1 text-xs"
                      type="email"
                      placeholder="billing@yourdomain.com"
                      value={values.BUSINESS_EMAIL ?? ""}
                      onChange={(e) => setValues({ ...values, BUSINESS_EMAIL: e.target.value })}
                    />
                    <button
                      className="btn text-xs px-3"
                      disabled={savingKey === "BUSINESS_EMAIL"}
                      onClick={() => save("BUSINESS_EMAIL")}
                    >
                      {savingKey === "BUSINESS_EMAIL" ? "Saving…" : "Save"}
                    </button>
                  </div>
                  {savedKey === "BUSINESS_EMAIL" && <p className="text-[11px] text-good mt-0.5">Saved</p>}
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-ink">
                    Official Support Phone <span className="text-muted font-normal">(Customer Helplines)</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      className="input flex-1 text-xs"
                      placeholder="+91 98765 43210"
                      value={values.BUSINESS_PHONE ?? ""}
                      onChange={(e) => setValues({ ...values, BUSINESS_PHONE: e.target.value })}
                    />
                    <button
                      className="btn text-xs px-3"
                      disabled={savingKey === "BUSINESS_PHONE"}
                      onClick={() => save("BUSINESS_PHONE")}
                    >
                      {savingKey === "BUSINESS_PHONE" ? "Saving…" : "Save"}
                    </button>
                  </div>
                  {savedKey === "BUSINESS_PHONE" && <p className="text-[11px] text-good mt-0.5">Saved</p>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────── TAB 2: BILLING & PRINTING ─────────────────────── */}
      {activeTab === "billing" && (
        <div className="space-y-4">
          <div className="card space-y-4">
            <h2 className="text-sm font-bold text-ink border-b border-line pb-2 flex items-center gap-2">
              <span>🧾</span>
              <span>POS Invoicing & Thermal Roll Printing Parameters</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink">Default Counter Selling Mode</label>
                <select
                  className="input w-full text-xs"
                  value={values.DEFAULT_SELLING_MODE ?? "WHOLESALE"}
                  onChange={(e) => {
                    const v = e.target.value;
                    setValues({ ...values, DEFAULT_SELLING_MODE: v });
                    save("DEFAULT_SELLING_MODE", v);
                  }}
                >
                  <option value="WHOLESALE">Wholesale Mode (B2B Rates by default)</option>
                  <option value="RETAIL">Retail Mode (Walk-in MRP/Retail rates by default)</option>
                </select>
                <p className="text-[11px] text-muted mt-1">Pre-selected mode when cashier opens a fresh bill.</p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-ink">Thermal Printer Slip Format</label>
                <select
                  className="input w-full text-xs"
                  value={values.PRINT_FORMAT ?? "80mm"}
                  onChange={(e) => {
                    const v = e.target.value;
                    setValues({ ...values, PRINT_FORMAT: v });
                    save("PRINT_FORMAT", v);
                  }}
                >
                  <option value="80mm">80mm Thermal Receipt (Standard ESC/POS Roll)</option>
                  <option value="58mm">58mm Compact Thermal Receipt</option>
                  <option value="A4">Full A4 Tax Invoice Page</option>
                </select>
                <p className="text-[11px] text-muted mt-1">Standard layout generated for counter receipt printing.</p>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-ink">
                Receipt Footer Terms & Notes <span className="text-muted font-normal">(Printed at bottom of thermal slips)</span>
              </label>
              <textarea
                className="input w-full text-xs"
                rows={2}
                placeholder="e.g. Goods once sold will not be taken back after 7 days. Thank you for visiting!"
                value={values.RECEIPT_FOOTER_NOTE ?? ""}
                onChange={(e) => setValues({ ...values, RECEIPT_FOOTER_NOTE: e.target.value })}
              />
              <div className="mt-1 flex justify-end">
                <button
                  className="btn text-xs px-3"
                  disabled={savingKey === "RECEIPT_FOOTER_NOTE"}
                  onClick={() => save("RECEIPT_FOOTER_NOTE")}
                >
                  {savingKey === "RECEIPT_FOOTER_NOTE" ? "Saving…" : "Save Note"}
                </button>
              </div>
              {savedKey === "RECEIPT_FOOTER_NOTE" && <p className="text-[11px] text-good">Saved</p>}
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────── TAB 3: MY PERSONAL THEME & FONT STUDIO ─────────────────────── */}
      {activeTab === "studio" && (
        <div className="space-y-5">
          <div className="card space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-line pb-3">
              <div>
                <h2 className="text-sm font-bold text-ink flex items-center gap-2">
                  <span>🎨</span>
                  <span>Personal ID Theme & Text Font Editor</span>
                </h2>
                <p className="text-xs text-muted">
                  Customizing appearance for your active login: <strong className="text-ink">{myPrefs?.staffId || "ADMIN"}</strong> ({myPrefs?.name || "Administrator"})
                </p>
              </div>
              <button
                type="button"
                className="btn-primary text-xs px-4 py-2 font-bold shadow-sm"
                onClick={saveMyPreferences}
                disabled={savingMyPrefs}
              >
                {savingMyPrefs ? "Saving…" : "💾 Save & Apply My Style"}
              </button>
            </div>

            {savedMyPrefsSuccess && (
              <div className="p-3 rounded-lg bg-good/15 border border-good/30 text-good text-xs font-semibold flex items-center justify-between">
                <span>✓ Your personalized theme and font settings have been saved and applied!</span>
              </div>
            )}

            {/* Live Interactive Preview Box */}
            <div className="space-y-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-muted block">
                Live Real-Time Preview
              </span>
              <div
                style={fullThemeStyle(myTheme, myAccent, myFont)}
                className={`rounded-xl border border-line bg-surface p-4 shadow-inner ${
                  myFontSize && myFontSize !== "standard" ? "font-size-" + myFontSize : ""
                }`}
              >
                <div className="rounded-lg border border-line bg-paper p-4 shadow-sm space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                    <div className="flex items-center gap-2">
                      <span className="h-3.5 w-3.5 rounded-full bg-accent" />
                      <span className="font-bold text-sm text-ink">Taresh WMS Counter POS</span>
                      <span className="badge bg-surface-hi text-muted text-[11px] border border-line">
                        Font: {FONT_FAMILIES[myFont]?.label}
                      </span>
                    </div>
                    <span className="badge bg-good/15 text-good font-semibold text-xs">● Connected</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <div className="p-2.5 rounded bg-surface border border-line">
                      <span className="text-muted block text-[11px]">Today&apos;s Revenue</span>
                      <span className="text-sm font-bold text-ink">₹2,84,500.00</span>
                    </div>
                    <div className="p-2.5 rounded bg-surface border border-line">
                      <span className="text-muted block text-[11px]">Pending QC Orders</span>
                      <span className="text-sm font-bold text-ink">12 Consignments</span>
                    </div>
                    <div className="p-2.5 rounded bg-surface border border-line">
                      <span className="text-muted block text-[11px]">Active Staff ID</span>
                      <span className="text-sm font-bold text-ink">{myPrefs?.staffId || "ADMIN-1"}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button type="button" className="btn-primary text-xs px-3 py-1.5 shadow-sm font-semibold">
                      Primary Button
                    </button>
                    <button type="button" className="btn text-xs px-3 py-1.5 font-medium">
                      Secondary Button
                    </button>
                    <span className="badge bg-accent/15 text-accent font-semibold text-xs border border-accent/30">
                      Accent Badge
                    </span>
                    <span className="text-xs text-muted ml-auto font-mono">
                      Scale: {myFontSize} · WCAG AA Checked
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Horizontal Sub-sections for Theme & Font */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              {/* Color Themes */}
              <div className="p-3.5 rounded-lg border border-line bg-surface-2/20 space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-ink block">
                  1. Color Palette ({THEME_NAMES.length} Presets)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(THEMES).map(([key, t]) => {
                    const isSelected = myTheme === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setMyTheme(key)}
                        style={fullThemeStyle(key, null, myFont)}
                        className={`p-2 rounded-lg border text-left transition-all bg-surface ${
                          isSelected ? "ring-2 ring-accent border-accent shadow-sm" : "border-line hover:border-ink/40"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-ink truncate">{t.label}</span>
                          {isSelected && <span className="text-[10px] text-accent font-bold">✓</span>}
                        </div>
                        <div className="flex gap-1 h-3">
                          <span className="flex-1 rounded bg-paper border border-line" />
                          <span className="w-3 rounded bg-accent" />
                          <span className="w-3 rounded bg-surface-hi" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Accent Color */}
              <div className="p-3.5 rounded-lg border border-line bg-surface-2/20 space-y-3">
                <label className="text-xs font-bold uppercase tracking-wider text-ink block">
                  2. Highlight & Accent Color
                </label>
                <div className="flex flex-wrap gap-2">
                  {ACCENT_COLOR_PRESETS.map((preset) => {
                    const isSelected = myAccent === preset.rgb;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setMyAccent(preset.rgb)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                          isSelected
                            ? "ring-2 ring-accent border-accent bg-paper shadow-sm"
                            : "border-line bg-surface text-muted hover:text-ink"
                        }`}
                      >
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: preset.hex }} />
                        <span>{preset.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-line">
                  <label htmlFor="settings-custom-accent" className="text-xs text-muted font-medium">Custom Color Picker:</label>
                  <input
                    id="settings-custom-accent"
                    type="color"
                    className="h-7 w-8 cursor-pointer rounded border border-line p-0 bg-transparent"
                    value={myAccent ? (myAccent.includes(" ") ? rgbTripletToHex(myAccent) : myAccent) : "#1f5fbf"}
                    onChange={(e) => {
                      const rgb = hexToRgbTriplet(e.target.value);
                      if (rgb) setMyAccent(rgb);
                    }}
                  />
                  {myAccent && (
                    <button
                      type="button"
                      onClick={() => setMyAccent(null)}
                      className="text-xs text-muted hover:text-bad underline ml-2"
                    >
                      Reset to Theme Default
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Typography Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Google Fonts */}
              <div className="p-3.5 rounded-lg border border-line bg-surface-2/20 space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-ink block">
                  3. Text Font Family (Google Fonts)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(FONT_FAMILIES).map(([key, f]) => {
                    const isSelected = myFont === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setMyFont(key as FontFamilyKey)}
                        style={{ fontFamily: f.family }}
                        className={`p-2.5 rounded-lg border text-left transition-all ${
                          isSelected
                            ? "ring-2 ring-accent border-accent bg-accent/10 text-ink shadow-sm"
                            : "border-line bg-surface hover:bg-surface-hi text-muted"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-ink">{f.label}</span>
                          {isSelected && <span className="text-[10px] text-accent font-bold">✓</span>}
                        </div>
                        <span className="text-[10px] text-muted block mt-0.5">{f.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Font Size Scaling */}
              <div className="p-3.5 rounded-lg border border-line bg-surface-2/20 space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-ink block">
                  4. Interface Text Sizing
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {FONT_SIZES.map((size) => {
                    const isSelected = myFontSize === size.id;
                    return (
                      <button
                        key={size.id}
                        type="button"
                        onClick={() => setMyFontSize(size.id)}
                        className={`p-2.5 rounded-lg border text-left transition-all ${
                          isSelected
                            ? "ring-2 ring-accent border-accent bg-accent/10 text-ink shadow-sm"
                            : "border-line bg-surface hover:bg-surface-hi text-muted"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-ink">{size.label}</span>
                          {isSelected && <span className="text-[10px] text-accent font-bold">✓</span>}
                        </div>
                        <span className="text-[10px] text-muted block mt-0.5">{size.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────── TAB 4: USER THEMES MANAGER (EVERY USER) ─────────────────────── */}
      {activeTab === "users_themes" && (
        <div className="space-y-4">
          <div className="card space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-line pb-3">
              <div>
                <h2 className="text-sm font-bold text-ink flex items-center gap-2">
                  <span>👥</span>
                  <span>User Themes & Typography Manager (Every User)</span>
                </h2>
                <p className="text-xs text-muted">
                  Configure and customize visual themes, Google Fonts, and sizing for every staff account individually or by role.
                </p>
              </div>

              {/* Search filter */}
              <input
                type="text"
                placeholder="🔍 Filter by Staff ID, Name, Role…"
                className="input text-xs w-64"
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
              />
            </div>

            {/* Quick Bulk Presets Bar */}
            <div className="p-3 rounded-lg border border-line bg-surface-2/30 space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted block">
                ⚡ 1-Click Role Theme Presets
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => applyBulkThemeToRole("FINANCE", "ocean", "inter", "lg")}
                  className="btn text-xs px-2.5 py-1 flex items-center gap-1.5"
                >
                  <span>🌊</span>
                  <span>Set all Finance/Cashiers to Ocean Indigo (Large)</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyBulkThemeToRole("MANAGER", "slate", "outfit", "standard")}
                  className="btn text-xs px-2.5 py-1 flex items-center gap-1.5"
                >
                  <span>🏙️</span>
                  <span>Set all Managers to Slate Blue (Outfit Font)</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyBulkThemeToRole("QC", "forest", "mono", "lg")}
                  className="btn text-xs px-2.5 py-1 flex items-center gap-1.5"
                >
                  <span>🌿</span>
                  <span>Set all QC to Forest Green (JetBrains Mono)</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyBulkThemeToRole("ADMIN", "dark", "inter", "standard")}
                  className="btn text-xs px-2.5 py-1 flex items-center gap-1.5"
                >
                  <span>🌙</span>
                  <span>Set all Admins to Charcoal Dark</span>
                </button>
              </div>
            </div>

            {/* User List Table */}
            <div className="overflow-x-auto border border-line rounded-lg">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-muted">
                    <th className="py-2.5 px-3">Staff ID & Name</th>
                    <th className="py-2.5 px-3">Role & Location</th>
                    <th className="py-2.5 px-3">Color Theme</th>
                    <th className="py-2.5 px-3">Font Family</th>
                    <th className="py-2.5 px-3">Font Size</th>
                    <th className="py-2.5 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filteredUsers.map((u) => {
                    const activeTheme = u.theme || "default";
                    const activeFont = (u.fontFamily || "inter").toLowerCase();
                    const activeSize = u.fontSize || "standard";
                    const isSaving = savingUserId === u.id;
                    const isSaved = savedUserId === u.id;

                    return (
                      <tr key={u.id} className="hover:bg-surface-2/40">
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-ink">{u.name}</div>
                          <div className="text-[11px] font-mono text-muted">{u.staffId}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="badge bg-surface-2 border border-line font-bold text-[10px]">
                            {u.role}
                          </span>
                          <span className="text-[11px] text-muted block mt-0.5">
                            {u.warehouse?.name || "Global / All"}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <select
                            className="input text-xs py-1 px-2"
                            value={activeTheme}
                            disabled={isSaving}
                            onChange={(e) => saveUserTheme(u.id, { theme: e.target.value })}
                          >
                            {Object.entries(THEMES).map(([key, t]) => (
                              <option key={key} value={key}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-3">
                          <select
                            className="input text-xs py-1 px-2"
                            value={activeFont}
                            disabled={isSaving}
                            onChange={(e) => saveUserTheme(u.id, { fontFamily: e.target.value })}
                          >
                            {Object.entries(FONT_FAMILIES).map(([key, f]) => (
                              <option key={key} value={key}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-3">
                          <select
                            className="input text-xs py-1 px-2"
                            value={activeSize}
                            disabled={isSaving}
                            onChange={(e) => saveUserTheme(u.id, { fontSize: e.target.value })}
                          >
                            {FONT_SIZES.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {isSaving && <span className="text-[11px] text-muted">Saving…</span>}
                          {isSaved && <span className="badge bg-good/15 text-good font-bold text-[10px]">✓ Saved</span>}
                          {!isSaving && !isSaved && (
                            <span className="text-[11px] text-muted font-mono">Instant</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────── TAB 5: QC & WORKFLOW ─────────────────────── */}
      {activeTab === "qc" && (
        <div className="space-y-4">
          <div className="card space-y-4">
            <h2 className="text-sm font-bold text-ink border-b border-line pb-2 flex items-center gap-2">
              <span>🔍</span>
              <span>Quality Check (QC) Handover Controls & Variance Limits</span>
            </h2>
            <p className="text-xs text-muted">
              Configure strict bounds for QC staff during physical packing and handover. Changes exceeding these thresholds require manager authorization.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink">
                  Max Quantity Reduction Allowed Without Approval (%)
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    className="input flex-1 text-xs"
                    placeholder="e.g. 20"
                    value={values.QC_MAX_REDUCE_PERCENT ?? ""}
                    onChange={(e) => setValues({ ...values, QC_MAX_REDUCE_PERCENT: e.target.value })}
                  />
                  <button className="btn text-xs px-3" onClick={() => save("QC_MAX_REDUCE_PERCENT")}>Save</button>
                </div>
                <p className="text-[11px] text-muted mt-1">If customer takes fewer items, reductions over this % trigger approval.</p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-ink">
                  Max Quantity Addition Allowed Without Approval (%)
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    className="input flex-1 text-xs"
                    placeholder="e.g. 10"
                    value={values.QC_MAX_ADD_PERCENT ?? ""}
                    onChange={(e) => setValues({ ...values, QC_MAX_ADD_PERCENT: e.target.value })}
                  />
                  <button className="btn text-xs px-3" onClick={() => save("QC_MAX_ADD_PERCENT")}>Save</button>
                </div>
                <p className="text-[11px] text-muted mt-1">Additions over this % trigger payment collection check & manager approval.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────── TAB 6: GOVERNANCE & APPROVALS ─────────────────────── */}
      {activeTab === "governance" && (
        <div className="space-y-4">
          <div className="card space-y-4">
            <h2 className="text-sm font-bold text-ink border-b border-line pb-2 flex items-center gap-2">
              <span>⚖️</span>
              <span>Authority Matrix & Escalation Thresholds</span>
            </h2>
            <p className="text-xs text-muted">
              Configure amount limits that automatically route purchase orders, discounts, and payment vouchers to Manager or Admin for authorization.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {([
                ["THRESHOLD_PO_MANAGER", "Purchase Order Auto-Approval Limit (Procurement) — ₹", "10000", "POs up to this amount execute without manager sign-off."],
                ["THRESHOLD_PO_ADMIN", "Purchase Order Admin Approval Required Above — ₹", "50000", "High-value purchase commitments requiring Admin sign-off."],
                ["THRESHOLD_DISCOUNT_MANAGER", "Discount Manager Approval Above (%)", "2", "Line or bill discounts above this % require manager PIN."],
                ["THRESHOLD_DISCOUNT_ADMIN", "Discount Admin Approval Required Above (%)", "5", "Discounts exceeding this % require Admin approval."],
                ["THRESHOLD_VOUCHER_MANAGER", "Cash Voucher Manager Limit — ₹", "5000", "Petty cash and operational payouts approved by Manager."],
                ["THRESHOLD_VOUCHER_ADMIN", "Cash Voucher Admin Approval Required Above — ₹", "25000", "Expenses exceeding this amount require Admin authorization."],
              ] as const).map(([key, label, placeholder, desc]) => (
                <div key={key} className="p-3 rounded-lg border border-line bg-surface-2/30">
                  <label className="mb-1 block text-xs font-semibold text-ink">{label}</label>
                  <div className="flex gap-2">
                    <input
                      className="input flex-1 text-xs"
                      type="number"
                      placeholder={placeholder}
                      value={values[key] ?? ""}
                      onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                    />
                    <button className="btn text-xs px-3" onClick={() => save(key)}>Save</button>
                  </div>
                  <p className="text-[11px] text-muted mt-1">{desc}</p>
                  {savedKey === key && <p className="text-[11px] text-good mt-0.5">Saved</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────── TAB 7: MAINTENANCE & BACKUP ─────────────────────── */}
      {activeTab === "maintenance" && (
        <div className="space-y-4">
          <div className="card space-y-3">
            <h2 className="text-sm font-bold text-ink border-b border-line pb-2 flex items-center gap-2">
              <span>💾</span>
              <span>Database Backups & Snapshot Archives</span>
            </h2>
            <p className="text-xs text-muted">
              Generate an immediate point-in-time SQL snapshot of all warehouses, products, customer balances, and transaction journals.
            </p>
            <div>
              <button className="btn-primary text-xs px-4 py-2 font-semibold" disabled={backingUp} onClick={exportBackup}>
                {backingUp ? "Exporting Backup Archive…" : "📦 Export Backup Snapshot Now"}
              </button>
            </div>

            {backups.length > 0 ? (
              <div className="overflow-x-auto border border-line rounded-lg mt-3">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-line bg-surface-2 text-muted">
                      <th className="py-2 px-3">Archive File</th>
                      <th className="py-2 px-3">Size</th>
                      <th className="py-2 px-3">Generated At</th>
                      <th className="py-2 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {backups
                      .slice()
                      .sort((a, b) => b.uploaded.localeCompare(a.uploaded))
                      .map((b) => (
                        <tr key={b.key} className="hover:bg-surface-2/40">
                          <td className="py-2 px-3 font-mono font-medium text-ink">{b.key.replace("backups/", "")}</td>
                          <td className="py-2 px-3 text-muted">{(b.size / 1024).toFixed(1)} KB</td>
                          <td className="py-2 px-3 text-muted">{fmtDateTime(b.uploaded)}</td>
                          <td className="py-2 px-3 text-right">
                            <a
                              className="badge bg-accent text-white font-medium hover:opacity-90 transition-opacity"
                              href={`/api/files/${b.key}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Download
                            </a>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-muted italic">No previous backup archives found in cloud storage.</p>
            )}
          </div>

          <div className="card space-y-3 border-l-4 border-l-bad bg-bad/5">
            <h2 className="text-sm font-bold text-bad">⚠️ Emergency Warehouse Stock Reset</h2>
            <p className="text-xs text-ink/80 leading-relaxed">
              Resets the on-hand quantity of every product in the active warehouse to <strong>0</strong>. Every zeroed SKU is logged in the audit ledger with timestamp and administrator staff ID.
            </p>
            <div>
              <button className="btn-danger text-xs font-semibold px-3 py-1.5" onClick={() => setResetOpen(true)}>
                Zero Out All Warehouse Stock…
              </button>
            </div>
          </div>
          {resetOpen && <ResetInventoryDialog onClose={() => setResetOpen(false)} />}
        </div>
      )}
    </div>
  );
}

function ResetInventoryDialog({ onClose }: { onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [resetReserved, setResetReserved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/inventory/reset-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resetReserved }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setResult({ ok: false, text: "Failed: no connection — nothing was changed" });
    const body = await res.json().catch(() => ({}));
    setResult(
      res.ok
        ? { ok: true, text: `Done — ${body.zeroed} product${body.zeroed === 1 ? "" : "s"} set to 0${resetReserved ? " (stock and reserved)" : ""}.` }
        : { ok: false, text: `Failed: ${typeof body.error === "string" ? body.error : res.status}` }
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && onClose()}>
      <div
        className="card w-full max-w-md space-y-4 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
      >
        <h3 id="reset-title" className="text-base font-semibold text-bad">
          Zero Out All Warehouse Stock?
        </h3>
        <p className="text-xs text-muted">
          Type <strong>RESET ALL</strong> below to confirm. Every product in this warehouse will be set to 0 on hand.
        </p>

        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={resetReserved}
            onChange={(e) => setResetReserved(e.target.checked)}
          />
          <span>Also clear reserved quantities</span>
        </label>

        <input
          className="input w-full text-xs font-mono"
          placeholder="Type RESET ALL"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
        />

        {result && (
          <p className={`text-xs ${result.ok ? "text-good font-semibold" : "text-bad"}`}>
            {result.text}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-line">
          <button className="btn text-xs" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-danger text-xs font-semibold px-4"
            disabled={busy || typed.trim() !== "RESET ALL"}
            onClick={submit}
          >
            {busy ? "Resetting…" : "Confirm Reset"}
          </button>
        </div>
      </div>
    </div>
  );
}
