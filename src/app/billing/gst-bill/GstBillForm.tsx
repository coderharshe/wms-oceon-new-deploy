"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useDebounced } from "@/lib/useDebounced";
import { describeHttpError } from "@/lib/http-error";
import { printUrl } from "@/lib/print";
import { fmtQty } from "@/lib/fmt";
import { gstLine, gstTotals, hsnSummary, isInterState, stateCodeOfGstin, stateName, STATE_CODES, round2 } from "@/lib/gst";
import { rupeesInWords } from "@/lib/gst-invoice";
import { catalogueRate, unitIdOf, type SaleUnitLike } from "@/lib/bill-lines";
import { CustomerFields, type BillableCustomer } from "./CustomerFields";
import type { RegisterRow } from "@/lib/gst-register";

type Customer = BillableCustomer;
type Product = { id: string; sku: string; name: string; wholesalePrice: string; retailPrice: string; taxPercent: string; saleUnits: SaleUnitLike[] };

// The whole product is kept on the line, not just its id: switching the unit
// has to re-price from that unit's own rate, which needs the sale-unit list.
// `rateEdited` marks a rate the counter typed over, so switching the price
// list re-prices the catalogue-rate lines and leaves the deliberate ones be.
type Line = { key: string; product: Product; name: string; hsn: string; quantity: number; unitId: string; rate: number; taxPercent: number; rateEdited?: boolean };

// HSN codes are not on Product (see the note in the route) — the person
// raising the bill types one per line and this remembers it against the
// product, so the second invoice for the same goods is already filled in.
// ponytail: localStorage, so it lives on one PC. Move it to a Product column
// if a second counter starts raising GST bills, or the codes get retyped.
const HSN_STORE = "gst-hsn-by-product";

function loadHsn(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(HSN_STORE) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function rememberHsn(productId: string, hsn: string) {
  try {
    const all = loadHsn();
    if (hsn.trim()) all[productId] = hsn.trim();
    else delete all[productId];
    localStorage.setItem(HSN_STORE, JSON.stringify(all));
  } catch {
    // A locked-down browser must not stop anyone billing.
  }
}

const money = (n: number) => n.toFixed(2);

export default function GstBillForm({ sellerGstin, sellerName }: { sellerGstin: string; sellerName: string }) {
  const sellerState = stateCodeOfGstin(sellerGstin);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [custQuery, setCustQuery] = useState("");
  const [custHits, setCustHits] = useState<Customer[]>([]);
  const debouncedCust = useDebounced(custQuery, 200);

  const [prodQuery, setProdQuery] = useState("");
  const [prodHits, setProdHits] = useState<Product[]>([]);
  const debouncedProd = useDebounced(prodQuery, 200);
  const prodInput = useRef<HTMLInputElement>(null);

  const [lines, setLines] = useState<Line[]>([]);
  const [inclusive, setInclusive] = useState(true);
  const [deductStock, setDeductStock] = useState(false);
  // Which price list the rates come from. Seeded from the customer's own type
  // when one is picked, and overridable — a wholesale customer occasionally
  // buys a single piece at retail.
  const [mode, setMode] = useState("WHOLESALE");
  // "new" = adding a customer from scratch, "edit" = filling in what an
  // existing record is missing (most predate GST billing and have no GSTIN).
  const [custForm, setCustForm] = useState<null | "new" | "edit">(null);

  // "Modify" on the register sends us here with ?revise=GST-… . The invoice is
  // rebuilt from its own audit record, which is why the issue route stores the
  // lines and not just a count.
  const revising = useSearchParams().get("revise");
  const [revisedHadStock, setRevisedHadStock] = useState(false);
  const [prefillError, setPrefillError] = useState<string | null>(null);
  // Blank = follow the buyer's GSTIN (or the seller's state for an
  // unregistered buyer); set it to override where the supply went.
  const [placeOverride, setPlaceOverride] = useState("");
  const [shipTo, setShipTo] = useState("");
  const [terms, setTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ invoiceNo: string; url: string } | null>(null);

  useEffect(() => {
    if (!debouncedCust.trim()) return setCustHits([]);
    const ac = new AbortController();
    fetch(`/api/customers?q=${encodeURIComponent(debouncedCust)}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then(setCustHits)
      .catch(() => {});
    return () => ac.abort();
  }, [debouncedCust]);

  useEffect(() => {
    if (!debouncedProd.trim()) return setProdHits([]);
    const ac = new AbortController();
    fetch(`/api/products?q=${encodeURIComponent(debouncedProd)}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then(setProdHits)
      .catch(() => {});
    return () => ac.abort();
  }, [debouncedProd]);

  // Rebuild the invoice being revised: its customer, its lines, and how it was
  // priced. Products are re-fetched so a line can still have its unit switched
  // and re-priced — the stored record holds the numbers, not the catalogue.
  useEffect(() => {
    if (!revising) return;
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/finance/gst-invoices");
      if (!res.ok) return setPrefillError(await describeHttpError(res));
      const all = (await res.json()) as RegisterRow[];
      const src = all.find((r) => r.invoiceNo === revising);
      if (!src) return setPrefillError(`Could not find ${revising} to revise.`);
      if (cancelled) return;

      setInclusive(src.inclusive);
      setRevisedHadStock(src.stockDeducted || src.deductedLater);
      if (src.placeOfSupply) setPlaceOverride(src.placeOfSupply);

      const cust = await fetch(`/api/customers?q=${encodeURIComponent(src.customerName)}`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []);
      const match = (cust as Customer[]).find((c) => c.id === src.customerId);
      if (match && !cancelled) setCustomer(match);

      // One search per distinct product, so each line gets a real catalogue
      // entry (and its sale units) rather than a frozen snapshot.
      const wanted = [...new Set(src.items.map((i) => i.productId))];
      const found = new Map<string, Product>();
      for (const it of src.items) {
        if (found.has(it.productId)) continue;
        const hits = (await fetch(`/api/products?q=${encodeURIComponent(it.name)}`)
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => [])) as Product[];
        const p = hits.find((x) => x.id === it.productId);
        if (p) found.set(p.id, p);
      }
      if (cancelled) return;
      if (found.size < wanted.length) setPrefillError("Some products on that invoice are no longer in the catalogue — check the lines before issuing.");

      setLines(
        src.items
          .filter((it) => found.has(it.productId))
          .map((it) => ({
            key: crypto.randomUUID(),
            product: found.get(it.productId)!,
            name: it.name,
            hsn: it.hsn,
            quantity: it.quantity,
            unitId: it.unitId,
            rate: it.rate,
            taxPercent: it.taxPercent,
            // Every rate came off the original invoice, not the catalogue, so
            // none of them should be silently re-priced by a price-list switch.
            rateEdited: true,
          }))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [revising]);

  const buyerState = placeOverride || stateCodeOfGstin(customer?.gstin) || sellerState;
  const interState = isInterState(sellerGstin, buyerState);

  const priced = useMemo(
    () => lines.map((l) => ({ ...l, ...gstLine(l, inclusive, interState), hsn: l.hsn })),
    [lines, inclusive, interState]
  );
  const totals = gstTotals(priced);
  const summary = hsnSummary(priced);

  // Picking a customer also picks their price list — a WHOLESALE customer
  // should not be quoted retail rates because nobody remembered to switch.
  function pickCustomer(c: Customer) {
    setCustomer(c);
    setCustQuery("");
    setCustHits([]);
    if (c.type === "WHOLESALE" || c.type === "RETAIL") changeMode(c.type);
  }

  function addProduct(p: Product) {
    // Same default as the till: the unit the product is normally sold in
    // (peti, bag), falling back to the base unit — never the first in the list.
    const su = p.saleUnits.find((u) => u.isDefaultSaleUnit) ?? p.saleUnits.find((u) => u.isBaseUnit) ?? p.saleUnits[0];
    const unitId = su ? unitIdOf(su) : "";
    setLines((ls) => [
      ...ls,
      {
        key: crypto.randomUUID(),
        product: p,
        name: p.name,
        hsn: loadHsn()[p.id] ?? "",
        quantity: 1,
        unitId,
        rate: catalogueRate(p, unitId, mode) ?? 0,
        taxPercent: Number(p.taxPercent) || 0,
      },
    ]);
    setProdQuery("");
    setProdHits([]);
    prodInput.current?.focus();
  }

  const patch = (key: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  // Switching the unit re-prices the line: a rate quoted per bag is simply not
  // the rate per kg, so carrying the old number over would print a wrong bill.
  // An unpriced unit leaves the rate alone rather than zeroing it.
  function changeUnit(l: Line, unitId: string) {
    const fresh = catalogueRate(l.product, unitId, mode);
    // A catalogue rate replaces a hand-typed one AND clears the flag, so a
    // later price-list switch re-prices this line too. An unpriced unit keeps
    // both the typed rate and the flag.
    patch(l.key, fresh == null ? { unitId } : { unitId, rate: fresh, rateEdited: false });
  }

  // Re-pricing every line when the price list changes, except lines whose rate
  // was typed by hand — that number is a decision, not a default.
  function changeMode(next: string) {
    setMode(next);
    setLines((ls) => ls.map((l) => (l.rateEdited ? l : { ...l, rate: catalogueRate(l.product, l.unitId, next) ?? l.rate })));
  }

  async function issue() {
    if (!customer || lines.length === 0) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/finance/gst-bill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: customer.id,
        inclusive,
        deductStock,
        supersedes: revising ?? undefined,
        placeOfSupply: buyerState || undefined,
        shipTo: shipTo.trim() || undefined,
        terms: terms.trim() || undefined,
        notes: notes.trim() || undefined,
        items: lines.map((l) => ({
          productId: l.product.id,
          unitId: l.unitId,
          hsn: l.hsn.trim() || undefined,
          // Only sent when it differs — the server falls back to the catalogue
          // name, and an untouched line should not read as a rename.
          description: l.name.trim() && l.name.trim() !== l.product.name ? l.name.trim() : undefined,
          quantity: l.quantity,
          rate: l.rate,
          taxPercent: l.taxPercent,
        })),
      }),
    });
    setBusy(false);
    if (!res.ok) return setError(await describeHttpError(res));
    const out = (await res.json()) as { invoiceNo: string; url: string };
    for (const l of lines) rememberHsn(l.product.id, l.hsn);
    setIssued(out);
    printUrl(out.url);
  }

  if (issued) {
    return (
      <div className="mx-auto max-w-md space-y-3">
        <div className="card space-y-2">
          <h1 className="text-lg font-semibold">Invoice {issued.invoiceNo}</h1>
          <p className="text-sm text-muted">Sent to the printer. Reprint or save it from the link below.</p>
          <div className="flex gap-2">
            <button className="btn" onClick={() => printUrl(issued.url)}>Print again</button>
            <a className="btn" href={issued.url} target="_blank" rel="noreferrer">Open</a>
          </div>
        </div>
        <button
          className="btn"
          onClick={() => {
            setIssued(null);
            setLines([]);
            setCustomer(null);
            setShipTo("");
            setNotes("");
          }}
        >
          New GST invoice
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">GST Tax Invoice</h1>
        <Link className="btn" href="/billing/gst-bill/invoices">Past invoices</Link>
      </div>
      {revising && (
        <p className="card text-sm">
          Revising <strong>{revising}</strong>. A tax invoice is not edited once issued — this will be issued
          under a <strong>new number</strong>, and {revising} will be marked as revised by it.
          {revisedHadStock && " The original moved stock; reverse it from inventory if these quantities differ."}
        </p>
      )}
      {!stateCodeOfGstin(sellerGstin) && (
        <p className="card text-sm text-bad">
          No valid business GSTIN is set. Ask an admin to add it under Settings — a tax invoice cannot be raised without one.
        </p>
      )}

      <div className="card space-y-2">
        <label className="block text-xs text-muted">Buyer</label>
        {custForm ? (
          <CustomerFields
            existing={custForm === "edit" && customer ? customer : undefined}
            onCancel={() => setCustForm(null)}
            onDone={(c) => {
              pickCustomer(c);
              setCustForm(null);
            }}
          />
        ) : customer ? (
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold">{customer.shopName}</div>
              <div className="text-sm text-muted">
                {customer.gstin ? `GSTIN ${customer.gstin}` : "Unregistered"} · {stateName(buyerState) || "state not known"}
              </div>
              {customer.address ? (
                <div className="text-sm text-muted">{customer.address}</div>
              ) : (
                <div className="text-sm text-bad">No address on file — a tax invoice should carry one.</div>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <button className="btn" onClick={() => setCustForm("edit")}>Edit details</button>
              <button className="btn" onClick={() => setCustomer(null)}>Change</button>
            </div>
          </div>
        ) : (
          <>
            <input className="w-full" placeholder="Search shop name or mobile" value={custQuery} onChange={(e) => setCustQuery(e.target.value)} />
            {custHits.length > 0 && (
              <ul className="max-h-48 overflow-y-auto rounded border border-line">
                {custHits.map((c) => (
                  <li key={c.id}>
                    <button className="w-full px-2 py-1 text-left hover:bg-surface-hi" onClick={() => pickCustomer(c)}>
                      {c.shopName}
                      <span className="text-muted"> {c.mobile ?? ""} {c.gstin ?? ""}</span>
                      {!c.gstin && <span className="text-muted"> · no GSTIN yet</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button className="btn" onClick={() => setCustForm("new")}>
              {custQuery.trim() ? `Add "${custQuery.trim()}" as a new customer` : "Add a new customer"}
            </button>
          </>
        )}
      </div>

      <div className="card flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} />
          Rates include GST
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={deductStock} onChange={(e) => setDeductStock(e.target.checked)} />
          Deduct this from stock
        </label>
        <label className="flex items-center gap-2">
          Price list
          <select value={mode} onChange={(e) => changeMode(e.target.value)}>
            <option value="WHOLESALE">Wholesale</option>
            <option value="RETAIL">Retail</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Place of supply
          <select value={placeOverride} onChange={(e) => setPlaceOverride(e.target.value)}>
            <option value="">Auto ({stateName(buyerState) || "—"})</option>
            {Object.entries(STATE_CODES).map(([code, name]) => (
              <option key={code} value={code}>{code} {name}</option>
            ))}
          </select>
        </label>
        <span className="text-muted">{interState ? "IGST (inter-state)" : "CGST + SGST (intra-state)"}</span>
      </div>

      <div className="card space-y-2">
        <input
          ref={prodInput}
          className="w-full"
          placeholder="Search a product to add a line"
          value={prodQuery}
          onChange={(e) => setProdQuery(e.target.value)}
        />
        {prodHits.length > 0 && (
          <ul className="max-h-48 overflow-y-auto rounded border border-line">
            {prodHits.map((p) => (
              <li key={p.id}>
                <button className="w-full px-2 py-1 text-left hover:bg-surface-hi" onClick={() => addProduct(p)}>
                  {p.name} <span className="text-muted">{p.sku} · {Number(p.taxPercent).toFixed(2)}% GST</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {lines.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th>Description</th>
                  <th>HSN/SAC</th>
                  <th className="text-right">Qty</th>
                  <th>Unit</th>
                  <th className="text-right">Rate {inclusive ? "(incl.)" : "(excl.)"}</th>
                  <th className="text-right">GST %</th>
                  <th className="text-right">Taxable</th>
                  <th className="text-right">Tax</th>
                  <th className="text-right">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {priced.map((l) => (
                  <tr key={l.key} className="border-t border-line">
                    <td>
                      <input className="w-48 uppercase" value={l.name} maxLength={120} onChange={(e) => patch(l.key, { name: e.target.value })} aria-label="Description of goods" />
                    </td>
                    <td>
                      <input className="w-20" value={l.hsn} inputMode="numeric" maxLength={8} onChange={(e) => patch(l.key, { hsn: e.target.value.replace(/\D/g, "") })} />
                    </td>
                    <td className="text-right">
                      <input className="w-16 text-right" type="number" min="0" step="0.001" value={l.quantity} onChange={(e) => patch(l.key, { quantity: Number(e.target.value) })} />
                    </td>
                    <td>
                      <select value={l.unitId} onChange={(e) => changeUnit(l, e.target.value)} aria-label={`Unit for ${l.name}`}>
                        {l.product.saleUnits.map((u) => (
                          <option key={unitIdOf(u)} value={unitIdOf(u)}>{u.unit?.symbol ?? ""}</option>
                        ))}
                      </select>
                    </td>
                    <td className="text-right">
                      <input className="w-24 text-right" type="number" min="0" step="0.01" value={l.rate} onChange={(e) => patch(l.key, { rate: Number(e.target.value), rateEdited: true })} />
                    </td>
                    <td className="text-right">
                      <input className="w-16 text-right" type="number" min="0" max="100" step="0.01" value={l.taxPercent} onChange={(e) => patch(l.key, { taxPercent: Number(e.target.value) })} />
                    </td>
                    <td className="text-right">{money(l.taxable)}</td>
                    <td className="text-right">{money(l.tax)}</td>
                    <td className="text-right">{money(l.total)}</td>
                    <td className="text-right">
                      <button className="text-bad" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remove ${l.name}`}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {lines.length > 0 && (
        <div className="card space-y-1 text-sm">
          <div className="flex justify-between"><span>Taxable value</span><span>{money(totals.taxable)}</span></div>
          {interState ? (
            <div className="flex justify-between"><span>IGST</span><span>{money(totals.igst)}</span></div>
          ) : (
            <>
              <div className="flex justify-between"><span>CGST</span><span>{money(totals.cgst)}</span></div>
              <div className="flex justify-between"><span>SGST</span><span>{money(totals.sgst)}</span></div>
            </>
          )}
          <div className="flex justify-between border-t border-line pt-1 text-base font-semibold">
            <span>Total</span><span>₹{money(totals.total)}</span>
          </div>
          <div className="text-muted">{rupeesInWords(totals.total)}</div>
          <div className="text-xs text-muted">
            {summary.map((r) => `${r.hsn} @ ${r.taxPercent.toFixed(2)}%: ${money(r.taxable)}`).join("  ·  ")}
          </div>
        </div>
      )}

      <div className="card space-y-2">
        <input className="w-full" placeholder="Ship to (only if different from the buyer)" value={shipTo} onChange={(e) => setShipTo(e.target.value)} />
        <input className="w-full" placeholder="Mode / terms of payment" value={terms} onChange={(e) => setTerms(e.target.value)} />
        <input className="w-full" placeholder="Note on the invoice (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {prefillError && <p className="card text-sm text-bad">{prefillError}</p>}
      {error && <p className="card text-sm text-bad">{error}</p>}
      {deductStock && <p className="text-xs text-muted">Stock will be reduced at your warehouse when this invoice is issued.</p>}

      <button className="btn" disabled={busy || !customer || lines.length === 0} onClick={issue}>
        {busy ? "Issuing…" : "Issue & print invoice"}
      </button>
      <p className="text-xs text-muted">
        Seller: {sellerName || "—"} · {sellerGstin || "no GSTIN set"} · {stateName(sellerState) || "—"}
        {lines.length > 0 && ` · ${fmtQty(lines.reduce((s, l) => s + l.quantity, 0))} items, total ₹${money(round2(totals.total))}`}
      </p>
    </div>
  );
}
