"use client";

import { useState, useMemo } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { EditUserModal, type EditableUser } from "@/components/EditUserModal";
import { AttendancePayrollManager } from "@/components/AttendancePayrollManager";
import { readError } from "@/lib/read-error";

type Warehouse = { id: string; name: string; code: string; address?: string | null };
type User = EditableUser & {
  warehouse: { id?: string; name: string; code?: string; address?: string | null } | null;
};

const ROLES = ["ADMIN", "MANAGER", "BILLING", "FINANCE", "INVENTORY", "PROCUREMENT", "QC"];

export default function UsersPage() {
  const [sectionTab, setSectionTab] = useState<"users" | "attendance">("users");

  const { data: usersData, error: loadError, loading, reload: load } = useApiGet<User[]>("/api/admin/users");
  const list = usersData ?? [];
  const { data: warehousesData } = useApiGet<Warehouse[]>("/api/admin/warehouses");
  const warehouses = warehousesData ?? [];

  // New User Form State
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({
    staffId: "",
    name: "",
    password: "",
    role: "BILLING",
    warehouseId: "",
    contact: "",
    designation: "",
    city: "",
    town: "",
    employmentType: "Full-time",
    shift: "General",
    joiningDate: new Date().toISOString().slice(0, 10),
    endingDate: "",
    salary: "",
    bankUpi: "",
    reportingManager: "",
  });

  const [showFormPassword, setShowFormPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<User | null>(null);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Password visibility
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showAllPasswords, setShowAllPasswords] = useState(false);

  function toggleReveal(id: string) {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleShowAll() {
    if (showAllPasswords) {
      setRevealedIds(new Set());
      setShowAllPasswords(false);
    } else {
      setRevealedIds(new Set(list.map((u) => u.id)));
      setShowAllPasswords(true);
    }
  }

  async function copyPassword(id: string, pwd?: string | null) {
    if (!pwd) return;
    try {
      await navigator.clipboard.writeText(pwd);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 2000);
    } catch {
      // fallback
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        warehouseId: form.role === "ADMIN" ? undefined : form.warehouseId,
      }),
    });
    if (!res.ok) {
      const err = await readError(res, "Could not create user");
      return setError(err.message);
    }
    setForm({
      staffId: "",
      name: "",
      password: "",
      role: "BILLING",
      warehouseId: "",
      contact: "",
      designation: "",
      city: "",
      town: "",
      employmentType: "Full-time",
      shift: "General",
      joiningDate: new Date().toISOString().slice(0, 10),
      endingDate: "",
      salary: "",
      bankUpi: "",
      reportingManager: "",
    });
    setShowAddForm(false);
    load();
  }

  async function toggleActive(u: User) {
    await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !u.active }),
    });
    load();
  }

  const filteredUsers = useMemo(() => {
    return list.filter((u) => {
      if (roleFilter && u.role !== roleFilter) return false;
      if (warehouseFilter && u.warehouseId !== warehouseFilter) return false;
      if (statusFilter === "active" && !u.active) return false;
      if (statusFilter === "inactive" && u.active) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        u.staffId.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q) ||
        (u.contact && u.contact.toLowerCase().includes(q)) ||
        (u.designation && u.designation.toLowerCase().includes(q)) ||
        (u.city && u.city.toLowerCase().includes(q)) ||
        (u.town && u.town.toLowerCase().includes(q)) ||
        (u.warehouse?.name && u.warehouse.name.toLowerCase().includes(q)) ||
        (u.warehouse?.code && u.warehouse.code.toLowerCase().includes(q)) ||
        (u.reportingManager && u.reportingManager.toLowerCase().includes(q))
      );
    });
  }, [list, searchQuery, roleFilter, warehouseFilter, statusFilter]);

  function exportCSV() {
    if (!filteredUsers.length) return;
    const headers = [
      "Employee",
      "Full Name",
      "Contact",
      "Role",
      "Hub Code",
      "Hub Name",
      "City",
      "Town",
      "Type",
      "Shift",
      "Joining",
      "Discontinued Date",
      "Salary / Hourly Rate",
      "Bank/UPI",
      "Reporting",
      "Status",
    ];
    const rows = filteredUsers.map((u) => [
      `"${u.staffId}"`,
      `"${u.name}"`,
      `"${u.contact || ""}"`,
      `"${u.designation || u.role}"`,
      `"${u.warehouse?.code || (u.role === "ADMIN" ? "GLOBAL" : "N/A")}"`,
      `"${u.warehouse?.name || (u.role === "ADMIN" ? "All Warehouses" : "N/A")}"`,
      `"${u.city || ""}"`,
      `"${u.town || ""}"`,
      `"${u.employmentType || "Full-time"}"`,
      `"${u.shift || "General"}"`,
      `"${u.joiningDate || ""}"`,
      `"${u.endingDate || ""}"`,
      `"${u.salary || ""}"`,
      `"${u.bankUpi || ""}"`,
      `"${u.reportingManager || ""}"`,
      `"${u.active ? "Active" : "Inactive"}"`,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `staff_users_directory_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="space-y-4">
      {/* Top Header & Tab Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-line pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink">Users</h1>
        </div>

        {/* Section Tabs */}
        <div className="flex items-center gap-1.5 bg-surface-2 p-1 rounded-lg border border-line">
          <button
            onClick={() => setSectionTab("users")}
            className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${
              sectionTab === "users" ? "bg-accent text-white shadow-xs" : "text-muted hover:text-ink"
            }`}
          >
            👥 Users & Create
          </button>
          <button
            onClick={() => setSectionTab("attendance")}
            className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${
              sectionTab === "attendance" ? "bg-accent text-white shadow-xs" : "text-muted hover:text-ink"
            }`}
          >
            📅 Attendance & Payroll
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {sectionTab === "attendance" && (
        <AttendancePayrollManager portalRole="ADMIN" />
      )}

      {sectionTab === "users" && (
        <div className="space-y-4">
          {/* Controls within Directory */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted font-medium">
              Manage system credentials, employee profiles, and hub/warehouse assignments
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="btn-primary text-xs px-3 py-1.5 font-semibold flex items-center gap-1 shadow-xs"
              >
                {showAddForm ? "✖ Close Form" : "➕ Add User"}
              </button>
              <button
                onClick={toggleShowAll}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-surface-hi transition-colors flex items-center gap-1.5"
              >
                <span>{showAllPasswords ? "🙈 Hide Passwords" : "👁️ Passwords"}</span>
              </button>
              <button
                onClick={exportCSV}
                className="btn-secondary text-xs px-3 py-1.5 font-medium flex items-center gap-1"
              >
                📥 Export CSV
              </button>
            </div>
          </div>

      {loadError && <ErrorRetry message={loadError} onRetry={load} />}

      {/* Add User Collapsible Form */}
      {showAddForm && (
        <form onSubmit={create} className="card space-y-4 border-2 border-accent/20 bg-surface/90 shadow-md">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <h2 className="text-xs font-bold text-ink uppercase tracking-wider">➕ Register New Employee / User</h2>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-xs text-muted hover:text-ink font-bold"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-ink">Employee / Staff ID *</label>
              <input
                required
                className="input w-full text-xs font-mono font-semibold"
                placeholder="e.g. EMP001 or BIL-01"
                value={form.staffId}
                onChange={(e) => setForm({ ...form, staffId: e.target.value })}
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-ink">Full Name *</label>
              <input
                required
                className="input w-full text-xs"
                placeholder="e.g. Ramesh Kumar"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-ink">Contact / Mobile</label>
              <input
                className="input w-full text-xs"
                placeholder="e.g. 9876543210"
                value={form.contact}
                onChange={(e) => setForm({ ...form, contact: e.target.value })}
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-ink">Login Password *</label>
              <div className="relative flex items-center">
                <input
                  required
                  type={showFormPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className="input w-full text-xs pr-8 font-mono"
                  placeholder="Password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setShowFormPassword(!showFormPassword)}
                  className="absolute right-2 text-xs text-muted hover:text-ink"
                >
                  {showFormPassword ? "🙈" : "👁️"}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-ink">System Role *</label>
              <select
                className="input w-full text-xs font-semibold"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-ink">Designation / Title</label>
              <input
                className="input w-full text-xs"
                placeholder="e.g. Picker / Cashier / Supervisor"
                value={form.designation}
                onChange={(e) => setForm({ ...form, designation: e.target.value })}
              />
            </div>

            {form.role !== "ADMIN" ? (
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-ink">Hub / Warehouse *</label>
                <select
                  required
                  className="input w-full text-xs"
                  value={form.warehouseId}
                  onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
                >
                  <option value="">Select Hub / Warehouse…</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.code})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-ink">Hub / Warehouse Scope</label>
                <div className="input w-full text-xs bg-muted/10 text-muted italic flex items-center">
                  Global (All Hubs)
                </div>
              </div>
            )}

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-ink">City</label>
              <input
                className="input w-full text-xs"
                placeholder="e.g. Gurugram"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-ink">Town / State</label>
              <input
                className="input w-full text-xs"
                placeholder="e.g. Haryana"
                value={form.town}
                onChange={(e) => setForm({ ...form, town: e.target.value })}
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-ink">Employment Type</label>
              <select
                className="input w-full text-xs"
                value={form.employmentType}
                onChange={(e) => setForm({ ...form, employmentType: e.target.value })}
              >
                <option value="Full-time">Full-time</option>
                <option value="Part-time">Part-time</option>
                <option value="Contract">Contract</option>
                <option value="Intern">Intern</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-ink">Shift</label>
              <input
                className="input w-full text-xs"
                placeholder="e.g. 6AM–2PM, General"
                value={form.shift}
                onChange={(e) => setForm({ ...form, shift: e.target.value })}
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-ink">Joining Date</label>
              <input
                type="date"
                className="input w-full text-xs"
                value={form.joiningDate}
                onChange={(e) => setForm({ ...form, joiningDate: e.target.value })}
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-ink">Ending Date (Discontinued)</label>
              <input
                type="date"
                className="input w-full text-xs"
                placeholder="Discontinued Date (Optional)"
                value={form.endingDate}
                onChange={(e) => setForm({ ...form, endingDate: e.target.value })}
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-ink">Salary / Hourly Rate</label>
              <input
                className="input w-full text-xs"
                placeholder="e.g. 15,000"
                value={form.salary}
                onChange={(e) => setForm({ ...form, salary: e.target.value })}
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-ink">Bank / UPI</label>
              <input
                className="input w-full text-xs"
                placeholder="e.g. UPI:ramesh@upi"
                value={form.bankUpi}
                onChange={(e) => setForm({ ...form, bankUpi: e.target.value })}
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-ink">Reporting Manager</label>
              <input
                className="input w-full text-xs"
                placeholder="e.g. ASM1 or MGR-1"
                value={form.reportingManager}
                onChange={(e) => setForm({ ...form, reportingManager: e.target.value })}
              />
            </div>
          </div>

          <div className="flex justify-between items-center pt-3 border-t border-line">
            {error ? <span className="text-xs text-bad font-medium">{error}</span> : <span />}
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn text-xs"
                onClick={() => setShowAddForm(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary text-xs px-5 py-2 font-semibold"
                disabled={!form.staffId.trim() || !form.name.trim() || !form.password || (form.role !== "ADMIN" && !form.warehouseId)}
              >
                Save User Details
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-2 bg-surface-2/60 p-2.5 rounded-lg border border-line">
        <div className="w-full sm:w-64">
          <input
            type="text"
            placeholder="Search employee, name, contact, city…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input text-xs w-full py-1.5 px-2.5"
          />
        </div>

        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="input text-xs py-1.5 px-2"
        >
          <option value="">All Roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <select
          value={warehouseFilter}
          onChange={(e) => setWarehouseFilter(e.target.value)}
          className="input text-xs py-1.5 px-2"
        >
          <option value="">All Hubs / Warehouses</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.code})
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input text-xs py-1.5 px-2"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        {(searchQuery || roleFilter || warehouseFilter || statusFilter) && (
          <button
            onClick={() => {
              setSearchQuery("");
              setRoleFilter("");
              setWarehouseFilter("");
              setStatusFilter("");
            }}
            className="text-xs text-accent hover:underline font-medium px-1"
          >
            Clear Filters
          </button>
        )}

        <div className="ml-auto text-xs text-muted font-medium">
          Showing {filteredUsers.length} of {list.length} Users
        </div>
      </div>

      {/* Users & Employees Table */}
      {loading ? (
        <SkeletonTable rows={8} cols={10} />
      ) : (
        <div className="card overflow-x-auto p-0 border border-line shadow-xs">
          <table className="w-full text-left text-xs whitespace-nowrap">
            {/* Header styled cleanly with vibrant header row */}
            <thead>
              <tr className="bg-[#0284c7] text-white font-bold border-b border-[#0369a1]">
                <th className="py-2.5 px-3">Employee</th>
                <th className="py-2.5 px-3">Full Name</th>
                <th className="py-2.5 px-3">Contact</th>
                <th className="py-2.5 px-3">Role</th>
                <th className="py-2.5 px-3">Hub Code</th>
                <th className="py-2.5 px-3">Hub Name</th>
                <th className="py-2.5 px-3">City</th>
                <th className="py-2.5 px-3">Town</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Shift</th>
                <th className="py-2.5 px-3">Joining</th>
                <th className="py-2.5 px-3">Discontinued</th>
                <th className="py-2.5 px-3 text-right">Salary / Hourly Rate</th>
                <th className="py-2.5 px-3">Bank/UPI</th>
                <th className="py-2.5 px-3">Reporting</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60 bg-surface">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={17} className="text-center py-8 text-xs text-muted">
                    No employee records match the search or filter criteria.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isRevealed = showAllPasswords || revealedIds.has(u.id);
                  const pwd = u.plainPassword || "password123";
                  const isCopied = copiedId === u.id;

                  return (
                    <tr key={u.id} className="hover:bg-surface-2/50 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-bold text-ink">
                        {u.staffId}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-ink">
                        {u.name}
                      </td>
                      <td className="py-2.5 px-3 text-ink font-mono">
                        {u.contact || "—"}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`badge text-[10px] font-bold ${
                            u.role === "ADMIN"
                              ? "bg-purple-100 text-purple-800"
                              : u.role === "MANAGER"
                              ? "bg-blue-100 text-blue-800"
                              : u.role === "BILLING"
                              ? "bg-sky-100 text-sky-800"
                              : u.role === "FINANCE"
                              ? "bg-emerald-100 text-emerald-800"
                              : u.role === "QC"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-800"
                          }`}
                        >
                          {u.designation || u.role}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-muted font-medium">
                        {u.warehouse?.code ?? (u.role === "ADMIN" ? "GLOBAL" : "—")}
                      </td>
                      <td className="py-2.5 px-3 text-ink">
                        {u.warehouse?.name ?? (u.role === "ADMIN" ? "All Warehouses" : "—")}
                      </td>
                      <td className="py-2.5 px-3 text-muted">
                        {u.city || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-muted">
                        {u.town || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-muted">
                        {u.employmentType || "Full-time"}
                      </td>
                      <td className="py-2.5 px-3 text-muted">
                        {u.shift || "General"}
                      </td>
                      <td className="py-2.5 px-3 text-muted font-mono">
                        {u.joiningDate || "—"}
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        {u.endingDate ? <span className="text-rose-600 font-semibold">{u.endingDate}</span> : <span className="text-muted">—</span>}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-ink font-mono">
                        {u.salary ? `₹${u.salary}` : "—"}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-muted text-[11px]">
                        {u.bankUpi || "—"}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-muted">
                        {u.reportingManager || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={`badge text-[10px] font-semibold ${
                            u.active ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                          }`}
                        >
                          {u.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right space-x-1.5">
                        <div className="inline-flex items-center gap-1.5">
                          {/* Quick Password Reveal/Copy */}
                          <div className="inline-flex items-center gap-1 bg-surface-2/80 px-1.5 py-0.5 rounded border border-line text-[11px] font-mono">
                            <span className={isRevealed ? "font-bold text-ink" : "text-muted"}>
                              {isRevealed ? pwd : "••••"}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleReveal(u.id)}
                              className="text-muted hover:text-ink transition-colors"
                              title={isRevealed ? "Hide Password" : "Show Password"}
                            >
                              {isRevealed ? "🙈" : "👁️"}
                            </button>
                            <button
                              type="button"
                              onClick={() => copyPassword(u.id, pwd)}
                              className="text-muted hover:text-ink transition-colors"
                              title="Copy Password"
                            >
                              {isCopied ? "✓" : "📋"}
                            </button>
                          </div>

                          <button
                            className="rounded px-2 py-1 text-xs font-semibold text-accent hover:bg-surface-hi transition-colors"
                            onClick={() => setEditing(u)}
                          >
                            Edit
                          </button>
                          <button
                            className={`rounded px-2 py-1 text-xs font-semibold transition-colors ${
                              u.active ? "text-bad hover:bg-bad/10" : "text-good hover:bg-good/10"
                            }`}
                            onClick={() => toggleActive(u)}
                          >
                            {u.active ? "Deactivate" : "Activate"}
                          </button>
                        </div>
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

      {editing && (
        <EditUserModal
          user={editing}
          roles={ROLES}
          warehouses={warehouses}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
