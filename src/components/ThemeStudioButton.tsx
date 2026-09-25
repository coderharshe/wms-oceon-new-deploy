"use client";

import { useState } from "react";
import { ThemeStudioModal } from "./ThemeStudioModal";

export default function ThemeStudioButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded px-2 py-1 text-xs font-semibold text-muted hover:text-ink hover:bg-surface-hi transition-colors flex items-center gap-1 border border-line"
        title="Customize Theme & Font"
      >
        <span>🎨</span>
        <span className="hidden sm:inline">Theme</span>
      </button>

      {open && <ThemeStudioModal onClose={() => setOpen(false)} />}
    </>
  );
}
