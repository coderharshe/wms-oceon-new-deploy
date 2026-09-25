import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse, assertWarehouseAccess } from "@/lib/guard";
import { publish } from "@/lib/realtime";
import { isWorkersRuntime } from "@/lib/cf-env";
import { isLockStale } from "@/lib/qc-lock";

const schema = z.object({ orderId: z.string() });
// QC_IN_PROGRESS is here too: this endpoint is also how the QC session page
// resolves its session id on load/refresh, so re-opening (or resuming) an
// order that's already being worked on must succeed, not 409.
const STARTABLE = ["READY_FOR_QC", "QC_IN_PROGRESS"];
const ACTIVE_SESSION = ["IN_PROGRESS", "CHANGES_REQUIRED"] as const;

/** Order status changed between the pre-check and the row lock — not a bug, just lost the race. */
class QcConflictError extends Error {}
/** A different QC user's lock is still active — routes this to 423 with holder info. */
class QcLockedError extends Error {
  constructor(message: string, public lockedByName: string, public lockedSince: string) {
    super(message);
  }
}

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "QC"]);
  if (isErrorResponse(session)) return session;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    if (isWorkersRuntime()) {
      const { getDrizzleDb } = await import("@/lib/drizzle-db");
      const { order, qcSession, user } = await import("@/generated/drizzle/schema");
      const { eq, and, inArray } = await import("drizzle-orm");
      const { writeAuditDrizzle } = await import("@/lib/drizzle-audit");
      const db = getDrizzleDb();

      const [ord0] = await db.select().from(order).where(eq(order.id, parsed.data.orderId));
      if (!ord0) return NextResponse.json({ error: "Order not found" }, { status: 404 });
      const forbidden = assertWarehouseAccess(session, ord0.warehouseId);
      if (forbidden) return forbidden;

      let started = false;
      const qc = await db.transaction(async (tx) => {
        // Row lock: two QC staff opening the same order at once must not
        // both pass the "no existing session" check and create two rows.
        const [ord] = await tx.select().from(order).where(eq(order.id, ord0.id)).for("update");
        if (!STARTABLE.includes(ord!.status)) {
          throw new QcConflictError(`Order is in status ${ord!.status}, cannot start QC`);
        }

        const [existing] = await tx
          .select()
          .from(qcSession)
          .where(and(eq(qcSession.orderId, ord!.id), inArray(qcSession.status, ACTIVE_SESSION)));

        let session_ = existing;
        if (existing && existing.qcUserId !== session.sub) {
          if (isLockStale(existing.lastActiveAt)) {
            const [taken] = await tx
              .update(qcSession)
              .set({ qcUserId: session.sub, lastActiveAt: new Date().toISOString() })
              .where(eq(qcSession.id, existing.id))
              .returning();
            session_ = taken;
            await writeAuditDrizzle({ userId: session.sub, role: session.role, warehouseId: ord!.warehouseId, action: "QC_LOCK_TAKEN_OVER_STALE", entityType: "QcSession", entityId: existing.id, oldValue: { previousHolder: existing.qcUserId } });
          } else {
            const [holder] = await tx.select({ name: user.name }).from(user).where(eq(user.id, existing.qcUserId));
            throw new QcLockedError(`This order is being worked on by ${holder?.name ?? "another QC user"}`, holder?.name ?? "another QC user", existing.lastActiveAt);
          }
        } else if (existing) {
          const [bumped] = await tx.update(qcSession).set({ lastActiveAt: new Date().toISOString() }).where(eq(qcSession.id, existing.id)).returning();
          session_ = bumped;
        } else {
          const [created] = await tx
            .insert(qcSession)
            .values({ id: crypto.randomUUID(), orderId: ord!.id, qcUserId: session.sub, status: "IN_PROGRESS" })
            .returning();
          session_ = created;
        }

        if (ord!.status !== "QC_IN_PROGRESS") {
          await tx.update(order).set({ status: "QC_IN_PROGRESS", updatedAt: new Date().toISOString() }).where(eq(order.id, ord!.id));
          await writeAuditDrizzle({
            userId: session.sub,
            role: session.role,
            warehouseId: ord!.warehouseId,
            action: "QC_STARTED",
            entityType: "QcSession",
            entityId: session_!.id,
          });
          started = true;
        }
        return session_;
      });

      if (started) publish(`warehouse:${ord0.warehouseId}`, "qc:started", { orderId: ord0.id });
      return NextResponse.json(qc, { status: 201 });
    }

    const db = (await import("@/lib/db")).getDb();
    const writeAudit = (await import("@/lib/audit")).writeAudit;

    const order0 = await db.order.findUnique({ where: { id: parsed.data.orderId } });
    if (!order0) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    const forbidden = assertWarehouseAccess(session, order0.warehouseId);
    if (forbidden) return forbidden;

    let started = false;
    const qcSessionResult = await db.$transaction(async (tx) => {
      // Row lock — same reasoning as the Drizzle branch above.
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order0.id} FOR UPDATE`;
      const order = await tx.order.findUniqueOrThrow({ where: { id: order0.id } });
      if (!STARTABLE.includes(order.status)) {
        throw new QcConflictError(`Order is in status ${order.status}, cannot start QC`);
      }

      const existing = await tx.qcSession.findFirst({
        where: { orderId: order.id, status: { in: ACTIVE_SESSION as any } },
        include: { qcUser: { select: { name: true } } },
      });

      let qcSession = existing;
      if (existing && existing.qcUserId !== session.sub) {
        if (isLockStale(existing.lastActiveAt)) {
          qcSession = await tx.qcSession.update({
            where: { id: existing.id },
            data: { qcUserId: session.sub, lastActiveAt: new Date() },
            include: { qcUser: { select: { name: true } } },
          });
          await writeAudit(
            { userId: session.sub, role: session.role, warehouseId: order.warehouseId, action: "QC_LOCK_TAKEN_OVER_STALE", entityType: "QcSession", entityId: existing.id, oldValue: { previousHolder: existing.qcUserId } },
            tx
          );
        } else {
          throw new QcLockedError(`This order is being worked on by ${existing.qcUser.name}`, existing.qcUser.name, existing.lastActiveAt.toISOString());
        }
      } else if (existing) {
        qcSession = await tx.qcSession.update({ where: { id: existing.id }, data: { lastActiveAt: new Date() }, include: { qcUser: { select: { name: true } } } });
      } else {
        qcSession = await tx.qcSession.create({
          data: { orderId: order.id, qcUserId: session.sub, status: "IN_PROGRESS" },
          include: { qcUser: { select: { name: true } } },
        });
      }

      if (order.status !== "QC_IN_PROGRESS") {
        await tx.order.update({ where: { id: order.id }, data: { status: "QC_IN_PROGRESS" } });
        await writeAudit(
          {
            userId: session.sub,
            role: session.role,
            warehouseId: order.warehouseId,
            action: "QC_STARTED",
            entityType: "QcSession",
            entityId: qcSession!.id,
          },
          tx
        );
        started = true;
      }
      return qcSession;
    });

    if (started) publish(`warehouse:${order0.warehouseId}`, "qc:started", { orderId: order0.id });
    return NextResponse.json(qcSessionResult, { status: 201 });
  } catch (err) {
    if (err instanceof QcConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof QcLockedError) return NextResponse.json({ error: err.message, lockedByName: err.lockedByName, lockedSince: err.lockedSince }, { status: 423 });
    throw err;
  }
}
