"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Calculator from "./Calculator";

export default function PortalNav({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [calc, setCalc] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isTyping = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      // Alt+1 to Alt+9 quick tab jumping
      if (e.altKey && !e.ctrlKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        if (links[idx]) {
          e.preventDefault();
          router.push(links[idx].href);
          return;
        }
      }

      // Alt+D jump to dashboard
      if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "d") {
        if (links[0]) {
          e.preventDefault();
          router.push(links[0].href);
          return;
        }
      }

      // Alt+C toggle calculator
      if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        setCalc((v) => !v);
        return;
      }

      // Alt+S or standalone '/' when not typing -> focus page search input
      if (
        (e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "s") ||
        (e.key === "/" && !isTyping && !e.altKey && !e.ctrlKey && !e.metaKey)
      ) {
        const searchInput = document.querySelector<HTMLInputElement>(
          'input[type="search"], input[placeholder*="Search"], input[placeholder*="search"], input[placeholder*="Filter"]'
        );
        if (searchInput) {
          e.preventDefault();
          searchInput.focus();
          searchInput.select?.();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [links, router]);

  return (
    <>
      <nav className="flex flex-wrap items-center gap-1">
        {links.map((l, i) => {
          const isActive = pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href + "/"));
          return (
            <Link
              key={l.href}
              href={l.href}
              title={`Jump to ${l.label} (Alt+${i + 1})`}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                isActive
                  ? "bg-accent text-surface font-semibold shadow-xs"
                  : "text-muted hover:bg-surface-hi hover:text-ink"
              }`}
            >
              <span>{l.label}</span>
              {i < 9 && (
                <span
                  className={`text-[9px] px-1 py-0.2 rounded ${
                    isActive ? "bg-black/20 text-surface/90" : "bg-line/60 text-muted"
                  }`}
                >
                  ⌥{i + 1}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      {calc && <Calculator onClose={() => setCalc(false)} />}
    </>
  );
}
