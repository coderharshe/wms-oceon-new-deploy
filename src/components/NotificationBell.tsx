"use client";

import { useEffect, useState } from "react";
import { useLiveEvents } from "@/lib/live-events";

type Notification = { id: string; title: string; message: string; read: boolean; createdAt: string };

export default function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

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

  const unread = items.filter((i) => !i.read).length;

  async function markRead(id: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, read: true } : i)));
    await fetch(`/api/notifications/${id}/read`, { method: "POST" });
  }

  return (
    <div className="relative">
      <button className="btn relative" onClick={() => setOpen((o) => !o)}>
        Notifications
        {unread > 0 && (
          <span className="badge absolute -right-1.5 -top-1.5 bg-bad text-white">{unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 max-h-96 w-80 overflow-y-auto card shadow-none">
          {items.length === 0 && <p className="p-2 text-sm text-muted">No notifications</p>}
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => markRead(n.id)}
              className={`block w-full border-b border-line p-2 text-left text-sm last:border-b-0 ${n.read ? "opacity-60" : "bg-surface"}`}
            >
              <div className="font-medium">{n.title}</div>
              <div className="text-muted">{n.message}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
