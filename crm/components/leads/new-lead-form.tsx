"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { createLeadAction } from "@/app/(app)/leads/actions";

export function NewLeadForm({
  services,
  members,
}: {
  services: { id: string; name: string }[];
  members: { userId: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <form
      className="mt-5 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget as HTMLFormElement);
        const payload = Object.fromEntries(fd.entries());
        start(async () => {
          setErr(null);
          const res = await createLeadAction({
            ...payload,
            estimatedValue: payload.estimatedValue ? Number(payload.estimatedValue) : undefined,
          });
          if (res.ok && res.id) router.push(`/leads/${res.id}`);
          else if (!res.ok) setErr(res.error);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name *">
          <Input name="fullName" required placeholder="Vikram Sharma" />
        </Field>
        <Field label="Company">
          <Input name="company" placeholder="Nimbus Retail" />
        </Field>
        <Field label="Phone">
          <Input name="phone" placeholder="+91 98123 45678" />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" placeholder="vikram@nimbus.com" />
        </Field>
        <Field label="Interested service">
          <Select name="serviceId" defaultValue="">
            <option value="">Not set</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Source channel *">
          <Select name="sourceChannel" defaultValue="MANUAL">
            <option value="MANUAL">Manual entry</option>
            <option value="WEBSITE_FORM">Website form</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="META_LEAD_ADS">Facebook / Instagram Lead Ads</option>
            <option value="MESSENGER">Facebook Messenger</option>
            <option value="INSTAGRAM">Instagram</option>
          </Select>
        </Field>
        <Field label="Priority">
          <Select name="priority" defaultValue="MEDIUM">
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </Select>
        </Field>
        <Field label="Estimated value (INR)">
          <Input name="estimatedValue" type="number" min="0" step="1000" placeholder="250000" />
        </Field>
        <Field label="Assign to">
          <Select name="ownerId" defaultValue="">
            <option value="">Leave to automation (round-robin)</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Requirement / notes">
        <Textarea name="interestedService" rows={3} placeholder="What are they asking for?" />
      </Field>

      {err && (
        <p className="rounded-md bg-danger-50 px-3 py-2 text-xs text-danger-600">{err}</p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create lead"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
