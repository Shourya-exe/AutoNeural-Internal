import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/context";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { Sidebar } from "@/components/shell/sidebar";
import { Topnav } from "@/components/shell/topnav";
import { DemoBanner } from "@/components/shell/demo-banner";
import { AuroraBackground } from "@/components/fx/aurora-background";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [org, unread] = await Promise.all([
    prisma.organization.findUnique({ where: { id: actor.organizationId } }),
    prisma.notification.count({ where: { userId: actor.id, readAt: null } }),
  ]);

  return (
    <div className="relative min-h-screen isolate">
      <AuroraBackground intensity={0.9} />
      <Sidebar role={actor.role} />
      <div className="lg:pl-[232px]">
        <Topnav
          user={{ name: actor.name, email: actor.email, role: actor.role }}
          orgName={org?.name ?? "Autoneural"}
          unreadCount={unread}
        />
        {env.demoMode && <DemoBanner />}
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
