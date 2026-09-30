import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/context";
import { env } from "@/lib/env";
import { LoginForm } from "@/components/auth/login-form";
import { AuroraBackground } from "@/components/fx/aurora-background";
import { Wordmark } from "@/components/shell/wordmark";
import { HeroVideo } from "@/components/fx/hero-video";
import { AlertCircle, CheckCircle2, PhoneCall, KanbanSquare, MessageCircle } from "lucide-react";

export const dynamic = "force-dynamic";

const HEADLINE: string[][] = [
  ["Every", "enquiry,"],
  ["answered", "on", "time."],
];

const FEATURES = [
  { icon: KanbanSquare, label: "Lead capture & pipeline" },
  { icon: MessageCircle, label: "WhatsApp & Meta conversations" },
  { icon: PhoneCall, label: "Autoneural AI assistant" },
];

const TICKER = ["Leads", "Pipeline", "Projects", "WhatsApp", "AI voice calls", "Follow-ups", "Reports", "Customers"];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string; email?: string; signedOut?: string }>;
}) {
  const sp = await searchParams;
  const actor = await getActor();
  if (actor) redirect("/");

  const callbackUrl =
    sp.callbackUrl?.startsWith("/") && !sp.callbackUrl.startsWith("//") ? sp.callbackUrl : "/";

  let wordIndex = 0;

  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden text-espresso">
      {/* ── Cinematic background: WebGL aurora underneath, skyline video on top ── */}
      <AuroraBackground intensity={1.2} />
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <HeroVideo src="/media/hero-login.mp4" className="opacity-95 [filter:saturate(0.85)_contrast(1.02)_brightness(1.06)]" />
        {/* Warm-white grade: the skyline reads as a faint sepia texture, not a night photo. */}
        <div className="absolute inset-0 bg-[#F4E7DB] mix-blend-color opacity-45" />
        <div className="absolute inset-0 bg-gradient-to-r from-wine-900/95 via-wine-900/58 to-wine-900/5" />
        <div className="absolute inset-0 bg-gradient-to-t from-wine-900/85 via-transparent to-wine-900/35" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_75%_25%,rgba(140,28,43,0.12),transparent_70%)]" />
        <div className="grain absolute inset-0" />
      </div>

      {/* ── Top bar ── */}
      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-6 pt-6 animate-page-in sm:px-10 sm:pt-8">
        <Wordmark />
        <nav className="hidden items-center gap-7 rounded-full border border-border bg-surface px-5 py-2 text-[11px] font-medium uppercase tracking-[0.22em] text-espresso-700 shadow-card md:flex">
          <span>Pipeline</span>
          <span>Conversations</span>
          <span>AI Voice</span>
        </nav>
      </header>

      {/* ── Hero ── */}
      <main className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 items-center gap-14 px-6 py-12 sm:px-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-20">
        <section className="max-w-2xl">
          <h1 className="font-display text-6xl font-semibold leading-[0.98] tracking-[-0.02em] sm:text-7xl xl:text-8xl">
            {HEADLINE.map((line, li) => (
              <span key={li} className="block">
                {line.map((word) => {
                  const delay = 250 + wordIndex++ * 110;
                  return (
                    <span key={word} className="reveal-word mr-[0.22em]">
                      <span
                        className={li === 1 ? "italic text-gold-700" : "text-espresso"}
                        style={{ animationDelay: `${delay}ms` }}
                      >
                        {word}
                      </span>
                    </span>
                  );
                })}
              </span>
            ))}
          </h1>
          <p
            className="mt-8 max-w-lg animate-rise-in text-base leading-relaxed text-espresso sm:text-lg"
            style={{ animationDelay: "900ms" }}
          >
            Leads, conversations, projects and AI voice calls — one considered workspace for the Autoneural
            team.
          </p>
          <ul className="mt-10 grid gap-3 sm:grid-cols-3">
            {FEATURES.map((f, i) => (
              <li
                key={f.label}
                className="glass lift flex items-center gap-3 rounded-2xl px-4 py-3 text-sm text-espresso-700 animate-rise-in"
                style={{ animationDelay: `${1050 + i * 120}ms`, background: "rgba(255, 255, 255, 0.72)" }}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#8C1C2B]/70 to-[#5E0D18]/70 ring-1 ring-white/10">
                  <f.icon className="size-4 text-white" />
                </span>
                {f.label}
              </li>
            ))}
          </ul>
        </section>

        {/* ── Sign-in card ── */}
        <section className="w-full animate-rise-in lg:justify-self-end" style={{ animationDelay: "500ms" }}>
          <div className="relative mx-auto w-full max-w-[420px] rounded-[28px]">
            <div className="orbit-border" />
            <div
              className="glass relative rounded-[28px] p-8 sm:p-10"
              style={{
                // Denser wine glass than elsewhere: the form must stay readable over bright city lights.
                background: "linear-gradient(160deg, rgba(255, 255, 255, 0.88), rgba(255, 250, 246, 0.76))",
                backdropFilter: "blur(28px) saturate(115%)",
                WebkitBackdropFilter: "blur(28px) saturate(115%)",
              }}
            >
              <h2 className="font-display text-3xl font-semibold text-espresso">Welcome back</h2>
              <p className="mt-1.5 text-sm text-espresso-500">Sign in to your Autoneural workspace.</p>

              {sp.error && (
                <div
                  role="alert"
                  className="mt-5 flex items-start gap-2 rounded-xl border border-danger-100 bg-danger-50 p-3 text-xs text-danger-600 animate-fade-in"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  Incorrect email or password. Please try again.
                </div>
              )}
              {sp.signedOut && !sp.error && (
                <div
                  role="status"
                  className="mt-5 flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-600 animate-fade-in"
                >
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  You have been signed out.
                </div>
              )}

              <div className="mt-7">
                <LoginForm defaultEmail={sp.email} callbackUrl={callbackUrl} />
              </div>



              <p className="mt-6 text-center text-[10px] uppercase tracking-[0.24em] text-espresso-300">
                Secure sales workspace
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* ── Ticker ── */}
      <footer className="relative z-10 overflow-hidden border-t border-border py-4 [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
        <div className="marquee flex w-max gap-12 whitespace-nowrap text-[11px] uppercase tracking-[0.3em] text-espresso-300">
          {[...TICKER, ...TICKER].map((t, i) => (
            <span key={i} className="flex items-center gap-12">
              {t}
              <span className="size-1 rounded-full bg-gold-700/60" />
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}
