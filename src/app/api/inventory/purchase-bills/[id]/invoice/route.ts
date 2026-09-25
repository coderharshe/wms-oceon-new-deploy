import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { putFile } from "@/lib/r2";
import { isWorkersRuntime } from "@/lib/cf-env";

// Photo of the supplier's paper bill. Separate from bill creation on purpose:
// the stock-in must not fail because a camera did, and a bill received from
// the offline queue can have its photo attached once back on the network.
const MAX_BYTES = 5 * 1024 * 1024; // same cap as product images
const MAX_PAGES = 5; // multi-page supplier bills are common; five is plenty
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER", "FINANCE"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: "Only JPEG/PNG/WebP images or PDF are allowed" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File must be under 5MB" }, { status: 400 });

  const ext = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { purchaseBill } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    const db = getDrizzleDb();
    const [bill] = await db.select().from(purchaseBill).where(eq(purchaseBill.id, id));
    if (!bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    const forbidden = assertWarehouseAccess(session, bill.warehouseId);
    if (forbidden) return forbidden;
    const existingKeys = bill.invoiceKeys ?? [];
    if (existingKeys.length >= MAX_PAGES) return NextResponse.json({ error: `At most ${MAX_PAGES} pages per bill` }, { status: 400 });

    const key = `purchase-bills/${id}/${existingKeys.length + 1}.${ext}`;
    await putFile(key, await file.arrayBuffer(), file.type);
    const invoiceKeys = [...existingKeys, key];
    await db.update(purchaseBill).set({ invoiceKeys }).where(eq(purchaseBill.id, id));
    await writeAuditDrizzle({
      userId: session.sub,
      role: session.role,
      warehouseId: bill.warehouseId,
      action: "PURCHASE_INVOICE_UPLOADED",
      entityType: "PurchaseBill",
      entityId: id,
      newValue: { key },
    });
    return NextResponse.json({ invoiceKeys });
  }

  const db = (await import("@/lib/db")).getDb();
  const bill = await db.purchaseBill.findUnique({ where: { id } });
  if (!bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  const forbidden = assertWarehouseAccess(session, bill.warehouseId);
  if (forbidden) return forbidden;
  if (bill.invoiceKeys.length >= MAX_PAGES) return NextResponse.json({ error: `At most ${MAX_PAGES} pages per bill` }, { status: 400 });

  const key = `purchase-bills/${id}/${bill.invoiceKeys.length + 1}.${ext}`;
  await putFile(key, await file.arrayBuffer(), file.type);
  const invoiceKeys = [...bill.invoiceKeys, key];
  await db.purchaseBill.update({ where: { id }, data: { invoiceKeys } });
  await (await import("@/lib/audit")).writeAudit({
    userId: session.sub,
    role: session.role,
    warehouseId: bill.warehouseId,
    action: "PURCHASE_INVOICE_UPLOADED",
    entityType: "PurchaseBill",
    entityId: id,
    newValue: { key },
  });
  return NextResponse.json({ invoiceKeys });
}
