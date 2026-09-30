import { EnquiryForm } from "@/components/public/enquiry-form";
import { Wordmark } from "@/components/shell/wordmark";

export const metadata = {
  title: "Talk to AutoNeural",
  description: "Tell us what you want to automate — AI agents, calling systems, WhatsApp, websites and custom software.",
};

/**
 * Example public enquiry form. This page is intentionally OUTSIDE the
 * authenticated app and posts to /api/public/enquiry. It holds no credentials.
 */
export default function EnquiryPage() {
  return (
    <div className="min-h-screen bg-ivory">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-5">
          <Wordmark />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10">
        <div className="mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-700">
            Contact Autoneural
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-espresso">
            Tell us what you want to automate
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-espresso-500">
            AI agents, AI calling systems, WhatsApp automation, websites, custom software and
            business automation. Send us the shape of the problem and we&apos;ll come back with an
            approach.
          </p>
          <div className="gold-rule mt-5 h-px w-full" />
        </div>

        <EnquiryForm />

        <p className="mt-8 text-[11px] leading-relaxed text-muted-foreground">
          Prefer WhatsApp? <a href="https://wa.me/916297927642" className="underline">Message Autoneural on +91 62979 27642</a>.

        </p>
      </main>
    </div>
  );
}
