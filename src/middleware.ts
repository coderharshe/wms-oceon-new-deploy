import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, COOKIE_NAME } from "@/lib/auth";
import type { Role } from "@/generated/prisma/client";

// Route prefix -> roles allowed to view it. This is a UX convenience
// (redirect to the right portal / bounce wrong roles); the real enforcement
// is server-side per API route via requireRole() (PRD §38).
const ROLE_PREFIXES: { prefix: string; roles: Role[] }[] = [
  { prefix: "/admin", roles: ["ADMIN"] },
  { prefix: "/manager", roles: ["ADMIN", "MANAGER"] },
  { prefix: "/finance", roles: ["ADMIN", "FINANCE"] },
  { prefix: "/billing", roles: ["ADMIN", "BILLING", "MANAGER"] },
  { prefix: "/procurement", roles: ["ADMIN", "PROCUREMENT", "MANAGER"] },
  { prefix: "/inventory", roles: ["ADMIN", "INVENTORY", "MANAGER"] },
  { prefix: "/qc", roles: ["ADMIN", "QC"] },
];

// Subdomain -> default landing path. Lets each "portal" be deployed on its
// own domain later while remaining one build (PRD §2/§39/§47).
const SUBDOMAIN_HOME: Record<string, string> = {
  admin: "/admin",
  manager: "/manager",
  finance: "/finance",
  billing: "/billing",
  procurement: "/procurement",
  inventory: "/inventory",
  qc: "/qc",
  pay: "/pay",
  payment: "/pay",
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/favicon") ||
    // PWA assets: must always be served directly, unauthenticated, with no
    // redirect — a service worker script fetched via a redirect is refused
    // outright by the browser (confirmed live: registration silently failed
    // every time, since the first attempt always runs from the unauth'd
    // /login page and never retries after signing in).
    pathname === "/sw.js" ||
    pathname === "/manifest.json" ||
    pathname === "/icon.svg" ||
    // Same reason, and it cost an afternoon: the Cache API REFUSES to store a
    // redirected response, so while this 307'd to /login the offline fallback
    // page was never cached and every unsaved screen fell back to Chrome's
    // "site can't be reached" during an outage.
    pathname === "/offline" ||
    pathname === "/offline.html"
  ) {
    return NextResponse.next();
  }

  const host = req.headers.get("host") ?? "";
  const subdomain = host.split(".")[0] ?? "";
  const home = SUBDOMAIN_HOME[subdomain];

  if (pathname === "/" && home) {
    return NextResponse.redirect(new URL(home, req.url));
  }

  if (pathname.startsWith("/pay") || pathname === "/login") {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    const res = NextResponse.redirect(loginUrl);
    // Stale/invalid cookie (rotated secret, expired, old domain) would
    // otherwise keep getting resent forever, looping the redirect until the
    // user manually clears cookies — clear it here instead, once.
    if (token) res.cookies.delete(COOKIE_NAME);
    return res;
  }

  const rule = ROLE_PREFIXES.find((r) => pathname.startsWith(r.prefix));
  if (rule && !rule.roles.includes(session.role)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (pathname === "/") {
    const fallback: Record<Role, string> = {
      ADMIN: "/admin",
      MANAGER: "/manager",
      FINANCE: "/finance",
      BILLING: "/billing",
      PROCUREMENT: "/procurement",
      INVENTORY: "/inventory",
      QC: "/qc",
    };
    return NextResponse.redirect(new URL(fallback[session.role], req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
