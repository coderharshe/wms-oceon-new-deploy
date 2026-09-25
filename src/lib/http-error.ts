/**
 * Turns a failed fetch Response into something a person at the counter can
 * act on.
 *
 * Screens used to render one fixed sentence for every failure, so "your
 * session ended", "this order belongs to another warehouse" and "the server
 * fell over" were indistinguishable — and the one failure actually seen in
 * production (the Worker exceeding its CPU limit on bill creation, which
 * returns a Cloudflare error page rather than JSON) looked exactly like all
 * the others. The status code is the one thing always present, so it is the
 * fallback rather than nothing.
 */
export async function describeHttpError(res: Response): Promise<string> {
  // A route that failed inside Cloudflare's runtime returns HTML, not JSON,
  // so this has to survive a body that will not parse.
  const body = await res.json().catch(() => null);
  const fromServer = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
    ? (body as { error: string }).error
    : null;
  if (fromServer) return fromServer;

  if (res.status === 401) return "your session has ended — sign in again";
  if (res.status === 403) return "this order belongs to a warehouse your login cannot see";
  if (res.status === 404) return "the server could not find this order";
  // 5xx here is usually transient — the same request often succeeds on a
  // second press, so say so rather than implying the bill is lost.
  if (res.status >= 500) return `the server failed (${res.status}) — this is usually temporary, try again`;
  return `the server returned ${res.status}`;
}
