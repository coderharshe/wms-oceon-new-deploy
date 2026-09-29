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
      className={`flex min-h-screen flex-col bg-surface ${fontSize && fontSize !== "standard" ? "font-size-" + fontSize : ""
        }`}
      style={themeVars(theme)}
    >
      <SessionGuard />
      <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur-md shadow-xs">
        <div className="mx-auto flex w-full max-w-[1700px] flex-wrap items-center justify-between gap-3 px-3.5 py-2 sm:px-6">
          <div className="flex flex-wrap items-center gap-3 sm:gap-5">
            <div className="flex items-center gap-2 shrink-0">
              <img
                src="/logo.png"
                alt="Oceon Logo"
                className="h-[34px] w-auto object-contain shrink-0"
              />
              <span className="hidden md:inline-block text-xs font-semibold text-muted">
                · {title}
              </span>
            </div>

            <PortalNav links={links} />
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {shortcuts && <ShortcutsButton />}
            {syncStaffId && <SyncStatus staffId={syncStaffId} />}
            <ThemeStudioButton />
            <RefreshButton />
            <InstallButton />
            <NotificationBell />
            <span className="hidden sm:inline-block rounded-full bg-surface-hi px-3 py-1 text-xs font-bold text-muted border border-line">
              👤 {userName}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1700px] mx-auto p-3.5 sm:p-5 lg:p-6 min-h-[calc(100vh-120px)]">{children}</main>

      <footer className="border-t border-line bg-paper py-3">
        <div className="mx-auto max-w-[1700px] px-3.5 sm:px-6">
          <Copyright />
        </div>
      </footer>
    </div>
  );
}
