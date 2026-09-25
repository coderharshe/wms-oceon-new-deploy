import { getEnv, isWorkersRuntime } from "./cf-env";

/** DB-backed system settings (PRD §5 "Manage system settings"), env as the seed default. */
export async function getSetting(key: string): Promise<string> {
  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("./drizzle-db");
    const { systemSetting } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await getDrizzleDb().select().from(systemSetting).where(eq(systemSetting.key, key));
    if (row) return row.value as string;
    return getEnv(key) ?? "";
  }

  const db = (await import("./db")).getDb();
  const row = await db.systemSetting.findUnique({ where: { key } });
  if (row) return row.value as string;
  return getEnv(key) ?? "";
}

export async function setSetting(key: string, value: string) {
  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("./drizzle-db");
    const { systemSetting } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = getDrizzleDb();
    const [existing] = await db.select().from(systemSetting).where(eq(systemSetting.key, key));
    const now = new Date().toISOString();
    if (existing) await db.update(systemSetting).set({ value, updatedAt: now }).where(eq(systemSetting.key, key));
    else await db.insert(systemSetting).values({ key, value, updatedAt: now });
    return;
  }

  const db = (await import("./db")).getDb();
  await db.systemSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

// ───────────────────────── QC on/off ─────────────────────────

/** Anything but an explicit "false" means QC is on — an unset setting must not skip QC. */
export function qcEnabledFromValue(value: string) {
  return String(value) !== "false";
}

/**
 * When a manager switches QC off, Finance's "send to QC" instead finalises the
 * order itself (same money/stock path, no QC step) and QC staff can't sign in.
 */
export async function isQcEnabled() {
  return qcEnabledFromValue(await getSetting("QC_ENABLED"));
}

// ───────────────── Finance adding products mid-bill ─────────────────

/** Anything but an explicit "false" means Finance may add products. */
export function financeCanAddProductsFromValue(value: string) {
  return String(value) !== "false";
}

/**
 * Whether Finance may create a product from the New Order screen when a
 * search finds nothing.
 *
 * A counter clerk inventing a SKU mid-sale is a real convenience and a real
 * risk — the price they type is the price the shop sells at — so the switch
 * is the manager's, and the product they create lands on the manager's review
 * screen rather than quietly joining the catalogue.
 */
export async function financeCanAddProducts() {
  return financeCanAddProductsFromValue(await getSetting("FINANCE_ADD_PRODUCTS"));
}
