import { NextResponse } from "next/server";
import type { SessionPayload } from "./auth";

/** Which warehouse a day-book request is about: a manager's own, or the admin's pick. */
export function cashWarehouse(session: SessionPayload, requested: string | null | undefined): string | NextResponse {
  if (session.role !== "ADMIN") {
    if (!session.warehouseId) return NextResponse.json({ error: "No warehouse assigned" }, { status: 400 });
    return session.warehouseId;
  }
  const w = requested || session.warehouseId;
  return w ?? NextResponse.json({ error: "Choose a warehouse" }, { status: 400 });
}

export const isDay = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
