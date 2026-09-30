"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TR, TD } from "@/components/ui/table";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/misc";
import { changeRoleAction, setUserActiveAction } from "@/app/(app)/settings/actions";

export function TeamRow({
  userId,
  name,
  email,
  role,
  isActive,
  isSelf,
}: {
  userId: string;
  name: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "SALES_REP";
  isActive: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <TR>
      <TD>
        <span className="flex items-center gap-2">
          <Avatar name={name} className="size-7" />
          <span className="text-xs font-medium text-espresso-700">
            {name}
            {isSelf && <span className="ml-1 text-[10px] text-muted-foreground">(you)</span>}
          </span>
        </span>
      </TD>
      <TD className="text-xs text-muted-foreground">{email}</TD>
      <TD>
        <Select
          value={role}
          disabled={pending}
          className="h-7 w-auto text-[11px]"
          onChange={(e) =>
            start(async () => {
              setErr(null);
              const res = await changeRoleAction(userId, e.target.value as any);
              if (!res.ok) setErr(res.error);
              router.refresh();
            })
          }
        >
          <option value="SALES_REP">Sales Rep</option>
          <option value="MANAGER">Manager</option>
          <option value="ADMIN">Admin</option>
        </Select>
        {err && <p className="mt-1 text-[10px] text-danger-600">{err}</p>}
      </TD>
      <TD>
        <Badge variant={isActive ? "success" : "muted"}>{isActive ? "Active" : "Disabled"}</Badge>
      </TD>
      <TD>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending || isSelf}
          onClick={() =>
            start(async () => {
              await setUserActiveAction(userId, !isActive);
              router.refresh();
            })
          }
        >
          {isActive ? "Disable" : "Enable"}
        </Button>
      </TD>
    </TR>
  );
}
