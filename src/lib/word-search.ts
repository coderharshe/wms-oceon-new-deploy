/**
 * Word-start search: "c c 2" finds "Coke Can 2L".
 *
 * Each space-separated part must begin a word of the name, the parts in the
 * same order as the words, and each on a DIFFERENT word — so "c c 2" does not
 * match "Coke 2L" (one c-word) or "2L Coke Can" (wrong order). Anything that
 * is not a letter or digit separates words, so "Coke-Can (2L)" matches too.
 *
 * Two forms of the one rule, and the tests hold them equal:
 *  - wordStartPattern: a regex source for Postgres (`~*` in /api/products).
 *    Postgres's regex engine does not backtrack exponentially.
 *  - matchesWordStarts: a linear walk for the browser. The same regex in JS
 *    backtracks on every `.*` — six one-letter parts against a long name,
 *    over 1,700 products per keystroke, would freeze the counter.
 * If the two disagreed, the list would reshuffle when the live results land.
 *
 * Single part: no word-start match. "coke" alone is already covered by the
 * starts-with and contains matches.
 */
const parse = (q: string) => q.trim().toLowerCase().split(/\s+/).filter(Boolean);

export function matchesWordStarts(name: string, q: string): boolean {
  const parts = parse(q);
  if (parts.length < 2) return false;
  const s = name.toLowerCase();
  const sep = (i: number) => /[^a-z0-9]/.test(s[i]!);
  // Earliest possible word for each part, in turn: taking the earliest never
  // rules out a match a later choice would have allowed.
  let from = 0;
  for (const p of parts) {
    let i = from;
    while (i + p.length <= s.length && !((i === 0 || (i - 1 >= from && sep(i - 1))) && s.startsWith(p, i))) i++;
    if (i + p.length > s.length) return false;
    from = i + p.length;
  }
  return true;
}

export function wordStartPattern(q: string): string | null {
  const parts = parse(q);
  if (parts.length < 2) return null;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The first part may start the name; every later one needs a separator in
  // front of it, and that separator necessarily comes after the previous
  // part's word began — which is what forces a different, later word.
  return `(^|[^a-z0-9])${esc(parts[0]!)}` + parts.slice(1).map((p) => `.*[^a-z0-9]${esc(p)}`).join("");
}
