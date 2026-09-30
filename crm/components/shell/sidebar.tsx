"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  KanbanSquare,
  Inbox,
  CheckSquare,
  BarChart3,
  Settings,
  Menu,
  X,
  Plug,
  Building2,
  Bot,
  PhoneCall,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Wordmark } from "./wordmark";
import type { Role } from "@prisma/client";

const NAV: { href: string; label: string; icon: any; minRole?: Role }[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/agents", label: "AI Agents", icon: Bot },
  { href: "/calls", label: "Call Logs", icon: PhoneCall },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/reports", label: "Reports", icon: BarChart3, minRole: "MANAGER" },
  { href: "/settings", label: "Settings", icon: Settings },
];

const RANK: Record<Role, number> = { SALES_REP: 1, MANAGER: 2, ADMIN: 3 };

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const items = NAV.filter((n) => !n.minRole || RANK[role] >= RANK[n.minRole]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  const NavList = (
    <nav className="stagger flex flex-1 flex-col gap-1 px-3">
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={cn(
              "group relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-sm font-medium transition-all duration-300",
              active
                ? "bg-gradient-to-r from-[rgba(140,28,43,0.32)] to-[rgba(140,28,43,0.04)] text-espresso shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                : "text-espresso-500 hover:translate-x-0.5 hover:bg-champagne-100 hover:text-espresso",
            )}
          >
            {/* glowing indicator on the active item */}
            <span
              aria-hidden
              className={cn(
                "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-gradient-to-b from-[#C1435A] to-[#8C1C2B] shadow-[0_0_12px_rgba(140,28,43,0.9)] transition-all duration-300",
                active ? "opacity-100" : "scale-y-0 opacity-0",
              )}
            />
            <Icon
              className={cn(
                "size-[18px] transition-colors duration-300",
                active ? "text-gold-700 drop-shadow-[0_0_6px_rgba(140,28,43,0.6)]" : "text-espresso-300 group-hover:text-espresso-500",
              )}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen(true)}
        className="fixed left-3 top-3 z-40 rounded-xl border border-border bg-surface p-2 text-espresso shadow-card lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-4" />
      </button>

      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-14 items-center gap-2 border-b border-border px-5">
          <Wordmark />
        </div>
        <div className="flex flex-1 flex-col py-4">{NavList}</div>
        <div className="border-t border-border p-3">
          <Link
            href="/settings/integrations"
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-espresso-500 transition-colors hover:bg-champagne-100 hover:text-espresso"
          >
            <Plug className="size-4 text-espresso-300" />
            Integration status
          </Link>
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[240px] flex-col border-r border-border bg-popover shadow-pop animate-fade-in">
            <div className="flex h-14 items-center justify-between border-b border-border px-5">
              <Wordmark />
              <button onClick={() => setOpen(false)} aria-label="Close navigation" className="text-espresso-500">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex flex-1 flex-col py-4">{NavList}</div>
          </aside>
        </div>
      )}
    </>
  );
}
