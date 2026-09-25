import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { TaskStatus } from "@/generated/prisma/client";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY", "BILLING", "PROCUREMENT", "FINANCE", "QC"]);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const task = await db.task.findUnique({ where: { id } });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const { status, notes, assignedToId } = body;

  // Only Manager or Admin can verify or cancel a task
  if (["VERIFIED", "CANCELLED"].includes(status) && !["ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Only Managers or Admins can verify or cancel tasks" }, { status: 403 });
  }

  try {
    const updated = await db.task.update({
      where: { id },
      data: {
        ...(status ? { status: status as TaskStatus } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(assignedToId !== undefined ? { assignedToId } : {}),
      },
    });

    await db.auditLog.create({
      data: {
        userId: session.sub,
        role: session.role,
        warehouseId: task.warehouseId,
        action: `TASK_STATUS_${status || "UPDATED"}`,
        entityType: "Task",
        entityId: id,
        reason: notes || `Status changed from ${task.status} to ${status}`,
        oldValue: { status: task.status },
        newValue: { status: updated.status },
      },
    });

    return NextResponse.json({ success: true, task: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update task" }, { status: 500 });
  }
}
