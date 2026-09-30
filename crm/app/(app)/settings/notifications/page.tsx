import { requireActor } from "@/server/auth/context";
import { prisma } from "@/lib/prisma";
import { relativeTime } from "@/lib/datetime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NotificationPrefs } from "@/components/settings/notification-prefs";

export const dynamic = "force-dynamic";

export default async function NotificationsSettingsPage() {
  const actor = await requireActor();
  const notifications = await prisma.notification.findMany({
    where: { userId: actor.id },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Notification preferences</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            In-app notifications are always on for leads assigned to you. Channel delivery (email,
            push) is not implemented — it is stored as a preference only and clearly marked.
          </p>
        </CardHeader>
        <CardContent>
          <NotificationPrefs />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {notifications.map((n) => (
            <div
              key={n.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-xs text-espresso-700">{n.title}</p>
                {n.body && <p className="text-[11px] text-muted-foreground">{n.body}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge variant="outline">{n.type}</Badge>
                {!n.readAt && <Badge variant="gold">Unread</Badge>}
                <span className="text-[10px] text-muted-foreground">
                  {relativeTime(n.createdAt)}
                </span>
              </div>
            </div>
          ))}
          {notifications.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">No notifications.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
