/**
 * True when an error is a unique-constraint violation, across both query
 * layers: Prisma raises `P2002`, node-postgres (the Drizzle path) raises the
 * raw SQLSTATE `23505`. Barcodes and SKUs are user-entered unique columns, so
 * colliding on one is an ordinary "that code is already taken" — a 409 the
 * user can act on, not a 500.
 *
 * `constraintHint` narrows it to one column when a table has several unique
 * indexes (ProductUnit has both `barcode` and `[productId, unitId]`), so the
 * message can say which one actually collided. Prisma exposes the field names
 * in `meta.target`; pg exposes the index name in `constraint`.
 */
export function isUniqueViolation(err: unknown, constraintHint?: string): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; constraint?: string; meta?: { target?: unknown } };
  const isUnique = e.code === "P2002" || e.code === "23505";
  if (!isUnique) return false;
  if (!constraintHint) return true;

  const hint = constraintHint.toLowerCase();
  if (typeof e.constraint === "string" && e.constraint.toLowerCase().includes(hint)) return true;
  const target = e.meta?.target;
  if (Array.isArray(target)) return target.some((t) => String(t).toLowerCase().includes(hint));
  if (typeof target === "string") return target.toLowerCase().includes(hint);
  return false;
}
