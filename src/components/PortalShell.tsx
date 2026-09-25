import LogoutButton from "./LogoutButton";
import NotificationBell from "./NotificationBell";
import ShortcutsButton from "./ShortcutsButton";
import Copyright from "./Copyright";
import SessionGuard from "./SessionGuard";
import InstallButton from "./InstallButton";
import RefreshButton from "./RefreshButton";
import SyncStatus from "./SyncStatus";
import ThemeStudioButton from "./ThemeStudioButton";
import PortalNav from "./PortalNav";
import { themeVars } from "@/lib/themes";

export default function PortalShell({
  title,
  userName,
  links,
  shortcuts = true,
  syncStaffId,
  theme,
  fontSize,
  children,
}: {
  title: string;
  userName: string;
  links: { href: string; label: string }[];
  shortcuts?: boolean;
  /** Theme name from SystemSetting THEME_<PORTAL>; unset means the default. */
  theme?: string;
  /** Font size from SystemSetting FONT_SIZE_<PORTAL>; unset means the default. */
  fontSize?: string;
  /** Finance only: shows the offline outbox badge; the id numbers provisional bills. */
  syncStaffId?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex min-h-screen flex-col bg-surface ${
        fontSize && fontSize !== "standard" ? "font-size-" + fontSize : ""
      }`}
      style={themeVars(theme)}
    >
      <SessionGuard />
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paper/95 backdrop-blur px-3.5 py-2 shadow-xs">
        <div className="flex flex-wrap items-center gap-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-surface font-black text-xs shadow-xs">
              O
            </span>
            <span className="text-sm font-bold tracking-tight text-ink">
              OCEON-WMS <span className="font-normal text-muted">· {title}</span>
            </span>
          </div>

          <PortalNav links={links} />
        </div>

        <div className="flex items-center gap-2">
          {shortcuts && <ShortcutsButton />}
          {syncStaffId && <SyncStatus staffId={syncStaffId} />}
          <ThemeStudioButton />
          <RefreshButton />
          <InstallButton />
          <NotificationBell />
          <span className="hidden sm:inline-block rounded-full bg-surface-hi px-2.5 py-0.5 text-xs font-semibold text-muted">
            👤 {userName}
          </span>
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1 p-3.5 sm:p-4">{children}</main>

      <footer className="border-t border-line bg-paper py-2.5">
        <Copyright />
      </footer>
    </div>
  );
}
