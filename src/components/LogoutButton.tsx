"use client";

import { markSignedOut } from "@/lib/offline-login";

export default function LogoutButton() {
  return (
    <button
      className="btn"
      onClick={async () => {
        // Marked first: offline the server never hears of it, the cookie stays,
        // and only this flag keeps the saved screens from opening signed in.
        markSignedOut();
        await fetch("/api/auth/logout", { method: "POST", signal: AbortSignal.timeout(5000) }).catch(() => {});
        // A full load: offline, only the service worker's saved /login can open.
        window.location.assign("/login");
      }}
    >
      Log out
    </button>
  );
}
