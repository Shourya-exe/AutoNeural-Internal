"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

const PREFS = [
  { key: "assigned", label: "A lead is assigned to me", inApp: true, external: false },
  { key: "noResponse", label: "First-response SLA breach on my lead", inApp: true, external: false },
  { key: "overdue", label: "My follow-up becomes overdue", inApp: true, external: false },
  { key: "escalation", label: "Team escalations (Managers/Admins)", inApp: true, external: false },
  { key: "integration", label: "Integration connection failures", inApp: true, external: false },
];

/**
 * In-app notification behaviour is fixed (always on for your own leads).
 * Email/push toggles are stored per browser and are clearly marked as not
 * implemented — no delivery channel is wired up.
 */
export function NotificationPrefs() {
  const [email, setEmail] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      setEmail(JSON.parse(localStorage.getItem("notifPrefs") ?? "{}"));
    } catch {
      setEmail({});
    }
  }, []);

  function toggle(key: string, v: boolean) {
    const next = { ...email, [key]: v };
    setEmail(next);
    try {
      localStorage.setItem("notifPrefs", JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Event</span>
        <span className="w-16 text-center">In-app</span>
        <span className="w-16 text-center">Email</span>
      </div>
      {PREFS.map((p) => (
        <div
          key={p.key}
          className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-md border border-border px-2 py-2"
        >
          <span className="text-xs text-espresso-700">{p.label}</span>
          <span className="w-16 text-center">
            <Badge variant="success">On</Badge>
          </span>
          <span className="w-16 text-center">
            <input
              type="checkbox"
              className="accent-gold"
              checked={!!email[p.key]}
              onChange={(e) => toggle(p.key, e.target.checked)}
            />
          </span>
        </div>
      ))}
      <p className="pt-2 text-[11px] text-gold-700">
        Email delivery is <strong>not implemented</strong>. These toggles record a preference only;
        connecting an email provider is on the roadmap (see the adapter interface in
        server/integrations/types.ts).
      </p>
    </div>
  );
}
