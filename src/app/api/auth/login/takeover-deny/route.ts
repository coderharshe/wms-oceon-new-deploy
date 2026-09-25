import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, isErrorResponse } from "@/lib/guard";
import { getTakeover, denyTakeover } from "@/lib/session-registry";

const schema = z.object({ takeoverId: z.string().min(1) });
const ANY_ROLE = ["ADMIN", "MANAGER", "FINANCE", "QC"] as const;

// Called from the currently-logged-in device (SessionGuard's "Deny" button)
// in response to a session:takeover_requested SSE event.
export async function POST(req: NextRequest) {
  const session = await requireRole([...ANY_ROLE]);
  if (isErrorResponse(session)) return session;

  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const takeover = await getTakeover(body.data.takeoverId);
  // Only the account being targeted can deny its own takeover — otherwise
  // this would let anyone signed in anywhere cancel anyone else's login.
  if (!takeover || takeover.userId !== session.sub) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await denyTakeover(body.data.takeoverId);
  return NextResponse.json({ ok: true });
}
