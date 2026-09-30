"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Eye, EyeOff, Loader2, ArrowRight } from "lucide-react";
import { signInAction } from "@/app/login/actions";

const field =
  "h-12 w-full rounded-xl border border-[#8A1226]/20 bg-white/[0.07] px-4 text-sm text-espresso placeholder:text-espresso-300 outline-none transition-all duration-200 focus:border-[rgba(140,28,43,0.6)] focus:bg-white/[0.09] focus:ring-4 focus:ring-[rgba(140,28,43,0.25)]";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-sheen group flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#8A1226]/40 bg-gradient-to-b from-[#8C1C2B] to-[#5E0D18] text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_14px_34px_-12px_rgba(140,28,43,0.85)] transition-all duration-200 hover:from-[#A32133] hover:to-[#6E1020] hover:shadow-glow active:scale-[0.99] disabled:cursor-wait disabled:opacity-80"
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" /> Signing in…
        </>
      ) : (
        <>
          Sign in to your workspace <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-1" />
        </>
      )}
    </button>
  );
}

export function LoginForm({ defaultEmail, callbackUrl }: { defaultEmail?: string; callbackUrl?: string }) {
  const [show, setShow] = useState(false);

  return (
    <form action={signInAction} className="space-y-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/"} />
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-espresso-500">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus={!defaultEmail}
          defaultValue={defaultEmail}
          placeholder="you@business.com"
          className={field}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-espresso-500">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            required
            autoComplete="current-password"
            autoFocus={!!defaultEmail}
            className={`${field} pr-11`}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-espresso-300 transition-colors hover:text-espresso"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>
      <SubmitButton />
    </form>
  );
}
