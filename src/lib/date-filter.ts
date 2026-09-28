import { businessDateString } from "./business-date";

export type DateRangePreset = "today" | "yesterday" | "last7days" | "thismonth" | "lastmonth" | "custom";

export type ParsedDateRange = {
  preset: DateRangePreset;
  startDate: Date;
  endDate: Date;
  startDateStr: string;
  endDateStr: string;
  label: string;
};

export function resolveDateRange(
  preset?: string | null,
  customStart?: string | null,
  customEnd?: string | null
): ParsedDateRange {
  const todayStr = businessDateString();
  const parts = todayStr.split("-").map(Number);
  const year = parts[0] ?? new Date().getFullYear();
  const month = parts[1] ?? new Date().getMonth() + 1;
  const day = parts[2] ?? new Date().getDate();
  const now = new Date(year, month - 1, day);

  const p = (preset?.toLowerCase() || "today") as DateRangePreset;

  if (p === "yesterday") {
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    const start = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 0, 0, 0, 0);
    const end = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 23, 59, 59, 999);
    const yStr = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, "0")}-${String(yest.getDate()).padStart(2, "0")}`;
    return {
      preset: "yesterday",
      startDate: start,
      endDate: end,
      startDateStr: yStr,
      endDateStr: yStr,
      label: "Yesterday",
    };
  }

  if (p === "last7days") {
    const startD = new Date(now);
    startD.setDate(startD.getDate() - 6);
    const start = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate(), 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const sStr = `${startD.getFullYear()}-${String(startD.getMonth() + 1).padStart(2, "0")}-${String(startD.getDate()).padStart(2, "0")}`;
    return {
      preset: "last7days",
      startDate: start,
      endDate: end,
      startDateStr: sStr,
      endDateStr: todayStr,
      label: "Last 7 Days",
    };
  }

  if (p === "lastmonth") {
    const prevMonthYear = month === 1 ? year - 1 : year;
    const prevMonthIdx = month === 1 ? 11 : month - 2;
    const start = new Date(prevMonthYear, prevMonthIdx, 1, 0, 0, 0, 0);
    const end = new Date(prevMonthYear, prevMonthIdx + 1, 0, 23, 59, 59, 999);
    const sStr = `${prevMonthYear}-${String(prevMonthIdx + 1).padStart(2, "0")}-01`;
    const eStr = `${prevMonthYear}-${String(prevMonthIdx + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
    return {
      preset: "lastmonth",
      startDate: start,
      endDate: end,
      startDateStr: sStr,
      endDateStr: eStr,
      label: "Last Month",
    };
  }

  if (p === "thismonth") {
    const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const end = new Date(year, month - 1, day, 23, 59, 59, 999);
    const sStr = `${year}-${String(month).padStart(2, "0")}-01`;
    return {
      preset: "thismonth",
      startDate: start,
      endDate: end,
      startDateStr: sStr,
      endDateStr: todayStr,
      label: "This Month",
    };
  }

  if (p === "custom" && customStart && customEnd) {
    const sParts = customStart.split("-").map(Number);
    const eParts = customEnd.split("-").map(Number);
    const sy = sParts[0] ?? year;
    const sm = sParts[1] ?? month;
    const sd = sParts[2] ?? 1;
    const ey = eParts[0] ?? year;
    const em = eParts[1] ?? month;
    const ed = eParts[2] ?? day;
    const start = new Date(sy, sm - 1, sd, 0, 0, 0, 0);
    const end = new Date(ey, em - 1, ed, 23, 59, 59, 999);
    return {
      preset: "custom",
      startDate: start,
      endDate: end,
      startDateStr: customStart,
      endDateStr: customEnd,
      label: `${customStart} to ${customEnd}`,
    };
  }

  // Default: Today
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);
  return {
    preset: "today",
    startDate: start,
    endDate: end,
    startDateStr: todayStr,
    endDateStr: todayStr,
    label: "Today",
  };
}
