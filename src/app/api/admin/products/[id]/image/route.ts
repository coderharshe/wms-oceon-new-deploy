import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { putFile } from "@/lib/r2";
import { isWorkersRuntime } from "@/lib/cf-env";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — plenty for a product photo, keeps R2 cost/latency low
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;
  const { id } = await params;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: "Only JPEG/PNG/WebP images are allowed" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Image must be under 5MB" }, { status: 400 });

  const ext = file.type.split("/")[1];
  const key = `products/${id}/image.${ext}`;

  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { product } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
    const db = getDrizzleDb();
    const [existing] = await db.select().from(product).where(eq(product.id, id));
    if (!existing) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    await putFile(key, await file.arrayBuffer(), file.type);
    await db.update(product).set({ imageKey: key }).where(eq(product.id, id));
    await writeAuditDrizzle({ userId: session.sub, role: session.role, action: "PRODUCT_IMAGE_UPLOADED", entityType: "Product", entityId: id, newValue: { imageKey: key } });
    return NextResponse.json({ imageKey: key });
  }

  const db = (await import("@/lib/db")).getDb();
  const product = await db.product.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  await putFile(key, await file.arrayBuffer(), file.type);

  await db.product.update({ where: { id }, data: { imageKey: key } });
  await (await import("@/lib/audit")).writeAudit({
    userId: session.sub,
    role: session.role,
    action: "PRODUCT_IMAGE_UPLOADED",
    entityType: "Product",
    entityId: id,
    newValue: { imageKey: key },
  });

  return NextResponse.json({ imageKey: key });
}
