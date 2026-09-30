"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, Bell, LogOut, User as UserIcon, Building2 } from "lucide-react";
import { Avatar } from "@/components/ui/misc";
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from "@/components/ui/dropdown";
import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/lib/datetime";
import type { Role } from "@prisma/client";
import { signOutAction } from "@/app/login/actions";

interface Notification {
  id: string;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
  createdAt: string;
  readAt: string | null;
}

export function Topnav({
  user,
  orgName,
  unreadCount,
}: {
  user: { name: string; email: string; role: Role };
  orgName: string;
  unreadCount: number;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(unreadCount);
  const loaded = useRef(false);

  async function loadNotifs() {
    const res = await fetch("/api/notifications", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setNotifs(data.notifications);
      setUnread(data.unread);
    }
  }

  async function markAllRead() {
    await fetch("/api/notifications", { method: "POST" });
    setUnread(0);
    setNotifs((n) => n.map((x) => ({ ...x, readAt: new Date().toISOString() })));
  }

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    loadNotifs();
    const t = setInterval(loadNotifs, 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface px-4 sm:px-6 lg:px-8">
      <form
        className="relative ml-8 max-w-md flex-1 lg:ml-0"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/leads?q=${encodeURIComponent(q)}`);
        }}
      >
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search leads, companies, phone, email…"
          className="h-9 w-full rounded-xl border border-input bg-ivory pl-8 pr-3 text-sm text-espresso transition-all placeholder:text-espresso-300 focus-visible:border-[rgba(140,28,43,0.5)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
        />
      </form>

      <div className="ml-auto flex items-center gap-1.5">
        <Dropdown
          trigger={
            <span className="relative inline-flex size-9 items-center justify-center rounded-md hover:bg-accent">
              <Bell className="size-[18px] text-espresso-500" />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </span>
          }
        >
          <div className="flex items-center justify-between px-2.5 py-1.5">
            <DropdownLabel>Notifications</DropdownLabel>
            <button
              onClick={markAllRead}
              className="text-[11px] text-gold-700 hover:underline"
            >
              Mark all read
            </button>
          </div>
          <DropdownSeparator />
          <div className="max-h-80 overflow-y-auto">
            {notifs.length === 0 && (
              <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">
                Nothing new.
              </p>
            )}
            {notifs.map((n) => (
              <Link
                key={n.id}
                href={n.linkUrl ?? "#"}
                className="block rounded-sm px-2.5 py-2 hover:bg-accent"
              >
                <div className="flex items-start gap-2">
                  {!n.readAt && <span className="mt-1 size-1.5 shrink-0 rounded-full bg-gold" />}
                  <div className={n.readAt ? "opacity-60" : ""}>
                    <p className="text-xs font-medium text-espresso-700">{n.title}</p>
                    {n.body && <p className="text-[11px] text-muted-foreground">{n.body}</p>}
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {relativeTime(n.createdAt)}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </Dropdown>

        <Dropdown
          trigger={
            <span className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-accent">
              <Avatar name={user.name} />
              <span className="hidden text-left sm:block">
                <span className="block text-xs font-medium leading-tight text-espresso-700">
                  {user.name}
                </span>
                <span className="block text-[10px] leading-tight text-muted-foreground">
                  {roleLabel(user.role)}
                </span>
              </span>
            </span>
          }
        >
          <div className="px-2.5 py-2">
            <p className="text-xs font-medium text-espresso-700">{user.name}</p>
            <p className="text-[11px] text-muted-foreground">{user.email}</p>
            <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Building2 className="size-3" /> {orgName}
              <Badge variant="gold" className="ml-1">
                {roleLabel(user.role)}
              </Badge>
            </p>
          </div>
          <DropdownSeparator />
          <Link href="/settings/profile">
            <DropdownItem>
              <UserIcon className="size-4" /> Profile & preferences
            </DropdownItem>
          </Link>
          {/* Called directly, not via a <form>: the menu unmounts on click, which would
              detach a form before the browser submits it. */}
          <DropdownItem type="button" onClick={() => void signOutAction()}>
            <LogOut className="size-4" /> Sign out
          </DropdownItem>
        </Dropdown>
      </div>
    </header>
  );
}

function roleLabel(r: Role) {
  return { ADMIN: "Admin", MANAGER: "Manager", SALES_REP: "Sales Rep" }[r];
}
