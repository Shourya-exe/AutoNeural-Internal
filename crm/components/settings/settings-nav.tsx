"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { Role } from "@prisma/client";

const ITEMS: { href: string; label: string; min: Role }[] = [
  { href: "/settings/profile", label: "Profile", min: "SALES_REP" },
  { href: "/settings/team", label: "Team & roles", min: "ADMIN" },
  { href: "/settings/pipeline", label: "Pipeline stages", min: "ADMIN" },
  { href: "/settings/catalog", label: "Services & tags", min: "MANAGER" },
  { href: "/settings/integrations", label: "Integrations", min: "ADMIN" },
  { href: "/settings/automations", label: "Automations", min: "ADMIN" },
  { href: "/settings/notifications", label: "Notifications", min: "SALES_REP" },
  { href: "/settings/audit", label: "Audit log", min: "MANAGER" },
];

const RANK: Record<Role, number> = { SALES_REP: 1, MANAGER: 2, ADMIN: 3 };

export function SettingsNav({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col">
      {ITEMS.filter((i) => RANK[role] >= RANK[i.min]).map((i) => (
        <Link
          key={i.href}
          href={i.href}
          className={cn(
            "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            pathname === i.href
              ? "bg-champagne-100 text-espresso"
              : "text-espresso-500 hover:bg-champagne-50",
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
