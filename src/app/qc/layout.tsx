import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import PortalShell from "@/components/PortalShell";
import { getSetting } from "@/lib/settings";

const LINKS = [{ href: "/qc", label: "Queue" }];

export default async function QcLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const [theme, fontSize] = await Promise.all([
    getSetting("THEME_QC"),
    getSetting("FONT_SIZE_QC"),
  ]);

  return (
    <div className="qc-ui">
      <PortalShell
        title="Quality Check"
        userName={session.name}
        links={LINKS}
        shortcuts
        theme={theme}
        fontSize={fontSize}
      >
        {children}
      </PortalShell>
    </div>
  );
}
