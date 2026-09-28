"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveEvents } from "@/lib/live-events";

type Notification = { id: string; title: string; message: string; read: boolean; createdAt: string };

export default function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const load = () =>
    fetch("/api/notifications")
      .then((r) => (r.ok ? r.json() : []))
      .then(setItems)
      .catch(() => {});

  useEffect(() => {
    load();
  }, []);

  useLiveEvents((data) => {
    if (data.type === "notification") setItems((prev) => [data.payload, ...prev].slice(0, 30));
    else if (data.type === "resync") load();
  });

  // Position calculation strictly clamped to viewport bounds
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const updatePos = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownWidth = Math.min(360, window.innerWidth - 32);
      let left = rect.left;
      if (left + dropdownWidth > window.innerWidth - 16) {
        left = window.innerWidth - dropdownWidth - 16;
      }
      if (left < 16) {
        left = 16;
      }
      setPos({
        top: rect.bottom + 8,
        left,
        width: dropdownWidth,
      });
    };
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [open]);

  // Click outside and Escape key to close popup
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest("#notifications-container") && !target.closest("#notifications-modal")) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const unread = items.filter((i) => !i.read).length;

  async function markRead(id: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, read: true } : i)));
    await fetch(`/api/notifications/${id}/read`, { method: "POST" });
  }

  return (
    <div id="notifications-container" className="relative inline-block">
      <button
        ref={buttonRef}
        className="btn relative text-xs font-semibold py-1.5 px-3"
        onClick={() => setOpen((o) => !o)}
      >
        🔔 <span className="hidden sm:inline">Notifications</span>
        {unread > 0 && (
          <span className="badge absolute -right-1.5 -top-1.5 bg-bad text-white text-[10px] font-black px-1.5 py-0.5">
            {unread}
          </span>
        )}
      </button>
      {open && pos && (
        <div
          id="notifications-modal"
          style={{ position: "fixed", top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px` }}
          className="z-50 max-h-[85vh] overflow-hidden rounded-2xl border-2 border-line bg-paper shadow-2xl ring-4 ring-black/10 animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="flex items-center justify-between border-b border-line bg-surface-hi px-3.5 py-2.5">
            <span className="text-xs font-bold text-ink">Notifications</span>
            {unread > 0 && <span className="text-[10px] text-accent font-semibold">{unread} unread</span>}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 && <p className="p-4 text-center text-xs text-muted">No new notifications</p>}
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => markRead(n.id)}
                className={`block w-full border-b border-line p-3 text-left text-xs last:border-b-0 hover:bg-surface-hi transition-colors ${
                  n.read ? "opacity-60" : "bg-surface font-semibold"
                }`}
              >
                <div className="font-bold text-ink">{n.title}</div>
                <div className="text-muted mt-0.5">{n.message}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
