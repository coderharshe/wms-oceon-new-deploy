import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";
import { isUniqueViolation } from "@/lib/db-errors";
import { supplierSchema } from "@/lib/purchase";

// Edit/deactivate, for ADMIN and MANAGER. The manager already creates
// suppliers at the gate (POST /api/suppliers) and settles their bills
// (PATCH /api/inventory/purchase-bills/[id]), so withholding "fix the phone
// number you just typed wrong" only bought a queue at the admin's desk. Every
// change is audited either way.
//
// There's still no DELETE: a supplier with purchase history is referenced by
// every bill it ever sent, so `active: false` is the only sane retirement —
// it drops out of the receive form's picker and stays in the ledger.
const patchSchema = supplierSchema.partial().extend({ active: z.boolean().optional() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY", "PROCUREMENT"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const raw = parsed.data;
  const data: Record<string, any> = {
    ...raw,
    ...(raw.name ? { name: raw.name.trim() } : {}),
    ...(raw.gstin !== undefined ? { gstin: raw.gstin ? raw.gstin.trim().toUpperCase() : null } : {}),
    ...(raw.email !== undefined ? { email: raw.email?.trim() || null } : {}),
    ...(raw.category !== undefined ? { category: raw.category?.trim() || null } : {}),
    ...(raw.contactPerson !== undefined ? { contactPerson: raw.contactPerson?.trim() || null } : {}),
    ...(raw.phone !== undefined ? { phone: raw.phone?.trim() || null } : {}),
    ...(raw.address !== undefined ? { address: raw.address?.trim() || null } : {}),
    ...(raw.city !== undefined ? { city: raw.city?.trim() || null } : {}),
    ...(raw.state !== undefined ? { state: raw.state?.trim() || null } : {}),
    ...(raw.paymentTerms !== undefined ? { paymentTerms: raw.paymentTerms?.trim() || null } : {}),
    ...(raw.bankDetails !== undefined ? { bankDetails: raw.bankDetails?.trim() || null } : {}),
    ...(raw.contractStart !== undefined ? { contractStart: raw.contractStart ? new Date(raw.contractStart) : null } : {}),
    ...(raw.contractEnd !== undefined ? { contractEnd: raw.contractEnd ? new Date(raw.contractEnd) : null } : {}),
    ...(raw.supplyType !== undefined ? { supplyType: raw.supplyType || "INWARD" } : {}),
    ...(raw.creditDays !== undefined ? { creditDays: Number(raw.creditDays || 0) } : {}),
    ...(raw.creditLimit !== undefined ? { creditLimit: raw.creditLimit != null ? Number(raw.creditLimit) : null } : {}),
    ...(raw.notes !== undefined ? { notes: raw.notes?.trim() || null } : {}),
    ...(raw.active !== undefined ? { active: raw.active } : {}),
  };

  try {
    if (isWorkersRuntime()) {
      const { getDrizzleDb } = await import("@/lib/drizzle-db");
      const { supplier } = await import("@/generated/drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
      const db = getDrizzleDb();
      const [updated] = await db.update(supplier).set(data).where(eq(supplier.id, id)).returning();
      if (!updated) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
      await writeAuditDrizzle({
        userId: session.sub,
        role: session.role,
        action: "SUPPLIER_UPDATED",
        entityType: "Supplier",
        entityId: id,
        newValue: data,
      });
      return NextResponse.json(updated);
    }

    const db = (await import("@/lib/db")).getDb();
    const existing = await db.supplier.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    const updated = await db.supplier.update({ where: { id }, data });
    await (await import("@/lib/audit")).writeAudit({
      userId: session.sub,
      role: session.role,
      action: "SUPPLIER_UPDATED",
      entityType: "Supplier",
      entityId: id,
      oldValue: { name: existing.name, active: existing.active, gstin: existing.gstin },
      newValue: data,
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (isUniqueViolation(err)) return NextResponse.json({ error: "A supplier with this name already exists" }, { status: 409 });
    throw err;
  }
}
