"use client";

import { ErrorNote } from "@/components/ErrorNote";
import { readError, type ApiError } from "@/lib/read-error";
import { useRef, useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { submitQueueable } from "@/lib/offline-fetch";
import { ProductPicker } from "@/components/ProductPicker";

type Unit = { id: string; symbol: string };
type Product = { id: string; sku: string; name: string; saleUnits: { unit: Unit; isBaseUnit: boolean }[] };
type Supplier = { id: string; name: string; phone?: string | null; gstin?: string | null };
type Line = { product: Product | null; unitId: string; quantity: string; rate: string };
type Bill = {
  id: string;
  grnNumber: string;
  supplierBillNo: string;
  billDate: string;
  total: string;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  invoiceKeys: string[];
  supplier: { name: string };
};

const today = () => new Date().toISOString().slice(0, 10);
const emptyLine = (): Line => ({ product: null, unitId: "", quantity: "", rate: "" });
const emptyHeader = () => ({
  supplierId: "",
  supplierBillNo: "",
  billDate: today(),
  gstAmount: "",
  otherCharges: "",
  paymentStatus: "UNPAID" as const,
  dueDate: "",
  notes: "",
});

const money = (n: number) => n.toFixed(2);

function NewSupplierForm({ onCreated, onCancel }: { onCreated: (s: Supplier) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ name: "", contactPerson: "", phone: "", email: "", address: "", gstin: "", notes: "" });
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    setSaving(true);
    const res = await fetch("/api/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) {
      return setError(await readError(res, "Could not save supplier"));
    }
    onCreated(await res.json());
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-line bg-paper/30 p-3">
      <h3 className="text-xs font-semibold">New supplier</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-muted">Supplier name *</label>
          <input className="w-48" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Contact person</label>
          <input className="w-40" value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Phone</label>
          <input className="w-32" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Email</label>
          <input className="w-44" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">GST no. (optional)</label>
          <input
            className="w-44 uppercase"
            placeholder="22AAAAA0000A1Z5"
            value={form.gstin}
            onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Address</label>
          <input className="w-56" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        <button className="btn-primary" disabled={saving || !form.name.trim()} onClick={save}>
          {saving ? "Saving…" : "Save supplier"}
        </button>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

function InvoiceUpload({ bill, onUploaded }: { bill: Bill; onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function upload(file: File) {
    setError(null);
    setBusy(true);
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`/api/inventory/purchase-bills/${bill.id}/invoice`, { method: "POST", body });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setError(typeof b.error === "string" ? { message: b.error } : { message: "Upload failed" });
    }
    onUploaded();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {bill.invoiceKeys.map((k, i) => (
        <a key={k} className="text-xs underline" href={`/api/files/${k}`} target="_blank" rel="noreferrer">
          Page {i + 1}
        </a>
      ))}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        capture="environment"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          e.target.value = "";
        }}
      />
      <button className="btn text-xs" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? "Uploading…" : bill.invoiceKeys.length ? "Add page" : "Upload invoice photo"}
      </button>
      <ErrorNote error={error} />
    </div>
  );
}

function BillList({ bills, reload }: { bills: Bill[]; reload: () => void }) {
  async function setStatus(bill: Bill, paymentStatus: Bill["paymentStatus"]) {
    await fetch(`/api/inventory/purchase-bills/${bill.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentStatus }),
    });
    reload();
  }

  return (
    <div className="card">
      <h2 className="mb-2 text-sm font-semibold">Recent purchase &amp; inward bills</h2>
      <table>
        <thead>
          <tr>
            <th>GRN</th>
            <th>Supplier</th>
            <th>Bill no.</th>
            <th>Date</th>
            <th>Total</th>
            <th>Payment</th>
            <th>Invoice</th>
          </tr>
        </thead>
        <tbody>
          {bills.map((b) => (
            <tr key={b.id}>
              <td>{b.grnNumber}</td>
              <td>{b.supplier?.name || "General Supplier"}</td>
              <td>{b.supplierBillNo}</td>
              <td>{String(b.billDate).slice(0, 10)}</td>
              <td>{money(Number(b.total))}</td>
              <td>
                <select value={b.paymentStatus} onChange={(e) => setStatus(b, e.target.value as Bill["paymentStatus"])}>
                  <option value="UNPAID">Unpaid</option>
                  <option value="PARTIAL">Partial</option>
                  <option value="PAID">Paid</option>
                </select>
              </td>
              <td>
                <InvoiceUpload bill={b} onUploaded={reload} />
              </td>
            </tr>
          ))}
          {bills.length === 0 && (
            <tr>
              <td colSpan={7} className="text-xs text-muted">
                No stock received yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function ReceiveStock({ onReceived }: { onReceived?: () => void }) {
  const [mode, setMode] = useState<"QUICK" | "DETAILED">("QUICK");
  const { data: suppliersData, reload: reloadSuppliers } = useApiGet<Supplier[]>("/api/suppliers");
  const suppliers = suppliersData ?? [];
  const { data: billsData, reload: reloadBills } = useApiGet<Bill[]>("/api/inventory/purchase-bills");
  const bills = billsData ?? [];

  const [header, setHeader] = useState(emptyHeader);
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const filledLines = lines.filter((l) => l.product && l.unitId && Number(l.quantity) > 0);
  const subtotal = filledLines.reduce((s, l) => s + Number(l.quantity) * Number(l.rate || 0), 0);
  const total = subtotal + Number(header.gstAmount || 0) + Number(header.otherCharges || 0);

  const canSubmit = filledLines.length > 0;

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function submit() {
    if (!canSubmit) return;
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const { queued } = await submitQueueable("/api/inventory/purchase-bills", {
        supplierId: header.supplierId || undefined,
        supplierBillNo: header.supplierBillNo.trim() || undefined,
        billDate: header.billDate || undefined,
        items: filledLines.map((l) => ({
          productId: l.product!.id,
          unitId: l.unitId,
          quantity: Number(l.quantity),
          rate: Number(l.rate || 0),
        })),
        gstAmount: header.gstAmount ? Number(header.gstAmount) : undefined,
        otherCharges: header.otherCharges ? Number(header.otherCharges) : undefined,
        paymentStatus: header.paymentStatus,
        dueDate: header.dueDate || undefined,
        notes: header.notes || undefined,
      });
      setHeader(emptyHeader());
      setLines([emptyLine()]);
      setNotice(queued ? "Saved offline — will sync once back online." : "Stock received successfully!");
      reloadBills();
      onReceived?.();
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : "Could not receive stock" });
    } finally {
      setSaving(false);
    }
  }

  const supplier = suppliers.find((s) => s.id === header.supplierId);

  return (
    <div className="space-y-4">
      <div className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
          <div>
            <h2 className="text-base font-bold text-ink">Inward Stock / GRN</h2>
            <p className="text-xs text-muted">
              Receive goods into warehouse inventory. Choose Quick Inward for rapid stock entry or Detailed GRN for full supplier billing.
            </p>
          </div>

          <div className="flex rounded-lg border border-line p-1 bg-surface">
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                mode === "QUICK" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
              onClick={() => setMode("QUICK")}
            >
              ⚡ Quick Inward (Minimal Fields)
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                mode === "DETAILED" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
              }`}
              onClick={() => setMode("DETAILED")}
            >
              📋 Detailed GRN (Supplier &amp; PO)
            </button>
          </div>
        </div>

        {/* Detailed Mode Optional Header */}
        {mode === "DETAILED" && (
          <div className="space-y-3 rounded-lg border border-line bg-paper/40 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Supplier (Optional)</label>
                <select
                  className="w-56 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs"
                  value={header.supplierId}
                  onChange={(e) => setHeader({ ...header, supplierId: e.target.value })}
                >
                  <option value="">General / Direct Supplier</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn text-xs" onClick={() => setAddingSupplier((v) => !v)}>
                {addingSupplier ? "Close" : "+ New supplier"}
              </button>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Supplier Bill No. (Optional)</label>
                <input
                  className="w-36 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs"
                  placeholder="e.g. INV-9021"
                  value={header.supplierBillNo}
                  onChange={(e) => setHeader({ ...header, supplierBillNo: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Bill Date (Optional)</label>
                <input
                  type="date"
                  className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs"
                  value={header.billDate}
                  onChange={(e) => setHeader({ ...header, billDate: e.target.value })}
                />
              </div>
            </div>

            {supplier && (
              <p className="text-xs text-muted">
                {supplier.phone ? `Ph: ${supplier.phone}` : "No phone on file"} · {supplier.gstin ? `GST: ${supplier.gstin}` : "No GST no."}
              </p>
            )}

            {addingSupplier && (
              <NewSupplierForm
                onCancel={() => setAddingSupplier(false)}
                onCreated={(s) => {
                  setAddingSupplier(false);
                  reloadSuppliers();
                  setHeader((h) => ({ ...h, supplierId: s.id }));
                }}
              />
            )}
          </div>
        )}

        {/* Product Items Table */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold text-ink">Products to Inward</span>
            <span className="text-xs text-muted">{filledLines.length} item(s) ready</span>
          </div>

          <table>
            <thead>
              <tr>
                <th>Product *</th>
                <th>Unit *</th>
                <th>Quantity *</th>
                <th>Purchase Rate (₹)</th>
                <th>Line Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const product = line.product;
                return (
                  <tr key={i}>
                    <td className="w-80">
                      <ProductPicker
                        value={product}
                        onChange={(p) => {
                          const defUnit = p?.saleUnits.find((u) => u.isBaseUnit)?.unit.id || p?.saleUnits[0]?.unit.id || "";
                          setLine(i, { product: p, unitId: defUnit });
                        }}
                      />
                    </td>
                    <td>
                      <select
                        className="w-24 rounded border border-line bg-surface px-2 py-1 text-xs"
                        value={line.unitId}
                        onChange={(e) => setLine(i, { unitId: e.target.value })}
                        disabled={!product}
                      >
                        <option value="">Select unit…</option>
                        {product?.saleUnits.map((su) => (
                          <option key={su.unit.id} value={su.unit.id}>
                            {su.unit.symbol} {su.isBaseUnit ? "(Base)" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        className="w-24 rounded border border-line bg-surface px-2 py-1 text-xs font-semibold"
                        min="0"
                        step="any"
                        placeholder="0"
                        value={line.quantity}
                        onChange={(e) => setLine(i, { quantity: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="w-24 rounded border border-line bg-surface px-2 py-1 text-xs"
                        min="0"
                        step="any"
                        placeholder="0.00"
                        value={line.rate}
                        onChange={(e) => setLine(i, { rate: e.target.value })}
                      />
                    </td>
                    <td className="text-xs font-bold">
                      ₹{money(Number(line.quantity || 0) * Number(line.rate || 0))}
                    </td>
                    <td>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          className="btn text-xs text-muted hover:text-bad"
                          onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <button
            type="button"
            className="btn text-xs mt-2"
            onClick={() => setLines((ls) => [...ls, emptyLine()])}
          >
            + Add Another Line
          </button>
        </div>

        {/* Detailed Mode Optional Extra Costs */}
        {mode === "DETAILED" && (
          <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
            <div>
              <label className="mb-1 block text-xs text-muted">GST Amount (Optional)</label>
              <input
                type="number"
                className="w-24 rounded border border-line bg-surface px-2 py-1 text-xs"
                min="0"
                step="any"
                placeholder="0.00"
                value={header.gstAmount}
                onChange={(e) => setHeader({ ...header, gstAmount: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Freight / Loading (Optional)</label>
              <input
                type="number"
                className="w-24 rounded border border-line bg-surface px-2 py-1 text-xs"
                min="0"
                step="any"
                placeholder="0.00"
                value={header.otherCharges}
                onChange={(e) => setHeader({ ...header, otherCharges: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Payment Status</label>
              <select
                className="rounded border border-line bg-surface px-2 py-1 text-xs"
                value={header.paymentStatus}
                onChange={(e) => setHeader({ ...header, paymentStatus: e.target.value as typeof header.paymentStatus })}
              >
                <option value="UNPAID">Unpaid</option>
                <option value="PARTIAL">Partial</option>
                <option value="PAID">Paid</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Due Date (Optional)</label>
              <input
                type="date"
                className="rounded border border-line bg-surface px-2 py-1 text-xs"
                value={header.dueDate}
                onChange={(e) => setHeader({ ...header, dueDate: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Notes / LR No. (Optional)</label>
              <input
                className="w-48 rounded border border-line bg-surface px-2 py-1 text-xs"
                placeholder="e.g. Transport LR #9921"
                value={header.notes}
                onChange={(e) => setHeader({ ...header, notes: e.target.value })}
              />
            </div>
          </div>
        )}

        {/* Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-3 text-sm">
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted">Subtotal: ₹{money(subtotal)}</span>
            <span className="font-bold text-base text-ink">Total Inward Value: ₹{money(total)}</span>
          </div>

          <button
            type="button"
            className="btn-primary px-6 py-2 text-xs font-bold shadow-md"
            disabled={saving || !canSubmit}
            onClick={submit}
          >
            {saving ? "Inwarding…" : mode === "QUICK" ? "⚡ Inward Stock Now" : "📋 Create GRN & Inward Stock"}
          </button>
        </div>

        <ErrorNote error={error} />
        {notice && (
          <div className="rounded-lg border border-good/40 bg-good/10 p-3 text-xs text-good font-semibold">
            {notice}
          </div>
        )}
      </div>

      <BillList bills={bills} reload={reloadBills} />
    </div>
  );
}
