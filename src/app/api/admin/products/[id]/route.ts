import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";
import { isUniqueViolation } from "@/lib/db-errors";
import { fail } from "@/lib/api-error";

const schema = z.object({
  sku: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  // Throughout: null clears the field, undefined leaves it untouched. Without
  // the null, emptying a box in the edit modal sent `undefined` and the old
  // value silently stayed — a category typed by mistake could not be removed.
  category: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  barcode: z.string().min(1).nullable().optional(),
  baseUnitId: z.string().optional(),
  wholesalePrice: z.number().nonnegative().optional(),
  retailPrice: z.number().nonnegative().optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  minStock: z.number().nullable().optional(),
  maxStock: z.number().nullable().optional(),
  mfgDate: z.string().nullable().optional(),
  expiryDate: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    return await patchProduct(session, id, parsed.data);
  } catch (err) {
    if (isUniqueViolation(err, "sku")) {
      return fail(409, "That SKU is already assigned to another product.", { label: "Find it", href: `/manager/products?q=${encodeURIComponent(parsed.data.sku ?? "")}` });
    }
    if (isUniqueViolation(err, "barcode")) {
      return fail(409, "That barcode is already assigned to another product or unit.", { label: "Find it", href: `/manager/products?q=${encodeURIComponent(parsed.data.barcode ?? "")}` });
    }
    throw err;
  }
}

async function patchProduct(
  session: Exclude<Awaited<ReturnType<typeof requireRole>>, NextResponse>,
  id: string,
  data: z.infer<typeof schema>
) {
  const parsed = { data };
  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { product } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    const db = getDrizzleDb();
    const { wholesalePrice, retailPrice, taxPercent, minStock, maxStock, mfgDate, expiryDate, ...rest } = parsed.data;
    const [before] = await db.select().from(product).where(eq(product.id, id));
    const [updated] = await db
      .update(product)
      .set({
        ...rest,
        ...(wholesalePrice !== undefined ? { wholesalePrice: wholesalePrice.toString() } : {}),
        ...(retailPrice !== undefined ? { retailPrice: retailPrice.toString() } : {}),
        ...(taxPercent !== undefined ? { taxPercent: taxPercent.toString() } : {}),
        ...(minStock !== undefined ? { minStock: minStock?.toString() ?? null } : {}),
        ...(maxStock !== undefined ? { maxStock: maxStock?.toString() ?? null } : {}),
        ...(mfgDate !== undefined ? { mfgDate: mfgDate ? new Date(mfgDate).toISOString() : null } : {}),
        ...(expiryDate !== undefined ? { expiryDate: expiryDate ? new Date(expiryDate).toISOString() : null } : {}),
      })
      .where(eq(product.id, id))
      .returning();
    await writeAuditDrizzle({
      userId: session.sub,
      role: session.role,
      action: "PRODUCT_UPDATED",
      entityType: "Product",
      entityId: id,
      oldValue: before ? { wholesalePrice: before.wholesalePrice.toString(), retailPrice: before.retailPrice.toString() } : undefined,
      newValue: parsed.data,
    });
    return NextResponse.json(updated);
  }

  const db = (await import("@/lib/db")).getDb();
  const before = await db.product.findUnique({ where: { id } });
  const { mfgDate, expiryDate, ...otherData } = parsed.data;
  const updatePayload: any = {
    ...otherData,
    ...(mfgDate !== undefined ? { mfgDate: mfgDate ? new Date(mfgDate) : null } : {}),
    ...(expiryDate !== undefined ? { expiryDate: expiryDate ? new Date(expiryDate) : null } : {}),
  };
  const product = await db.product.update({ where: { id }, data: updatePayload });
  await (await import("@/lib/audit")).writeAudit({
    userId: session.sub,
    role: session.role,
    action: "PRODUCT_UPDATED",
    entityType: "Product",
    entityId: id,
    oldValue: before ? { wholesalePrice: before.wholesalePrice.toString(), retailPrice: before.retailPrice.toString() } : undefined,
    newValue: parsed.data,
  });
  return NextResponse.json(product);
}
