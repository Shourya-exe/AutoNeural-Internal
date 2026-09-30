---
version: 1
slug: "src-app-app-page-tsx"
primary_target: "src/app/(app)/page.tsx"
related_targets: ["src/app/(app)/leads/page.tsx","src/app/(app)/contacts/[id]/page.tsx","src/app/(app)/pipeline/page.tsx"]
---

Scope: the whole signed-in Business OS workspace (web/src/app/(app)/*): Command home, Leads, Customer 360, Pipeline, and hosts for Inbox (WhatsApp), Calls, Automations. Mode: Operate.
Audience/job: salespeople on mid-range Android phones and founders/managers on laptops, equally. Job: act on the next thing that matters, and ask the business questions directly.
Constraints: brand pinned to autoneural.in; AI output always labelled; consequential AI actions need Review → Approve; honest "not connected" states for WhatsApp/telephony/AI keys.
Chosen structure: AI-first command home (surface seed key 0ed3dd9b, dealt lead index 7). Build path: code-led (no image generation on this machine).
Memorable moment: typing a plain sentence and getting back live, actionable record cards instead of prose.

## Direction contract
THESIS: The workspace opens on a question, not a dashboard. One ask-or-tell bar is the centre of gravity; answers arrive as live record cards with one-tap actions. Refuses the category default of KPI tiles over a sidebar of modules.
OWN-WORLD: autoneural.in carried into an instrument: ivory ground #FAF9F6, ink navy #0B1220 text and rail, the blue gradient #1D4ED8→#2563EB→#0EA5E9 reserved for AI-origin marks (✦, the ask bar focus ring, AI chips) so gradient = "the machine did this". Archivo for headings, Inter for UI, tabular IBM Plex Mono for money, times, counts. Pill controls with a 1px inset highlight; cards are flat ivory-white with hairline ink borders, no drop-shadow stacks. Dark theme: ink ground, ivory text, same gradient.
STORY: Visitor sees what needs them today, asks in their own words, approves or does the action, and leaves. Manual path is always one tap away (Call, WhatsApp, Log).
FIRST VIEWPORT: Narrow ink rail left (desktop) / bottom bar (phone). Top-left greeting with live counts in mono. The ask bar spans the content column at ~56px height, ⌘K anywhere. Below it, the "Needs you" stream: overdue then no-next-action cards, each with inline Call / WhatsApp / Done. Right column (desktop ≥1200px): proposed AI actions awaiting approval.
FORM: AI-first command home, position 7 of my ordered list, seed key 0ed3dd9b. Signature interaction: ask → streamed answer with record cards and approve-able actions; ⌘K palette doubles as the ask bar.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
