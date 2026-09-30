"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { CheckCircle2 } from "lucide-react";

const SERVICES = [
  "AI Agents",
  "AI Calling Systems",
  "WhatsApp Automation",
  "Websites",
  "Custom Software",
  "Business Automation",
  "Not sure yet",
];

export function EnquiryForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [attribution, setAttribution] = useState<Record<string, string>>({});

  // Capture attribution client-side and forward it with the submission.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const a: Record<string, string> = {};
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
      const v = p.get(k);
      if (v) a[k] = v;
    }
    a.referrer = document.referrer || "";
    a.landing = sessionStorage.getItem("an_landing") || window.location.href;
    a.pageUrl = window.location.href;
    try {
      if (!sessionStorage.getItem("an_landing"))
        sessionStorage.setItem("an_landing", window.location.href);
    } catch {
      /* private mode */
    }
    setAttribution(a);
  }, []);

  if (state === "sent") {
    return (
      <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-8 text-center">
        <CheckCircle2 className="mx-auto size-8 text-emerald-600" />
        <h2 className="mt-3 text-base font-semibold text-espresso">Thanks — we&apos;ve got it.</h2>
        <p className="mt-1 text-sm text-espresso-500">
          A member of the AutoNeural team will be in touch shortly.
        </p>
      </div>
    );
  }

  return (
    <form
      className="space-y-4 rounded-lg border border-border bg-surface p-6 shadow-card"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget as HTMLFormElement);
        const payload: Record<string, unknown> = {
          ...attribution,
          ...Object.fromEntries(fd.entries()),
          consent: fd.get("consent") === "on",
        };
        setState("sending");
        setError(null);
        try {
          const res = await fetch("/api/public/enquiry", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const json = await res.json().catch(() => ({}));
          if (res.ok) setState("sent");
          else {
            setState("error");
            setError(json.error ?? "Something went wrong. Please try again.");
          }
        } catch {
          setState("error");
          setError("Network error. Please try again.");
        }
      }}
    >
      {/* Honeypot — hidden from humans, must stay empty. */}
      <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label>
          Leave this field empty
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="name">Your name *</Label>
          <Input id="name" name="name" required placeholder="Vikram Sharma" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="company">Company</Label>
          <Input id="company" name="company" placeholder="Nimbus Retail" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" placeholder="you@company.com" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="phone">Phone / WhatsApp</Label>
          <Input id="phone" name="phone" placeholder="+91 98123 45678" />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="service">What are you interested in?</Label>
        <Select id="service" name="service" defaultValue="">
          <option value="">Select a service</option>
          {SERVICES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="message">What do you want to build or automate?</Label>
        <Textarea
          id="message"
          name="message"
          rows={4}
          placeholder="We get 200 enquiries a week on WhatsApp and miss half of them…"
        />
      </div>

      <label className="flex items-start gap-2 text-xs text-espresso-500">
        <input type="checkbox" name="consent" className="mt-0.5 accent-gold" />
        <span>
          I agree that AutoNeural may contact me about this enquiry by email, phone or WhatsApp.
        </span>
      </label>

      <p className="text-[11px] text-muted-foreground">
        At least one of email or phone is required so we can reply.
      </p>

      {error && (
        <p className="rounded-md bg-danger-50 px-3 py-2 text-xs text-danger-600">{error}</p>
      )}

      <Button type="submit" disabled={state === "sending"} className="w-full sm:w-auto">
        {state === "sending" ? "Sending…" : "Send enquiry"}
      </Button>
    </form>
  );
}
