import { Info } from "lucide-react";

export function DemoBanner() {
  return (
    <div className="border-b border-gold-700/20 bg-gold/15 px-4 py-2 text-center text-xs text-gold-700 backdrop-blur sm:px-6 lg:px-8">
      <Info className="mr-1.5 inline size-3.5 align-[-2px]" />
      <span className="font-medium">Demo mode</span> — WhatsApp, Messenger and Instagram replies are
      simulated and never leave the system. AI voice calls are real.
    </div>
  );
}
