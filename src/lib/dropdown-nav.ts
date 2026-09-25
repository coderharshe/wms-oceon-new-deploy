/**
 * Arrow-key movement for a search dropdown: wraps at both ends and skips rows
 * that can't be chosen (an out-of-stock product). Pure and index-only so the
 * off-by-one and wrap-around cases are testable without a browser.
 *
 * Returns `from` unchanged when nothing else is selectable, and -1 when the
 * list has no selectable row at all.
 */
export function nextIndex(count: number, from: number, dir: 1 | -1, isBlocked: (i: number) => boolean = () => false): number {
  if (count <= 0) return -1;
  for (let step = 1; step <= count; step++) {
    const idx = (((from + dir * step) % count) + count) % count;
    if (!isBlocked(idx)) return idx;
  }
  return from;
}

/**
 * Where the highlight goes when a dropdown's rows are replaced — the cached
 * list painting first and the live one landing a moment later. Stays on the
 * same record if it is still there, so a cashier who has already arrowed to a
 * row doesn't press Enter on whatever slid into row 0 under them.
 *
 * A record that is gone leaves NOTHING highlighted (-1), never row 0: the
 * search dropdown freezes its rows per query (mergeLiveResults) so this
 * cannot happen there, and anywhere else Enter must do nothing rather than
 * quietly bill a product the cashier never pointed at.
 */
export function carryIndex(prev: { id: string }[], idx: number, next: { id: string }[]): number {
  if (next.length === 0) return -1;
  const id = prev[idx]?.id;
  return id == null ? 0 : next.findIndex((r) => r.id === id);
}

/** First selectable row, or -1 if every row is blocked. */
export function firstIndex(count: number, isBlocked: (i: number) => boolean = () => false): number {
  for (let i = 0; i < count; i++) if (!isBlocked(i)) return i;
  return -1;
}
