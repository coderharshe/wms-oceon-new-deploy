import { NextResponse } from "next/server";
import type { Role } from "@/generated/prisma/client";
import { getSession, type SessionPayload } from "./auth";

/**
 * Every API route must call this first. This is the real permission boundary —
 * the frontend hiding a button is not security (PRD §38).
 *
 * Usage:
 *   const session = await requireRole(["ADMIN", "FINANCE"]);
 *   if (session instanceof NextResponse) return session; // 401/403 already built
 */
export async function requireRole(
  allowed: Role[]
): Promise<SessionPayload | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!allowed.includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return session;
}

/**
 * Enforces PRD §6: user.warehouse_id == requested_resource.warehouse_id.
 * ADMIN bypasses (global access); everyone else must match exactly.
 */
export function assertWarehouseAccess(
  session: SessionPayload,
  resourceWarehouseId: string
): NextResponse | null {
  if (session.role === "ADMIN") return null;
  if (session.warehouseId !== resourceWarehouseId) {
    return NextResponse.json(
      { error: "Forbidden: cross-warehouse access" },
      { status: 403 }
    );
  }
  return null;
}

export function isErrorResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}
