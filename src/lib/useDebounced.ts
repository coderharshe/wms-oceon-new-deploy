"use client";

import { useEffect, useState } from "react";

/** Trailing-edge debounce for search boxes: one server query per pause, not per keystroke. */
export function useDebounced<T>(value: T, ms = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
