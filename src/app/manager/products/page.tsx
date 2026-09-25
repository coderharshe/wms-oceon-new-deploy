"use client";

import { ErrorNote } from "@/components/ErrorNote";
import { readError, type ApiError } from "@/lib/read-error";
import { useEffect, useState } from "react";
import { useApiGet } from "@/lib/useApiGet";
import { ErrorRetry } from "@/components/ErrorRetry";
import { SkeletonTable } from "@/components/Skeleton";
import { EditProductModal } from "@/components/EditProductModal";
import { AddProductModal } from "@/components/AddProductModal";
import { Highlight, matchesQuery } from "@/components/Highlight";
import { useDebounced } from "@/lib/useDebounced";

type Unit = { id: string; symbol: string };
type Product = {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  category: string | null;
  brand: string | null;
  wholesalePrice: string;
  retailPrice: string;
  taxPercent: string;
  minStock: string | null;
  maxStock: string | null;
  active: boolean;
  imageKey: string | null;
  baseUnit: Unit;
  saleUnits: { unitId: string; unit: Unit; factorToBase: string; barcode: string | null; wholesalePrice: string | null; retailPrice: string | null }[];
};

// Manager gets the same edit capability as Admin's Products page, and the
// same ability to add one. It used to be admin-only here while
// POST /api/admin/products already accepted MANAGER — so the restriction was
// only a missing button, and its effect was that a manager holding a delivery
// of something new could not get it into the catalogue at all. The full
// multi-unit/barcode form stays on the Admin page; this is the short form,
// the same one Finance adds from.
export default function ManagerProductsPage() {
  // Server-side search — see the Admin page: 200 rows come back, the
  // catalogue is far bigger, so filtering only the loaded page hid most of it.
  const [q, setQ] = useState("");
  // Arriving from an error's "Find it" button (?q=<barcode|sku>) opens on that
  // one product instead of the whole catalogue. Read after mount rather than
  // via useSearchParams, which would force the page behind a Suspense boundary
  // for one optional flag — same reasoning as Inventory's #low.
  useEffect(() => {
    const from = new URLSearchParams(window.location.search).get("q");
    if (from) setQ(from);
  }, []);
  const debouncedQ = useDebounced(q.trim());
  const { data, error, loading, reload: load } = useApiGet<Product[]>(`/api/admin/products?q=${encodeURIComponent(debouncedQ)}`);
  const list = (data ?? []).filter((p) => matchesQuery(q, p.sku, p.name, p.barcode, p.category, p.brand));
  const [editing, setEditing] = useState<Product | null>(null);
  const [imageError, setImageError] = useState<ApiError | null>(null);

  // Same upload the Admin Products page has had all along — the route was
  // simply ADMIN-only, so a manager holding the product photo had nowhere to
  // put it.
  async function uploadImage(productId: string, file: File) {
    setImageError(null);
    const body = new FormData();
    body.set("file", file);
    const res = await fetch(`/api/admin/products/${productId}/image`, { method: "POST", body });
    if (!res.ok) {
      return setImageError(await readError(res, "Could not upload image"));
    }
    load();
  }
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Products</h1>
      {error && <ErrorRetry message={error} onRetry={load} />}
      <ErrorNote error={imageError} />
      <div className="flex flex-wrap items-center gap-2">
        <input className="w-64" placeholder="Search SKU / name / barcode…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary" onClick={() => setAdding(true)}>
          + Add product
        </button>
      </div>
      {loading ? (
        <SkeletonTable rows={6} cols={8} />
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Image</th>
                <th>SKU</th>
                <th>Name</th>
                <th>Base unit</th>
                <th>Wholesale</th>
                <th>Retail</th>
                <th>Tax</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      {p.imageKey && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/files/${p.imageKey}`} alt="" className="h-8 w-8 rounded object-cover" />
                      )}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="w-32 text-xs"
                        aria-label={`Photo for ${p.name}`}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadImage(p.id, file);
                        }}
                      />
                    </div>
                  </td>
                  <td><Highlight text={p.sku} q={q} /></td>
                  <td><Highlight text={p.name} q={q} /></td>
                  <td>{p.baseUnit.symbol}</td>
                  <td>₹{Number(p.wholesalePrice).toFixed(2)}</td>
                  <td>₹{Number(p.retailPrice).toFixed(2)}</td>
                  <td>{p.taxPercent}%</td>
                  <td>{p.active ? "Active" : "Inactive"}</td>
                  <td>
                    <button className="btn" onClick={() => setEditing(p)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <EditProductModal product={editing} onClose={() => setEditing(null)} onSaved={load} />}
      {adding && (
        <AddProductModal
          initialName={q.trim()}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            load();
          }}
        />
      )}
    </div>
  );
}
