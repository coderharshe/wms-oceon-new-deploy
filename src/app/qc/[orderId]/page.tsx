"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ErrorRetry } from "@/components/ErrorRetry";
import { Skeleton, SkeletonCard } from "@/components/Skeleton";
import { QC_HEARTBEAT_INTERVAL_MS } from "@/lib/qc-lock";
import { BarcodeScanButton } from "@/components/BarcodeScanButton";
import { barcodesForProduct, findByBarcode } from "@/lib/barcode";
import { fmtTime } from "@/lib/fmt";

type BillItem = {
  productId: string;
  product: {
    name: string;
    barcode: string | null;
    saleUnits: { unitId: string; barcode: string | null }[];
  };
  quantity: string;
  unitId: string;
  unit: { symbol: string };
  unitPrice: string;
};

type SessionDetail = {
  id: string;
  status: string;
  order: {
    orderNumber: string;
    customer: { shopName: string };
    sellingMode: string;
    bill: { billNumber: string; currentVersion: number; versions: { versionNumber: number; items: BillItem[] }[] };
  };
};

type LineState = {
  productId: string;
  name: string;
  original: number;
  unit: string;
  mode: "keep" | "no" | "edit";
  finalQty: number;
  reason: string;
  // Every code that identifies this line's product — the manufacturer's code
  // plus any per-packaging ones. Scanning any of them confirms the line.
  barcodes: string[];
};

export default function QcSessionPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [lines, setLines] = useState<LineState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [blockedLines, setBlockedLines] = useState<{ productId: string; productName: string; detail: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<null | { total: string; paymentStatus: string }>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [locked, setLocked] = useState<{ lockedByName: string; lockedSince: string } | null>(null);
  const leftRef = useRef(false); // guards the unmount/beforeunload release from firing twice
  // Products confirmed by scanning the physical item. Purely additive — QC
  // can still complete without scanning anything; this only records what was
  // physically verified, which the audit entry then carries to Admin/Manager.
  const [scanned, setScanned] = useState<string[]>([]);
  const [scanInput, setScanInput] = useState("");
  const [scanMessage, setScanMessage] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  // Two chained requests (open/resume session, then fetch its detail) — not
  // a plain GET, so hand-rolled rather than useApiGet. Wrapped in try/catch
  // with a res.ok check on *both* legs: previously a rejected fetch or a
  // bad response from the second request had no error handling at all and
  // left the page stuck on "Loading…" forever.
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setLocked(null);
    try {
      const startRes = await fetch("/api/qc/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const startBody = await startRes.json().catch(() => null);
      if (startRes.status === 423) {
        setLocked({ lockedByName: startBody?.lockedByName ?? "another QC user", lockedSince: startBody?.lockedSince ?? new Date().toISOString() });
        return;
      }
      if (!startRes.ok) {
        throw new Error((startBody && startBody.error) || "Could not start QC session");
      }

      const detailRes = await fetch(`/api/qc/sessions/${startBody.id}`);
      const data = (await detailRes.json().catch(() => null)) as SessionDetail | null;
      if (!detailRes.ok || !data) {
        throw new Error((data as any)?.error || "Could not load QC session detail");
      }

      setDetail(data);
      const version = data.order.bill.versions.find((v) => v.versionNumber === data.order.bill.currentVersion)!;
      setLines(
        version.items.map((it) => ({
          productId: it.productId,
          name: it.product.name,
          original: Number(it.quantity),
          unit: it.unit.symbol,
          mode: "keep" as const,
          finalQty: Number(it.quantity),
          reason: "",
          barcodes: barcodesForProduct(it.product),
        }))
      );
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  // Keeps the lock alive while this tab is open. Also best-effort releases it
  // on tab close/navigation-away — sendBeacon fires reliably where a normal
  // fetch in an unload handler often gets cancelled mid-flight.
  useEffect(() => {
    if (!detail || done) return;
    const heartbeat = setInterval(() => {
      fetch(`/api/qc/sessions/${detail.id}/heartbeat`, { method: "POST" }).catch(() => {});
    }, QC_HEARTBEAT_INTERVAL_MS);
    const releaseOnLeave = () => {
      if (leftRef.current) return;
      leftRef.current = true;
      navigator.sendBeacon(`/api/qc/sessions/${detail.id}/leave`);
    };
    window.addEventListener("beforeunload", releaseOnLeave);
    return () => {
      clearInterval(heartbeat);
      window.removeEventListener("beforeunload", releaseOnLeave);
      releaseOnLeave(); // also release on ordinary in-app navigation away from this page
    };
  }, [detail, done]);

  async function leave() {
    if (!detail) return;
    leftRef.current = true;
    await fetch(`/api/qc/sessions/${detail.id}/leave`, { method: "POST" });
    router.push("/qc");
  }

  function setMode(productId: string, mode: LineState["mode"]) {
    setLines((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, mode, finalQty: mode === "no" ? 0 : mode === "keep" ? l.original : l.finalQty } : l))
    );
  }
  // QC can only ever reduce a line (down to 0) — never raise it above what
  // was ordered. Clamped here too, not just via the input's max, since this
  // feeds a money-affecting request.
  function setFinalQty(productId: string, qty: number) {
    setLines((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, finalQty: Math.max(0, Math.min(qty, l.original)) } : l))
    );
  }
  function setReason(productId: string, reason: string) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, reason } : l)));
  }

  // Matching is deliberately limited to this order's own lines: scanning
  // something that isn't on the order is the mistake worth catching at
  // handover, so it reports rather than resolving against the whole catalogue.
  function onScan(rawCode: string) {
    const code = rawCode.trim();
    if (!code) return;
    setScanInput("");
    const line = findByBarcode(lines, code);
    if (!line) {
      setScanMessage({ kind: "bad", text: `${code} is not on this order` });
      return;
    }
    setMode(line.productId, "keep");
    setScanned((prev) => (prev.includes(line.productId) ? prev : [...prev, line.productId]));
    setScanMessage({ kind: "ok", text: `${line.name} confirmed` });
  }

  async function submit() {
    if (missingReason) {
      setError("Add a reason for every line you're reducing.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setBlockedLines([]);
    const res = await fetch(`/api/qc/sessions/${detail!.id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lineDecisions: lines
          .filter((l) => l.mode !== "keep")
          .map((l) => ({
            productId: l.productId,
            action: l.mode === "no" ? "MARK_UNAVAILABLE" : l.finalQty === 0 ? "REMOVE" : "REDUCE",
            finalQty: l.finalQty,
            reason: l.reason || undefined,
          })),
        scannedProductIds: scanned,
        totalLineCount: lines.length,
      }),
    });
    setSubmitting(false);
    const body = await res.json().catch(() => ({}));
    if (res.status === 200) {
      setDone(body);
      return;
    }
    setError(body.error === "CHANGE_BLOCKED" ? "Change blocked." : body.error ?? "Could not complete QC");
    setBlockedLines(body.lines ?? []);
  }

  const missingReason = lines.some((l) => l.mode !== "keep" && !l.reason.trim());

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <Skeleton className="h-6 w-48" />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </div>
    );
  }
  if (locked) {
    return (
      <div className="card mx-auto max-w-md space-y-2 text-center">
        <h1 className="text-lg font-semibold text-bad">Order locked</h1>
        <p>
          Being worked on by <strong>{locked.lockedByName}</strong> since {fmtTime(locked.lockedSince)}.
        </p>
        <p className="text-sm text-muted">Ask a manager to release it if this looks stuck.</p>
        <button className="btn-primary" onClick={() => router.push("/qc")}>
          Back to Queue
        </button>
      </div>
    );
  }
  if (loadError && !detail) return <ErrorRetry message={loadError} onRetry={load} />;
  if (!detail) return null;

  if (done) {
    return (
      <div className="card mx-auto max-w-md space-y-2 text-center">
        <h1 className="text-lg font-semibold text-good">QC Completed</h1>
        <p>Final total: ₹{Number(done.total).toFixed(2)}</p>
        <p>Payment status: {done.paymentStatus}</p>
        <button className="btn-primary" onClick={() => router.push("/qc")}>
          Back to Queue
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3 pb-24">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold">{detail.order.orderNumber}</h1>
          <p className="text-sm text-muted">
            {detail.order.customer.shopName} · {detail.order.bill.billNumber} · {detail.order.sellingMode}
          </p>
        </div>
        <button className="btn text-xs" onClick={leave} title="Release this order for someone else to pick up">
          Leave
        </button>
      </div>

      {/* Optional shortcut: scanning an item ticks its line off as available.
          A handheld scanner types into this box and hits Enter; the camera
          button appears only where the browser supports it. */}
      <div className="card space-y-1">
        <label className="block text-xs text-muted">
          Scan items as you hand them over ({scanned.length}/{lines.length} confirmed) — optional
        </label>
        <div className="flex items-center gap-2">
          <input
            className="flex-1"
            placeholder="Scan or type a barcode…"
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onScan(scanInput);
              }
            }}
          />
          <BarcodeScanButton onDetected={onScan} />
        </div>
        {scanMessage && (
          <p className={`text-sm ${scanMessage.kind === "ok" ? "text-good" : "text-bad"}`}>{scanMessage.text}</p>
        )}
      </div>

      <div className="space-y-2">
        {lines.map((l) => {
          const blocked = blockedLines.find((b) => b.productId === l.productId);
          return (
            <div key={l.productId} className={`card space-y-2 ${blocked ? "border-bad" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {l.name}
                  {scanned.includes(l.productId) && <span className="badge ml-2 bg-good text-white">✓ Scanned</span>}
                </span>
                <span className="text-sm text-muted">
                  Ordered: {l.original.toFixed(2)} {l.unit}
                </span>
              </div>

              {/* Big touch-friendly Yes/No */}
              <div className="flex gap-2">
                <button
                  onClick={() => setMode(l.productId, "keep")}
                  className={`flex-1 rounded py-3 text-base font-semibold ${l.mode === "keep" ? "bg-good text-white" : "border border-line"}`}
                >
                  YES — Available
                </button>
                <button
                  onClick={() => setMode(l.productId, "no")}
                  className={`flex-1 rounded py-3 text-base font-semibold ${l.mode === "no" ? "bg-bad text-white" : "border border-line"}`}
                >
                  NO
                </button>
                <button
                  onClick={() => setMode(l.productId, "edit")}
                  className={`rounded px-3 py-3 text-sm font-medium ${l.mode === "edit" ? "bg-accent text-white" : "border border-line"}`}
                >
                  Reduce qty
                </button>
              </div>

              {(l.mode === "edit" || l.mode === "no") && (
                <div className="space-y-1 border-t border-line pt-2">
                  {l.mode === "edit" && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted">Final qty</label>
                      <input
                        type="number"
                        min={0}
                        max={l.original}
                        step="0.001"
                        className="w-28"
                        value={l.finalQty}
                        onChange={(e) => setFinalQty(l.productId, Number(e.target.value))}
                      />
                      <span className="text-sm text-muted">{l.unit}</span>
                    </div>
                  )}
                  <input
                    className="w-full"
                    placeholder="Reason (required) — e.g. customer asked for less"
                    value={l.reason}
                    onChange={(e) => setReason(l.productId, e.target.value)}
                  />
                </div>
              )}
              {blocked && <p className="text-sm text-bad">{blocked.detail}</p>}
            </div>
          );
        })}
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}

      <div className="fixed bottom-0 left-0 right-0 border-t border-line bg-paper p-3">
        <button className="btn-primary mx-auto block w-full max-w-2xl py-3 text-base" disabled={submitting || missingReason} onClick={submit}>
          {submitting ? "Completing…" : missingReason ? "Add a reason for every reduced item" : "Complete QC & Confirm Handover"}
        </button>
      </div>
    </div>
  );
}
