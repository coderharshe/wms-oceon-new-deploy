import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getDb } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;

  const { searchParams } = req.nextUrl;
  const date = searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const month = searchParams.get("month") || date.slice(0, 7); // YYYY-MM
  const requestedWarehouseId = searchParams.get("warehouseId") || undefined;
  const warehouseId = session.role === "ADMIN" ? requestedWarehouseId : session.warehouseId;
  if (session.role !== "ADMIN" && !warehouseId) {
    return NextResponse.json({ error: "No warehouse assigned" }, { status: 403 });
  }

  try {
    const db = getDb();

    // 1. Fetch staff & all users/labours
    const userWhere: any = {
      active: true,
    };
    if (session.role === "MANAGER") {
      userWhere.role = { not: "ADMIN" };
      userWhere.warehouseId = session.warehouseId;
    } else if (warehouseId) {
      userWhere.warehouseId = warehouseId;
    }

    const staffUsers = await db.user.findMany({
      where: userWhere,
      select: {
        id: true,
        staffId: true,
        name: true,
        role: true,
        contact: true,
        designation: true,
        city: true,
        town: true,
        employmentType: true,
        shift: true,
        joiningDate: true,
        salary: true,
        bankUpi: true,
        reportingManager: true,
        warehouseId: true,
        warehouse: { select: { id: true, name: true, code: true } },
      },
      orderBy: { name: "asc" },
    });

    // 2. Fetch daily attendance for the selected date
    const dailyAttendances = await db.staffAttendance.findMany({
      where: {
        date,
        userId: { in: staffUsers.map((u) => u.id) },
      },
      include: {
        markedBy: { select: { name: true, staffId: true } },
      },
    });
    const dailyMap = new Map(dailyAttendances.map((a) => [a.userId, a]));

    const dailyList = staffUsers.map((u) => {
      const att = dailyMap.get(u.id);
      return {
        user: u,
        attendance: att
          ? {
              id: att.id,
              status: att.status,
              occasion: att.occasion,
              overtimeHrs: Number(att.overtimeHrs ?? 0),
              notes: att.notes,
              markedBy: att.markedBy?.name || undefined,
              updatedAt: att.updatedAt ? att.updatedAt.toISOString() : undefined,
            }
          : null,
      };
    });

    // 3. Fetch all month's attendances for monthly salary calculation
    const [yearStr, monthStr] = month.split("-");
    const yearNum = parseInt(yearStr || "2026", 10);
    const monthNum = parseInt(monthStr || "9", 10);
    const daysInMonth = new Date(yearNum, monthNum, 0).getDate();

    const monthlyAttendances = await db.staffAttendance.findMany({
      where: {
        date: { startsWith: month },
        userId: { in: staffUsers.map((u) => u.id) },
      },
    });

    // Group by userId
    const userMonthMap = new Map<string, typeof monthlyAttendances>();
    for (const a of monthlyAttendances) {
      if (!userMonthMap.has(a.userId)) userMonthMap.set(a.userId, []);
      userMonthMap.get(a.userId)!.push(a);
    }

    const monthlyPayroll = staffUsers.map((u) => {
      const records = userMonthMap.get(u.id) || [];
      let presentCount = 0;
      let halfDayCount = 0;
      let paidLeaveCount = 0;
      let absentCount = 0;
      let totalOvertimeHrs = 0;

      const occasionsList: string[] = [];

      for (const r of records) {
        if (r.status === "PRESENT") presentCount++;
        else if (r.status === "HALF_DAY") halfDayCount++;
        else if (r.status === "PAID_LEAVE") {
          paidLeaveCount++;
          if (r.occasion && !occasionsList.includes(r.occasion)) occasionsList.push(r.occasion);
        } else if (r.status === "ABSENT") absentCount++;
        else if (r.status === "OVERTIME") {
          presentCount++;
          totalOvertimeHrs += Number(r.overtimeHrs ?? 0);
        }
      }

      // Base monthly salary parsing
      const rawSalary = parseFloat((u.salary || "0").replace(/,/g, "")) || 0;
      const perDayRate = daysInMonth > 0 ? rawSalary / daysInMonth : 0;

      // Effective paid days = Full Days + Paid Occasions + (0.5 * Half Days)
      const effectivePaidDays = presentCount + paidLeaveCount + halfDayCount * 0.5;
      const unpaidDays = Math.max(0, daysInMonth - effectivePaidDays);
      const calculatedSalary = Math.round(effectivePaidDays * perDayRate);

      return {
        user: u,
        month,
        daysInMonth,
        baseSalary: rawSalary,
        perDayRate: Math.round(perDayRate * 100) / 100,
        presentCount,
        halfDayCount,
        paidLeaveCount,
        absentCount,
        unpaidDays: Math.round(unpaidDays * 10) / 10,
        effectivePaidDays: Math.round(effectivePaidDays * 10) / 10,
        totalOvertimeHrs,
        occasions: occasionsList,
        calculatedSalary,
        recordsCount: records.length,
      };
    });

    const warehouses = session.role === "ADMIN"
      ? await db.warehouse.findMany({ select: { id: true, name: true, code: true } })
      : [];

    return NextResponse.json({
      date,
      month,
      daysInMonth,
      dailyList,
      monthlyPayroll,
      warehouses,
    });
  } catch (err: any) {
    console.error("GET /api/attendance error:", err);
    return NextResponse.json({ error: err.message || "Failed to load attendance" }, { status: 500 });
  }
}

const markSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format YYYY-MM-DD"),
  warehouseId: z.string().optional(),
  records: z.array(
    z.object({
      userId: z.string().min(1),
      status: z.enum(["PRESENT", "HALF_DAY", "PAID_LEAVE", "ABSENT", "OVERTIME"]),
      occasion: z.string().nullable().optional(),
      overtimeHrs: z.number().nonnegative().optional(),
      notes: z.string().nullable().optional(),
    })
  ),
});

export async function POST(req: NextRequest) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (isErrorResponse(session)) return session;

  const parsed = markSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { date, records } = parsed.data;
  const db = getDb();

  try {
    const saved = await db.$transaction(async (tx) => {
      const results = [];
      for (const rec of records) {
        const user = await tx.user.findUnique({
          where: { id: rec.userId },
          select: { warehouseId: true },
        });
        if (!user) continue;
        if (session.role === "MANAGER" && user.warehouseId !== session.warehouseId) {
          continue; // Block cross-warehouse attendance modification
        }
        const targetWarehouseId = user.warehouseId || session.warehouseId || parsed.data.warehouseId;
        if (!targetWarehouseId) continue;

        const entry = await tx.staffAttendance.upsert({
          where: { userId_date: { userId: rec.userId, date } },
          update: {
            status: rec.status,
            occasion: rec.occasion || null,
            overtimeHrs: rec.overtimeHrs ?? 0,
            notes: rec.notes || null,
            markedById: session.sub,
          },
          create: {
            userId: rec.userId,
            warehouseId: targetWarehouseId,
            date,
            status: rec.status,
            occasion: rec.occasion || null,
            overtimeHrs: rec.overtimeHrs ?? 0,
            notes: rec.notes || null,
            markedById: session.sub,
          },
        });
        results.push(entry);
      }
      return results;
    });

    await writeAudit({
      userId: session.sub,
      role: session.role,
      action: "ATTENDANCE_MARKED",
      entityType: "StaffAttendance",
      entityId: `${date}-${records.length}`,
      newValue: { date, count: records.length },
    });

    return NextResponse.json({ success: true, count: saved.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to mark attendance" }, { status: 500 });
  }
}
