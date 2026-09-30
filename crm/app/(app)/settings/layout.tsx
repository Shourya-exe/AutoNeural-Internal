import { SettingsNav } from "@/components/settings/settings-nav";
import { requireActor } from "@/server/auth/context";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-espresso">Settings</h1>
        <p className="text-xs text-muted-foreground">
          Signed in as {actor.name} · role {actor.role}. Permissions are enforced on the server for
          every operation, not just hidden in the UI.
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[196px_minmax(0,1fr)]">
        <SettingsNav role={actor.role} />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
