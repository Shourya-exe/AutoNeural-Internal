import { cn } from "@/lib/utils";

/** AUTONEURAL wordmark — a connected neural mark + letterspaced type. */
export function Wordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden className="drop-shadow-[0_0_6px_rgba(140,28,43,0.7)]">
        <defs>
          <linearGradient id="rx-mark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#B03348" />
            <stop offset="1" stopColor="#8C1C2B" />
          </linearGradient>
        </defs>
        <path d="M4 5 10 10 16 4M10 10 16 16M10 10 4 16" stroke="url(#rx-mark)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 5v11M16 4v12" stroke="url(#rx-mark)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="10" cy="10" r="1.5" fill="#8A1226" />
      </svg>
      {!compact && (
        <span className="text-[13px] font-semibold tracking-[0.18em] text-espresso">
          AUTONEURAL
        </span>
      )}
    </span>
  );
}
