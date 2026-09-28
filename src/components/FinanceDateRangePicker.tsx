"use client";

import { useState } from "react";
import type { DateRangePreset } from "@/lib/date-filter";

type Props = {
  preset: DateRangePreset;
  startDate: string;
  endDate: string;
  onChange: (preset: DateRangePreset, start: string, end: string) => void;
  className?: string;
};

const PRESETS: { id: DateRangePreset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7days", label: "Last 7 Days" },
  { id: "thismonth", label: "This Month" },
  { id: "lastmonth", label: "Last Month" },
  { id: "custom", label: "📅 Custom Range" },
];

export function FinanceDateRangePicker({ preset, startDate, endDate, onChange, className = "" }: Props) {
  const [customStart, setCustomStart] = useState(startDate);
  const [customEnd, setCustomEnd] = useState(endDate);

  function handlePresetClick(p: DateRangePreset) {
    if (p === "custom") {
      onChange("custom", customStart, customEnd);
    } else {
      onChange(p, "", "");
    }
  }

  function handleCustomApply() {
    if (customStart && customEnd) {
      onChange("custom", customStart, customEnd);
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div className="inline-flex rounded-lg bg-surface border border-line p-0.5 shadow-xs">
        {PRESETS.map((p) => {
          const active = preset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => handlePresetClick(p.id)}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                active
                  ? "bg-ink text-surface shadow-xs font-bold"
                  : "text-muted hover:text-ink hover:bg-surface-hi"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {preset === "custom" && (
        <div className="flex items-center gap-1.5 bg-paper border border-line rounded-lg px-2.5 py-1 text-xs shadow-xs animate-in fade-in">
          <span className="text-muted text-[11px]">From:</span>
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="bg-transparent border-0 text-xs font-mono font-medium focus:ring-0 focus:outline-none"
          />
          <span className="text-muted text-[11px]">To:</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="bg-transparent border-0 text-xs font-mono font-medium focus:ring-0 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleCustomApply}
            className="btn btn-primary px-2.5 py-0.5 text-xs font-bold rounded"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
