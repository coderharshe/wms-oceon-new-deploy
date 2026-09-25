// Client-side search over an already-loaded list: filter on the visible text
// columns, and mark the matched run so the eye lands on it.
// Server-side search does the reaching now (see the product pages); this is
// the second pass over what came back, plus the match highlighting.
export function matchesQuery(q: string, ...fields: (string | null | undefined)[]) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => f?.toLowerCase().includes(needle));
}

export function Highlight({ text, q }: { text: string; q: string }) {
  const needle = q.trim().toLowerCase();
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-transparent font-bold text-accent">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}
