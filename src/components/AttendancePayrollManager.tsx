"use client";

import { useState, useMemo, useEffect } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable, SkeletonStats } from "@/components/Skeleton";

type StaffUser = {
  id: string;
  staffId: string;
  name: string;
  role: string;
  contact?: string | null;
  designation?: string | null;
  city?: string | null;
  town?: string | null;
  employmentType?: string | null;
  shift?: string | null;
  joiningDate?: string | null;
  salary?: string | null;
  bankUpi?: string | null;
  reportingManager?: string | null;
  warehouse?: { id: string; name: string; code: string } | null;
};

type DailyItem = {
  user: StaffUser;
  attendance: {
    id: string;
    status: "PRESENT" | "HALF_DAY" | "PAID_LEAVE" | "ABSENT" | "OVERTIME";
    occasion?: string | null;
    overtimeHrs?: number;
    notes?: string | null;
    markedBy?: string;
    updatedAt?: string;
  } | null;
};

type MonthlyPayrollItem = {
  user: StaffUser;
  month: string;
  daysInMonth: number;
  baseSalary: number;
  perDayRate: number;
  presentCount: number;
  halfDayCount: number;
  paidLeaveCount: number;
  absentCount: number;
  unpaidDays: number;
  effectivePaidDays: number;
  totalOvertimeHrs: number;
  occasions: string[];
  calculatedSalary: number;
  recordsCount: number;
};

type AttendanceApiResponse = {
  date: string;
  month: string;
  daysInMonth: number;
  dailyList: DailyItem[];
  monthlyPayroll: MonthlyPayrollItem[];
  warehouses: { id: string; name: string; code: string }[];
};

const PAID_OCCASIONS = [
  "Festival (Diwali / Eid / Holi)",
  "National Holiday",
  "Weekly Off (Paid)",
  "Casual Leave (Paid)",
  "Sick Leave (Paid)",
  "Paid Company Occasion",
];

export function AttendancePayrollManager({
  portalRole,
  initialTab = "daily",
  hideTitle = false,
}: {
  portalRole: "ADMIN" | "MANAGER";
  initialTab?: "daily" | "payroll";
  hideTitle?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"daily" | "payroll">(initialTab);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  // Local state for daily editing before saving
  const [attendanceDraft, setAttendanceDraft] = useState<
    Record<
      string,
      {
        status: "PRESENT" | "HALF_DAY" | "PAID_LEAVE" | "ABSENT" | "OVERTIME";
        occasion: string;
        overtimeHrs: number;
        notes: string;
      }
    >
  >({});

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const url = `/api/attendance?date=${selectedDate}&month=${selectedMonth}${selectedWarehouse ? `&warehouseId=${selectedWarehouse}` : ""}`;
  const { data, loading, error, reload } = useApiGet<AttendanceApiResponse>(url);

  // Sync draft state with loaded dailyList
  useEffect(() => {
    if (!data?.dailyList) return;
    const initial: Record<
      string,
      {
        status: "PRESENT" | "HALF_DAY" | "PAID_LEAVE" | "ABSENT" | "OVERTIME";
        occasion: string;
        overtimeHrs: number;
        notes: string;
      }
    > = {};

    for (const item of data.dailyList) {
      initial[item.user.id] = {
        status: item.attendance?.status ?? "PRESENT",
        occasion: item.attendance?.occasion ?? "",
        overtimeHrs: item.attendance?.overtimeHrs ?? 0,
        notes: item.attendance?.notes ?? "",
      };
    }
    setAttendanceDraft(initial);
  }, [data?.dailyList]);

  function markAll(status: "PRESENT" | "PAID_LEAVE" | "ABSENT") {
    if (!data?.dailyList) return;
    const nextDraft = { ...attendanceDraft };
    for (const item of data.dailyList) {
      nextDraft[item.user.id] = {
        status,
        occasion: status === "PAID_LEAVE" ? "Festival (Diwali / Eid / Holi)" : "",
        overtimeHrs: 0,
        notes: "",
      };
    }
    setAttendanceDraft(nextDraft);
  }

  function updateRow(
    userId: string,
    updates: Partial<{
      status: "PRESENT" | "HALF_DAY" | "PAID_LEAVE" | "ABSENT" | "OVERTIME";
      occasion: string;
      overtimeHrs: number;
      notes: string;
    }>
  ) {
    setAttendanceDraft((prev) => ({
      ...prev,
      [userId]: {
        ...(prev[userId] ?? { status: "PRESENT", occasion: "", overtimeHrs: 0, notes: "" }),
        ...updates,
      },
    }));
  }

  async function handleSaveAttendance() {
    setSaving(true);
    setSaveSuccess(null);
    setSaveError(null);

    const records = Object.entries(attendanceDraft).map(([userId, val]) => ({
      userId,
      status: val.status,
      occasion: val.status === "PAID_LEAVE" ? val.occasion || "Paid Leave" : null,
      overtimeHrs: val.status === "OVERTIME" ? Number(val.overtimeHrs) : 0,
      notes: val.notes || null,
    }));

    const res = await fetch("/api/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: selectedDate,
        warehouseId: selectedWarehouse || undefined,
        records,
      }),
    });

    setSaving(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setSaveError(b.error || "Failed to save attendance");
    }

    setSaveSuccess(`Attendance for ${selectedDate} saved successfully!`);
    setTimeout(() => setSaveSuccess(null), 4000);
    reload();
  }

  // Filter daily list
  const filteredDailyList = useMemo(() => {
    if (!data?.dailyList) return [];
    if (!searchQuery.trim()) return data.dailyList;
    const q = searchQuery.toLowerCase();
    return data.dailyList.filter(
      (d) =>
        d.user.name.toLowerCase().includes(q) ||
        d.user.staffId.toLowerCase().includes(q) ||
        (d.user.designation && d.user.designation.toLowerCase().includes(q)) ||
        (d.user.warehouse?.name && d.user.warehouse.name.toLowerCase().includes(q))
    );
  }, [data?.dailyList, searchQuery]);

  // Filter monthly payroll
  const filteredPayroll = useMemo(() => {
    if (!data?.monthlyPayroll) return [];
    if (!searchQuery.trim()) return data.monthlyPayroll;
    const q = searchQuery.toLowerCase();
    return data.monthlyPayroll.filter(
      (p) =>
        p.user.name.toLowerCase().includes(q) ||
        p.user.staffId.toLowerCase().includes(q) ||
        (p.user.designation && p.user.designation.toLowerCase().includes(q)) ||
        (p.user.warehouse?.name && p.user.warehouse.name.toLowerCase().includes(q))
    );
  }, [data?.monthlyPayroll, searchQuery]);

  // Total payroll aggregates
  const payrollTotals = useMemo(() => {
    if (!filteredPayroll.length) return { staffCount: 0, totalSalary: 0, totalPaidDays: 0, totalAbsences: 0 };
    let totalSalary = 0;
    let totalPaidDays = 0;
    let totalAbsences = 0;

    for (const p of filteredPayroll) {
      totalSalary += p.calculatedSalary;
      totalPaidDays += p.effectivePaidDays;
      totalAbsences += p.absentCount;
    }

    return {
      staffCount: filteredPayroll.length,
      totalSalary,
      totalPaidDays,
      totalAbsences,
    };
  }, [filteredPayroll]);

  function exportPayrollCSV() {
    if (!filteredPayroll.length) return;
    const headers = [
      "Employee",
      "Full Name",
      "Designation",
      "Hub Code",
      "Hub Name",
      "Month",
      "Days in Month",
      "Base Salary (INR)",
      "Per Day Rate (INR)",
      "Present Days",
      "Half Days (0.5)",
      "Paid Occasion Days",
      "Absent (Loss of Pay)",
      "Effective Paid Days",
      "Net Payable Salary (INR)",
      "Bank / UPI Details",
      "Status",
    ];

    const rows = filteredPayroll.map((p) => [
      `"${p.user.staffId}"`,
      `"${p.user.name}"`,
      `"${p.user.designation || p.user.role}"`,
      `"${p.user.warehouse?.code || "N/A"}"`,
      `"${p.user.warehouse?.name || "N/A"}"`,
      `"${p.month}"`,
      p.daysInMonth,
      p.baseSalary,
      p.perDayRate.toFixed(2),
      p.presentCount,
      p.halfDayCount,
      p.paidLeaveCount,
      p.absentCount,
      p.effectivePaidDays,
      p.calculatedSalary,
      `"${p.user.bankUpi || ""}"`,
      `"${p.calculatedSalary > 0 ? "Ready for Payout" : "Zero Payout"}"`,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `payroll_calculation_${selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="space-y-4">
      {/* Header & Tabs */}
      <div className={`flex flex-col sm:flex-row sm:items-center ${hideTitle ? "justify-end" : "justify-between"} gap-3 border-b border-line pb-3`}>
        {!hideTitle && (
          <div>
            <h1 className="text-xl font-bold tracking-tight text-ink">
              {portalRole === "ADMIN" ? "Attendance & Payroll" : "Attendance & Daily Log"}
            </h1>
          </div>
        )}

        <div className="flex items-center gap-1.5 bg-surface-2 p-1 rounded-lg border border-line">
          <button
            onClick={() => setActiveTab("daily")}
            className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${
              activeTab === "daily" ? "bg-accent text-white shadow-xs" : "text-muted hover:text-ink"
            }`}
          >
            📅 Daily Attendance
          </button>
          <button
            onClick={() => setActiveTab("payroll")}
            className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${
              activeTab === "payroll" ? "bg-accent text-white shadow-xs" : "text-muted hover:text-ink"
            }`}
          >
            💰 Monthly Salary Calculation
          </button>
        </div>
      </div>

      {error && <ErrorRetry message={error} onRetry={reload} />}

      {/* Daily Attendance View */}
      {activeTab === "daily" && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-2/60 p-3 rounded-lg border border-line">
            <div className="flex flex-wrap items-center gap-2">
              <div>
                <label className="block text-[10px] uppercase font-bold text-muted mb-0.5">Attendance Date</label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="input text-xs py-1 px-2.5 font-semibold"
                />
              </div>

              {portalRole === "ADMIN" && data?.warehouses && data.warehouses.length > 0 && (
                <div>
                  <label className="block text-[10px] uppercase font-bold text-muted mb-0.5">Hub / Warehouse</label>
                  <select
                    value={selectedWarehouse}
                    onChange={(e) => setSelectedWarehouse(e.target.value)}
                    className="input text-xs py-1 px-2"
                  >
                    <option value="">All Hubs / Warehouses</option>
                    {data.warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="self-end">
                <input
                  type="text"
                  placeholder="Search staff…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input text-xs py-1 px-2.5 w-48"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 self-end">
              <button
                type="button"
                onClick={() => markAll("PRESENT")}
                className="btn text-xs py-1 px-2.5 bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100 font-semibold"
              >
                ✓ Mark All Present
              </button>
              <button
                type="button"
                onClick={() => markAll("PAID_LEAVE")}
                className="btn text-xs py-1 px-2.5 bg-sky-50 text-sky-700 border border-sky-300 hover:bg-sky-100 font-semibold"
              >
                🎉 Mark All Holiday (Paid)
              </button>
              <button
                type="button"
                onClick={handleSaveAttendance}
                disabled={saving}
                className="btn-primary text-xs py-1.5 px-4 font-bold shadow-xs flex items-center gap-1.5"
              >
                {saving ? "Saving…" : "💾 Save Attendance"}
              </button>
            </div>
          </div>

          {saveSuccess && (
            <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-lg text-xs font-semibold flex items-center gap-2">
              <span>✅</span> {saveSuccess}
            </div>
          )}

          {saveError && (
            <div className="p-3 bg-rose-50 text-rose-800 border border-rose-300 rounded-lg text-xs font-semibold flex items-center gap-2">
              <span>⚠️</span> {saveError}
            </div>
          )}

          {/* Table */}
          {loading && !data ? (
            <SkeletonTable rows={8} cols={6} />
          ) : (
            <div className="card overflow-x-auto p-0 border border-line shadow-xs">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead>
                  <tr className="bg-[#0284c7] text-white font-bold border-b border-[#0369a1]">
                    <th className="py-2.5 px-3">Employee</th>
                    <th className="py-2.5 px-3">Full Name</th>
                    <th className="py-2.5 px-3">Designation / Role</th>
                    <th className="py-2.5 px-3">Hub</th>
                    <th className="py-2.5 px-3">Attendance Status</th>
                    <th className="py-2.5 px-3">Paid Occasion / Leave Type</th>
                    <th className="py-2.5 px-3">Overtime (Hrs)</th>
                    <th className="py-2.5 px-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60 bg-surface">
                  {filteredDailyList.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-xs text-muted">
                        No active staff members found for the selected filter.
                      </td>
                    </tr>
                  ) : (
                    filteredDailyList.map((item) => {
                      const u = item.user;
                      const rowState = attendanceDraft[u.id] || {
                        status: "PRESENT",
                        occasion: "",
                        overtimeHrs: 0,
                        notes: "",
                      };

                      return (
                        <tr key={u.id} className="hover:bg-surface-2/40 transition-colors">
                          <td className="py-2.5 px-3 font-mono font-bold text-ink">
                            {u.staffId}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-ink">
                            <div>{u.name}</div>
                            {u.contact && <div className="text-[10px] text-muted font-mono">{u.contact}</div>}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="badge text-[10px] font-semibold bg-slate-100 text-slate-800">
                              {u.designation || u.role}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-muted font-medium">
                            {u.warehouse?.name ?? "—"}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => updateRow(u.id, { status: "PRESENT" })}
                                className={`px-2 py-1 text-[11px] font-bold rounded transition ${
                                  rowState.status === "PRESENT"
                                    ? "bg-emerald-600 text-white shadow-xs"
                                    : "bg-surface-2 text-muted hover:text-ink border border-line"
                                }`}
                              >
                                Present
                              </button>
                              <button
                                type="button"
                                onClick={() => updateRow(u.id, { status: "HALF_DAY" })}
                                className={`px-2 py-1 text-[11px] font-bold rounded transition ${
                                  rowState.status === "HALF_DAY"
                                    ? "bg-amber-600 text-white shadow-xs"
                                    : "bg-surface-2 text-muted hover:text-ink border border-line"
                                }`}
                              >
                                Half Day
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  updateRow(u.id, {
                                    status: "PAID_LEAVE",
                                    occasion: rowState.occasion || "Festival (Diwali / Eid / Holi)",
                                  })
                                }
                                className={`px-2 py-1 text-[11px] font-bold rounded transition ${
                                  rowState.status === "PAID_LEAVE"
                                    ? "bg-sky-600 text-white shadow-xs"
                                    : "bg-surface-2 text-muted hover:text-ink border border-line"
                                }`}
                              >
                                Paid Occasion
                              </button>
                              <button
                                type="button"
                                onClick={() => updateRow(u.id, { status: "ABSENT" })}
                                className={`px-2 py-1 text-[11px] font-bold rounded transition ${
                                  rowState.status === "ABSENT"
                                    ? "bg-rose-600 text-white shadow-xs"
                                    : "bg-surface-2 text-muted hover:text-ink border border-line"
                                }`}
                              >
                                Absent (LOP)
                              </button>
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            {rowState.status === "PAID_LEAVE" ? (
                              <select
                                value={rowState.occasion}
                                onChange={(e) => updateRow(u.id, { occasion: e.target.value })}
                                className="input text-xs py-1 px-2 font-medium bg-sky-50 text-sky-900 border-sky-300 w-48"
                              >
                                {PAID_OCCASIONS.map((occ) => (
                                  <option key={occ} value={occ}>
                                    {occ}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-muted text-[11px] italic">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <input
                              type="number"
                              min="0"
                              max="12"
                              step="0.5"
                              placeholder="0"
                              value={rowState.overtimeHrs || ""}
                              onChange={(e) => updateRow(u.id, { overtimeHrs: parseFloat(e.target.value) || 0 })}
                              className="input text-xs py-1 px-2 w-16 font-mono text-center"
                            />
                          </td>
                          <td className="py-2.5 px-3">
                            <input
                              type="text"
                              placeholder="Optional remarks…"
                              value={rowState.notes}
                              onChange={(e) => updateRow(u.id, { notes: e.target.value })}
                              className="input text-xs py-1 px-2 w-44"
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Monthly Payroll & Salary Calculation View */}
      {activeTab === "payroll" && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-2/60 p-3 rounded-lg border border-line">
            <div className="flex flex-wrap items-center gap-2">
              <div>
                <label className="block text-[10px] uppercase font-bold text-muted mb-0.5">Payroll Month</label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="input text-xs py-1 px-2.5 font-bold"
                />
              </div>

              {portalRole === "ADMIN" && data?.warehouses && data.warehouses.length > 0 && (
                <div>
                  <label className="block text-[10px] uppercase font-bold text-muted mb-0.5">Hub / Warehouse</label>
                  <select
                    value={selectedWarehouse}
                    onChange={(e) => setSelectedWarehouse(e.target.value)}
                    className="input text-xs py-1 px-2"
                  >
                    <option value="">All Hubs / Warehouses</option>
                    {data.warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="self-end">
                <input
                  type="text"
                  placeholder="Search staff, designation…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input text-xs py-1 px-2.5 w-48"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 self-end">
              <button
                type="button"
                onClick={exportPayrollCSV}
                className="btn-secondary text-xs py-1.5 px-3 font-medium flex items-center gap-1 shadow-xs"
              >
                📥 Export Payroll Sheet (CSV)
              </button>
              <button onClick={reload} className="btn-secondary text-xs py-1.5 px-2.5">
                Refresh
              </button>
            </div>
          </div>

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="card">
              <div className="text-xs text-muted font-medium">Total Net Payroll</div>
              <div className="text-xl font-bold text-emerald-600 mt-0.5">
                ₹{payrollTotals.totalSalary.toLocaleString("en-IN")}
              </div>
              <div className="text-[11px] text-muted mt-1">Calculated for {selectedMonth}</div>
            </div>

            <div className="card">
              <div className="text-xs text-muted font-medium">Eligible Staff</div>
              <div className="text-xl font-bold text-ink mt-0.5">{payrollTotals.staffCount}</div>
              <div className="text-[11px] text-muted mt-1">Active staff members</div>
            </div>

            <div className="card">
              <div className="text-xs text-muted font-medium">Effective Paid Man-Days</div>
              <div className="text-xl font-bold text-sky-600 mt-0.5">{payrollTotals.totalPaidDays}</div>
              <div className="text-[11px] text-muted mt-1">Includes Present + Paid Occasions</div>
            </div>

            <div className="card">
              <div className="text-xs text-muted font-medium">Total Unpaid Absences</div>
              <div className="text-xl font-bold text-rose-600 mt-0.5">{payrollTotals.totalAbsences}</div>
              <div className="text-[11px] text-muted mt-1">Loss of Pay deductions</div>
            </div>
          </div>

          {/* Detailed Monthly Payroll Table */}
          {loading && !data ? (
            <SkeletonTable rows={8} cols={10} />
          ) : (
            <div className="card overflow-x-auto p-0 border border-line shadow-xs">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead>
                  <tr className="bg-[#0284c7] text-white font-bold border-b border-[#0369a1]">
                    <th className="py-2.5 px-3">Employee</th>
                    <th className="py-2.5 px-3">Full Name</th>
                    <th className="py-2.5 px-3">Hub</th>
                    <th className="py-2.5 px-3 text-right">Base Salary</th>
                    <th className="py-2.5 px-3 text-center">Days</th>
                    <th className="py-2.5 px-3 text-center">Present</th>
                    <th className="py-2.5 px-3 text-center">Half Day</th>
                    <th className="py-2.5 px-3 text-center">Paid Occasion</th>
                    <th className="py-2.5 px-3 text-center">Absent (LOP)</th>
                    <th className="py-2.5 px-3 text-right">Per-Day Rate</th>
                    <th className="py-2.5 px-3 text-right">Net Payable Salary</th>
                    <th className="py-2.5 px-3">Bank / UPI Transfer</th>
                    <th className="py-2.5 px-3 text-center">Payout Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60 bg-surface">
                  {filteredPayroll.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="text-center py-8 text-xs text-muted">
                        No payroll records found for {selectedMonth}.
                      </td>
                    </tr>
                  ) : (
                    filteredPayroll.map((p) => {
                      const u = p.user;
                      return (
                        <tr key={u.id} className="hover:bg-surface-2/40 transition-colors">
                          <td className="py-2.5 px-3 font-mono font-bold text-ink">
                            {u.staffId}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-ink">
                            <div>{u.name}</div>
                            <div className="text-[10px] text-muted">{u.designation || u.role}</div>
                          </td>
                          <td className="py-2.5 px-3 text-muted">
                            {u.warehouse?.name ?? "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right font-medium text-ink font-mono">
                            ₹{p.baseSalary.toLocaleString("en-IN")}
                          </td>
                          <td className="py-2.5 px-3 text-center text-muted font-mono">
                            {p.daysInMonth}
                          </td>
                          <td className="py-2.5 px-3 text-center font-bold text-emerald-700">
                            {p.presentCount}
                          </td>
                          <td className="py-2.5 px-3 text-center text-amber-700 font-medium">
                            {p.halfDayCount > 0 ? `${p.halfDayCount} (${p.halfDayCount * 0.5}d)` : "0"}
                          </td>
                          <td className="py-2.5 px-3 text-center text-sky-700 font-bold">
                            <div>{p.paidLeaveCount}</div>
                            {p.occasions.length > 0 && (
                              <div className="text-[9px] text-muted max-w-[120px] truncate" title={p.occasions.join(", ")}>
                                {p.occasions.join(", ")}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center text-rose-600 font-bold">
                            {p.absentCount}
                          </td>
                          <td className="py-2.5 px-3 text-right text-muted font-mono">
                            ₹{p.perDayRate.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-emerald-600 font-mono text-sm">
                            ₹{p.calculatedSalary.toLocaleString("en-IN")}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-muted text-[11px]">
                            {u.bankUpi || "—"}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`badge text-[10px] font-semibold ${
                                p.calculatedSalary > 0
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-slate-100 text-slate-800"
                              }`}
                            >
                              {p.calculatedSalary > 0 ? "Eligible" : "Zero"}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
