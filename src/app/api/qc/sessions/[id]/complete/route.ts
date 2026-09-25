import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { isWorkersRuntime } from "@/lib/cf-env";

const schema = z.object({
  lineDecisions: z.array(
    z.object({
      productId: z.string(),
      action: z.enum(["KEEP", "REDUCE", "REMOVE", "MARK_UNAVAILABLE"]),
      finalQty: z.number().min(0),
      reason: z.string().optional(),
    })
  ),
  // Which lines QC physically verified by scanning a barcode. Never enforced —
  // completing with nothing scanned is still valid. It only enriches the
  // QC_COMPLETED audit entry so Admin/Manager can see afterwards how much of a
  // handover was scan-verified rather than eyeballed.
  scannedProductIds: z.array(z.string()).default([]),
  totalLineCount: z.number().int().nonnegative().optional(),
});

// Summary of the barcode check, stored on the QC_COMPLETED audit entry.
// `scannedCount === 0` is what tells a reviewing manager the handover was
// confirmed by eye alone — which is allowed, but worth being able to see.
function buildScanVerification(data: z.infer<typeof schema>) {
  const scannedCount = new Set(data.scannedProductIds).size;
  const lineCount = data.totalLineCount ?? data.lineDecisions.length;
  return { scannedProductIds: data.scannedProductIds, scannedCount, lineCount };
}

// Implements the PRD §36 atomic QC-completion sequence: validate → recalc
// bill → create version → deduct inventory → adjust payment → audit — all in
// one transaction, or nothing happens (PRD §36).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(["ADMIN", "QC"]);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const onWorkers = isWorkersRuntime();

  const qcSession = onWorkers
    ? await (async () => {
        const { getDrizzleDb } = await import("@/lib/drizzle-db");
        return getDrizzleDb().query.qcSession.findFirst({ where: (t, { eq }) => eq(t.id, id), with: { order: true } });
      })()
    : await (await import("@/lib/db")).getDb().qcSession.findUnique({ where: { id }, include: { order: true } });
  if (!qcSession) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const forbidden = assertWarehouseAccess(session, qcSession.order.warehouseId);
  if (forbidden) return forbidden;

  // Role + warehouse alone let any QC user in the warehouse finalise a
  // colleague's in-progress session — a money- and stock-affecting write they
  // never physically checked. Only the lock holder may complete; ADMIN keeps
  // an override (for a holder who has gone home mid-session) but it is audited.
  const isAdminOverride = qcSession.qcUserId !== session.sub && session.role === "ADMIN";
  if (qcSession.qcUserId !== session.sub && !isAdminOverride) {
    return NextResponse.json({ error: "You don't hold this session's lock" }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const result = onWorkers
      ? await (
          await import("@/lib/drizzle-qc-service")
        ).completeQcSessionDrizzle((await import("@/lib/drizzle-db")).getDrizzleDb(), {
          sessionId: id,
          userId: session.sub,
          lineDecisions: parsed.data.lineDecisions,
          scanVerification: buildScanVerification(parsed.data),
        })
      : await (
          await import("@/lib/qc-service")
        ).completeQcSession((await import("@/lib/db")).getDb(), {
          sessionId: id,
          userId: session.sub,
          lineDecisions: parsed.data.lineDecisions as any,
          scanVerification: buildScanVerification(parsed.data),
        });
    if (!result.ok) {
      return NextResponse.json({ error: "CHANGE_BLOCKED", lines: result.lines }, { status: 400 });
    }
    if (isAdminOverride) {
      // Separate entry from QC_COMPLETED so a reviewer can see the completion
      // was not done by the person who held the session.
      const entry = {
        userId: session.sub,
        role: session.role,
        warehouseId: qcSession.order.warehouseId,
        action: "QC_COMPLETED_BY_ADMIN_OVERRIDE",
        entityType: "QcSession",
        entityId: id,
        oldValue: { lockHolder: qcSession.qcUserId },
      };
      if (onWorkers) await (await import("@/lib/drizzle-audit")).writeAuditDrizzle(entry);
      else await (await import("@/lib/audit")).writeAudit(entry);
    }
    return NextResponse.json(result);
  } catch (err) {
    const { QcValidationError } = await import("@/lib/qc-service");
    if (err instanceof QcValidationError) {
      // Only reachable if state changed between the pre-check and the commit
      // transaction (PRD §37 concurrency) — same response shape either way.
      return NextResponse.json({ error: "CHANGE_BLOCKED", lines: err.lines }, { status: 400 });
    }
    if (err instanceof Error && err.message === "CHANGE_BLOCKED") {
      // Drizzle path's in-transaction recheck throws a plain Error (no line detail) on the same race.
      return NextResponse.json({ error: err.message, lines: [] }, { status: 400 });
    }
    throw err;
  }
}
