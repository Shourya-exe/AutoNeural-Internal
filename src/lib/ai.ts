import { z } from "zod";
import { AppError } from "./store";
import { sdb, salesSummary, company } from "./sales";
import { cdb } from "./voice";
import { audit, meter, usedThisMonth } from "./platform";
import { ldb } from "./leads";
import type { User } from "./types";

/**
 * AI sales assistant: email drafting, lead guidance and plain-English business questions.
 * Uses the Gemini keys already configured for the voice agent (GOOGLE_API_KEY, GOOGLE_API_KEY_2).
 * The model only sees data from this workspace and is told not to invent facts.
 */

// Same chain as the voice agent (voice_config.py): full Flash first, the lighter model when it is busy.
const MODELS = () => [...new Set([process.env.AI_MODEL || "gemini-3.5-flash", "gemini-3.5-flash-lite"])];

/** Monthly caps (Settings → Usage). Null means no cap. */
export function budgets(): { aiCreditsPerMonth: number | null; voiceMinutesPerMonth: number | null } {
  const row = ldb().prepare("SELECT value FROM settings WHERE key='budgets'").get() as { value: string } | undefined;
  return row ? JSON.parse(row.value) : { aiCreditsPerMonth: null, voiceMinutesPerMonth: null };
}

/** One AI credit = up to 1,000 tokens. Every call is metered and checked against the monthly budget. */
export async function gemini(system: string, prompt: string, json = false, feature = "assistant"): Promise<string> {
  const cap = budgets().aiCreditsPerMonth;
  if (cap != null && usedThisMonth("ai_credit") >= cap) throw new AppError(402, "This month's AI credit budget is used up. Raise it under Usage.");
  const keys = [process.env.GOOGLE_API_KEY, process.env.GOOGLE_API_KEY_2].filter(Boolean) as string[];
  if (!keys.length) throw new AppError(400, "AI is not configured. Add GOOGLE_API_KEY (the same key the calling agent uses).");
  let last = "";
  const attempts = MODELS().flatMap((model) => keys.map((key) => ({ model, key })));
  for (const { model, key } of attempts) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, ...(json ? { responseMimeType: "application/json" } : {}) },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { totalTokenCount?: number };
      error?: { message?: string };
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
    if (res.ok && text) {
      const tokens = data.usageMetadata?.totalTokenCount ?? Math.ceil((system.length + prompt.length + text.length) / 4);
      meter("ai_credit", Math.max(1, Math.ceil(tokens / 1000)), feature, { model, tokens });
      return text;
    }
    last = data.error?.message ?? `HTTP ${res.status}`;
    if (res.status !== 429 && res.status < 500) break; // only quota/overload errors are worth another model or key
  }
  throw new AppError(502, `The AI service failed: ${last}`);
}

const GROUND =
  "Use only the facts provided. Never invent prices, dates, results, company details or promises; if something is unknown, say so or leave a clear [placeholder]. Indian business context, INR, IST. Write plain text: no Markdown, no asterisks or # headings; use a hyphen for bullets.";

function leadContext(user: User, leadId: string) {
  sdb();
  const db = cdb();
  const lead = db.prepare("SELECT l.*, u.name AS ownerName FROM leads l LEFT JOIN users u ON u.id=l.ownerId WHERE l.id=?").get(leadId) as Record<string, any> | undefined;
  if (!lead || (user.role !== "admin" && lead.ownerId !== user.id)) throw new AppError(404, "Lead not found.");
  const notes = lead.taskId ? (db.prepare("SELECT text, createdAt FROM comments WHERE taskId=? ORDER BY createdAt DESC LIMIT 15").all(lead.taskId) as { text: string }[]) : [];
  const calls = db.prepare("SELECT direction, status, summary, nextAction, createdAt FROM calls WHERE leadId=? ORDER BY createdAt DESC LIMIT 5").all(leadId);
  const docs = db.prepare("SELECT number, kind, status, total, paid FROM documents WHERE leadId=? ORDER BY createdAt DESC LIMIT 5").all(leadId);
  const { id: _i, taskId: _t, externalId: _e, ...fields } = lead;
  return { lead: fields, notes: notes.map((n) => n.text), calls, documents: docs, seller: { name: company().name, services: "AI agents, AI calling, WhatsApp automation, websites, custom software, business automation" } };
}

export async function leadGuidance(user: User, leadId: string) {
  const ctx = leadContext(user, leadId);
  const out = await gemini(
    `You are a sales coach for an Indian SME salesperson. ${GROUND} Answer in JSON with keys: overview (2-3 sentences on who this lead is and what they want), company (what is known about their business; say "Not known yet" if nothing), pitch (3 short bullet strings tailored to their need), questions (3 discovery questions), nextAction (one concrete next step with timing).`,
    JSON.stringify(ctx),
    true,
  );
  return z
    .object({ overview: z.string(), company: z.string(), pitch: z.array(z.string()), questions: z.array(z.string()), nextAction: z.string() })
    .parse(JSON.parse(out));
}

export async function draftEmail(user: User, input: unknown) {
  const p = z.object({ leadId: z.string().uuid(), purpose: z.string().trim().min(3).max(500) }).parse(input);
  const ctx = leadContext(user, p.leadId);
  const out = await gemini(
    `You write short, warm, professional sales emails for ${company().name}. ${GROUND} Sign off as ${user.name}. Reply in JSON with keys subject and body (plain text, under 180 words).`,
    `Purpose: ${p.purpose}\nContext: ${JSON.stringify(ctx)}`,
    true,
  );
  return z.object({ subject: z.string(), body: z.string() }).parse(JSON.parse(out));
}

/** Plain-English questions over a snapshot of workspace metrics (no raw SQL from the model). */
export async function askBusiness(user: User, question: unknown) {
  const q = z.string().trim().min(3).max(500).parse(question);
  sdb();
  const db = cdb();
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const admin = user.role === "admin";
  const own = admin ? "" : " AND l.ownerId=@me";
  // Queries share one params object; admin queries simply don't use @me.
  const all = (sql: string, params: Record<string, string> = {}) => {
    const st = db.prepare(sql);
    st.setAllowUnknownNamedParameters(true);
    return st.all({ me: user.id, since, ...params });
  };
  const snapshot = {
    asOf: new Date().toISOString(),
    scope: admin ? "whole company" : `only ${user.name}'s leads`,
    pipeline: salesSummary(user),
    leadsBySource90d: all(`SELECT source, sourceDetail, COUNT(*) AS n FROM leads l WHERE createdAt>=@since AND status!='Duplicate'${own} GROUP BY source, sourceDetail ORDER BY n DESC LIMIT 20`),
    leadsByOwner90d: admin
      ? all("SELECT u.name, COUNT(*) AS leads, SUM(l.status='Won') AS won, COALESCE(SUM(CASE WHEN l.status='Won' THEN l.value END),0) AS wonValue FROM leads l JOIN users u ON u.id=l.ownerId WHERE l.createdAt>=@since AND l.status!='Duplicate' GROUP BY u.name")
      : undefined,
    leadsByWeek: all(`SELECT strftime('%Y-%W', createdAt) AS week, COUNT(*) AS n FROM leads l WHERE createdAt>=@since AND status!='Duplicate'${own} GROUP BY week ORDER BY week`),
    lostReasons: all(`SELECT lostReason, COUNT(*) AS n FROM leads l WHERE status='Lost' AND lostReason IS NOT NULL${own} GROUP BY lostReason ORDER BY n DESC LIMIT 10`),
    aiCalls90d: all("SELECT direction, status, COUNT(*) AS n, AVG(duration) AS avgSeconds FROM calls WHERE createdAt>=@since GROUP BY direction, status"),
    invoices: admin ? db.prepare("SELECT status, COUNT(*) AS n, SUM(total) AS total, SUM(paid) AS paid FROM documents WHERE kind='invoice' GROUP BY status").all() : undefined,
    tickets: db.prepare("SELECT status, category, COUNT(*) AS n FROM tickets GROUP BY status, category").all(),
  };
  const answer = await gemini(
    `You are a business analyst for an Indian SME. Answer the question using only this data snapshot. ${GROUND} Be concise: a direct answer first, then up to 4 bullet points with numbers. If the data cannot answer it, say what is missing.`,
    `Question: ${q}\nData: ${JSON.stringify(snapshot)}`,
  );
  return { answer };
}
