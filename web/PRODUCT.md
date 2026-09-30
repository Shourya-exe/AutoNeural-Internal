# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Growing Indian service businesses with 5–30 operational users (B2B services, agencies, education/training first). Two primary users, weighted equally (confirmed):
- **Salespeople / coordinators** working on a mid-range phone all day between WhatsApp and calls: capture a lead, reply, call, log the outcome, set the next follow-up — in seconds.
- **Founders / managers** on a laptop: see what is pending, who owns it, what is late, where revenue is leaking, and ask the business questions directly.

## Product Purpose
AutoNeural Business OS connects customer conversations, sales, team execution and payments in one workspace so a growing company runs with less manual coordination and more visibility. Success = every open lead has an owner and a next action, managers stop chasing updates, and enquiries progress to payment without being re-typed across tools.

## Positioning
Not "another CRM": one connected workflow from enquiry to payment for WhatsApp-and-phone-driven Indian SMEs, with governed AI. Philosophy is binding: **Manual first → Automation second → AI third.** Every important action works by hand; automation removes repetition; AI analyses, drafts and acts only within permissions, with Draft → Review → Approve → Execute for consequential actions.

## Operating Context
Leads arrive from Facebook/website/WhatsApp/calls/referrals. Conversations happen on WhatsApp and phone. Quotes, invoices (GST), and payment links (Razorpay/UPI) follow. Managers run daily/weekly reviews. Multi-tenant SaaS; later sold via agencies/resellers under white-label.

## Capabilities and Constraints
- Built: leads/contacts, accounts, configurable pipeline stages, deals, activities & follow-ups, Customer 360 timeline, "needs attention" (no next action / overdue / next 7 days), role scoping (admins see company, employees see own), tenant isolation.
- In progress: AI layer (summaries, lead scoring, next best action, Business Brain Q&A, AI workflow builder), workflow automation engine, official WhatsApp Cloud API inbox, click-to-call + call logs, AI voice agent.
- External services (Claude API, WhatsApp Cloud API, telephony, voice AI) require customer credentials; UI must show honest "not connected" states — never simulated data presented as real.
- AI must never invent pricing, discounts, financial, legal, HR or compliance facts. AI output is always visibly labelled as AI.
- UI language: English only at launch. Customer data may be Hindi, Bengali, etc. and must render correctly.
- Stack: Next.js 16 (web/), NestJS + Prisma + PostgreSQL (backend/).

## Brand Commitments
Match autoneural.in (confirmed): company name "AutoNeural" (Autoneural Solutions Pvt Ltd). Site evidence: warm ivory ground (#FAF9F6), deep ink navy (#0B1220 / #1A2540), signature blue gradient (#1D4ED8 → #2563EB → #0EA5E9) used for emphasis, Archivo headings, Inter UI text, IBM Plex Mono for figures, Syne 800 wordmark, pill buttons with soft glassy highlights. Logo files live at autoneural.in/media/ (not yet copied into this repo).

## Evidence on Hand
No customer testimonials, case studies, usage metrics or pricing are confirmed for the product. Do not fabricate any. The marketing site's stats (120+ projects etc.) belong to the agency, not this product.

## Product Principles
1. Manual first, automation second, AI third — the manual path is always one tap away.
2. Every open lead has an owner and a next action; the interface makes gaps impossible to miss.
3. Evidence over assertion — every metric and AI answer links to the records behind it.
4. Human control over consequential actions; AI proposes, people approve.
5. Speed on a phone beats feature count.

## Accessibility & Inclusion
WCAG 2.2 AA contrast and keyboard access; touch targets ≥ 44px on mobile; works on mid-range Android over patchy networks.
