import { NextRequest, NextResponse } from "next/server";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { Role, TaskPriority, TaskStatus } from "@/generated/prisma/client";

function generateTaskNumber() {
  const d = new Date();
  const dateStr = d.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TSK-${dateStr}-${rand}`;
}

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER", "INVENTORY", "BILLING", "PROCUREMENT", "FINANCE", "QC"]);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  let warehouseId = session.warehouseId;
  if (!warehouseId && session.role === "ADMIN") {
    const firstWh = await db.warehouse.findFirst({ where: { active: true } });
    warehouseId = firstWh?.id ?? null;
  }
  if (!warehouseId) return NextResponse.json({ error: "No warehouse assigned" }, { status: 400 });

  const searchParams = req.nextUrl.searchParams;
  const status = searchParams.get("status") as TaskStatus | null;
  const priority = searchParams.get("priority") as TaskPriority | null;
  const department = searchParams.get("department") as Role | null;
  const assignedToId = searchParams.get("assignedToId") || undefined;

  const [tasks, staffList] = await Promise.all([
    db.task.findMany({
      where: {
        warehouseId,
        ...(status ? { status } : {}),
        ...(priority ? { priority } : {}),
        ...(department ? { department } : {}),
        ...(assignedToId ? { assignedToId } : {}),
      },
      include: {
        assignedTo: { select: { id: true, name: true, staffId: true, role: true } },
        createdBy: { select: { id: true, name: true, staffId: true } },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    }),
    db.user.findMany({
      where: { warehouseId, active: true },
      select: { id: true, name: true, staffId: true, role: true },
    }),
  ]);

  return NextResponse.json({
    tasks: tasks.map((t) => ({
      id: t.id,
      taskNo: t.taskNo,
      title: t.title,
      description: t.description,
      department: t.department,
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDate,
      notes: t.notes,
      createdAt: t.createdAt,
      assignedTo: t.assignedTo ? { id: t.assignedTo.id, name: t.assignedTo.name, staffId: t.assignedTo.staffId, role: t.assignedTo.role } : null,
      createdBy: { id: t.createdBy.id, name: t.createdBy.name, staffId: t.createdBy.staffId },
    })),
    staffList,
  });
}

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  let warehouseId = session.warehouseId;
  if (!warehouseId && session.role === "ADMIN") {
    const firstWh = await db.warehouse.findFirst({ where: { active: true } });
    warehouseId = firstWh?.id ?? null;
  }
  if (!warehouseId) return NextResponse.json({ error: "No warehouse assigned" }, { status: 400 });

  const body = await req.json().catch(() => null);
  if (!body || !body.title || !body.description) {
    return NextResponse.json({ error: "Title and description are required" }, { status: 400 });
  }

  const { title, description, department, priority, assignedToId, dueDate, notes } = body;

  try {
    const task = await db.task.create({
      data: {
        taskNo: generateTaskNumber(),
        title,
        description,
        department: department ?? null,
        priority: priority ?? "MEDIUM",
        status: "PENDING",
        warehouseId,
        assignedToId: assignedToId ?? null,
        createdById: session.sub,
        dueDate: dueDate ? new Date(dueDate) : null,
        notes: notes ?? null,
      },
    });

    await db.auditLog.create({
      data: {
        userId: session.sub,
        role: session.role,
        warehouseId,
        action: "TASK_CREATED",
        entityType: "Task",
        entityId: task.id,
        reason: `Created task ${task.taskNo}: ${task.title}`,
        newValue: { taskNo: task.taskNo, title: task.title, priority: task.priority },
      },
    });

    return NextResponse.json({ success: true, task });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to create task" }, { status: 500 });
  }
}
