"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useShortcuts, getShortcutKey, FINANCE_SHORTCUTS } from "@/lib/shortcuts";
import { onFieldNavKeyDown, useEscapeKey } from "@/lib/keynav";
import { nextIndex } from "@/lib/dropdown-nav";
import { AddProductModal } from "@/components/AddProductModal";
import { useApiGet } from "@/lib/useApiGet";
import { describeHttpError } from "@/lib/http-error";
import { fmtDateTime } from "@/lib/fmt";
import type { BillingContext } from "@/app/api/customers/[id]/billing-context/route";
import { Highlight } from "@/components/Highlight";
import { barcodesForProduct } from "@/lib/barcode";
import {
  submitBill,
  printLocalBill,
  getLocalBill,
  lineMoney as moneyOf,
  moneyTotals,
  BillAlreadySentError,
  type BillDisplay,
  type LocalBill,
} from "@/lib/offline-bills";
import { LocalBillOverlay } from "@/components/LocalBillView";
import {
  ensureFreshCatalog,
  getCachedProducts,
  getCachedCustomers,
  searchProducts,
  rankProducts,
  searchCustomers,
  paintResults,
  type Painted,
  saveEntry,
  readEntry,
  clearEntry,
  ENTRY_KEYS,
} from "@/lib/offline-catalog";
import { offlineSession } from "@/lib/offline-login";
import { amountInWords } from "@/lib/invoice";

type Customer = {
  id: string;
  shopName: string;
  mobile: string | null;
  type: "WHOLESALE" | "RETAIL";
  ownerName?: string | null;
  address?: string | null;
  gstin?: string | null;
};

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
  saleUnits: {
    unitId: string;
    isBaseUnit: boolean;
    isDefaultSaleUnit: boolean;
    factorToBase: string;
    wholesalePrice: string | null;
    retailPrice: string | null;
    barcode: string | null;
    unit: Unit | null;
  }[];
  available: number | null;
  matchedUnitId?: string | null;
};

type Line = {
  product: Product;
  quantity: number;
  unitId: string;
  discount: number; // in percent
  unitPrice?: number;
};

export type PaymentTenderMode = "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE" | "CREDIT" | "SPLIT";

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
  <kbd className="rounded border border-line bg-paper px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink shadow-xs">
    {k}
  </kbd>
);

const KEY_GUIDE: { title: string; keys: [string, string][] }[] = [
  {
    title: "Navigation",
    keys: [
      ["id:focus-customer", "Customer search"],
      ["id:focus-product", "Product / Barcode"],
      ["Enter", "Next field"],
      ["Shift+Enter", "Previous field"],
      ["Esc", "Close / Leave"],
      ["id:toggle-key-guide", "Hide / Show guide"],
    ],
  },
  {
    title: "Product Search",
    keys: [
      ["↑ ↓", "Pick search item"],
      ["Enter", "Add item & focus Qty"],
      ["Enter (empty)", "Jump to Generate Bill"],
    ],
  },
  {
    title: "Table Lines",
    keys: [
      ["↑ ↓", "Move between lines"],
      ["Tab", "Qty → Unit → Price → Disc"],
      ["Alt+L", "Recall customer's last rate"],
      ["Ctrl+Delete", "Remove line item"],
    ],
  },
  {
    title: "Billing Actions",
    keys: [
      ["id:toggle-selling-mode", "Wholesale / Retail mode"],
      ["id:hold-new-bill", "Hold & start new bill"],
      ["Alt+1…9", "Switch to held bill"],
      ["id:submit-order", "Generate & print bill"],
    ],
  },
];

function zoneOf(el: EventTarget): string {
  if (!(el instanceof HTMLElement)) return "Navigation";
  if (el.closest("tbody")) return "Table Lines";
  if (el.getAttribute("placeholder")?.startsWith("Barcode")) return "Product Search";
  if (el.closest("[data-guide='bill']")) return "Billing Actions";
  return "Navigation";
}

const WALK_IN = "CASH";

export type PaymentRowItem = {
  id: string;
  method: "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE" | "CREDIT";
  amount: string;
  reference?: string;
};

type SavedBasket = {
  details: { shopName: string; mobile: string; ownerName: string; address: string; gstin: string };
  customer: Customer | null;
  customerQuery: string;
  sellingMode: "WHOLESALE" | "RETAIL";
  lines: Line[];
  notes: string;
  paymentRows?: PaymentRowItem[];
  requestId: string | null;
};

export default function BillingNewOrderPage() {
  const router = useRouter();

  // Clock & Employee info
  const [clock, setClock] = useState<string>("");
  const { data: authSession } = useApiGet<{ authenticated: boolean; user: { id: string; staffId: string; name: string; role: string } }>("/api/auth/me");
  const activeStaff = authSession?.user ?? offlineSession() ?? { staffId: "POS-1", name: "Billing Staff", role: "BILLING" };

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setClock(
        now.toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Customer state
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [details, setDetails] = useState({ shopName: "", mobile: "", ownerName: WALK_IN, address: "", gstin: "" });
  const [showExtraCustomerDetails, setShowExtraCustomerDetails] = useState(false);

  // Products & Table state
  const [sellingMode, setSellingMode] = useState<"WHOLESALE" | "RETAIL">("WHOLESALE");
  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState<Product[]>([]);
  const [customerIdx, setCustomerIdx] = useState(0);
  const [productIdx, setProductIdx] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [focusQtyIdx, setFocusQtyIdx] = useState<number | null>(null);
  const [notes, setNotes] = useState("");

  // Simple Payment Rows State
  const [paymentRows, setPaymentRows] = useState<PaymentRowItem[]>([
    { id: "1", method: "CASH", amount: "" },
  ]);

  // Form submission & offline queue
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
  }, [details, customer, customerQuery, sellingMode, lines, notes, paymentRows]);

  const [held, setHeld] = useState<SavedBasket[]>([]);
  useEffect(() => {
    if (!recovered.current) return;
    if (held.length === 0) clearEntry(ENTRY_KEYS.heldBills);
    else saveEntry(ENTRY_KEYS.heldBills, { bills: held });
  }, [held]);

  function snapshot(): SavedBasket {
    return {
      details,
      customer,
      customerQuery,
      sellingMode,
      lines,
      notes,
      paymentRows,
      requestId: requestIdRef.current,
    };
  }

  function loadBasket(b: SavedBasket | null) {
    setDetails(b?.details ?? { shopName: "", mobile: "", ownerName: WALK_IN, address: "", gstin: "" });
    setCustomer(b?.customer ?? null);
    setCustomerQuery(b?.customerQuery ?? "");
    setSellingMode(b?.sellingMode ?? "WHOLESALE");
    setLines(b?.lines ?? []);
    setNotes(b?.notes ?? "");
    setPaymentRows(b?.paymentRows && b.paymentRows.length > 0 ? b.paymentRows : [{ id: "1", method: "CASH", amount: "" }]);
    requestIdRef.current = b?.requestId ?? null;
    setProductQuery("");
    setRestoredAt(null);
    setError(null);
  }

  function addPaymentRow() {
    const currentPaid = paymentRows.reduce((sum, r) => (r.method === "CREDIT" ? sum : sum + (Number(r.amount) || 0)), 0);
    const rem = round2(Math.max(0, total - currentPaid));
    setPaymentRows((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        method: prev.some((r) => r.method === "CASH") ? "UPI" : "CASH",
        amount: rem > 0 ? String(rem) : "",
        reference: "",
      },
    ]);
  }

  function updatePaymentRow(id: string, patch: Partial<PaymentRowItem>) {
    setPaymentRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removePaymentRow(id: string) {
    setPaymentRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
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
      .catch(() => { });
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
      getCachedProducts().then(setCachedProducts).catch(() => { });
      getCachedCustomers().then(setCachedCustomers).catch(() => { });
    };
    ensureFreshCatalog(read).then(read).catch(() => { });
    return () => {
      live = false;
    };
  }, []);

  const paintedCustomers = useRef<Painted<Customer>>({ q: "", rows: [] });
  const paintedProducts = useRef<Painted<Product>>({ q: "", rows: [] });

  function paintCustomers(q: string, rows: Customer[]) {
    const p = paintResults(paintedCustomers.current, q, rows);
    paintedCustomers.current = p;
    setCustomerResults(p.rows);
    setCustomerIdx(0);
  }

  function paintProducts(q: string, rows: Product[]) {
    const p = paintResults(paintedProducts.current, q, rows);
    paintedProducts.current = p;
    setProductResults(p.rows);
    setProductIdx(0);
  }

  useEffect(() => {
    if (!customerQuery.trim()) {
      paintedCustomers.current = { q: "", rows: [] };
      setCustomerResults([]);
      return;
    }
    const SEARCH_LIMIT = 25;
    const local = searchCustomers(cachedCustomers, customerQuery);
    if (local.length > 0) paintCustomers(customerQuery, local as Customer[]);
    if (!navigator.onLine) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/customers?q=${encodeURIComponent(customerQuery)}&limit=${SEARCH_LIMIT}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => Array.isArray(d) && paintCustomers(customerQuery, d as Customer[]))
        .catch(() => { });
    }, 150);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [customerQuery, cachedCustomers]);

  useEffect(() => {
    if (!productQuery.trim()) {
      paintedProducts.current = { q: "", rows: [] };
      setProductResults([]);
      return;
    }
    const SEARCH_LIMIT = 25;
    const local = searchProducts(cachedProducts, productQuery);
    if (local.length > 0) paintProducts(productQuery, local as unknown as Product[]);
    if (!navigator.onLine) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/products?q=${encodeURIComponent(productQuery)}&limit=${SEARCH_LIMIT}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => Array.isArray(d) && paintProducts(productQuery, rankProducts(d as Product[], productQuery)))
        .catch(() => { });
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
      } catch { }
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
            .catch(() => { });
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
          mobile: isNum ? trimmed : details.mobile || null,
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
        .catch(() => { });
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
        l.product.id === product.id ? { ...l, product, ...(i === f.idx ? { unitId: added.unitId, unitPrice: undefined } : {}) } : l
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

  // Payment computation across simple payment rows
  const totalPaid = round2(
    paymentRows.reduce((sum, r) => {
      if (r.method === "CREDIT") return sum;
      return sum + (Number(r.amount) || 0);
    }, 0)
  );
  const isSingleRow = paymentRows.length === 1;
  const singleRow = paymentRows[0] || { id: "1", method: "CASH" as const, amount: "" };
  const effectivePaid =
    isSingleRow && !singleRow.amount && singleRow.method !== "CREDIT"
      ? total
      : totalPaid;
  const changeDue = effectivePaid > total ? round2(effectivePaid - total) : 0;
  const remainingCredit = round2(Math.max(0, total - effectivePaid));
  const isCreditSale =
    (isSingleRow && singleRow.method === "CREDIT") ||
    (!isSingleRow && totalPaid <= 0) ||
    (effectivePaid < total);

  function billed() {
    requestIdRef.current = null;
    clearEntry(ENTRY_KEYS.newOrder);
  }

  async function submit() {
    if (submittingRef.current) return;
    if (lines.length === 0) {
      setError("Add at least one product to generate a bill");
      return;
    }
    if (!isSingleRow && totalPaid <= 0 && !paymentRows.some((r) => r.method === "CREDIT")) {
      setError("Please enter an amount for at least one payment method or select Credit");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    const cust = customerPayload();

    let paymentMethod: PaymentTenderMode = "CASH";
    let splitsPayload: Array<{
      method: "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE";
      amount: number;
      reference?: string;
    }> | undefined;

    if (isSingleRow) {
      paymentMethod = singleRow.method;
    } else {
      paymentMethod = "SPLIT";
      splitsPayload = paymentRows
        .filter((r) => r.method !== "CREDIT" && Number(r.amount) > 0)
        .map((r) => ({
          method: r.method as "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE",
          amount: Number(r.amount),
          reference: r.reference?.trim() || undefined,
        }));
    }

    const singleRowAmt = Number(singleRow.amount) > 0 ? Number(singleRow.amount) : total;
    const paymentDetails = {
      amountReceived: isSingleRow ? (singleRow.method === "CREDIT" ? 0 : singleRowAmt) : totalPaid,
      changeGiven: changeDue,
      upiReference: isSingleRow && singleRow.method === "UPI" ? singleRow.reference?.trim() || undefined : undefined,
      bankReference: isSingleRow && singleRow.method === "BANK_TRANSFER" ? singleRow.reference?.trim() || undefined : undefined,
      chequeNumber: isSingleRow && singleRow.method === "CHEQUE" ? singleRow.reference?.trim() || undefined : undefined,
      notes: notes.trim() || undefined,
      splits: splitsPayload,
    };

    const payload = {
      customer: cust,
      sellingMode,
      notes: notes || undefined,
      unpaid: isCreditSale,
      paymentMethod,
      paymentDetails,
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
      paymentMethod,
      paymentDetails,
      employeeName: activeStaff.name,
      employeeStaffId: activeStaff.staffId,
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
      setError("Add at least one product to save draft");
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
  const [guideZone, setGuideZone] = useState("Navigation");
  const GUIDE_HIDDEN_KEY = "new-order:key-guide-hidden";
  const [guideHidden, setGuideHidden] = useState(false);
  useEffect(() => {
    try {
      setGuideHidden(localStorage.getItem(GUIDE_HIDDEN_KEY) === "1");
    } catch { }
  }, []);
  function toggleGuide() {
    setGuideHidden((h) => {
      try {
        localStorage.setItem(GUIDE_HIDDEN_KEY, h ? "0" : "1");
      } catch { }
      return !h;
    });
  }
  const keyFor = (id: string) => remapped[id] ?? FINANCE_SHORTCUTS.find((s) => s.id === id)?.defaultKey ?? "";

  function closeAddProductModal() {
    setShowAddProductModal(false);
    productInputRef.current?.focus();
  }

  return (
    <div className={`mx-auto grid items-start gap-4 ${guideHidden ? "max-w-6xl" : "max-w-7xl lg:grid-cols-[minmax(0,1fr)_16rem]"}`}>
      <div
        className="space-y-4"
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
        {/* Header Ribbon: Title, Clock, Billed By, Held Bills, Shortcuts */}
        <div className="card bg-paper border border-line p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white font-black text-lg shadow-sm">
                🧾
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-ink">New Bills</h1>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted mt-0.5">
                  <span>📅 {clock || "Loading clock..."}</span>
                  <span>👤 Cashier: <strong className="text-ink">{activeStaff.name}</strong></span>
                  <span>🏷️ Mode: <strong className="text-accent">{sellingMode}</strong></span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {held.map((b, i) => (
                <button
                  key={i}
                  type="button"
                  tabIndex={-1}
                  className="btn text-xs font-medium border-warn/40 bg-warn/10 text-ink hover:bg-warn/20"
                  onClick={() => switchToHeld(i)}
                  title="Swap this held bill in"
                >
                  ⏸️ Held {i + 1}: {billLabel(b)} (Alt+{i + 1})
                </button>
              ))}
              <button
                type="button"
                tabIndex={-1}
                className="btn text-xs font-semibold hover:bg-surface-hi"
                onClick={holdAndStartNew}
              >
                ⏸️ Hold &amp; New ({keyFor("hold-new-bill")})
              </button>
              {guideHidden && (
                <button
                  type="button"
                  tabIndex={-1}
                  className="btn text-xs hover:bg-surface-hi"
                  onClick={toggleGuide}
                >
                  ⌨️ Shortcuts ({keyFor("toggle-key-guide")})
                </button>
              )}
            </div>
          </div>
        </div>

        {notice && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-bad/50 bg-bad/10 p-3 text-sm text-bad" role="alert">
            <span className="font-medium">{notice.text}</span>
            <div className="flex gap-2">
              <button className="btn text-xs font-semibold" onClick={() => setLocalBillId(notice.requestId)}>
                Open Bill
              </button>
              <button className="btn text-xs" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        {restoredAt != null && lines.length > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm">
            <span>
              Picked up where you left off — {lines.length} {lines.length === 1 ? "product" : "products"} from{" "}
              {fmtDateTime(new Date(restoredAt).toISOString())}.
            </span>
            <button className="btn text-xs font-semibold" onClick={() => { setLines([]); setNotes(""); billed(); setRestoredAt(null); }}>
              Start Fresh Bill
            </button>
          </div>
        )}

        {/* 1. Customer / Retailer Card */}
        {customer ? (
          <div className="card relative border-accent/50 bg-accent/5 p-4 space-y-3 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-white font-bold text-sm shadow-xs">
                  {customer.shopName.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-base text-ink">{customer.shopName}</span>
                    <span className="badge bg-ink text-surface text-xs font-semibold">{customer.type}</span>
                    {customer.ownerName && customer.ownerName !== customer.shopName && (
                      <span className="text-xs text-muted">({customer.ownerName})</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted mt-0.5">
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
                  {showExtraCustomerDetails ? "Hide Fields" : "✏️ Edit / GSTIN"}
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
                  Change Customer ({keyFor("focus-customer")})
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
                  ✕ Walk-in Cash
                </button>
              </div>
            </div>

            {showExtraCustomerDetails && (
              <div className="grid grid-cols-1 gap-3 border-t border-line/60 pt-3 sm:grid-cols-3 text-xs">
                <div>
                  <label className="mb-1 block font-semibold text-muted">Mobile Number</label>
                  <input
                    className="w-full text-sm"
                    inputMode="numeric"
                    placeholder="10-digit mobile"
                    value={details.mobile}
                    onChange={(e) => setDetails({ ...details, mobile: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-muted">Address / City</label>
                  <input
                    className="w-full text-sm"
                    placeholder="City / location"
                    value={details.address}
                    onChange={(e) => setDetails({ ...details, address: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-muted">GSTIN</label>
                  <input
                    className="w-full text-sm uppercase"
                    placeholder="22AAAAA0000A1Z5"
                    value={details.gstin}
                    onChange={(e) => setDetails({ ...details, gstin: e.target.value.toUpperCase() })}
                  />
                </div>
              </div>
            )}

            {ctx && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-line/60 pt-2.5 text-xs text-muted">
                <span className={ctx.outstanding > 0 ? "font-bold text-bad" : "text-muted"}>
                  {ctx.outstanding > 0 ? `⚠️ Current Ledger Due: ₹${ctx.outstanding.toFixed(2)}` : "✅ Zero outstanding balance"}
                </span>
                {ctx.creditLimit != null && (
                  <span className={overLimitBy > 0 ? "font-bold text-bad" : "text-muted font-medium"}>
                    Credit Limit: ₹{ctx.creditLimit.toFixed(2)}
                    {overLimitBy > 0 ? ` (Over by ₹${overLimitBy.toFixed(2)})` : ` (₹${Math.max(0, ctx.creditLimit - ctx.outstanding).toFixed(2)} available)`}
                  </span>
                )}
                {ctx.lastBill && (
                  <span>
                    Last Bill: {ctx.lastBill.orderNumber} (₹{Number(ctx.lastBill.total).toFixed(2)}) on {fmtDateTime(ctx.lastBill.at)}
                  </span>
                )}
                {ctx.lastRates.length > 0 && (
                  <span className="text-accent font-semibold italic">💡 Alt+L on any line recalls previous rate</span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="card relative space-y-2 p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-ink">
                👤 Customer / Retailer ({keyFor("focus-customer")}) — Search Name / Phone / GSTIN
              </label>
              <button
                type="button"
                className="text-xs text-accent font-semibold hover:underline"
                onClick={() => setShowExtraCustomerDetails((v) => !v)}
              >
                {showExtraCustomerDetails ? "Hide Extra Fields" : "+ Optional Phone / GSTIN"}
              </button>
            </div>
            <div className="flex gap-2">
              <input
                ref={customerInputRef}
                className="flex-1 text-base font-medium"
                autoFocus
                placeholder="Type customer or shop name, phone number, GSTIN (Press Enter to select or start Cash sale)…"
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                onKeyDown={onCustomerKeyDown}
              />
            </div>

            {showExtraCustomerDetails && (
              <div className="grid grid-cols-1 gap-3 border-t border-line pt-3 sm:grid-cols-3 text-xs">
                <div>
                  <label className="mb-1 block font-semibold text-muted">Mobile Number</label>
                  <input
                    className="w-full text-sm"
                    inputMode="numeric"
                    placeholder="10-digit number"
                    value={details.mobile}
                    onChange={(e) => setDetails({ ...details, mobile: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-muted">Address / City</label>
                  <input
                    className="w-full text-sm"
                    placeholder="Area / city"
                    value={details.address}
                    onChange={(e) => setDetails({ ...details, address: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-muted">GSTIN</label>
                  <input
                    className="w-full text-sm uppercase"
                    placeholder="Optional GSTIN"
                    value={details.gstin}
                    onChange={(e) => setDetails({ ...details, gstin: e.target.value.toUpperCase() })}
                  />
                </div>
              </div>
            )}

            {customerResults.length > 0 && (
              <div
                role="listbox"
                className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-paper shadow-xl"
              >
                {customerResults.map((c, i) => (
                  <button
                    key={c.id}
                    role="option"
                    tabIndex={-1}
                    aria-selected={i === customerIdx}
                    ref={scrollToActive(i === customerIdx)}
                    className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-surface-hi ${i === customerIdx ? "bg-accent/15 font-semibold ring-1 ring-inset ring-accent" : ""
                      }`}
                    onClick={() => selectCustomer(c)}
                  >
                    <div>
                      <span className="font-bold text-ink"><Highlight text={c.shopName} q={customerQuery} /></span>
                      {c.mobile && <span className="text-xs text-muted"> · 📞 <Highlight text={c.mobile} q={customerQuery} /></span>}
                      {c.gstin && <span className="text-xs text-muted"> · 🏛️ <Highlight text={c.gstin} q={customerQuery} /></span>}
                    </div>
                    <span className="badge text-xs bg-surface-hi text-muted font-semibold">{c.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 2. SKU / Product Search Bar */}
        <div className="card relative p-4 space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-ink">
              📦 SKU / Product ({keyFor("focus-product")}) — Scan Barcode or Search by Name / SKU
            </label>
            <div className="flex items-center gap-1.5 text-xs" data-guide="bill">
              <button
                type="button"
                className={`rounded-md px-3 py-1 font-semibold transition-colors ${sellingMode === "WHOLESALE" ? "bg-ink text-surface" : "bg-surface-hi text-muted hover:text-ink"}`}
                onClick={() => setSellingMode("WHOLESALE")}
              >
                Wholesale Price
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-1 font-semibold transition-colors ${sellingMode === "RETAIL" ? "bg-ink text-surface" : "bg-surface-hi text-muted hover:text-ink"}`}
                onClick={() => setSellingMode("RETAIL")}
              >
                Retail Price
              </button>
              <span className="text-muted ml-1">({keyFor("toggle-selling-mode")})</span>
            </div>
          </div>
          <input
            ref={productInputRef}
            className="w-full text-base font-medium"
            placeholder="Scan barcode scanner or type product name / SKU / category…"
            value={productQuery}
            onChange={(e) => setProductQuery(e.target.value)}
            onKeyDown={onProductKeyDown}
          />
          {(productResults.length > 0 || (canAddProduct && productQuery.trim())) && (
            <div role="listbox" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-line bg-paper shadow-xl">
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
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-hi ${i === productIdx ? "bg-accent/15 font-semibold ring-1 ring-inset ring-accent" : ""
                      }`}
                    onClick={() => addProduct(p)}
                  >
                    <span>
                      <strong className="text-ink"><Highlight text={p.name} q={productQuery} /></strong>{" "}
                      <span className="text-xs text-muted">
                        (<Highlight text={p.sku} q={productQuery} />
                        {p.barcode ? <> · <Highlight text={p.barcode} q={productQuery} /></> : ""})
                      </span>
                    </span>
                    <span className="flex items-center gap-3 text-xs">
                      {p.available != null && (
                        <span className={outOfStock ? "text-bad font-bold" : lowStock ? "text-warn font-semibold" : "text-muted"}>
                          {outOfStock ? "0 in stock" : `${p.available} ${unitSym(p.baseUnit)} in stock`}
                        </span>
                      )}
                      <span className="font-bold text-sm text-ink">
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
                  className={`flex w-full items-center justify-between border-t border-line px-3 py-2.5 text-left text-sm text-accent hover:bg-surface-hi ${productIdx === productResults.length ? "bg-accent/15 font-bold ring-1 ring-inset ring-accent" : ""
                    }`}
                  onClick={() => {
                    if (allUnits.length === 0) {
                      fetch("/api/admin/units")
                        .then((r) => (r.ok ? r.json() : null))
                        .then((d) => Array.isArray(d) && setAllUnits(d))
                        .catch(() => { });
                    }
                    setShowAddProductModal(true);
                  }}
                >
                  <span>+ Add &ldquo;{productQuery.trim()}&rdquo; to catalogue…</span>
                  <span className="text-xs text-muted">Creates product &amp; adds directly to bill</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* 3. SKU / Product Bill Items Table */}
        <div className="card overflow-x-auto p-0 shadow-xs border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-hi text-left text-xs font-bold text-muted uppercase tracking-wider">
                <th className="p-3 w-10">#</th>
                <th className="p-3">SKU / Product</th>
                <th className="p-3 w-28">Quantity</th>
                <th className="p-3 w-36">Unit</th>
                <th className="p-3 w-32">Selling Price (₹)</th>
                <th className="p-3 w-24">Disc (%)</th>
                <th className="p-3 w-28">GST Tax</th>
                <th className="p-3 text-right w-36">Total (₹)</th>
                <th className="p-3 w-12 text-center"></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-sm text-muted">
                    <div className="text-2xl mb-1">🛒</div>
                    No items in this bill yet. Scan a barcode or search for products above.
                  </td>
                </tr>
              )}
              {lines.map((l, i) => {
                const rowTotal = money[i]!;
                const last = lastRateFor(l);
                const isOverridden = l.unitPrice !== undefined;
                const taxPct = Number(l.product.taxPercent) || 0;
                return (
                  <tr
                    key={`${l.product.id}-${l.unitId}-${i}`}
                    className="border-b border-line/70 hover:bg-surface-hi/80 transition-colors"
                    onKeyDown={(e) => onLineKeyDown(e, i)}
                  >
                    <td className="p-3 text-xs text-muted font-bold">{i + 1}</td>
                    <td className="p-3">
                      <div className="font-bold text-ink text-sm">{l.product.name}</div>
                      <div className="text-xs text-muted">
                        SKU: <span className="font-mono">{l.product.sku}</span>
                        {l.product.barcode && <span> · Barcode: {l.product.barcode}</span>}
                      </div>
                    </td>
                    <td className="p-3">
                      <input
                        ref={(el) => { qtyRefs.current[i] = el; }}
                        data-col="qty"
                        type="number"
                        min="0.001"
                        step="any"
                        className="w-24 text-sm font-bold"
                        value={l.quantity || ""}
                        onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                      />
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1">
                        <select
                          data-unit
                          className="w-28 text-sm font-medium"
                          value={l.unitId}
                          onChange={(e) => updateLine(i, { unitId: e.target.value })}
                        >
                          {l.product.saleUnits.map((su) => (
                            <option key={su.unitId} value={su.unitId}>
                              {unitSym(su.unit)} ({su.factorToBase}x)
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          tabIndex={-1}
                          className="btn text-xs px-2 py-1 text-accent font-bold"
                          onClick={() => openUnitForm(i)}
                          title="Add missing unit packaging"
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td className="p-3">
                      <input
                        data-col="price"
                        type="number"
                        min="0"
                        step="any"
                        className={`w-28 text-sm font-semibold ${isOverridden ? "border-accent text-accent ring-1 ring-accent" : ""}`}
                        value={l.unitPrice ?? priceFor(l.product, l.unitId)}
                        onChange={(e) => updateLine(i, { unitPrice: e.target.value === "" ? undefined : Number(e.target.value) })}
                        title={isOverridden ? "Custom price applied" : "Catalogue master price"}
                      />
                      {last && !isOverridden && (
                        <div
                          className="text-[11px] text-muted cursor-pointer hover:text-accent mt-0.5"
                          onClick={() => updateLine(i, { unitPrice: last.unitPrice })}
                          title="Click to apply last billed rate"
                        >
                          Last: ₹{last.unitPrice.toFixed(2)}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <input
                        data-col="disc"
                        type="number"
                        min="0"
                        max="100"
                        step="any"
                        className="w-20 text-sm"
                        placeholder="0%"
                        value={l.discount || ""}
                        onChange={(e) => updateLine(i, { discount: Number(e.target.value) })}
                      />
                    </td>
                    <td className="p-3 text-xs">
                      <div className="font-semibold text-ink">{taxPct}% GST</div>
                      <div className="text-muted">₹{rowTotal.tax.toFixed(2)}</div>
                    </td>
                    <td className="p-3 text-right font-bold text-base text-ink">
                      ₹{rowTotal.total.toFixed(2)}
                    </td>
                    <td className="p-3 text-center">
                      <button
                        type="button"
                        className="text-muted hover:text-bad font-bold text-sm"
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
          <div className="card space-y-3 border-accent bg-accent/5 p-4 shadow-sm">
            <div className="text-sm font-bold text-ink">
              Add new packaging unit for &ldquo;{lines[unitForm.idx]?.product.name}&rdquo;
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 text-sm">
              <select
                className="w-full"
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
                <button className="btn-primary text-xs font-bold py-2 flex-1" disabled={unitForm.saving} onClick={saveUnit}>
                  {unitForm.saving ? "Saving…" : "Save Unit"}
                </button>
                <button className="btn text-xs py-2" onClick={() => setUnitForm(null)}>
                  Cancel
                </button>
              </div>
            </div>
            {unitForm.error && <div className="text-xs text-bad font-semibold">{unitForm.error}</div>}
          </div>
        )}

        {/* 4. Payment Mode & Tender Recording Panel */}
        {/* 4. Simple Payment Tender Breakdown (Dropdown + Add Rows) */}
        <div className="card p-5 space-y-4 border border-line shadow-sm" data-guide="bill">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
            <div>
              <h2 className="text-base font-bold text-ink flex items-center gap-2">
                <span>💳</span> Payment Breakdown
              </h2>
              <p className="text-xs text-muted">
                Select payment method and amount. Add rows to split payment across different methods.
              </p>
            </div>
            <button
              type="button"
              className="btn text-xs font-semibold flex items-center gap-1.5 hover:border-accent hover:text-accent"
              onClick={addPaymentRow}
            >
              <span>+</span>
              <span>Add Payment Method</span>
            </button>
          </div>

          {/* Payment Rows List */}
          <div className="space-y-2.5">
            {paymentRows.map((row, idx) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center gap-2.5 rounded-lg border border-line bg-paper p-3 shadow-2xs"
              >
                {/* Method Dropdown */}
                <div className="w-48 min-w-[150px]">
                  <label className="mb-0.5 block text-[10px] font-semibold text-muted uppercase">Payment Mode</label>
                  <select
                    className="w-full text-xs font-semibold"
                    value={row.method}
                    onChange={(e) => updatePaymentRow(row.id, { method: e.target.value as any })}
                  >
                    <option value="CASH">💵 Cash Payment</option>
                    <option value="UPI">📱 UPI / QR Code</option>
                    <option value="BANK_TRANSFER">🏦 Bank Transfer (NEFT/IMPS)</option>
                    <option value="CHEQUE">📑 Cheque / DD</option>
                    <option value="CREDIT">📒 Credit / Khata (Unpaid)</option>
                  </select>
                </div>

                {/* Amount */}
                <div className="w-40 min-w-[120px]">
                  <label className="mb-0.5 block text-[10px] font-semibold text-muted uppercase">Amount (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    disabled={row.method === "CREDIT"}
                    className={`w-full text-xs font-bold font-mono ${row.method === "CREDIT" ? "opacity-50" : ""}`}
                    placeholder={
                      row.method === "CREDIT"
                        ? "Credit Ledger"
                        : paymentRows.length === 1
                          ? `Exact (₹${total.toFixed(2)})`
                          : "0.00"
                    }
                    value={row.amount}
                    onChange={(e) => updatePaymentRow(row.id, { amount: e.target.value })}
                  />
                </div>

                {/* Reference / Notes */}
                {row.method !== "CREDIT" && row.method !== "CASH" && (
                  <div className="flex-1 min-w-[160px]">
                    <label className="mb-0.5 block text-[10px] font-semibold text-muted uppercase">
                      {row.method === "UPI"
                        ? "UPI Ref / UTR (Optional)"
                        : row.method === "CHEQUE"
                          ? "Cheque Number (Optional)"
                          : "Bank UTR / Ref (Optional)"}
                    </label>
                    <input
                      type="text"
                      className="w-full text-xs"
                      placeholder={
                        row.method === "UPI"
                          ? "e.g. 408291839218"
                          : row.method === "CHEQUE"
                            ? "e.g. 004921"
                            : "e.g. HDFC00012398"
                      }
                      value={row.reference || ""}
                      onChange={(e) => updatePaymentRow(row.id, { reference: e.target.value })}
                    />
                  </div>
                )}

                {/* Remove button */}
                {paymentRows.length > 1 && (
                  <div className="pt-3.5">
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted hover:border-bad hover:bg-bad/10 hover:text-bad"
                      onClick={() => removePaymentRow(row.id)}
                      title="Remove row"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Totals Summary Footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-hi/40 p-3 text-xs">
            <button
              type="button"
              className="btn text-xs font-semibold flex items-center gap-1.5"
              onClick={addPaymentRow}
            >
              <span>+</span>
              <span>Add Another Payment Row</span>
            </button>

            <div className="flex flex-wrap items-center gap-4 text-xs">
              <div>
                <span className="text-muted">Bill Total: </span>
                <strong className="text-ink font-mono text-sm">₹{total.toFixed(2)}</strong>
              </div>
              <div>
                <span className="text-muted">Total Paid: </span>
                <strong className="text-good font-mono text-sm">
                  ₹{effectivePaid.toFixed(2)}
                </strong>
              </div>
              {changeDue > 0 ? (
                <div className="rounded bg-good/15 px-2.5 py-1 font-bold text-good border border-good/30">
                  Change to Return: ₹{changeDue.toFixed(2)}
                </div>
              ) : remainingCredit > 0 && !(isSingleRow && !singleRow.amount && singleRow.method !== "CREDIT") ? (
                <div className="rounded bg-amber-500/15 px-2.5 py-1 font-bold text-amber-700 dark:text-amber-300 border border-amber-500/30">
                  Remaining on Credit: ₹{remainingCredit.toFixed(2)}
                </div>
              ) : (
                <div className="rounded bg-good/15 px-2.5 py-1 font-bold text-good border border-good/30">
                  ✓ Full Settled
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 5. Financial Summary & Totals Breakdown */}
        <div className="card p-5 space-y-4 border border-line shadow-sm" data-guide="bill">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 bg-surface-hi/50 p-4 rounded-xl border border-line/60">
            <div>
              <div className="text-xs font-bold text-muted uppercase">Gross Subtotal</div>
              <div className="text-lg font-bold text-ink mt-0.5">₹{subtotal.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-muted uppercase">Total Discount</div>
              <div className="text-lg font-bold text-warn mt-0.5">-₹{discountTotal.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-muted uppercase">Total GST Tax</div>
              <div className="text-lg font-bold text-ink mt-0.5">+₹{taxTotal.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-muted uppercase">Grand Total</div>
              <div className="text-3xl font-black text-good mt-0.5">₹{total.toFixed(2)}</div>
            </div>
          </div>

          {total > 0 && (
            <div className="text-xs text-muted italic">
              <strong>In Words:</strong> {amountInWords(total)} Rupees Only
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-bold text-muted">Order Remark / Delivery Notes</label>
            <input
              className="w-full text-sm"
              placeholder="Special instructions or delivery remarks…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {overLimitBy > 0 && isCreditSale && (
            <div className="text-xs text-bad font-bold">
              ⚠️ Warning: Bill exceeds customer credit limit by ₹{overLimitBy.toFixed(2)}
            </div>
          )}

          {shortLines.length > 0 && (
            <p className="text-xs text-warn font-semibold">
              ⚠️ Billing more than available stock for {[...new Set(shortLines.map((l) => l.product.name))].join(", ")}. Stock will go negative.
            </p>
          )}

          {zeroLines.length > 0 && (
            <p className="text-xs text-warn font-semibold">
              ⚠️ Some items have 0 quantity or 0 rate. Bill will be flagged for manager review.
            </p>
          )}

          {error && <div className="text-sm text-bad font-bold bg-bad/10 p-3 rounded-lg border border-bad/30">{error}</div>}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 pt-2">
            <button
              className="btn w-44 py-3 text-base font-semibold"
              disabled={submitting || lines.length === 0}
              onClick={saveDraft}
            >
              📝 Save as Draft
            </button>
            <button
              ref={submitButtonRef}
              className="btn-primary flex-1 py-3 text-lg font-black shadow-md transition-all hover:scale-[1.01]"
              disabled={submitting}
              onClick={submit}
            >
              {submitting ? "Generating & Printing…" : `⚡ Generate & Print Bill (${keyFor("submit-order") || "F10"})`}
            </button>
          </div>
        </div>

        {/* Discard Confirmation Modal */}
        {confirmDiscard && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs" onClick={() => setConfirmDiscard(false)}>
            <div className="w-full max-w-sm space-y-4 rounded-xl border-2 border-bad bg-paper p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-bold text-bad">Discard this active bill?</h2>
              <p className="text-sm text-muted">
                {lines.length} {lines.length === 1 ? "product" : "products"} worth <strong>₹{total.toFixed(2)}</strong> will be discarded.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn font-semibold" onClick={() => setConfirmDiscard(false)}>
                  Keep Editing (Esc)
                </button>
                <button
                  autoFocus
                  className="btn-danger font-bold px-4"
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
        <aside className="card space-y-4 text-xs lg:sticky lg:top-4 border border-line shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-line pb-2">
            <span className="font-bold text-ink">⌨️ Keyboard Shortcuts</span>
            <button type="button" tabIndex={-1} className="text-muted hover:text-ink underline" onClick={toggleGuide}>
              Hide ({keyFor("toggle-key-guide")})
            </button>
          </div>
          {KEY_GUIDE.map((g) => (
            <div key={g.title} className={`-mx-1 rounded-lg p-2 transition-colors ${g.title === guideZone ? "bg-accent/15 ring-1 ring-inset ring-accent font-semibold" : ""}`}>
              <div className="mb-1.5 font-bold text-ink">{g.title}</div>
              <ul className="space-y-1">
                {g.keys.map(([k, what]) => (
                  <li key={k + what} className="flex items-baseline gap-2">
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
