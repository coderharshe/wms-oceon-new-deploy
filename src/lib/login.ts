import { isWorkersRuntime } from "./cf-env";
import { verifyPassword } from "./password";
import { createSessionToken, setSessionCookie } from "./auth";
import { setActiveSid } from "./session-registry";

// Shared by /api/auth/login and the takeover flow (/api/auth/login/takeover*)
// — both need to look a user up and, once a login is actually granted, mint
// the same kind of session. Dual-path (Prisma locally, Drizzle on Workers),
// same reasoning as every other route in this codebase.
export async function findActiveUserByStaffId(staffId: string) {
  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("./drizzle-db");
    const { user: userTable } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    return getDrizzleDb().query.user.findFirst({ where: eq(userTable.staffId, staffId) });
  }
  return (await import("./db")).getDb().user.findUnique({ where: { staffId } });
}

export async function findActiveUserById(id: string) {
  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("./drizzle-db");
    const { user: userTable } = await import("@/generated/drizzle/schema");
    const { eq } = await import("drizzle-orm");
    return getDrizzleDb().query.user.findFirst({ where: eq(userTable.id, id) });
  }
  return (await import("./db")).getDb().user.findUnique({ where: { id } });
}

/**
 * `x-forwarded-for` is client-settable — anyone can send one, which makes it
 * useless both as a throttle key (rotate it, get unlimited guesses) and as an
 * audit record. Cloudflare overwrites `cf-connecting-ip` with the real TCP
 * peer on every request, so prefer it and only fall back off-Workers.
 */
export function clientIp(req: Request) {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
}

// No strength rules on purpose: this is a closed till system on the shop
// network, the staff pick something they can type at a counter, and a
// password a cashier has to write on a sticky note is the weaker one. The
// login throttle in session-registry.ts is what stands against guessing.

export async function verifyCredentials(staffId: string, password: string) {
  const user = await findActiveUserByStaffId(staffId);
  if (!user || !user.active) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? user : null;
}

type LoginableUser = { id: string; staffId: string; name: string; role: any; warehouseId: string | null };

/** Mints the session (cookie + KV registry entry) and writes the LOGIN audit row. */
export async function completeLogin(user: LoginableUser, ipAddress?: string) {
  const sid = crypto.randomUUID();
  const token = await createSessionToken({ sub: user.id, staffId: user.staffId, name: user.name, role: user.role, warehouseId: user.warehouseId, sid });
  await setSessionCookie(token);
  await setActiveSid(user.id, sid);

  const auditArgs = { userId: user.id, role: user.role, warehouseId: user.warehouseId, action: "LOGIN", entityType: "User", entityId: user.id, ipAddress };
  if (isWorkersRuntime()) {
    await (await import("./drizzle-audit")).writeAuditDrizzle(auditArgs);
  } else {
    await (await import("./audit")).writeAudit(auditArgs);
  }

  return { role: user.role, name: user.name, warehouseId: user.warehouseId };
}
