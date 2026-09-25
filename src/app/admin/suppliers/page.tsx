"use client";

import { Fragment, useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { fmtDate } from "@/lib/fmt";

// The supplier master, shared by Admin and Manager (see
// src/app/manager/suppliers/page.tsx). Receiving staff create suppliers inline
// on the receive form (a truck at the gate can't wait), so this is where
// duplicates get fixed, dead suppliers get retired, and — expanding a row —
// what we still owe each one gets settled.
//
// No delete: a supplier is referenced by every bill it ever sent, so
// `active: false` is the only retirement. Outstanding/bill figures are scoped
// to the viewer's warehouse by the API; ADMIN sees every branch.

const money = (n: number) => n.toFixed(2);

type Supplier = {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  notes: string | null;
  active: boolean;
  bills: number;
  outstanding: number;
  lastBillDate: string | null;
};

type Bill = {
  id: string;
  grnNumber: string;
  supplierBillNo: string;
  billDate: string;
  dueDate: string | null;
  total: string;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
};

const FIELDS = [
  ["name", "Name"],
  ["contactPerson", "Contact"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["gstin", "GST no."],
  ["address", "Address"],
  ["notes", "Notes"],
] as const;

const COLS = 8;

// One supplier's purchase ledger, loaded only when the row is expanded — the
// list itself already carries the totals, and most rows never get opened.
function CreditHistory({ supplier, onPaid }: { supplier: Supplier; onPaid: () => void }) {
  const { data, error, loading, reload } = useApiGet<Bill[]>(
    `/api/inventory/purchase-bills?supplierId=${supplier.id}&limit=100`,
  );
  const bills = data ?? [];

  async function setStatus(id: string, paymentStatus: Bill["paymentStatus"]) {
    await fetch(`/api/inventory/purchase-bills/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentStatus }),
    });
    reload();
    onPaid(); // the outstanding total in the row above just changed
  }

  if (loading) return <p className="text-xs text-muted">Loading bills…</p>;
  if (error) return <ErrorRetry message={error} onRetry={reload} />;
  if (bills.length === 0) return <p className="text-xs text-muted">No bills received from {supplier.name} yet.</p>;

  return (
    <table>
      <thead>
        <tr>
          <th>GRN</th>
          <th>Bill no.</th>
          <th>Bill date</th>
          <th>Due</th>
          <th>Total</th>
          <th>Payment</th>
        </tr>
      </thead>
      <tbody>
        {bills.map((b) => (
          <tr key={b.id}>
            <td>{b.grnNumber}</td>
            <td>{b.supplierBillNo}</td>
            <td>{fmtDate(b.billDate)}</td>
            <td>{b.dueDate ? fmtDate(b.dueDate) : "—"}</td>
            <td>{money(Number(b.total))}</td>
            <td>
              <select value={b.paymentStatus} onChange={(e) => setStatus(b.id, e.target.value as Bill["paymentStatus"])}>
                <option value="UNPAID">Unpaid</option>
                <option value="PARTIAL">Partial</option>
                <option value="PAID">Paid</option>
              </select>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function SuppliersPage() {
  const [q, setQ] = useState("");
  const { data, error, loading, reload } = useApiGet<Supplier[]>(
    `/api/suppliers?includeInactive=1&withCredit=1&q=${encodeURIComponent(q)}`,
  );
  const list = data ?? [];
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function patch(id: string, body: Record<string, unknown>) {
    setSaveError(null);
    const res = await fetch(`/api/suppliers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setSaveError(typeof b.error === "string" ? b.error : "Could not save");
    }
    setEditing(null);
    reload();
  }

  const owed = list.reduce((sum, s) => sum + s.outstanding, 0);

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Suppliers</h1>
      <div className="flex items-center gap-3">
        <input className="w-64" placeholder="Search name / phone / GST…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-sm text-muted">
          To pay, all suppliers: <strong className={owed > 0 ? "text-bad" : ""}>{money(owed)}</strong>
        </span>
      </div>
      {error && <ErrorRetry message={error} onRetry={reload} />}
      {saveError && <p className="text-sm text-bad">{saveError}</p>}

      {editing && (
        <div className="card space-y-2">
          <h2 className="text-sm font-semibold">Edit {editing.name}</h2>
          <div className="flex flex-wrap items-end gap-2">
            {FIELDS.map(([key, label]) => (
              <div key={key}>
                <label className="mb-1 block text-xs text-muted">{label}</label>
                <input
                  className="w-44"
                  value={editing[key] ?? ""}
                  onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                />
              </div>
            ))}
            <button
              className="btn-primary"
              onClick={() =>
                patch(editing.id, {
                  name: editing.name,
                  contactPerson: editing.contactPerson ?? "",
                  phone: editing.phone ?? "",
                  email: editing.email ?? "",
                  gstin: editing.gstin ?? "",
                  address: editing.address ?? "",
                  notes: editing.notes ?? "",
                })
              }
            >
              Save
            </button>
            <button className="btn" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={6} cols={COLS} />
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Phone</th>
                <th>GST no.</th>
                <th>Bills</th>
                <th>To pay</th>
                <th>Last bill</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <Fragment key={s.id}>
                  <tr className={s.active ? "" : "text-muted"}>
                    <td>
                      <button className="underline" onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                        {s.name}
                      </button>
                      {!s.active && " (inactive)"}
                    </td>
                    <td>{s.contactPerson}</td>
                    <td>{s.phone}</td>
                    <td>{s.gstin}</td>
                    <td>{s.bills}</td>
                    <td className={s.outstanding > 0 ? "text-bad" : ""}>{money(s.outstanding)}</td>
                    <td>{s.lastBillDate ? fmtDate(s.lastBillDate) : "—"}</td>
                    <td className="flex gap-2">
                      <button className="btn text-xs" onClick={() => setEditing(s)}>
                        Edit
                      </button>
                      <button className="btn text-xs" onClick={() => patch(s.id, { active: !s.active })}>
                        {s.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </td>
                  </tr>
                  {openId === s.id && (
                    <tr>
                      <td colSpan={COLS}>
                        <CreditHistory supplier={s} onPaid={reload} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={COLS} className="text-xs text-muted">
                    No suppliers yet — they get added from the Receive Stock form.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
