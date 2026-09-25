"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useShortcuts, getShortcutKey, FINANCE_SHORTCUTS } from "@/lib/shortcuts";
import { onFieldNavKeyDown, useEscapeKey } from "@/lib/keynav";
import { nextIndex, carryIndex } from "@/lib/dropdown-nav";
import { AddProductModal } from "@/components/AddProductModal";
import { useApiGet } from "@/lib/useApiGet";
import { describeHttpError } from "@/lib/http-error";
import { fmtDateTime } from "@/lib/fmt";
import type { BillingContext } from "@/app/api/customers/[id]/billing-context/route";
import { Highlight } from "@/components/Highlight";
import { barcodesForProduct } from "@/lib/barcode";
import { submitBill, printLocalBill, getLocalBill, lineMoney as moneyOf, moneyTotals, BillAlreadySentError, type BillDisplay, type LocalBill } from "@/lib/offline-bills";
import { LocalBillOverlay } from "@/components/LocalBillView";
import { ensureFreshCatalog, getCachedProducts, getCachedCustomers, searchProducts, rankProducts, searchCustomers, SEARCH_LIMIT, paintResults, type Painted, saveEntry, readEntry, clearEntry, ENTRY_KEYS } from "@/lib/offline-catalog";

type Customer = { id: string; shopName: string; mobile: string | null; type: "WHOLESALE" | "RETAIL"; ownerName?: string | null; address?: string | null; gstin?: string | null };
type Unit = { id: string; symbol: string };
type Product = {
  id: string;
  sku: string;
  name: string;
  wholesalePrice: string;
  retailPrice: string;
  taxPercent: string;
  barcode?: string | null;
  baseUnit: Unit | null;
  saleUnits: { unitId: string; isBaseUnit: boolean; isDefaultSaleUnit: boolean; factorToBase: string; wholesalePrice: string | null; retailPrice: string | null; barcode: string | null; unit: Unit | null }[];
  available: number | null;
  matchedUnitId?: string | null;
};
type Line = { product: Product; quantity: number; unitId: string; discount: number; unitPrice?: number };

const scrollToActive = (active: boolean) => (el: HTMLElement | null) => {
  if (active) el?.scrollIntoView({ block: "nearest" });
};

const unitSym = (u: Unit | null | undefined) => u?.symbol ?? "";

function defaultUnitOf(p: Product) {
  return p.saleUnits.find((u) => u.isDefaultSaleUnit) ?? p.saleUnits.find((u) => u.isBaseUnit) ?? p.saleUnits[0];
}

function baseQtyOf(l: Line) {
  const su = l.product.saleUnits.find((u) => u.unitId === l.unitId);
  return l.quantity * Number(su?.factorToBase ?? 1);
}

function baseQtyForProduct(lines: Line[], productId: string) {
  return lines.reduce((s, l) => (l.product.id === productId ? s + baseQtyOf(l) : s), 0);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const Key = ({ k }: { k: string }) => (
  <kbd className="rounded border border-line bg-paper px-1 font-mono text-[11px] text-ink">{k}</kbd>
);

const KEY_GUIDE: { title: string; keys: [string, string][] }[] = [
  {
    title: "Move around",
    keys: [["id:focus-customer", "customer search"], ["id:focus-product", "product search"], ["Enter", "next field"], ["Shift+Enter", "previous field"], ["Esc", "close / leave"], ["id:toggle-key-guide", "hide / show this panel"]],
  },
  {
    title: "Product search",
    keys: [["↑ ↓", "pick a result"], ["Enter", "add it, cursor to Qty"], ["Enter (empty)", "go to Generate Bill"]],
  },
  {
    title: "On a line",
    keys: [["↑ ↓", "line above / below"], ["Tab", "Qty → Unit → Price → Disc"], ["Enter", "Qty → Unit (opens list) → next product"], ["Alt+L", "customer's last rate"], ["Ctrl+Delete", "remove line"]],
  },
  {
    title: "Bill",
    keys: [["id:toggle-selling-mode", "wholesale / retail"], ["id:hold-new-bill", "hold, start new bill"], ["Alt+1…9", "open a held bill"], ["id:submit-order", "generate bill"]],
  },
];

function zoneOf(el: EventTarget): string {
  if (!(el instanceof HTMLElement)) return "Move around";
  if (el.closest("tbody")) return "On a line";
  if (el.getAttribute("placeholder")?.startsWith("Barcode")) return "Product search";
  if (el.closest("[data-guide='bill']")) return "Bill";
  return "Move around";
}

const WALK_IN = "CASH";

type SavedBasket = {
  details: { shopName: string; mobile: string; ownerName: string; address: string; gstin: string };
  customer: Customer | null;
  customerQuery: string;
  sellingMode: "WHOLESALE" | "RETAIL";
  lines: Line[];
  notes: string;
  unpaid?: boolean;
  requestId: string | null;
};

export default function BillingNewOrderPage() {
  const router = useRouter();
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [details, setDetails] = useState({ shopName: "", mobile: "", ownerName: WALK_IN, address: "", gstin: "" });
  const [showExtraCustomerDetails, setShowExtraCustomerDetails] = useState(false);

  const [sellingMode, setSellingMode] = useState<"WHOLESALE" | "RETAIL">("WHOLESALE");
  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState<Product[]>([]);
  const [customerIdx, setCustomerIdx] = useState(0);
  const [productIdx, setProductIdx] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [focusQtyIdx, setFocusQtyIdx] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [unpaid, setUnpaid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [allUnits, setAllUnits] = useState<(Unit & { name: string })[]>([]);
  const [unitForm, setUnitForm] = useState<{ idx: number; unitId: string; factor: string; price: string; makeDefault: boolean; error: string | null; saving: boolean } | null>(null);
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const { data: addProductSetting } = useApiGet<{ enabled: boolean }>("/api/settings/finance-add-products");
  const canAddProduct = addProductSetting?.enabled !== false;

  const submittingRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  function currentRequestId() {
    return (requestIdRef.current ??= crypto.randomUUID());
  }
  const productInputRef = useRef<HTMLInputElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const qtyRefs = useRef<(HTMLInputElement | null)[]>([]);
  const unitPickerOpenedRef = useRef(false);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const recovered = useRef(false);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [localBillId, setLocalBillId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ requestId: string; text: string } | null>(null);
  const alreadySaved = (b: LocalBill) => ({
    requestId: b.requestId,
    text: `This bill was already saved as ${b.server?.billNumber ?? b.offlineRef}${b.server?.billNumber ? ` (${b.offlineRef})` : ""} — changes to it go through Modify Bill.`,
  });

  useEffect(() => {
    const saved = readEntry<SavedBasket>(ENTRY_KEYS.newOrder);
    setHeld(readEntry<{ bills: SavedBasket[] }>(ENTRY_KEYS.heldBills)?.bills ?? []);
    if (!saved?.lines?.length) {
      recovered.current = true;
      return;
    }
    (saved.requestId ? getLocalBill(saved.requestId).catch(() => null) : Promise.resolve(null)).then((bill) => {
      recovered.current = true;
      if (bill && bill.state !== "attention") {
        clearEntry(ENTRY_KEYS.newOrder);
        setNotice(alreadySaved(bill));
        return;
      }
      loadBasket(saved);
      setRestoredAt(saved.savedAt);
      if (bill) setError(`Could not create the bill: ${bill.error ?? "refused by the server"}`);
    });
  }, []);

  useEffect(() => {
    if (!recovered.current) return;
    if (lines.length === 0) clearEntry(ENTRY_KEYS.newOrder);
    else saveEntry(ENTRY_KEYS.newOrder, snapshot());
  }, [details, customer, customerQuery, sellingMode, lines, notes, unpaid]);

  const [held, setHeld] = useState<SavedBasket[]>([]);
  useEffect(() => {
    if (!recovered.current) return;
    if (held.length === 0) clearEntry(ENTRY_KEYS.heldBills);
    else saveEntry(ENTRY_KEYS.heldBills, { bills: held });
  }, [held]);

  function snapshot(): SavedBasket {
    return { details, customer, customerQuery, sellingMode, lines, notes, unpaid, requestId: requestIdRef.current };
  }

  function loadBasket(b: SavedBasket | null) {
    setDetails(b?.details ?? { shopName: "", mobile: "", ownerName: WALK_IN, address: "", gstin: "" });
    setCustomer(b?.customer ?? null);
    setCustomerQuery(b?.customerQuery ?? "");
    setSellingMode(b?.sellingMode ?? "WHOLESALE");
    setLines(b?.lines ?? []);
    setNotes(b?.notes ?? "");
    setUnpaid(b?.unpaid ?? false);
    requestIdRef.current = b?.requestId ?? null;
    setProductQuery("");
    setRestoredAt(null);
    setError(null);
  }

  const isBlank = () => lines.length === 0 && !customer;

  function holdAndStartNew() {
    if (isBlank()) return customerInputRef.current?.focus();
    setHeld((h) => [...h, snapshot()]);
    loadBasket(null);
    customerInputRef.current?.focus();
  }

  function switchToHeld(i: number) {
    const target = held[i];
    if (!target) return;
    setHeld((h) => (isBlank() ? h.filter((_, j) => j !== i) : h.map((b, j) => (j === i ? snapshot() : b))));
    loadBasket(target);
    productInputRef.current?.focus();
  }

  const billLabel = (b: Pick<SavedBasket, "details" | "lines">) =>
    `${b.details.shopName.trim() || b.details.ownerName.trim() || WALK_IN} · ${b.lines.length} ${b.lines.length === 1 ? "item" : "items"}`;

  const [ctx, setCtx] = useState<BillingContext | null>(null);
  useEffect(() => {
    setCtx(null);
    if (!customer || !customer.id || customer.id.startsWith("new-")) return;
    const ac = new AbortController();
    fetch(`/api/customers/${customer.id}/billing-context`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && typeof d === "object" && Array.isArray(d.lastRates) && setCtx(d))
      .catch(() => {});
    return () => ac.abort();
  }, [customer?.id]);

  function lastRateFor(l: Line) {
    return ctx?.lastRates.find((r) => r.productId === l.product.id && r.unitId === l.unitId);
  }

  const [cachedProducts, setCachedProducts] = useState<Awaited<ReturnType<typeof getCachedProducts>>>([]);
  const [cachedCustomers, setCachedCustomers] = useState<Awaited<ReturnType<typeof getCachedCustomers>>>([]);
  useEffect(() => {
    let live = true;
    const read = () => {
      if (!live) return;
      getCachedProducts().then(setCachedProducts).catch(() => {});
      getCachedCustomers().then(setCachedCustomers).catch(() => {});
    };
    ensureFreshCatalog(read).then(read).catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const paintedCustomers = useRef<Painted<Customer>>({ q: "", rows: [] });
  const paintedProducts = useRef<Painted<Product>>({ q: "", rows: [] });
  function paintCustomers(q: string, rows: Customer[], fromCache = false) {
    paintedCustomers.current = paintResults(paintedCustomers.current, q, rows, fromCache);
    setCustomerResults(paintedCustomers.current.rows);
  }
  function paintProducts(q: string, rows: Product[], fromCache = false) {
    paintedProducts.current = paintResults(paintedProducts.current, q, rows, fromCache);
    setProductResults(paintedProducts.current.rows);
  }

  useEffect(() => {
    if (!customerQuery.trim() || customer) {
      paintedCustomers.current = { q: "", rows: [] };
      return setCustomerResults([]);
    }
    paintCustomers(customerQuery, searchCustomers(cachedCustomers, customerQuery) as Customer[], true);
    const ac = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/customers?q=${encodeURIComponent(customerQuery)}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => Array.isArray(d) && paintCustomers(customerQuery, d))
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [customerQuery, customer, cachedCustomers]);

  const shownCustomers = useRef<Customer[]>([]);
  const shownProducts = useRef<Product[]>([]);
  useEffect(() => {
    setCustomerIdx((i) => Math.max(0, carryIndex(shownCustomers.current, i, customerResults)));
    shownCustomers.current = customerResults;
  }, [customerResults]);
  useEffect(() => {
    setProductIdx((i) => carryIndex(shownProducts.current, i, productResults));
    shownProducts.current = productResults;
  }, [productResults]);

  useEffect(() => {
    if (!productQuery.trim()) {
      paintedProducts.current = { q: "", rows: [] };
      return setProductResults([]);
    }
    paintProducts(productQuery, searchProducts(cachedProducts, productQuery).map((p) => ({ ...p, available: null })) as Product[], true);
    const ac = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/products?q=${encodeURIComponent(productQuery)}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => Array.isArray(d) && paintProducts(productQuery, rankProducts(d as Product[], productQuery)))
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [productQuery, cachedProducts]);

  function selectCustomer(c: Customer) {
    setCustomer(c);
    setCustomerResults([]);
    setCustomerQuery(c.shopName);
    setDetails({
      shopName: c.shopName,
      mobile: c.mobile ?? "",
      ownerName: c.ownerName ?? c.shopName,
      address: c.address ?? "",
      gstin: c.gstin ?? "",
    });
    if (c.type) setSellingMode(c.type);
    productInputRef.current?.focus();
  }

  function customerPayload() {
    if (customer && !customer.id.startsWith("new-")) {
      return {
        id: customer.id,
        ownerName: customer.ownerName || customer.shopName || WALK_IN,
        shopName: customer.shopName || undefined,
        mobile: details.mobile || customer.mobile || undefined,
        type: customer.type || sellingMode,
        address: details.address || customer.address || undefined,
        gstin: details.gstin || customer.gstin || undefined,
      };
    }
    const finalName = (customer?.shopName || details.shopName || customerQuery).trim();
    const ownerName = finalName || WALK_IN;
    return {
      ownerName,
      shopName: finalName || undefined,
      mobile: details.mobile.trim() || undefined,
      type: sellingMode,
      address: details.address.trim() || undefined,
      gstin: details.gstin.trim() || undefined,
    };
  }

  function priceFor(p: Product, unitId?: string) {
    const su = unitId ? p.saleUnits.find((u) => u.unitId === unitId) : defaultUnitOf(p);
    const own = sellingMode === "WHOLESALE" ? su?.wholesalePrice : su?.retailPrice;
    if (own != null && Number(own) > 0) return Number(own);
    const base = Number(sellingMode === "WHOLESALE" ? p.wholesalePrice : p.retailPrice);
    return base * Number(su?.factorToBase ?? 1);
  }

  function addProduct(p: Product) {
    const scanned = p.matchedUnitId ? p.saleUnits.find((u) => u.unitId === p.matchedUnitId) : undefined;
    const chosen = scanned ?? defaultUnitOf(p);
    if (!chosen) {
      setError(`${p.name} has no sale unit set up — a manager needs to add one before it can be billed`);
      return;
    }
    const wasScan = barcodesForProduct(p).includes(productQuery.trim());
    const existingIdx = lines.findIndex((l) => l.product.id === p.id && l.unitId === chosen.unitId);
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === p.id && l.unitId === chosen.unitId);
      if (existing) {
        return prev.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { product: p, quantity: 1, unitId: chosen.unitId, discount: 0 }];
    });
    if (!wasScan) setFocusQtyIdx(existingIdx >= 0 ? existingIdx : lines.length);
    setProductQuery("");
    setProductResults([]);
  }

  useEffect(() => {
    if (focusQtyIdx == null) return;
    const el = qtyRefs.current[focusQtyIdx];
    el?.focus();
    el?.select();
    setFocusQtyIdx(null);
  }, [focusQtyIdx]);

  function onLineKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>, idx: number) {
    const el = e.target as HTMLElement;
    if (e.key === "Delete" && e.ctrlKey) {
      e.preventDefault();
      return removeLine(idx);
    }
    if (e.altKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      const last = lastRateFor(lines[idx]!);
      if (last) updateLine(idx, { unitPrice: last.unitPrice });
      return;
    }
    const col = el.dataset.col;
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && col && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const row = e.key === "ArrowUp" ? e.currentTarget.previousElementSibling : e.currentTarget.nextElementSibling;
      const target = row?.querySelector<HTMLInputElement>(`[data-col="${col}"]`);
      if (target) target.focus();
      else if (e.key === "ArrowUp") productInputRef.current?.focus();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    if (el.tagName === "BUTTON") return;
    e.preventDefault();
    const unitSelect = e.currentTarget.querySelector<HTMLSelectElement>("select[data-unit]");
    if (col === "qty" && unitSelect && lines[idx]!.product.saleUnits.length > 1) return unitSelect.focus();
    if (el === unitSelect && !unitPickerOpenedRef.current) {
      unitPickerOpenedRef.current = true;
      try {
        unitSelect.showPicker();
        return;
      } catch {}
    }
    productInputRef.current?.focus();
  }

  function onProductKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !productQuery.trim()) {
      e.preventDefault();
      submitButtonRef.current?.focus();
      return;
    }
    if (productResults.length === 0 && !(canAddProduct && productQuery.trim())) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setProductIdx(nextIndex(productResults.length + (canAddProduct ? 1 : 0), productIdx, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setProductIdx(nextIndex(productResults.length + (canAddProduct ? 1 : 0), productIdx, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (canAddProduct && productIdx === productResults.length) {
        if (allUnits.length === 0) {
          fetch("/api/admin/units")
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => Array.isArray(d) && setAllUnits(d))
            .catch(() => {});
        }
        setShowAddProductModal(true);
      } else {
        const p = productResults[productIdx];
        if (p) addProduct(p);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setProductResults([]);
    }
  }

  function onCustomerKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !customerQuery.trim()) {
      e.preventDefault();
      setCustomer(null);
      setDetails({ shopName: "", mobile: "", ownerName: WALK_IN, address: "", gstin: "" });
      setCustomerResults([]);
      productInputRef.current?.focus();
      return;
    }

    if (e.key === "ArrowDown" && customerResults.length > 0) {
      e.preventDefault();
      setCustomerIdx(nextIndex(customerResults.length, customerIdx, 1));
      return;
    } else if (e.key === "ArrowUp" && customerResults.length > 0) {
      e.preventDefault();
      setCustomerIdx(nextIndex(customerResults.length, customerIdx, -1));
      return;
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (customerResults.length > 0 && customerResults[customerIdx]) {
        selectCustomer(customerResults[customerIdx]);
      } else {
        const trimmed = customerQuery.trim();
        const isNum = /^\d+$/.test(trimmed);
        const newCust: Customer = {
          id: `new-${Date.now()}`,
          shopName: isNum ? `Customer ${trimmed}` : trimmed,
          ownerName: isNum ? `Customer ${trimmed}` : trimmed,
          mobile: isNum ? trimmed : (details.mobile || null),
          address: details.address || null,
          gstin: details.gstin || null,
          type: sellingMode,
        };
        setCustomer(newCust);
        setDetails({
          shopName: newCust.shopName,
          ownerName: newCust.ownerName ?? newCust.shopName,
          mobile: newCust.mobile ?? "",
          address: newCust.address ?? "",
          gstin: newCust.gstin ?? "",
        });
        setCustomerResults([]);
        productInputRef.current?.focus();
      }
      return;
    } else if (e.key === "Escape") {
      e.preventDefault();
      setCustomerResults([]);
    }
  }

  function openUnitForm(idx: number) {
    setUnitForm({ idx, unitId: "", factor: "", price: "", makeDefault: false, error: null, saving: false });
    if (allUnits.length === 0) {
      fetch("/api/admin/units")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => Array.isArray(d) && setAllUnits(d))
        .catch(() => {});
    }
  }

  async function saveUnit() {
    const f = unitForm;
    if (!f) return;
    const line = lines[f.idx];
    const picked = allUnits.find((u) => u.id === f.unitId);
    const factor = Number(f.factor);
    if (!line || !picked || !(factor > 0)) return setUnitForm({ ...f, error: "Pick a unit and enter how many base units it holds" });
    const rate = f.price.trim() ? Number(f.price) : null;
    const wholesalePrice = sellingMode === "WHOLESALE" ? rate : null;
    const retailPrice = sellingMode === "RETAIL" ? rate : null;
    setUnitForm({ ...f, error: null, saving: true });
    const res = await fetch(`/api/admin/products/${line.product.id}/units`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unitId: f.unitId, factorToBase: factor, isDefaultSaleUnit: f.makeDefault, wholesalePrice, retailPrice }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setUnitForm({ ...f, saving: false, error: typeof body.error === "string" ? body.error : "Could not add the unit" });
      return;
    }
    const added = {
      unitId: picked.id,
      isBaseUnit: false,
      isDefaultSaleUnit: f.makeDefault,
      factorToBase: String(factor),
      wholesalePrice: wholesalePrice == null ? null : String(wholesalePrice),
      retailPrice: retailPrice == null ? null : String(retailPrice),
      barcode: null,
      unit: picked,
    };
    setLines((prev) => {
      const product: Product = {
        ...line.product,
        saleUnits: [...line.product.saleUnits.map((su) => (f.makeDefault ? { ...su, isDefaultSaleUnit: false } : su)), added],
      };
      return prev.map((l, i) =>
        l.product.id === product.id
          ? { ...l, product, ...(i === f.idx ? { unitId: added.unitId, unitPrice: undefined } : {}) }
          : l
      );
    });
    setUnitForm(null);
  }

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        const unitChanged = patch.unitId !== undefined && patch.unitId !== l.unitId;
        return { ...l, ...patch, ...(unitChanged && patch.unitPrice === undefined ? { unitPrice: undefined } : {}) };
      })
    );
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
    if (idx < lines.length - 1) setFocusQtyIdx(idx);
    else productInputRef.current?.focus();
  }

  function rateFor(l: Line) {
    return l.unitPrice ?? priceFor(l.product, l.unitId);
  }

  function lineMoney(l: Line) {
    return moneyOf({ quantity: l.quantity, unitPrice: rateFor(l), discount: l.discount, taxPercent: Number(l.product.taxPercent) });
  }

  const zeroLines = lines.filter((l) => !(l.quantity > 0) || !(rateFor(l) > 0));
  const shortLines = lines.filter((l) => l.product.available != null && baseQtyForProduct(lines, l.product.id) > l.product.available);

  const money = lines.map(lineMoney);
  const { subtotal, discountTotal, taxTotal, total } = moneyTotals(money);
  const overLimitBy = ctx?.creditLimit != null ? round2(ctx.outstanding + total - ctx.creditLimit) : 0;

  function billed() {
    requestIdRef.current = null;
    clearEntry(ENTRY_KEYS.newOrder);
  }

  async function submit() {
    if (submittingRef.current) return;
    if (lines.length === 0) {
      setError("Add at least one product");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    const cust = customerPayload();
    const payload = {
      customer: cust,
      sellingMode,
      notes: notes || undefined,
      ...(unpaid ? { unpaid: true } : {}),
      items: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity, unitId: l.unitId, discount: l.discount, unitPrice: rateFor(l) })),
    };
    const display: BillDisplay = {
      customerName: cust.ownerName,
      customerMobile: cust.mobile ?? null,
      sellingMode,
      notes: notes.trim() || null,
      lines: lines.map((l, i) => ({
        productId: l.product.id,
        unitId: l.unitId,
        name: l.product.name,
        unit: unitSym(l.product.saleUnits.find((u) => u.unitId === l.unitId)?.unit),
        quantity: l.quantity,
        unitPrice: rateFor(l),
        discount: l.discount,
        lineTotal: money[i]!.total,
      })),
      subtotal,
      discountTotal,
      taxTotal,
      total,
    };
    const requestId = currentRequestId();
    saveEntry(ENTRY_KEYS.newOrder, snapshot());
    const bill = await submitBill({ requestId, payload, display }).catch((err: unknown) => {
      if (err instanceof BillAlreadySentError) {
        billed();
        loadBasket(null);
        setNotice({ requestId: err.bill.requestId, text: err.message });
      } else setError(`Could not save the bill on this PC: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });
    submittingRef.current = false;
    setSubmitting(false);
    if (!bill) return;
    if (bill.state === "attention") {
      setError(`Could not create the bill: ${bill.error ?? "refused by the server"}`);
      return;
    }
    billed();
    await printLocalBill(bill).catch((err: unknown) => setError(`Could not print the slip: ${err instanceof Error ? err.message : String(err)} — reprint it from the bill.`));
    loadBasket(null);
    setLocalBillId(bill.requestId);
  }

  function closeLocalBill() {
    setLocalBillId(null);
    customerInputRef.current?.focus();
  }

  async function saveDraft() {
    if (submittingRef.current) return;
    if (lines.length === 0) {
      setError("Add at least one product");
      return;
    }
    if (!navigator.onLine) {
      setError("Save as Draft needs the internet. Generate Bill works offline.");
      return;
    }
    if (requestIdRef.current && (await getLocalBill(requestIdRef.current).catch(() => null))) {
      setError("This bill is already saved on this PC — fix it and press Generate Bill.");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/finance/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: customerPayload(),
        sellingMode,
        notes: notes || undefined,
        items: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity, unitId: l.unitId, discount: l.discount, unitPrice: l.unitPrice })),
        draft: true,
        clientRequestId: currentRequestId(),
      }),
    }).catch(() => null);
    submittingRef.current = false;
    setSubmitting(false);
    if (!res) {
      setError("Could not save the draft: no connection to the server. Generate Bill works offline.");
      return;
    }
    if (!res.ok) {
      setError(`Could not save the draft: ${await describeHttpError(res)}`);
      return;
    }
    const body = await res.json();
    if (body.duplicate || !body.order) {
      billed();
      router.push("/billing/orders");
      return;
    }
    billed();
    router.push(`/billing/orders/${body.order.id}`);
  }

  useEscapeKey(() => {
    if (localBillId) return;
    if (showAddProductModal) return closeAddProductModal();
    if (unitForm) return setUnitForm(null);
    if (confirmDiscard) return setConfirmDiscard(false);
    if (productResults.length) return setProductResults([]);
    if (customerResults.length) return setCustomerResults([]);
    if (lines.length > 0) return setConfirmDiscard(true);
    router.push("/billing");
  });

  useShortcuts({
    "focus-customer": () => {
      if (customer) {
        setCustomer(null);
        setCustomerQuery("");
        setDetails({ shopName: "", mobile: "", ownerName: WALK_IN, address: "", gstin: "" });
      }
      customerInputRef.current?.focus();
    },
    "focus-product": () => productInputRef.current?.focus(),
    "submit-order": () => {
      if (!submitting && !showAddProductModal && !confirmDiscard && !localBillId) submit();
    },
    "toggle-selling-mode": () => setSellingMode((m) => (m === "WHOLESALE" ? "RETAIL" : "WHOLESALE")),
    "hold-new-bill": holdAndStartNew,
    "toggle-key-guide": () => toggleGuide(),
    "nav-new-order": () => {
      setLocalBillId(null);
      holdAndStartNew();
    },
  });

  const [remapped, setRemapped] = useState<Record<string, string>>({});
  useEffect(() => setRemapped(Object.fromEntries(FINANCE_SHORTCUTS.map((s) => [s.id, getShortcutKey(s.id)]))), []);
  const [guideZone, setGuideZone] = useState("Move around");
  const GUIDE_HIDDEN_KEY = "new-order:key-guide-hidden";
  const [guideHidden, setGuideHidden] = useState(false);
  useEffect(() => {
    try {
      setGuideHidden(localStorage.getItem(GUIDE_HIDDEN_KEY) === "1");
    } catch {}
  }, []);
  function toggleGuide() {
    setGuideHidden((h) => {
      try {
        localStorage.setItem(GUIDE_HIDDEN_KEY, h ? "0" : "1");
      } catch {}
      return !h;
    });
  }
  const keyFor = (id: string) => remapped[id] ?? FINANCE_SHORTCUTS.find((s) => s.id === id)?.defaultKey ?? "";

  function closeAddProductModal() {
    setShowAddProductModal(false);
    productInputRef.current?.focus();
  }

  return (
    <div className={`mx-auto grid items-start gap-3 ${guideHidden ? "max-w-4xl" : "max-w-6xl lg:grid-cols-[minmax(0,1fr)_15rem]"}`}>
    <div
      className="space-y-3"
      ref={formRef}
      onKeyDown={(e) => {
        if (e.altKey && !e.ctrlKey && /^[1-9]$/.test(e.key)) {
          e.preventDefault();
          return switchToHeld(Number(e.key) - 1);
        }
        onFieldNavKeyDown(e, formRef.current);
      }}
      onFocus={(e) => setGuideZone(zoneOf(e.target))}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">New Bill</h1>
        {held.map((b, i) => (
          <button key={i} type="button" tabIndex={-1} className="btn text-xs" onClick={() => switchToHeld(i)} title="Swap this bill in; the one on screen is held in its place">
            Held {i + 1}: {billLabel(b)} (Alt+{i + 1})
          </button>
        ))}
        <button type="button" tabIndex={-1} className="btn text-xs" onClick={holdAndStartNew}>
          Hold &amp; new bill ({keyFor("hold-new-bill")})
        </button>
        {guideHidden && (
          <button type="button" tabIndex={-1} className="btn text-xs" onClick={toggleGuide}>
            Show shortcuts ({keyFor("toggle-key-guide")})
          </button>
        )}
      </div>

      {notice && (
        <p className="flex items-center justify-between gap-2 border border-bad bg-paper p-2 text-sm" role="alert">
          <span>{notice.text}</span>
          <span className="flex gap-2">
            <button className="btn text-xs" onClick={() => setLocalBillId(notice.requestId)}>
              Open it
            </button>
            <button className="btn text-xs" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </span>
        </p>
      )}

      {restoredAt != null && lines.length > 0 && (
        <p className="flex items-center justify-between gap-2 border border-line bg-paper p-2 text-sm">
          <span>
            Picked up where you left off — {lines.length} {lines.length === 1 ? "product" : "products"} from{" "}
            {fmtDateTime(new Date(restoredAt).toISOString())}. Nothing has been billed yet.
          </span>
          <button className="btn text-xs" onClick={() => { setLines([]); setNotes(""); billed(); setRestoredAt(null); }}>
            Start a fresh bill
          </button>
        </p>
      )}

      {/* Customer Single Unified Bar & Inline Details */}
      {customer ? (
        <div className="card relative border-accent/40 bg-accent/5 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-surface font-bold text-xs">
                {customer.shopName.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-ink">{customer.shopName}</span>
                  <span className="badge bg-ink text-surface text-[10px]">{customer.type}</span>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted">
                  {details.mobile && <span>📞 {details.mobile}</span>}
                  {details.address && <span>📍 {details.address}</span>}
                  {details.gstin && <span>🏛️ GSTIN: {details.gstin}</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn text-xs font-semibold hover:bg-surface-hi"
                onClick={() => setShowExtraCustomerDetails((v) => !v)}
              >
                {showExtraCustomerDetails ? "Hide Details" : "Edit / Extra Details"}
              </button>
              <button
                type="button"
                className="btn text-xs font-semibold hover:bg-surface-hi"
                onClick={() => {
                  setCustomer(null);
                  setCustomerQuery("");
                  setDetails({ shopName: "", mobile: "", ownerName: WALK_IN, address: "", gstin: "" });
                  setTimeout(() => customerInputRef.current?.focus(), 50);
                }}
              >
                Change (F3)
              </button>
              <button
                type="button"
                className="btn text-xs text-muted hover:text-bad"
                onClick={() => {
                  setCustomer(null);
                  setCustomerQuery("");
                  setDetails({ shopName: "", mobile: "", ownerName: WALK_IN, address: "", gstin: "" });
                  setTimeout(() => productInputRef.current?.focus(), 50);
                }}
                title="Switch to Walk-in Cash"
              >
                ✕ Switch to Cash
              </button>
            </div>
          </div>

          {showExtraCustomerDetails && (
            <div className="grid grid-cols-1 gap-2 border-t border-line/60 pt-2 sm:grid-cols-3 text-xs">
              <div>
                <label className="mb-1 block font-semibold text-muted">Mobile Number</label>
                <input
                  className="w-full"
                  inputMode="numeric"
                  placeholder="10-digit mobile"
                  value={details.mobile}
                  onChange={(e) => setDetails({ ...details, mobile: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-muted">Address</label>
                <input
                  className="w-full"
                  placeholder="City / location"
                  value={details.address}
                  onChange={(e) => setDetails({ ...details, address: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-muted">GSTIN</label>
                <input
                  className="w-full uppercase"
                  placeholder="22AAAAA0000A1Z5"
                  value={details.gstin}
                  onChange={(e) => setDetails({ ...details, gstin: e.target.value.toUpperCase() })}
                />
              </div>
            </div>
          )}

          {ctx && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line/60 pt-2 text-xs text-muted">
              <span className={ctx.outstanding > 0 ? "font-semibold text-bad" : "text-muted"}>
                {ctx.outstanding > 0 ? `Owes ₹${ctx.outstanding.toFixed(2)}` : "Nothing due"}
              </span>
              {ctx.creditLimit != null && (
                <span className={overLimitBy > 0 ? "font-semibold text-bad" : "text-muted"}>
                  Limit ₹{ctx.creditLimit.toFixed(2)}
                  {overLimitBy > 0 ? ` — over by ₹${overLimitBy.toFixed(2)}` : ` — ₹${Math.max(0, ctx.creditLimit - ctx.outstanding).toFixed(2)} left`}
                </span>
              )}
              {ctx.lastBill && (
                <span>
                  Last bill {ctx.lastBill.orderNumber}: ₹{Number(ctx.lastBill.total).toFixed(2)}
                  {Number(ctx.lastBill.paid) >= Number(ctx.lastBill.total) ? " paid" : `, ₹${(Number(ctx.lastBill.total) - Number(ctx.lastBill.paid)).toFixed(2)} unpaid`}, {fmtDateTime(ctx.lastBill.at)}
                </span>
              )}
              {ctx.lastPayment && (
                <span>
                  Last paid ₹{Number(ctx.lastPayment.amount).toFixed(2)} {ctx.lastPayment.method}, {fmtDateTime(ctx.lastPayment.at)}
                </span>
              )}
              {ctx.lastRates.length > 0 && <span className="italic">Alt+L on any line to reuse their last rate</span>}
            </div>
          )}
        </div>
      ) : (
        <div className="card relative space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-muted">
              Customer (F3) — Search Existing or Type New Name / Mobile
            </label>
            <button
              type="button"
              className="text-xs text-accent hover:underline"
              onClick={() => setShowExtraCustomerDetails((v) => !v)}
            >
              {showExtraCustomerDetails ? "Hide Extra Fields" : "+ Optional Details (Phone/GSTIN)"}
            </button>
          </div>
          <div className="flex gap-2">
            <input
              ref={customerInputRef}
              className="flex-1 text-sm font-medium"
              autoFocus
              placeholder="Type customer/shop name or mobile (press Enter to pick or start Cash sale)…"
              value={customerQuery}
              onChange={(e) => setCustomerQuery(e.target.value)}
              onKeyDown={onCustomerKeyDown}
            />
          </div>

          {showExtraCustomerDetails && (
            <div className="grid grid-cols-1 gap-2 border-t border-line pt-2 sm:grid-cols-3 text-xs">
              <div>
                <label className="mb-1 block font-semibold text-muted">Mobile Number</label>
                <input
                  className="w-full"
                  inputMode="numeric"
                  placeholder="10-digit number"
                  value={details.mobile}
                  onChange={(e) => setDetails({ ...details, mobile: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-muted">Address</label>
                <input
                  className="w-full"
                  placeholder="Area / city"
                  value={details.address}
                  onChange={(e) => setDetails({ ...details, address: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-muted">GSTIN</label>
                <input
                  className="w-full uppercase"
                  placeholder="Optional"
                  value={details.gstin}
                  onChange={(e) => setDetails({ ...details, gstin: e.target.value.toUpperCase() })}
                />
              </div>
            </div>
          )}

          {customerResults.length > 0 && (
            <div role="listbox" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded border border-line bg-paper shadow-lg">
              {customerResults.map((c, i) => (
                <button
                  key={c.id}
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === customerIdx}
                  ref={scrollToActive(i === customerIdx)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-hi ${
                    i === customerIdx ? "bg-accent/10 font-medium ring-1 ring-inset ring-accent" : ""
                  }`}
                  onClick={() => selectCustomer(c)}
                >
                  <div>
                    <span className="font-semibold"><Highlight text={c.shopName} q={customerQuery} /></span>
                    {c.mobile && <span className="text-xs text-muted"> · 📞 <Highlight text={c.mobile} q={customerQuery} /></span>}
                  </div>
                  <span className="badge text-[10px] bg-surface-hi text-muted">{c.type}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Product search */}
      <div className="card relative">
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs text-muted">Product (F5) — name, SKU or scan barcode</label>
          <div className="flex gap-1 text-xs" data-guide="bill">
            <button
              type="button"
              className={`rounded px-2 py-0.5 ${sellingMode === "WHOLESALE" ? "bg-ink text-surface" : "bg-surface-hi"}`}
              onClick={() => setSellingMode("WHOLESALE")}
            >
              Wholesale
            </button>
            <button
              type="button"
              className={`rounded px-2 py-0.5 ${sellingMode === "RETAIL" ? "bg-ink text-surface" : "bg-surface-hi"}`}
              onClick={() => setSellingMode("RETAIL")}
            >
              Retail
            </button>
            <span className="text-muted">({keyFor("toggle-selling-mode")})</span>
          </div>
        </div>
        <input
          ref={productInputRef}
          className="w-full"
          placeholder="Barcode scan or type name/SKU…"
          value={productQuery}
          onChange={(e) => setProductQuery(e.target.value)}
          onKeyDown={onProductKeyDown}
        />
        {(productResults.length > 0 || (canAddProduct && productQuery.trim())) && (
          <div role="listbox" className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto border border-line bg-paper">
            {productResults.map((p, i) => {
              const defUnit = defaultUnitOf(p);
              const outOfStock = p.available != null && p.available <= 0;
              const lowStock = p.available != null && p.available > 0 && p.available <= 5;
              return (
                <button
                  key={p.id}
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === productIdx}
                  ref={scrollToActive(i === productIdx)}
                  className={`flex w-full items-center justify-between px-2 py-1 text-left text-sm hover:bg-surface-hi ${
                    i === productIdx ? "bg-accent/10 font-medium ring-1 ring-inset ring-accent" : ""
                  }`}
                  onClick={() => addProduct(p)}
                >
                  <span>
                    <Highlight text={p.name} q={productQuery} />{" "}
                    <span className="text-xs text-muted">
                      (<Highlight text={p.sku} q={productQuery} />
                      {p.barcode ? <> · <Highlight text={p.barcode} q={productQuery} /></> : ""})
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    {p.available != null && (
                      <span className={outOfStock ? "text-bad font-semibold" : lowStock ? "text-warn" : "text-muted"}>
                        {outOfStock ? "0 in stock" : `${p.available} ${unitSym(p.baseUnit)}`}
                      </span>
                    )}
                    <span className="font-semibold">
                      ₹{priceFor(p).toFixed(2)}
                      {defUnit ? `/${unitSym(defUnit.unit)}` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
            {canAddProduct && productQuery.trim() && (
              <button
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={productIdx === productResults.length}
                ref={scrollToActive(productIdx === productResults.length)}
                className={`flex w-full items-center justify-between border-t border-line px-2 py-1.5 text-left text-sm text-accent hover:bg-surface-hi ${
                  productIdx === productResults.length ? "bg-accent/10 font-medium ring-1 ring-inset ring-accent" : ""
                }`}
                onClick={() => {
                  if (allUnits.length === 0) {
                    fetch("/api/admin/units")
                      .then((r) => (r.ok ? r.json() : null))
                      .then((d) => Array.isArray(d) && setAllUnits(d))
                      .catch(() => {});
                  }
                  setShowAddProductModal(true);
                }}
              >
                <span>+ Add &ldquo;{productQuery.trim()}&rdquo; to catalogue…</span>
                <span className="text-xs text-muted">Creates product &amp; adds to bill</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bill items table */}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="p-2">#</th>
              <th className="p-2">Product</th>
              <th className="p-2 w-24">Qty</th>
              <th className="p-2 w-32">Unit</th>
              <th className="p-2 w-24">Price (₹)</th>
              <th className="p-2 w-20">Disc (%)</th>
              <th className="p-2 text-right">Total (₹)</th>
              <th className="p-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={8} className="p-4 text-center text-xs text-muted">
                  No items added yet. Type or scan a product above.
                </td>
              </tr>
            )}
            {lines.map((l, i) => {
              const rowTotal = money[i]!;
              const last = lastRateFor(l);
              const isOverridden = l.unitPrice !== undefined;
              return (
                <tr
                  key={`${l.product.id}-${l.unitId}-${i}`}
                  className="border-b border-line hover:bg-surface-hi"
                  onKeyDown={(e) => onLineKeyDown(e, i)}
                >
                  <td className="p-2 text-xs text-muted">{i + 1}</td>
                  <td className="p-2">
                    <div className="font-medium">{l.product.name}</div>
                    <div className="text-[11px] text-muted">{l.product.sku}</div>
                  </td>
                  <td className="p-2">
                    <input
                      ref={(el) => { qtyRefs.current[i] = el; }}
                      data-col="qty"
                      type="number"
                      min="0.001"
                      step="any"
                      className="w-20"
                      value={l.quantity || ""}
                      onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                    />
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-1">
                      <select
                        data-unit
                        className="w-24"
                        value={l.unitId}
                        onChange={(e) => updateLine(i, { unitId: e.target.value })}
                      >
                        {l.product.saleUnits.map((su) => (
                          <option key={su.unitId} value={su.unitId}>
                            {unitSym(su.unit)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        tabIndex={-1}
                        className="text-xs text-accent hover:underline"
                        onClick={() => openUnitForm(i)}
                        title="Add missing unit packaging"
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="p-2">
                    <input
                      data-col="price"
                      type="number"
                      min="0"
                      step="any"
                      className={`w-24 ${isOverridden ? "border-accent font-semibold" : ""}`}
                      value={l.unitPrice ?? priceFor(l.product, l.unitId)}
                      onChange={(e) => updateLine(i, { unitPrice: e.target.value === "" ? undefined : Number(e.target.value) })}
                      title={isOverridden ? "Custom price applied" : "Catalogue price"}
                    />
                    {last && !isOverridden && (
                      <div className="text-[10px] text-muted cursor-pointer" onClick={() => updateLine(i, { unitPrice: last.unitPrice })}>
                        Last: ₹{last.unitPrice.toFixed(2)}
                      </div>
                    )}
                  </td>
                  <td className="p-2">
                    <input
                      data-col="disc"
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      className="w-16"
                      value={l.discount || ""}
                      onChange={(e) => updateLine(i, { discount: Number(e.target.value) })}
                    />
                  </td>
                  <td className="p-2 text-right font-medium">₹{rowTotal.total.toFixed(2)}</td>
                  <td className="p-2 text-center">
                    <button
                      type="button"
                      className="text-muted hover:text-bad"
                      onClick={() => removeLine(i)}
                      title="Remove line (Ctrl+Delete)"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Unit Form Modal */}
      {unitForm && (
        <div className="card space-y-2 border-accent bg-accent/5">
          <div className="text-xs font-semibold">Add new packaging unit for {lines[unitForm.idx]?.product.name}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <select
              value={unitForm.unitId}
              onChange={(e) => setUnitForm({ ...unitForm, unitId: e.target.value })}
            >
              <option value="">Select Unit</option>
              {allUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.symbol})
                </option>
              ))}
            </select>
            <input
              placeholder="Conversion factor (e.g. 10)"
              type="number"
              value={unitForm.factor}
              onChange={(e) => setUnitForm({ ...unitForm, factor: e.target.value })}
            />
            <input
              placeholder="Custom rate (optional)"
              type="number"
              value={unitForm.price}
              onChange={(e) => setUnitForm({ ...unitForm, price: e.target.value })}
            />
            <div className="flex items-center gap-2">
              <button className="btn btn-primary text-xs" disabled={unitForm.saving} onClick={saveUnit}>
                {unitForm.saving ? "Saving…" : "Save Unit"}
              </button>
              <button className="btn text-xs" onClick={() => setUnitForm(null)}>
                Cancel
              </button>
            </div>
          </div>
          {unitForm.error && <div className="text-xs text-bad">{unitForm.error}</div>}
        </div>
      )}

      {/* Summary and Actions */}
      <div className="card space-y-3" data-guide="bill">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <div className="text-xs text-muted">Subtotal</div>
            <div className="text-base font-semibold">₹{subtotal.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Discount</div>
            <div className="text-base font-semibold text-warn">-₹{discountTotal.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">GST Tax</div>
            <div className="text-base font-semibold">₹{taxTotal.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Grand Total</div>
            <div className="text-2xl font-bold text-good">₹{total.toFixed(2)}</div>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-muted">Order Notes / Remark</label>
          <input
            className="w-full"
            placeholder="Special instructions or delivery details…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {overLimitBy > 0 && (
          <div className="text-xs text-bad font-semibold">
            ⚠️ Bill exceeds customer credit limit by ₹{overLimitBy.toFixed(2)}
          </div>
        )}

        {shortLines.length > 0 && (
          <p className="text-xs text-warn">
            ⚠️ Billing more than available stock for {[...new Set(shortLines.map((l) => l.product.name))].join(", ")}. Stock will go negative.
          </p>
        )}

        {zeroLines.length > 0 && (
          <p className="text-xs text-warn">
            ⚠️ Some items have 0 quantity or 0 rate. Bill will be flagged for manager review.
          </p>
        )}

        <label className="flex w-fit items-center gap-2 text-sm">
          <input type="checkbox" checked={unpaid} onChange={(e) => setUnpaid(e.target.checked)} />
          Unpaid — Record on customer credit ledger (otherwise marked as settled)
        </label>

        {error && <div className="text-sm text-bad font-medium">{error}</div>}

        <div className="flex gap-2">
          <button className="btn w-40 py-2 text-base" disabled={submitting || lines.length === 0} onClick={saveDraft}>
            Save as Draft
          </button>
          <button ref={submitButtonRef} className="btn-primary flex-1 py-2 text-base font-bold" disabled={submitting} onClick={submit}>
            {submitting ? "Generating…" : "Generate Bill (F10)"}
          </button>
        </div>
      </div>

      {confirmDiscard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmDiscard(false)}>
          <div className="w-full max-w-sm space-y-3 rounded border-2 border-bad bg-paper p-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-bad">Discard this bill?</h2>
            <p className="text-sm">
              {lines.length} {lines.length === 1 ? "product" : "products"} worth ₹{total.toFixed(2)} will be discarded.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => setConfirmDiscard(false)}>
                Keep editing (Esc)
              </button>
              <button
                autoFocus
                className="btn-danger"
                onClick={() => {
                  billed();
                  router.push("/billing");
                }}
              >
                Discard (Enter)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Product Modal */}
      {showAddProductModal && (
        <div
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") return closeAddProductModal();
            onFieldNavKeyDown(e, e.currentTarget);
          }}
        >
          <AddProductModal
            initialName={productQuery.trim()}
            onClose={closeAddProductModal}
            onCreated={(p) => {
              setShowAddProductModal(false);
              addProduct(p);
            }}
          />
        </div>
      )}
    </div>

    {localBillId && <LocalBillOverlay requestId={localBillId} onClose={closeLocalBill} />}

    {!guideHidden && (
      <aside className="card space-y-3 text-xs lg:sticky lg:top-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">Keyboard Shortcuts</span>
          <button type="button" tabIndex={-1} className="text-muted underline" onClick={toggleGuide}>
            Hide ({keyFor("toggle-key-guide")})
          </button>
        </div>
        {KEY_GUIDE.map((g) => (
          <div key={g.title} className={`-mx-1 rounded px-1 py-0.5 ${g.title === guideZone ? "bg-accent/10 ring-1 ring-inset ring-accent" : ""}`}>
            <div className="mb-1 font-semibold">{g.title}</div>
            <ul className="space-y-0.5">
              {g.keys.map(([k, what]) => (
                <li key={k + what} className="flex items-baseline gap-1.5">
                  <Key k={k.startsWith("id:") ? keyFor(k.slice(3)) : k} />
                  <span className="text-muted">{what}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </aside>
    )}
    </div>
  );
}
