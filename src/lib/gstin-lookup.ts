/**
 * GSTIN → taxpayer name and address, via whichever lookup service the shop
 * has signed up for.
 *
 * Deliberately provider-agnostic. There is no free official GSTN API for
 * third parties (the portal's own search is captcha-gated), so this is always
 * somebody's service — and every one of them returns a different JSON shape.
 * Rather than hard-code an adapter per provider and guess at shapes that can
 * change without notice, the three moving parts are settings:
 *
 *   GSTIN_LOOKUP_URL   https://host/verify?gst={gstin}&key={key}
 *   GSTIN_LOOKUP_KEY   the account key, substituted for {key}
 *   GSTIN_LOOKUP_PATHS name:taxpayerInfo.lgnm, address:taxpayerInfo.pradr.adr
 *
 * Swapping providers is then three settings, not a deploy.
 */

export type GstinDetails = { legalName: string | null; tradeName: string | null; address: string | null };

/** Reads "a.b.c" out of a parsed JSON body. Arrays are indexed numerically
 *  ("x.0.y") because providers vary between an object and a one-item list. */
export function pick(source: unknown, path: string): unknown {
  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((acc, seg) => {
      if (acc == null) return undefined;
      if (Array.isArray(acc)) return acc[Number(seg)];
      if (typeof acc === "object") return (acc as Record<string, unknown>)[seg];
      return undefined;
    }, source);
}

/** "name:a.b, address:c.d" → { name: "a.b", address: "c.d" }. Whitespace and a
 *  trailing comma are tolerated — this is typed into a settings box by hand. */
export function parsePaths(spec: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of spec.split(",")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

/**
 * An address may come back as a string or as the object GSTN itself uses
 * (building/street/locality/city/state/pincode under varying key names).
 * Joining whatever non-empty string values are present beats demanding the
 * shop describe six more paths in a settings box.
 */
export function flattenAddress(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value !== "object") return null;
  const parts = Object.values(value as Record<string, unknown>)
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
  // De-duplicate: GSTN repeats the city in `dst` and `loc` on many records.
  return [...new Set(parts)].join(", ") || null;
}

const asText = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Normalises one provider response into the two fields the form fills. */
export function extractDetails(body: unknown, paths: Record<string, string>): GstinDetails {
  return {
    legalName: paths.name ? asText(pick(body, paths.name)) : null,
    tradeName: paths.tradeName ? asText(pick(body, paths.tradeName)) : null,
    address: paths.address ? flattenAddress(pick(body, paths.address)) : null,
  };
}

export class LookupConfigError extends Error {}

/**
 * Builds the request URL. The template comes from an admin setting, but it is
 * still validated: https only, and no private/loopback host — a settings typo
 * must not turn this authenticated endpoint into a way to probe the inside of
 * the network, and the key is substituted server-side so it never reaches a
 * browser.
 */
export function buildLookupUrl(template: string, gstin: string, key: string): string {
  if (!template.trim()) throw new LookupConfigError("No GSTIN lookup URL is configured");
  const url = template.replaceAll("{gstin}", encodeURIComponent(gstin)).replaceAll("{key}", encodeURIComponent(key));
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LookupConfigError("The GSTIN lookup URL is not a valid URL");
  }
  if (parsed.protocol !== "https:") throw new LookupConfigError("The GSTIN lookup URL must be https");
  if (isPrivateHost(parsed.hostname)) throw new LookupConfigError("The GSTIN lookup URL must be a public host");
  return parsed.toString();
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h === "[::1]") return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 127 || a === 10 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}
