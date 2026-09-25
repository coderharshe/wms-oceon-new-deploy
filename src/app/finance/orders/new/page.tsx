"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useShortcuts, getShortcutKey, FINANCE_SHORTCUTS } from "@/lib/shortcuts";
import { onFieldNavKeyDown, useEscapeKey } from "@/lib/keynav";
import { nextIndex, carryIndex } from "@/lib/dropdown-nav";
import { AddProductModal } from "@/components/AddProductModal";
import { AddCustomerModal, type NewCustomerData } from "@/components/AddCustomerModal";
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
  // Present in every /api/products row; typed here so an exact-barcode match
  // (a scan) can be told apart from a name/SKU search (a person typing).
  barcode?: string | null;
  baseUnit: Unit | null;
  saleUnits: { unitId: string; isBaseUnit: boolean; isDefaultSaleUnit: boolean; factorToBase: string; wholesalePrice: string | null; retailPrice: string | null; barcode: string | null; unit: Unit | null }[];
  available: number | null; // base-unit qty on hand minus reserved, for the session's warehouse
  // Set when the search term was an exact match on one unit's barcode —
  // scanning a "box of 24" should add a box, not the base unit.
  matchedUnitId?: string | null;
};
// unitPrice is set only when finance types over the catalogue rate; undefined
// means "whatever the product is priced at", which keeps following the unit
// dropdown and the wholesale/retail switch instead of freezing a number.
type Line = { product: Product; quantity: number; unitId: string; discount: number; unitPrice?: number };

// Keeps the arrow-key-selected row inside the dropdown's scroll window.
const scrollToActive = (active: boolean) => (el: HTMLElement | null) => {
  if (active) el?.scrollIntoView({ block: "nearest" });
};

// A unit symbol is a label, never a reason to lose the bill on screen. Both
// product endpoints map their units with `?? null`, so this can genuinely be
// absent; before this, one null took the whole till down with a React crash.
const unitSym = (u: Unit | null | undefined) => u?.symbol ?? "";

// The unit a line opens on. Drinks default to peti and rice to bag, so the
// base unit (always the smallest one, for stock) is the fallback, not the
// default — see ProductUnit.isDefaultSaleUnit.
function defaultUnitOf(p: Product) {
  return p.saleUnits.find((u) => u.isDefaultSaleUnit) ?? p.saleUnits.find((u) => u.isBaseUnit) ?? p.saleUnits[0];
}

// Line.quantity is entered in whatever sale unit is selected (e.g. boxes),
// but `available` from the API is always in base units — convert so the
// remaining-stock check compares like with like.
function baseQtyOf(l: Line) {
  const su = l.product.saleUnits.find((u) => u.unitId === l.unitId);
  return l.quantity * Number(su?.factorToBase ?? 1);
}

// One product can legitimately occupy several lines (a carton line and a
// loose-piece line), so stock is only ever checked against its total.
function baseQtyForProduct(lines: Line[], productId: string) {
  return lines.reduce((s, l) => (l.product.id === productId ? s + baseQtyOf(l) : s), 0);
}

// Money mirrors the server: it rounds each line's figures before summing, so
// rounding per line here keeps the printed total equal to the billed total.
const round2 = (n: number) => Math.round(n * 100) / 100;

const Key = ({ k }: { k: string }) => (
  <kbd className="rounded border border-line bg-paper px-1 font-mono text-[11px] text-ink">{k}</kbd>
);

// The on-screen key guide. Grouped by where the cursor is, because that is
// the question a cashier has: "I'm on a line — how do I get out / fix the rate?"
// Keys shown as `id:` come from the shortcut settings, so a remapped key shows
// its new binding; the rest are fixed to the screen.
const KEY_GUIDE: { title: string; keys: [string, string][] }[] = [
  {
    title: "Move around",
    keys: [["id:focus-customer", "customer search"], ["id:edit-customer-name", "edit customer name"],["id:focus-product", "product search"], ["Enter", "next field"], ["Shift+Enter", "previous field"], ["Esc", "close / leave"], ["id:toggle-key-guide", "hide / show this panel"]],
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

// Which guide group matches the focused field.
function zoneOf(el: EventTarget): string {
  if (!(el instanceof HTMLElement)) return "Move around";
  if (el.closest("tbody")) return "On a line";
  if (el.getAttribute("placeholder")?.startsWith("Barcode")) return "Product search";
  if (el.closest("[data-guide='bill']")) return "Bill";
  return "Move around";
}

/** The name on an anonymous over-the-counter sale, same as the paper pad. */
const WALK_IN = "CASH";

// What the New Order screen hands to saveEntry/readEntry — everything typed
// into a bill that is not on the server yet.
type SavedBasket = {
  details: { shopName: string; mobile: string; ownerName: string; address: string; gstin: string };
  // The picked customer as well as what is in the search box: restoring the
  // box alone would reopen the search dropdown over the recovered bill.
  customer: Customer | null;
  customerQuery: string;
  sellingMode: "WHOLESALE" | "RETAIL";
  lines: Line[];
  notes: string;
  /** Goes on credit instead of being settled as it prints. Off for almost every bill. */
  unpaid?: boolean;
  // Carried across the reload on purpose: if the bill was already committed
  // when the page went down, re-submitting with the same id is what makes the
  // server recognise the retry instead of billing the customer twice.
  requestId: string | null;
};

export default function NewOrderPage() {
  const router = useRouter();
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  // Customer details are part of the order, not a separate record to create
  // first. Search fills these in; anything typed here is saved when the order
  // is placed — a new mobile creates the customer, a known one is updated.
  // Most sales over the counter are anonymous cash sales, so the name box
  // starts on CASH and a bill can be rung up without touching it. Typing over
  // it is the whole "enter a customer" flow.
  const [details, setDetails] = useState({ shopName: "", mobile: "", ownerName: WALK_IN, address: "", gstin: "" });

  // Every new bill starts wholesale, whatever the customer is filed as; the
  // switch below is there for the rare retail sale.
  const [sellingMode, setSellingMode] = useState<"WHOLESALE" | "RETAIL">("WHOLESALE");
  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState<Product[]>([]);
  // Arrow-key highlight for both search dropdowns. Index into the results
  // array; -1 means nothing selectable (every product out of stock).
  const [customerIdx, setCustomerIdx] = useState(0);
  const [productIdx, setProductIdx] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  // Which row's quantity to focus once the new line has rendered. Set by
  // addProduct, cleared by the effect that does the focusing.
  const [focusQtyIdx, setFocusQtyIdx] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  // Counter sales are cash in hand, so the bill is recorded as paid the moment
  // it is generated (the order route does it). This is the exception: a bill
  // going on the customer's account.
  const [unpaid, setUnpaid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // "+ unit" on a line: the catalogue of units (fetched once, on first open)
  // and the open form's state, keyed by the line it belongs to.
  const [allUnits, setAllUnits] = useState<(Unit & { name: string })[]>([]);
  const [unitForm, setUnitForm] = useState<{ idx: number; unitId: string; factor: string; price: string; makeDefault: boolean; error: string | null; saving: boolean } | null>(null);
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  // The manager's switch. The create route enforces it too, so this only
  // decides whether the option is offered — a stale `true` here still fails
  // server-side rather than creating anything.
  const { data: addProductSetting } = useApiGet<{ enabled: boolean }>("/api/settings/finance-add-products");
  const canAddProduct = addProductSetting?.enabled !== false;

  const submittingRef = useRef(false); // checked and set synchronously — `submitting` state can't stop two fast Enters
  // One id per basket, not per click. A submission whose response is lost
  // after the server committed gets retried by the user pressing the button
  // again — reusing the id is what lets the server recognise that retry as
  // the same order instead of billing the customer twice. Cleared only on a
  // success (we've navigated away) or when the basket is emptied.
  const requestIdRef = useRef<string | null>(null);
  function currentRequestId() {
    return (requestIdRef.current ??= crypto.randomUUID());
  }
  const productInputRef = useRef<HTMLInputElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  // One entry per line row. Adding a product hands the cursor straight to that
  // row's quantity box, because on a wholesale bill the quantity is almost
  // never 1 — reaching for the mouse on every line was the slowest part of
  // billing. See focusQtyIdx below.
  const qtyRefs = useRef<(HTMLInputElement | null)[]>([]);
  const unitPickerOpenedRef = useRef(false); // Enter already opened the focused Unit list
  const customerInputRef = useRef<HTMLInputElement>(null);
  const customerNameRef = useRef<HTMLInputElement>(null);
  // Enter/Shift+Enter/arrow field movement walks this subtree in DOM order.
  const formRef = useRef<HTMLDivElement>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // "Has the saved basket been read yet" — the save effect below must not run
  // before it, or mounting would write an empty basket over the one waiting
  // to be recovered.
  const recovered = useRef(false);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  // A bill saved on this PC, shown in place: after a provisional bill, and from
  // the notice below. Never a navigation — offline, a route this tab hasn't
  // loaded is Chrome's "site can't be reached", and the slip would go with it.
  const [localBillId, setLocalBillId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ requestId: string; text: string } | null>(null);
  const alreadySaved = (b: LocalBill) => ({
    requestId: b.requestId,
    text: `This bill was already saved as ${b.server?.billNumber ?? b.offlineRef}${b.server?.billNumber ? ` (${b.offlineRef})` : ""} — changes to it go through Modify Bill.`,
  });

  // Restore in an effect rather than in the useState initialisers: this page
  // is server-rendered first, and reading localStorage during render makes the
  // two disagree.
  useEffect(() => {
    const saved = readEntry<SavedBasket>(ENTRY_KEYS.newOrder);
    setHeld(readEntry<{ bills: SavedBasket[] }>(ENTRY_KEYS.heldBills)?.bills ?? []);
    if (!saved?.lines?.length) {
      recovered.current = true;
      return;
    }
    // A basket with an id may already be a bill saved on this PC (the page went
    // down between Generate and clearing the screen). Handing it back as
    // editable would make edits that silently go nowhere — unless the server
    // refused it, when fixing and regenerating is exactly the way out.
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

  // Every keystroke. A bill is a few dozen small rows, so this is cheaper than
  // the debounce that would lose the last edit before the crash.
  useEffect(() => {
    if (!recovered.current) return;
    if (lines.length === 0) clearEntry(ENTRY_KEYS.newOrder);
    else saveEntry(ENTRY_KEYS.newOrder, snapshot());
  }, [details, customer, customerQuery, sellingMode, lines, notes, unpaid]);

  // Held bills — Marg's "open another sale bill". The counter is rarely one
  // customer at a time: the next one is waiting while this one goes to fetch
  // two more items. Alt+N parks what is on screen and starts a blank bill;
  // Alt+1…9 swaps a parked one back in, parking the current one in its place
  // so the numbers don't shuffle under the cashier. Parked bills live only in
  // this browser, like the in-progress one — nothing reaches the server (and
  // no stock is reserved) until one is actually billed.
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
    // Each bill keeps its own id, so a parked bill that was already submitted
    // once is still recognised as a retry, not billed a second time.
    requestIdRef.current = b?.requestId ?? null;
    setProductQuery("");
    setRestoredAt(null);
    setError(null);
  }

  // Nothing worth parking: no products and no customer picked.
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

  // The picked customer's balance, last bill and last rates. Only for a
  // customer on file — a walk-in has no history to show.
  const [ctx, setCtx] = useState<BillingContext | null>(null);
  useEffect(() => {
    setCtx(null);
    if (!customer) return;
    const ac = new AbortController();
    fetch(`/api/customers/${customer.id}/billing-context`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && typeof d === "object" && Array.isArray(d.lastRates) && setCtx(d))
      .catch(() => {}); // an aid, never a blocker — the bill works without it
    return () => ac.abort();
  }, [customer?.id]);

  function lastRateFor(l: Line) {
    return ctx?.lastRates.find((r) => r.productId === l.product.id && r.unitId === l.unitId);
  }

  // Offline read-cache (src/lib/offline-catalog.ts): loaded on mount (and again after a background refresh) so
  // search below can paint instantly from it, then reconciled with a live
  // fetch — see the two effects below for why stock still needs the network.
  const [cachedProducts, setCachedProducts] = useState<Awaited<ReturnType<typeof getCachedProducts>>>([]);
  const [cachedCustomers, setCachedCustomers] = useState<Awaited<ReturnType<typeof getCachedCustomers>>>([]);
  useEffect(() => {
    // The cache is an optimisation, never a dependency — if any part of it
    // fails the screen still works off live search.
    let live = true;
    const read = () => {
      if (!live) return;
      getCachedProducts().then(setCachedProducts).catch(() => {});
      getCachedCustomers().then(setCachedCustomers).catch(() => {});
    };
    // read() again once the background refresh lands, or new products stay unsearchable offline until a reload.
    ensureFreshCatalog(read).then(read).catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Both dropdowns are painted from the cache and then reconciled with a live
  // fetch. Rows on screen hold their places for as long as the same text is
  // typed — see mergeLiveResults. `painted` is what is currently on screen,
  // per box, and is what the live reply merges into; a new keystroke starts a
  // fresh list, a late-arriving cache refresh does not.
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

  // Customer search — instant from the local cache, then reconciled with a
  // live fetch (catches anyone created since the last sync).
  useEffect(() => {
    if (!customerQuery.trim() || customer) {
      paintedCustomers.current = { q: "", rows: [] };
      return setCustomerResults([]);
    }
    paintCustomers(customerQuery, searchCustomers(cachedCustomers, customerQuery) as Customer[], true);
    const ac = new AbortController(); // without this a late response for an older query overwrites the current results
    const t = setTimeout(() => {
      fetch(`/api/customers?q=${encodeURIComponent(customerQuery)}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => Array.isArray(d) && paintCustomers(customerQuery, d)) // a 401 body is an object, and a non-array here blanks the screen on the next render
        .catch(() => {}); // an abort (newer keystroke) or a failed search just leaves the cached results standing
    }, 200);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [customerQuery, customer, cachedCustomers]);

  // Both lists are painted twice (cache, then live), so the highlight follows
  // the record rather than resetting to row 0 — see carryIndex. -1 when there
  // is nothing to highlight; out of stock never makes a row unselectable.
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

  // Product search — instant from the local cache (no `available` yet, same
  // "not shown until known" handling the UI already had), then filled in by
  // the live fetch, which is the only source for real-time stock — that
  // field must never be served from yesterday's cache. The live reply fills
  // stock into the rows already shown and appends what it found extra; it
  // never reorders them, so the row under the cashier's finger stays put.
  useEffect(() => {
    if (!productQuery.trim()) {
      paintedProducts.current = { q: "", rows: [] };
      return setProductResults([]);
    }
    paintProducts(productQuery, searchProducts(cachedProducts, productQuery).map((p) => ({ ...p, available: null })) as Product[], true);
    const ac = new AbortController(); // a scanner fires fast — a stale response landing last would put the wrong product on the bill
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

  // What goes on the order. Sent every time so an edit to a picked customer
  // saves itself; the server matches on mobile and updates in place.
  function customerPayload() {
    if (customer) {
      return {
        id: customer.id,
        ownerName: customer.ownerName || customer.shopName || WALK_IN,
        shopName: customer.shopName || undefined,
        mobile: customer.mobile || undefined,
        type: customer.type || sellingMode,
        address: customer.address || undefined,
        gstin: customer.gstin || undefined,
      };
    }
    const ownerName = details.ownerName.trim() || details.shopName.trim() || WALK_IN;
    return {
      ownerName,
      shopName: details.shopName.trim() || undefined,
      mobile: details.mobile.trim() || undefined,
      type: sellingMode,
      address: details.address.trim() || undefined,
      gstin: details.gstin.trim() || undefined,
    };
  }

  // Prices are per *base* unit, so a line billed in a bigger unit scales by
  // that unit's factorToBase — a peti of 9 bottles costs 9x a bottle. Mirrors
  // resolveUnitPrice on the server; the server's figure is the one that bills.
  function priceFor(p: Product, unitId?: string) {
    const su = unitId ? p.saleUnits.find((u) => u.unitId === unitId) : defaultUnitOf(p);
    const own = sellingMode === "WHOLESALE" ? su?.wholesalePrice : su?.retailPrice;
    if (own != null && Number(own) > 0) return Number(own);
    const base = Number(sellingMode === "WHOLESALE" ? p.wholesalePrice : p.retailPrice);
    return base * Number(su?.factorToBase ?? 1);
  }

  function addProduct(p: Product) {
    // A barcode scan that hit a specific packaging wins over the base unit:
    // scanning the carton means they're selling a carton.
    const scanned = p.matchedUnitId ? p.saleUnits.find((u) => u.unitId === p.matchedUnitId) : undefined;
    const chosen = scanned ?? defaultUnitOf(p);
    // A product with no sale unit has nothing to bill it in. Nothing stops one
    // existing — Product.baseUnitId is required but no constraint demands a
    // matching ProductUnit — and the old `chosen!` turned that into a thrown
    // TypeError inside a setState updater, which unmounts the screen and takes
    // the half-entered bill with it. Refuse the line and say why instead.
    if (!chosen) {
      setError(`${p.name} has no sale unit set up — a manager needs to add one before it can be billed`);
      return;
    }
    // A scanner types the code and sends Enter by itself, so moving the cursor
    // into a number box after a scan would send the NEXT barcode into the
    // quantity field. An exact barcode hit — on the product or on one of its
    // units — is therefore left in the search box, ready for the next scan.
    // Anything found by name or SKU was typed by a person, who wants the qty.
    const wasScan = barcodesForProduct(p).includes(productQuery.trim());
    const existingIdx = lines.findIndex((l) => l.product.id === p.id && l.unitId === chosen.unitId);
    setLines((prev) => {
      // Merge only into a line for the SAME unit — scanning a carton and then
      // a loose piece is two different things to bill, not two cartons.
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

  // Focus and SELECT the quantity: it opens at 1, and a cashier typing 5 must
  // get 5, not 15. Runs after the new row has rendered.
  useEffect(() => {
    if (focusQtyIdx == null) return;
    const el = qtyRefs.current[focusQtyIdx];
    el?.focus();
    el?.select();
    setFocusQtyIdx(null);
  }, [focusQtyIdx]);

  // Keys inside a line row:
  //  Enter        Qty -> Unit (opens its list) -> back to the search box
  //  Shift+Enter  previous field, same as everywhere else on the screen
  //  Up/Down      same column on the line above/below (Qty, Price, Discount);
  //               Up from the first line returns to the search box
  //  Ctrl+Delete  remove the line
  //  Alt+L        bill this line at the customer's last rate (Marg's "last deal")
  // Tab still walks Qty -> Unit -> Price -> Discount -> remove.
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
      e.preventDefault(); // never the number spinner — a stray arrow must not rewrite a billed qty
      const row = e.key === "ArrowUp" ? e.currentTarget.previousElementSibling : e.currentTarget.nextElementSibling;
      const target = row?.querySelector<HTMLInputElement>(`[data-col="${col}"]`);
      if (target) target.focus();
      else if (e.key === "ArrowUp") productInputRef.current?.focus();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    // A focused button (remove, "+ unit") still gets its own Enter.
    if (el.tagName === "BUTTON") return;
    e.preventDefault();
    // Qty -> Unit -> search. A single-unit product has nothing to choose, so
    // Qty goes straight back to search.
    const unitSelect = e.currentTarget.querySelector<HTMLSelectElement>("select[data-unit]");
    if (col === "qty" && unitSelect && lines[idx]!.product.saleUnits.length > 1) return unitSelect.focus();
    // First Enter on Unit opens the list; picking from it returns to search
    // (the select's onChange). Enter again on the closed box also moves on,
    // for when the unit already shown was the one wanted.
    if (el === unitSelect && !unitPickerOpenedRef.current) {
      unitPickerOpenedRef.current = true;
      try {
        unitSelect.showPicker();
        return;
      } catch {} // browser without showPicker on <select>: just move on
    }
    productInputRef.current?.focus();
  }

  function onProductKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Nothing typed and Enter pressed: the cashier is done adding products.
    // Straight to Generate Bill — Notes is one Shift+Tab back for the rare
    // bill that needs one, rather than a stop on every bill that does not.
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
      e.preventDefault(); // claimed: Esc closes the list before it can mean "leave the screen"
      setProductResults([]);
    }
  }

  function onCustomerKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !customerQuery.trim()) {
      e.preventDefault();
      productInputRef.current?.focus();
      return;
    }
    const totalOptions = customerResults.length + (customerQuery.trim() ? 1 : 0);
    if (totalOptions === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCustomerIdx(nextIndex(totalOptions, customerIdx, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCustomerIdx(nextIndex(totalOptions, customerIdx, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (customerIdx === customerResults.length) {
        setShowAddCustomerModal(true);
      } else {
        const c = customerResults[customerIdx];
        if (c) selectCustomer(c);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setCustomerResults([]);
    }
  }

  // Attaching a missing packaging (a peti of something stocked in pieces) from
  // the counter — POST /api/admin/products/:id/units is open to FINANCE so the
  // queue doesn't stall waiting for a manager.
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
    // Blank rate means "derive from the base price x factor" — priceFor already
    // does that, so only send a figure when one was typed, and against the side
    // of the price list this bill is on.
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
      barcode: null, // a unit attached here has no code of its own until one is printed
      unit: picked,
    };
    setLines((prev) => {
      // Every line for this product shares one Product object, so the new unit
      // has to land on all of them — only the line that asked switches to it.
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
        // An overridden rate was typed against one specific unit — Rs 50 for a
        // piece is not Rs 50 for a peti of 48. Switching units drops it back
        // to the catalogue rate rather than silently repricing the line.
        const unitChanged = patch.unitId !== undefined && patch.unitId !== l.unitId;
        return { ...l, ...patch, ...(unitChanged && patch.unitPrice === undefined ? { unitPrice: undefined } : {}) };
      })
    );
  }

  // The removed row takes the focused field with it, which would strand a
  // keyboard user on <body>: land on the line that moved up, or the search box.
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

  // `!(n > 0)` rather than `n === 0`: clearing a number input yields
  // Number("") === 0, but a typed "-" can give NaN, and NaN fails every
  // comparison — this form catches zero, negative and NaN alike. Warned about
  // on screen and flagged to the manager by the order route; never a blocker.
  const zeroLines = lines.filter((l) => !(l.quantity > 0) || !(rateFor(l) > 0));
  const shortLines = lines.filter((l) => l.product.available != null && baseQtyForProduct(lines, l.product.id) > l.product.available);

  const money = lines.map(lineMoney);
  const { subtotal, discountTotal, taxTotal, total } = moneyTotals(money);
  // Warn-only, like the server's credit check: this is what they'd owe if the
  // whole bill goes on credit.
  const overLimitBy = ctx?.creditLimit != null ? round2(ctx.outstanding + total - ctx.creditLimit) : 0;

  // The basket is now on the server (or was already there). Drop both the
  // saved copy and the id that deduped it, so the next bill starts empty.
  function billed() {
    requestIdRef.current = null;
    clearEntry(ENTRY_KEYS.newOrder);
  }

  async function submit() {
    if (submittingRef.current) return; // the render state lags a fast second Enter — this doesn't
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
      // Left out when false: the server already treats a new bill as paid.
      ...(unpaid ? { unpaid: true } : {}),
      // Every rate frozen to what is on screen: a bill that syncs tomorrow must
      // charge what the provisional slip printed today, not tomorrow's price.
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
    // Saved on this PC first (offline-bills.ts), then sent. Same basket id as
    // before, so pressing Generate again can never make a second bill — and
    // the id is written into the saved basket NOW, so a crash before we
    // navigate can't bring the basket back under a fresh id and bill it twice.
    const requestId = currentRequestId();
    saveEntry(ENTRY_KEYS.newOrder, snapshot());
    const bill = await submitBill({ requestId, payload, display }).catch((err: unknown) => {
      if (err instanceof BillAlreadySentError) {
        // This basket was already billed and may be on the server: the edits
        // on screen were not applied. Say so and point at the real bill.
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
      // The server refused it (bad data, not a lost connection). The basket
      // stays on screen; fixing it and pressing Generate again resends this
      // same bill.
      setError(`Could not create the bill: ${bill.error ?? "refused by the server"}`);
      return;
    }
    billed();
    // Printed here, from what is on this PC, whether or not the server already
    // has the bill — never after a page change. Weak Wi-Fi can pass the bill
    // and then hang the next request with no timeout: the counter used to go to
    // the server bill and print from there, and sat on "Generating…" with the
    // customer waiting. A synced bill's slip carries its INV number.
    // Awaited: the slip must be out before anything can unload it. Then the
    // bill opens in place and the basket underneath is already fresh.
    await printLocalBill(bill).catch((err: unknown) => setError(`Could not print the slip: ${err instanceof Error ? err.message : String(err)} — reprint it from the bill.`));
    loadBasket(null);
    setLocalBillId(bill.requestId);
  }

  function closeLocalBill() {
    setLocalBillId(null);
    customerInputRef.current?.focus();
  }

  // No bill, no stock reservation — just parks the items for later. Doesn't
  // block on stock (that's checked fresh when it's finalized instead).
  async function saveDraft() {
    if (submittingRef.current) return;
    if (lines.length === 0) {
      setError("Add at least one product");
      return;
    }
    // Online-only: a draft reserves nothing and prints nothing, so there is
    // nothing to gain from queueing one.
    if (!navigator.onLine) {
      setError("Save as Draft needs the internet. Generate Bill works offline.");
      return;
    }
    // This basket already went to the outbox as a bill (the server refused it,
    // or it is waiting): a draft under the same id would be taken for that bill.
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
    // The server recognised this as a retry of a click it already committed:
    // the order exists but this response doesn't carry it. Send them to the
    // list rather than dereferencing an order that isn't in the payload.
    if (body.duplicate || !body.order) {
      billed();
      router.push("/finance/orders");
      return;
    }
    billed();
    router.push(`/finance/orders/${body.order.id}`);
  }

  // Innermost thing first, navigation last — a half-built bill is never lost
  // to a stray Esc, it asks first (Tally prompts the same way on quit).
  useEscapeKey(() => {
    if (localBillId) return; // the bill overlay answers its own Esc
    if (showAddCustomerModal) return setShowAddCustomerModal(false);
    if (showAddProductModal) return closeAddProductModal();
    if (unitForm) return setUnitForm(null);
    if (confirmDiscard) return setConfirmDiscard(false);
    if (productResults.length) return setProductResults([]);
    if (customerResults.length) return setCustomerResults([]);
    if (lines.length > 0) return setConfirmDiscard(true);
    router.push("/finance");
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
    // Not from under a popup — F10 while typing a new product's price must not bill.
    "submit-order": () => {
      if (!submitting && !showAddProductModal && !showAddCustomerModal && !confirmDiscard && !localBillId) submit();
    },
    "toggle-selling-mode": () => setSellingMode((m) => (m === "WHOLESALE" ? "RETAIL" : "WHOLESALE")),
    "hold-new-bill": holdAndStartNew,
    "toggle-key-guide": () => toggleGuide(),
    // F2 is "next customer". The layout's copy of it can't help here — it only
    // navigates, and this page IS the destination, so after a provisional bill
    // it did nothing and the counter had to reload. Parks anything unbilled
    // rather than throwing it away.
    "nav-new-order": () => {
      setLocalBillId(null);
      holdAndStartNew();
    },
  });

  // Remaps live in localStorage, which the server render can't see — start from
  // the defaults and swap in the user's keys after mount, or hydration disagrees.
  const [remapped, setRemapped] = useState<Record<string, string>>({});
  useEffect(() => setRemapped(Object.fromEntries(FINANCE_SHORTCUTS.map((s) => [s.id, getShortcutKey(s.id)]))), []);
  const [guideZone, setGuideZone] = useState("Move around");
  // Hidden or shown is this cashier's preference on this counter, so it is
  // remembered in the browser. Starts shown (server render), then reads it.
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
        <h1 className="mr-auto text-lg font-semibold">New Order</h1>
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

      {/* Say so. A basket that reappears by itself is unnerving if the cashier
          doesn't know why, and they need to know it was never billed. */}
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

      {/* Customer */}
      {/* Customer Unified Section */}
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
                  {customer.mobile && <span>📞 {customer.mobile}</span>}
                  {customer.address && <span>📍 {customer.address}</span>}
                  {customer.gstin && <span>🏛️ GSTIN: {customer.gstin}</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
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
                Change Customer (F3)
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
            </div>
          )}
        </div>
      ) : (
        <div className="card relative space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-muted">
              Customer (F3) — Walk-in (CASH) or Search Existing / Add New
            </label>
            <span className="text-[11px] text-muted">Press Enter on empty search for Walk-in Cash sale</span>
          </div>
          <div className="flex gap-2">
            <input
              ref={customerInputRef}
              className="flex-1 text-sm"
              autoFocus
              placeholder="Search shop name or mobile (or press Enter for Cash sale)…"
              value={customerQuery}
              onChange={(e) => setCustomerQuery(e.target.value)}
              onKeyDown={onCustomerKeyDown}
            />
            <button
              type="button"
              className="btn font-semibold text-xs border-accent text-accent hover:bg-accent/10 whitespace-nowrap"
              onClick={() => setShowAddCustomerModal(true)}
            >
              + Add New Customer
            </button>
          </div>

          {(customerResults.length > 0 || customerQuery.trim()) && (
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

              {customerQuery.trim() && (
                <button
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={customerIdx === customerResults.length}
                  ref={scrollToActive(customerIdx === customerResults.length)}
                  className={`flex w-full items-center justify-between border-t border-line px-3 py-2 text-left text-sm text-accent hover:bg-surface-hi ${
                    customerIdx === customerResults.length ? "bg-accent/10 font-medium ring-1 ring-inset ring-accent" : ""
                  }`}
                  onClick={() => setShowAddCustomerModal(true)}
                >
                  <span>+ Add &ldquo;{customerQuery.trim()}&rdquo; as new customer…</span>
                  <span className="text-xs text-muted">Opens details form (Enter)</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Selling mode */}
      <div className="card flex items-center gap-4">
        <span className="text-xs text-muted">Selling Mode (Alt+R)</span>
        {/* Out of the Enter/Tab/arrow path: an arrow key on a focused radio
            flips it, silently repricing every line. Alt+R or a click only. */}
        {(["RETAIL", "WHOLESALE"] as const).map((m) => (
          <label key={m} className="flex items-center gap-1 text-sm">
            <input type="radio" tabIndex={-1} checked={sellingMode === m} onChange={() => setSellingMode(m)} />
            {m}
          </label>
        ))}
      </div>

      {/* Product entry */}
      <div className="card relative">
        <label className="mb-1 block text-xs text-muted">Add Product — scan or type, Enter to add (F5)</label>
        <input
          ref={productInputRef}
          className="w-full"
          placeholder="Barcode / SKU / name…"
          value={productQuery}
          onChange={(e) => setProductQuery(e.target.value)}
          onKeyDown={onProductKeyDown}
        />
        {(productResults.length > 0 || (canAddProduct && productQuery.trim().length > 0)) && (
          <div role="listbox" className="absolute z-10 mt-1 max-h-72 w-[calc(100%-1.5rem)] overflow-y-auto border border-line bg-paper">
            {productResults.map((p, i) => {
              return (
                <button
                  key={p.id}
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === productIdx}
                  ref={scrollToActive(i === productIdx)}
                  className={`flex w-full justify-between px-2 py-1 text-left text-sm hover:bg-surface-hi ${i === productIdx ? "bg-accent/10 font-medium ring-1 ring-inset ring-accent" : ""}`}
                  onClick={() => addProduct(p)}
                >
                  <span>
                    <Highlight text={p.name} q={productQuery} /> <span className="text-muted">(<Highlight text={p.sku} q={productQuery} />)</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {/* Out of stock is a fact on the row, not a locked door:
                        it still bills, and the stock goes negative. */}
                    <span className={p.available != null && p.available <= 0 ? "text-bad" : "text-muted"}>
                      {p.available == null
                        ? ""
                        : p.available <= 0
                          ? "Out of stock"
                          : `${p.available.toFixed(2)} ${unitSym(p.baseUnit)} in stock`}
                    </span>
                    <span>₹{priceFor(p).toFixed(2)}</span>
                  </span>
                </button>
              );
            })}
            {/* A full page means there are almost certainly more behind it —
                say so, or the cashier reads the cut-off list as the whole shelf. */}
            {productResults.length >= SEARCH_LIMIT && (
              <p className="border-b border-line px-2 py-1 text-xs text-muted">Showing the first {SEARCH_LIMIT} — keep typing to narrow it down</p>
            )}
            {canAddProduct && productQuery.trim().length > 0 && (
              <button
                type="button"
                className={`block w-full px-2 py-2 text-left text-sm font-medium text-accent hover:bg-accent/10 ${
                  productResults.length === productIdx ? "bg-accent/10 ring-1 ring-inset ring-accent" : ""
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
                ➕ Add "{productQuery}" as new product
              </button>
            )}
          </div>
        )}
      </div>

      {/* Line items */}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th className="w-20">Qty</th>
              <th className="w-24">Unit</th>
              <th className="w-24">Price</th>
              <th className="w-24">Discount</th>
              <th className="w-28">Total</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => {
              const remaining = l.product.available == null ? null : l.product.available - baseQtyForProduct(lines, l.product.id);
              const short = remaining != null && remaining < 0;
              return (
              <tr key={`${l.product.id}-${idx}`} onKeyDown={(e) => onLineKeyDown(e, idx)}>
                <td>{l.product.name}</td>
                <td>
                  <input
                    ref={(el) => {
                      qtyRefs.current[idx] = el;
                    }}
                    data-col="qty"
                    type="number"
                    min={0}
                    step="0.001"
                    className={`w-full ${short ? "border-bad" : ""}`}
                    value={l.quantity}
                    onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) })}
                    onFocus={(e) => e.currentTarget.select()}
                    // The cursor now sits in this box by default, so a stray
                    // scroll while reading the total would silently rewrite a
                    // billed quantity. Give up focus instead of taking the wheel.
                    onWheel={(e) => e.currentTarget.blur()}
                  />
                  {remaining != null && (
                    <p className={`mt-0.5 text-xs ${short ? "text-bad" : "text-muted"}`}>
                      {short
                        ? `Only ${l.product.available?.toFixed(2)} ${unitSym(l.product.baseUnit)} in stock — goes to ${remaining?.toFixed(2)}`
                        : `${remaining?.toFixed(2)} ${unitSym(l.product.baseUnit)} left after this`}
                    </p>
                  )}
                </td>
                <td>
                  <select
                    data-unit
                    value={l.unitId}
                    onFocus={() => (unitPickerOpenedRef.current = false)}
                    onChange={(e) => {
                      updateLine(idx, { unitId: e.target.value });
                      if (unitPickerOpenedRef.current) productInputRef.current?.focus();
                    }}
                    className="w-full"
                  >
                    {l.product.saleUnits.map((u) => (
                      <option key={u.unitId} value={u.unitId}>
                        {unitSym(u.unit)}
                      </option>
                    ))}
                  </select>
                  {unitForm?.idx === idx ? (
                    <div
                      className="mt-1 space-y-1 border border-line p-1"
                      // Kept from the row's Enter/arrow handling. Stopping it here also keeps
                      // it from the window, so Esc has to be answered here too.
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Escape") setUnitForm(null);
                      }}
                    >
                      <select
                        className="w-full"
                        aria-label="Unit to attach"
                        value={unitForm.unitId}
                        onChange={(e) => setUnitForm({ ...unitForm, unitId: e.target.value })}
                      >
                        <option value="">Unit…</option>
                        {allUnits
                          .filter((u) => !l.product.saleUnits.some((su) => su.unitId === u.id))
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.symbol} — {u.name}
                            </option>
                          ))}
                      </select>
                      <input
                        type="number"
                        min={0}
                        step="0.001"
                        className="w-full"
                        aria-label={`${unitSym(l.product.baseUnit)} per unit`}
                        placeholder={`${unitSym(l.product.baseUnit)} in one`}
                        value={unitForm.factor}
                        onChange={(e) => setUnitForm({ ...unitForm, factor: e.target.value })}
                      />
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-full"
                        aria-label={`${sellingMode} rate for the new unit`}
                        placeholder="Rate (optional)"
                        value={unitForm.price}
                        onChange={(e) => setUnitForm({ ...unitForm, price: e.target.value })}
                      />
                      <label className="flex items-center gap-1 text-xs text-muted">
                        <input
                          type="checkbox"
                          checked={unitForm.makeDefault}
                          onChange={(e) => setUnitForm({ ...unitForm, makeDefault: e.target.checked })}
                        />
                        Default
                      </label>
                      {unitForm.error && <p className="text-xs text-bad">{unitForm.error}</p>}
                      <div className="flex gap-1">
                        <button type="button" className="btn-primary text-xs" disabled={unitForm.saving} onClick={saveUnit}>
                          {unitForm.saving ? "Adding…" : "Add"}
                        </button>
                        <button type="button" className="btn text-xs" onClick={() => setUnitForm(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" tabIndex={-1} className="mt-0.5 text-xs text-muted underline" onClick={() => openUnitForm(idx)}>
                      + unit
                    </button>
                  )}
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    data-col="price"
                    className="w-full"
                    aria-label={`Rate for ${l.product.name}`}
                    onFocus={(e) => e.currentTarget.select()}
                    onWheel={(e) => e.currentTarget.blur()}
                    title={l.unitPrice != null ? `Catalogue rate ₹${priceFor(l.product, l.unitId).toFixed(2)}` : "Catalogue rate — type to override"}
                    value={l.unitPrice ?? round2(priceFor(l.product, l.unitId))}
                    onChange={(e) => updateLine(idx, { unitPrice: e.target.value === "" ? undefined : Number(e.target.value) })}
                  />
                  {(() => {
                    const last = lastRateFor(l);
                    if (!last || round2(last.unitPrice) === round2(rateFor(l))) return null;
                    return (
                      <button
                        type="button"
                        tabIndex={-1}
                        className="block text-xs font-medium text-accent underline"
                        title={`Billed ${last.quantity} at ₹${last.unitPrice.toFixed(2)} on ${fmtDateTime(last.at)}`}
                        onClick={() => updateLine(idx, { unitPrice: last.unitPrice })}
                      >
                        last ₹{last.unitPrice.toFixed(2)} (Alt+L)
                      </button>
                    );
                  })()}
                  {l.unitPrice != null && (
                    <button
                      type="button"
                      tabIndex={-1}
                      className="text-xs text-muted underline"
                      onClick={() => updateLine(idx, { unitPrice: undefined })}
                    >
                      reset to ₹{priceFor(l.product, l.unitId).toFixed(2)}
                    </button>
                  )}
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    data-col="discount"
                    className="w-full"
                    value={l.discount}
                    onChange={(e) => updateLine(idx, { discount: Number(e.target.value) })}
                    onFocus={(e) => e.currentTarget.select()}
                    onWheel={(e) => e.currentTarget.blur()}
                  />
                </td>
                <td>₹{money[idx]!.total.toFixed(2)}</td>
                <td>
                  <button className="text-bad" onClick={() => removeLine(idx)} title="Remove (Ctrl+Delete)">
                    ✕
                  </button>
                </td>
              </tr>
              );
            })}
            {lines.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted">
                  No products added
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card flex justify-end">
        <div className="w-64 space-y-1 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>₹{subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Discount</span>
            <span>-₹{discountTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Tax</span>
            <span>₹{taxTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-t border-line pt-1 text-base font-semibold">
            <span>Total</span>
            <span>₹{total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="card" data-guide="bill">
        <label className="mb-1 block text-xs text-muted">Notes (printed on the bill)</label>
        <textarea className="w-full" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}
      {/* Never blockers. They exist so a 100-for-10 typo is caught here rather
          than found later as negative stock or a Rs 0 line — the bill goes
          through either way, and the manager gets the same note on the order. */}
      {shortLines.length > 0 && (
        <p className="text-sm text-warn">
          Billing more than is in stock for {[...new Set(shortLines.map((l) => l.product.name))].join(", ")} — stock will go
          negative. Check the quantity is right.
        </p>
      )}
      {zeroLines.length > 0 && (
        <p className="text-sm text-warn">
          {[...new Set(zeroLines.map((l) => l.product.name))].join(", ")} {zeroLines.length === 1 ? "has" : "have"} no quantity or no
          rate. The bill still goes through — it lands on the manager&rsquo;s list to sort out.
        </p>
      )}
      <label className="flex w-fit items-center gap-2 text-sm">
        <input type="checkbox" checked={unpaid} onChange={(e) => setUnpaid(e.target.checked)} />
        Unpaid — on the customer&rsquo;s account (otherwise the bill is recorded as paid in cash)
      </label>
      <div className="flex gap-2" data-guide="bill">
        <button className="btn w-40 py-2 text-base" disabled={submitting || lines.length === 0} onClick={saveDraft}>
          Save as Draft
        </button>
        <button ref={submitButtonRef} className="btn-primary flex-1 py-2 text-base" disabled={submitting} onClick={submit}>
          {submitting ? "Generating…" : "Generate Bill (F10)"}
        </button>
      </div>

      {confirmDiscard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmDiscard(false)}>
          <div className="w-full max-w-sm space-y-3 rounded border-2 border-bad bg-paper p-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-bad">Discard this bill?</h2>
            <p className="text-sm">
              {lines.length} {lines.length === 1 ? "product" : "products"} worth ₹{total.toFixed(2)} will be thrown away. Nothing is saved.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => setConfirmDiscard(false)}>
                Keep editing (Esc)
              </button>
              {/* Focused on open, so Enter answers the prompt. Esc cancels
                  instead, so the key that opened it can't also confirm it. */}
              <button
                autoFocus
                className="btn-danger"
                onClick={() => {
                  billed(); // thrown away deliberately — don't offer it back on the next bill
                  router.push("/finance");
                }}
              >
                Discard (Enter)
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Add Customer Modal */}
      {showAddCustomerModal && (
        <AddCustomerModal
          initialQuery={customerQuery}
          sellingMode={sellingMode}
          onClose={() => setShowAddCustomerModal(false)}
          onCreated={(newCust: NewCustomerData) => {
            selectCustomer(newCust);
            setShowAddCustomerModal(false);
          }}
        />
      )}

      {/* Its own keyboard world: Enter/Shift+Enter walk only the popup's fields,
          and stopping propagation keeps F10/F3/F5 from acting on the bill behind
          it — which is also why Esc is answered here. */}
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

      {/* The key guide, always beside the bill so nobody has to ask how. Sticky,
          so it stays in view on a long bill; below the bill on a narrow screen.
          The group for wherever the cursor is gets highlighted. Nothing in it
          takes focus, so it is never a stop between fields. */}
      {localBillId && <LocalBillOverlay requestId={localBillId} onClose={closeLocalBill} />}

      {!guideHidden && (
      <aside className="card space-y-3 text-xs lg:sticky lg:top-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">Keyboard — no mouse needed</span>
          <button type="button" tabIndex={-1} className="text-muted underline" onClick={toggleGuide} title="Bring it back from the top of the screen">
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
