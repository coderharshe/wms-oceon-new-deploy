"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonCard } from "@/components/Skeleton";
import { describeHttpError } from "@/lib/http-error";
import { printUrl } from "@/lib/print";
import { fmtDateTime } from "@/lib/fmt";
import { inMonth, isReplayable, isStockSettled, matchesSearch, toCsv, type RegisterRow } from "@/lib/gst-register";

type StockFilter = "all" | "deducted" | "not";

const money = (n: number | undefined) => (n ?? 0).toFixed(2);

export default function GstInvoiceRegisterPage() {
  const { data, error, loading, reload } = useApiGet<RegisterRow[]>("/api/finance/gst-invoices");
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState("");
  const [month, setMonth] = useState("");
  const [stock, setStock] = useState<StockFilter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          matchesSearch(r, search) &&
          inMonth(r.issuedAt, month) &&
          (stock === "all" || (stock === "deducted") === isStockSettled(r))
      ),
    [rows, search, month, stock]
  );

  const totals = shown.reduce(
    (a, r) => ({ taxable: a.taxable + (r.taxable ?? 0), tax: a.tax + (r.tax ?? 0), total: a.total + (r.total ?? 0) }),
    { taxable: 0, tax: 0, total: 0 }
  );

  // The artifact sandbox blocks <a download>, but this is the real app — a
  // Blob URL download is the whole feature, no server round trip needed.
  function exportCsv() {
    const blob = new Blob([toCsv(shown)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gst-invoices${month ? `-${month}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function deductNow(r: RegisterRow) {
    if (!confirm(`Move stock for ${r.invoiceNo} now? This reduces inventory by the ${r.items.length} line(s) on it and cannot be undone here.`)) return;
    setBusy(r.invoiceNo);
    setNote(null);
    const res = await fetch(`/api/finance/gst-invoices/${encodeURIComponent(r.invoiceNo)}/deduct`, { method: "POST" });
    setBusy(null);
    if (!res.ok) return setNote({ kind: "bad", text: await describeHttpError(res) });
    setNote({ kind: "ok", text: `Stock moved for ${r.invoiceNo}.` });
    reload();
  }

  if (loading) return <div className="mx-auto max-w-5xl space-y-3"><SkeletonCard lines={3} /><SkeletonCard lines={6} /></div>;
  if (error && !data) return <ErrorRetry message={error} onRetry={reload} />;

  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Past GST invoices</h1>
        <Link className="btn" href="/finance/gst-bill">New GST invoice</Link>
      </div>

      <div className="card flex flex-wrap items-end gap-3 text-sm">
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Search number or customer</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="GST-… or shop name" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Month</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Stock</span>
          <select value={stock} onChange={(e) => setStock(e.target.value as StockFilter)}>
            <option value="all">All</option>
            <option value="deducted">Deducted from inventory</option>
            <option value="not">Not deducted</option>
          </select>
        </label>
        <button className="btn" onClick={exportCsv} disabled={shown.length === 0}>Export CSV</button>
        {(search || month || stock !== "all") && (
          <button className="btn" onClick={() => { setSearch(""); setMonth(""); setStock("all"); }}>Clear</button>
        )}
      </div>

      {note && <p className={`card text-sm ${note.kind === "ok" ? "text-good" : "text-bad"}`}>{note.text}</p>}

      {shown.length === 0 ? (
        <p className="card text-sm text-muted">
          {rows.length === 0 ? "No GST invoices have been raised at this warehouse yet." : "No invoices match these filters."}
        </p>
      ) : (
        <>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="p-2">Invoice</th>
                  <th className="p-2">Date</th>
                  <th className="p-2">Customer</th>
                  <th className="p-2 text-right">Taxable</th>
                  <th className="p-2 text-right">Tax</th>
                  <th className="p-2 text-right">Total</th>
                  <th className="p-2">Stock</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const settled = isStockSettled(r);
                  return (
                    <tr key={r.invoiceNo} className="border-t border-line align-top">
                      <td className="p-2">
                        <div className="font-medium">{r.invoiceNo}</div>
                        <div className="text-xs text-muted">
                          {r.interState ? "IGST" : "CGST+SGST"} · {r.lines} line{r.lines === 1 ? "" : "s"}
                          {r.issuedBy ? ` · ${r.issuedBy}` : ""}
                        </div>
                        {r.supersedes && <div className="text-xs text-muted">Revises {r.supersedes}</div>}
                        {r.supersededBy && <div className="text-xs text-bad">Revised by {r.supersededBy}</div>}
                      </td>
                      <td className="p-2 whitespace-nowrap">{fmtDateTime(r.issuedAt)}</td>
                      <td className="p-2">{r.customerName}</td>
                      <td className="p-2 text-right">{money(r.taxable)}</td>
                      <td className="p-2 text-right">{money(r.tax)}</td>
                      <td className="p-2 text-right font-medium">{money(r.total)}</td>
                      <td className="p-2 whitespace-nowrap">
                        {settled ? (
                          <span className="text-good">Deducted{r.deductedLater ? " (later)" : ""}</span>
                        ) : (
                          <span className="text-bad">Not deducted</span>
                        )}
                      </td>
                      <td className="p-2">
                        <div className="flex flex-wrap justify-end gap-1">
                          <button className="btn" onClick={() => printUrl(r.url)}>Print</button>
                          {isReplayable(r) ? (
                            <>
                              {!settled && (
                                <button className="btn" disabled={busy === r.invoiceNo} onClick={() => deductNow(r)}>
                                  {busy === r.invoiceNo ? "Deducting…" : "Deduct now"}
                                </button>
                              )}
                              {!r.supersededBy && (
                                <Link className="btn" href={`/finance/gst-bill?revise=${encodeURIComponent(r.invoiceNo)}`}>Modify</Link>
                              )}
                            </>
                          ) : (
                            <span className="text-xs text-muted">view only</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card flex flex-wrap justify-between gap-3 text-sm">
            <span className="text-muted">{shown.length} invoice{shown.length === 1 ? "" : "s"}{month ? ` in ${month}` : ""}</span>
            <span>Taxable {money(totals.taxable)} · Tax {money(totals.tax)} · <strong>Total {money(totals.total)}</strong></span>
          </div>
        </>
      )}
    </div>
  );
}
