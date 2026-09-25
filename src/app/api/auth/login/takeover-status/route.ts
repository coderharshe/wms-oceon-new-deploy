import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isWorkersRuntime } from "@/lib/cf-env";
import { findActiveUserById, completeLogin, clientIp } from "@/lib/login";
import { getTakeover, deleteTakeover } from "@/lib/session-registry";
import { QC_LOCK_TIMEOUT_MS } from "@/lib/qc-lock";
import { publish } from "@/lib/realtime";

const schema = z.object({ takeoverId: z.string().min(1), secret: z.string().min(1) });
const ACTIVE_SESSION = ["IN_PROGRESS", "CHANGES_REQUIRED"] as const;
const staleTimestamp = () => new Date(Date.now() - QC_LOCK_TIMEOUT_MS - 1000).toISOString();

// Polled by the new device's login page every couple seconds while the
// grace-period countdown runs. Denied/still-pending just report status; once
// the deadline has passed with no deny, THIS request is what actually
// finalizes the takeover — issues the new session and kicks the old one.
//
// Which is why `secret` is required: the takeoverId alone is enough to reach
// this endpoint, and it is handed to the OLD device over SSE and sits in poll
// bodies/logs/proxies. Anyone who merely observes an id must not be able to
// mint a session with it, so the grant is bound to the secret returned once
// to the client that actually passed verifyCredentials in .../takeover.
export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const takeover = await getTakeover(body.data.takeoverId);
  if (!takeover || takeover.secret !== body.data.secret) return NextResponse.json({ status: "expired" });
  if (takeover.status === "denied") {
    await deleteTakeover(body.data.takeoverId);
    return NextResponse.json({ status: "denied" });
  }
  if (Date.now() < takeover.expiresAt) {
    return NextResponse.json({ status: "pending", expiresAt: takeover.expiresAt });
  }

  // Grace period elapsed with no deny — grant it.
  const user = await findActiveUserById(takeover.userId);
  if (!user) {
    await deleteTakeover(body.data.takeoverId);
    return NextResponse.json({ status: "expired" });
  }
  const result = await completeLogin(user, clientIp(req));

  // Release any QC lock the old device was holding — it's about to lose
  // access, so an in-progress order shouldn't stay stuck to it.
  if (isWorkersRuntime()) {
    const { getDrizzleDb } = await import("@/lib/drizzle-db");
    const { qcSession } = await import("@/generated/drizzle/schema");
    const { eq, and, inArray } = await import("drizzle-orm");
    const db = getDrizzleDb();
    await db.update(qcSession).set({ lastActiveAt: staleTimestamp() }).where(and(eq(qcSession.qcUserId, user.id), inArray(qcSession.status, [...ACTIVE_SESSION])));
  } else {
    const db = (await import("@/lib/db")).getDb();
    await db.qcSession.updateMany({ where: { qcUserId: user.id, status: { in: [...ACTIVE_SESSION] } }, data: { lastActiveAt: new Date(staleTimestamp()) } });
  }

  publish(`user:${user.id}`, "session:kicked", {});
  await deleteTakeover(body.data.takeoverId);
  return NextResponse.json({ status: "granted", ...result });
}
