import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError, requireAdmin } from "./store";
import { addLeads, ldb, normalizePhone, systemActor } from "./leads";
import type { User } from "./types";
import { audit, emit, meter, usedThisMonth } from "./platform";

/**
 * AI calling agent (Riya) for the workspace.
 *
 * The Python worker in voice-agent/ (agent.py, unchanged from AUTONEURAL CRM) registers
 * with LiveKit. "Call with AI" dispatches it with the lead's number; it dials over the
 * Vobiz SIP trunk and, when the call ends, posts the transcript and summary to
 * /api/agent/calls. Inbound calls to the company number reach the same worker through
 * LiveKit's SIP dispatch rule; unknown callers become new leads.
 */

export type CallRecord = {
  id: string;
  roomName: string;
  leadId: string | null;
  leadName: string | null;
  direction: "inbound" | "outbound";
  customerNumber: string | null;
  status: string;
  outcome: string | null;
  duration: number | null;
  language: string | null;
  summary: string | null;
  sentiment: string | null;
  nextAction: string | null;
  transcript: string | null;
  failureReason: string | null;
  requestedByName: string | null;
  createdAt: string;
  endedAt: string | null;
};

let ready = false;
export function cdb() {
  const c = ldb();
  if (!ready) {
    c.exec(`CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,roomName TEXT UNIQUE NOT NULL,leadId TEXT REFERENCES leads(id) ON DELETE SET NULL,direction TEXT NOT NULL,customerNumber TEXT,status TEXT NOT NULL,outcome TEXT,duration INTEGER,language TEXT,transcript TEXT,summary TEXT,sentiment TEXT,nextAction TEXT,failureReason TEXT,context TEXT,requestedBy TEXT REFERENCES users(id),createdAt TEXT NOT NULL,endedAt TEXT);
      CREATE INDEX IF NOT EXISTS calls_time ON calls(createdAt DESC);
      CREATE INDEX IF NOT EXISTS calls_lead ON calls(leadId);
      CREATE TABLE IF NOT EXISTS agent_requests(id TEXT PRIMARY KEY,result TEXT NOT NULL,createdAt TEXT NOT NULL);`);
    // Human calls share the table: agent='human', with disposition, notes and recording.
    for (const col of ["agent TEXT NOT NULL DEFAULT 'ai'", "userId TEXT", "disposition TEXT", "notes TEXT", "recordingUrl TEXT"]) {
      try {
        c.exec(`ALTER TABLE calls ADD COLUMN ${col}`);
      } catch {}
    }
    ready = true;
  }
  return c;
}
const now = () => new Date().toISOString();

// ─── Worker process ──────────────────────────────────────────────────────────

const AGENT_DIR = resolve(/* turbopackIgnore: true */ process.cwd(), "voice-agent");
const healthPort = () => Number(process.env.AGENT_HEALTH_PORT ?? "8082");
const external = () => ["1", "true", "yes"].includes((process.env.AGENT_EXTERNAL ?? "").toLowerCase());
let child: ChildProcess | null = null;
let startedAt: number | null = null;
let lastError: string | null = null;

function portOpen(port: number) {
  return new Promise<boolean>((done) => {
    const sock = connect({ port, host: "127.0.0.1" });
    const end = (open: boolean) => (sock.destroy(), done(open));
    sock.setTimeout(250);
    sock.once("connect", () => end(true));
    sock.once("timeout", () => end(false));
    sock.once("error", () => end(false));
  });
}

export function voiceConfigured() {
  const missing = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "DEEPGRAM_API_KEY", "AGENT_INGEST_SECRET"].filter(
    (k) => !process.env[k],
  );
  if (!process.env.OUTBOUND_TRUNK_ID && !process.env.VOBIZ_SIP_TRUNK_ID) missing.push("OUTBOUND_TRUNK_ID");
  return missing;
}

export async function agentStatus() {
  if (external()) return { running: true, external: true, uptime: null, error: null, missing: voiceConfigured() };
  const managed = child !== null && child.exitCode === null;
  const running = managed || (await portOpen(healthPort()));
  return {
    running,
    external: false,
    uptime: managed && startedAt ? Math.floor((Date.now() - startedAt) / 1000) : null,
    error: running ? null : lastError,
    missing: voiceConfigured(),
  };
}

const isWindows = process.platform === "win32";
type Python = { cmd: string; args: string[]; label: string };

/** The project virtualenv's interpreter for this OS (Windows venvs use Scripts\python.exe). */
const venvPython = () => (isWindows ? join(AGENT_DIR, ".venv", "Scripts", "python.exe") : join(AGENT_DIR, ".venv", "bin", "python"));

/** Interpreters to try, best first: AGENT_PYTHON, the project venv, then the system Python. */
function pythonCandidates(): Python[] {
  const list: Python[] = [];
  const configured = process.env.AGENT_PYTHON?.trim();
  if (configured) list.push({ cmd: configured, args: [], label: `AGENT_PYTHON (${configured})` });
  if (existsSync(venvPython())) list.push({ cmd: venvPython(), args: [], label: "voice-agent/.venv" });
  if (isWindows) list.push({ cmd: "py", args: ["-3"], label: "py -3" }, { cmd: "python", args: [], label: "python" });
  else list.push({ cmd: "python3", args: [], label: "python3" }, { cmd: "python", args: [], label: "python" });
  return list;
}

const tryRun = (cmd: string, args: string[], timeout: number) =>
  new Promise<{ ok: boolean; out: string }>((done) =>
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) =>
      done({ ok: !err, out: `${stdout}${stderr}`.trim() }),
    ),
  );

let agentPython: Python | null = null;
/**
 * The first interpreter that can import the agent's packages. Importing them also proves the
 * packages were installed for this OS (a virtualenv copied from a Mac has a `python` that is a
 * dead symlink on Windows). Otherwise explains exactly what to install.
 */
export async function findAgentPython(): Promise<Python> {
  if (agentPython) return agentPython;
  let bare: Python | null = null;
  for (const p of pythonCandidates()) {
    const version = await tryRun(p.cmd, [...p.args, "--version"], 10_000);
    if (!version.ok || !/^Python 3\./.test(version.out)) continue; // missing, or the Microsoft Store stub
    bare ??= p;
    if ((await tryRun(p.cmd, [...p.args, "-c", "import livekit.agents, livekit.plugins.deepgram, livekit.plugins.silero"], 90_000)).ok)
      return (agentPython = p);
  }
  const setup = isWindows
    ? "py -3 -m venv voice-agent\\.venv, then voice-agent\\.venv\\Scripts\\python -m pip install -r voice-agent\\requirements.txt"
    : "python3 -m venv voice-agent/.venv, then voice-agent/.venv/bin/python -m pip install -r voice-agent/requirements.txt";
  const foreignVenv = existsSync(join(AGENT_DIR, ".venv", "pyvenv.cfg")) && !existsSync(venvPython());
  throw new AppError(
    503,
    [
      bare ? `Python was found (${bare.label}), but the calling agent's packages are not installed for it.` : "Python 3 was not found on this server.",
      foreignVenv ? "voice-agent/.venv was created on a different operating system and cannot run here." : "",
      `From the project folder run: ${setup}. Or set AGENT_PYTHON to a Python that has them.`,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/** Last lines the agent printed, so a crash can be explained in the UI instead of "check the log". */
let recentOutput: string[] = [];
const remember = (chunk: Buffer, log: (s: string) => void) => {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (!line.trim()) continue;
    log(`[agent] ${line}`);
    recentOutput.push(line.trim());
  }
  recentOutput = recentOutput.slice(-30);
};

export async function startAgent(user: User) {
  requireAdmin(user);
  if ((await agentStatus()).running) return { ok: true, message: "The calling agent is already running." };
  const missing = voiceConfigured();
  if (missing.length) throw new AppError(400, `Add these settings first: ${missing.join(", ")}.`);
  const script = join(AGENT_DIR, "agent.py");
  if (!existsSync(script)) throw new AppError(500, "voice-agent/agent.py is missing.");
  const python = await findAgentPython();
  recentOutput = [];
  const proc = spawn(python.cmd, [...python.args, script, "start"], {
    cwd: AGENT_DIR,
    stdio: "pipe",
    // Unix: own process group so stop also ends LiveKit's job subprocesses. Windows has no
    // process groups (stop uses taskkill /T) and a detached child would open a console window.
    detached: !isWindows,
    windowsHide: true,
    env: {
      ...process.env,
      CRM_URL: process.env.CRM_URL || process.env.CRM_APP_URL || "http://localhost:3000",
      // Windows pipes default to cp1252; Hindi/Bengali log lines would crash the agent.
      PYTHONUTF8: "1",
      PYTHONUNBUFFERED: "1",
    },
  });
  proc.stdout?.on("data", (d: Buffer) => remember(d, console.log));
  proc.stderr?.on("data", (d: Buffer) => remember(d, console.error));
  proc.on("error", (e) => {
    lastError = `Could not start the agent with ${python.label}: ${e.message}`;
    agentPython = null; // look again next time
    if (child === proc) child = null;
  });
  proc.on("exit", (code, signal) => {
    if (child !== proc) return;
    child = null;
    startedAt = null;
    if (code !== 0) {
      const last = recentOutput.at(-1);
      lastError = `The agent stopped (${code ?? signal})${last ? `: ${last.slice(0, 300)}` : ". Check the server log."}`;
    }
  });
  child = proc;
  startedAt = Date.now();
  lastError = null;
  // Most setup problems (bad credentials, missing packages) end the process within seconds; report them now.
  await new Promise((r) => setTimeout(r, 3000));
  if (child !== proc) throw new AppError(502, lastError ?? "The calling agent stopped right after starting. Check the server log.");
  return { ok: true, message: "Calling agent started. It is ready once LiveKit registers it (a few seconds)." };
}

export function stopAgent(user: User) {
  requireAdmin(user);
  const proc = child;
  if (!proc || proc.exitCode !== null || !proc.pid) return { ok: true, message: "The agent was not started from here." };
  if (isWindows) {
    // Ends the agent and its job processes (tree kill); calls in progress are cut off.
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true }).on("error", (e) => console.error("[agent] stop failed", e));
  } else {
    const kill = (sig: NodeJS.Signals) => {
      try {
        process.kill(-proc.pid!, sig);
      } catch {}
    };
    kill("SIGTERM");
    const t = setTimeout(() => kill("SIGKILL"), 4000);
    proc.once("exit", () => clearTimeout(t));
  }
  child = null;
  startedAt = null;
  return { ok: true, message: "Calling agent stopped." };
}

// ─── Placing calls ───────────────────────────────────────────────────────────

const livekit = () => {
  const url = process.env.LIVEKIT_URL ?? "";
  const key = process.env.LIVEKIT_API_KEY ?? "";
  const secret = process.env.LIVEKIT_API_SECRET ?? "";
  if (!url || !key || !secret) throw new AppError(400, "LiveKit is not configured (LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET).");
  return { host: url.replace(/^ws/, "http"), key, secret };
};

const callInput = z.union([
  z.object({ leadId: z.string().uuid(), context: z.string().trim().max(1000).optional() }),
  z.object({ phone: z.string().min(6).max(32), name: z.string().trim().max(80).optional(), context: z.string().trim().max(1000).optional() }),
]);

/** "Call with AI": dispatch Riya to phone a lead (or any number) now. */
export async function placeCall(user: User, input: unknown) {
  const p = callInput.parse(input);
  let leadId: string | null = null,
    phone: string | null,
    name: string;
  if ("leadId" in p) {
    const lead = cdb().prepare("SELECT id,name,phone,ownerId FROM leads WHERE id=?").get(p.leadId) as
      | { id: string; name: string; phone: string | null; ownerId: string }
      | undefined;
    if (!lead || (user.role !== "admin" && lead.ownerId !== user.id)) throw new AppError(404, "Lead not found.");
    ({ id: leadId, phone, name } = lead);
    if (!phone) throw new AppError(400, "This lead has no phone number.");
  } else {
    phone = normalizePhone(p.phone);
    if (!phone) throw new AppError(400, "Enter a valid number, e.g. +91 98765 43210.");
    name = p.name || phone;
    const match = cdb()
      .prepare("SELECT id FROM leads WHERE phone=? AND status!='Duplicate' ORDER BY number DESC LIMIT 1")
      .get(phone) as { id: string } | undefined;
    leadId = match?.id ?? null;
  }
  if (!(await agentStatus()).running) throw new AppError(503, "The calling agent is not running. Start it on the AI Calls page.");
  const { budgets } = await import("./ai");
  const cap = budgets().voiceMinutesPerMonth;
  if (cap != null && usedThisMonth("voice_minute") >= cap) throw new AppError(402, "This month's AI voice-minute budget is used up. Raise it under Usage.");
  const lk = livekit();
  const roomName = `call-${phone.replace(/\D/g, "")}-${Date.now().toString(36)}`;
  const { AgentDispatchClient } = await import("livekit-server-sdk");
  try {
    await new AgentDispatchClient(lk.host, lk.key, lk.secret).createDispatch(
      roomName,
      process.env.AGENT_NAME || "autoneural-crm-assistant",
      {
        metadata: JSON.stringify({
          phone_number: phone,
          tenant_id: "autoneural",
          ...(leadId ? { lead_id: leadId } : {}),
          ...(p.context ? { user_prompt: p.context } : {}),
        }),
      },
    );
  } catch (e) {
    throw new AppError(502, `LiveKit could not start the call: ${(e as Error).message}`);
  }
  cdb()
    .prepare(
      "INSERT INTO calls(id,roomName,leadId,direction,customerNumber,status,context,requestedBy,createdAt) VALUES(?,?,?,'outbound',?,'queued',?,?,?)",
    )
    .run(randomUUID(), roomName, leadId, phone, p.context ?? null, user.id, now());
  return { ok: true, roomName, message: `Calling ${name} (${phone}). The phone should ring in a few seconds.` };
}

/** Live phase of a call: stored result once logged, otherwise the SIP leg's status in LiveKit. */
export async function callProgress(user: User, roomName: string) {
  if (!/^call-[\w-]{1,100}$/.test(roomName)) throw new AppError(400, "Invalid call.");
  const row = listCalls(user, 1, roomName)[0];
  if (!row) throw new AppError(404, "Call not found.");
  if (row.endedAt) return { phase: "ended", call: row };
  const lk = livekit();
  const { RoomServiceClient } = await import("livekit-server-sdk");
  try {
    const people = await new RoomServiceClient(lk.host, lk.key, lk.secret).listParticipants(roomName);
    const sip = people.find((x) => x.attributes?.["sip.callStatus"] !== undefined);
    const s = sip?.attributes["sip.callStatus"];
    const phase = !sip ? "connecting" : s === "hangup" ? "wrapping_up" : s === "active" || s === "automation" ? "active" : s === "ringing" ? "ringing" : "dialing";
    return { phase, call: row };
  } catch {
    // No room yet (agent not picked up) or already closed (agent is writing the summary).
    return { phase: Date.now() - Date.parse(row.createdAt) < 20_000 ? "connecting" : "wrapping_up", call: row };
  }
}

// ─── Finished calls from the agent ───────────────────────────────────────────

const opt = (max: number) => z.string().max(max).nullish();
export const agentCallSchema = z.object({
  organizationId: opt(64),
  leadId: opt(64),
  direction: z.enum(["inbound", "outbound"]),
  fromNumber: opt(32),
  toNumber: opt(32),
  customerNumber: opt(32),
  duration: z.number().int().min(0).max(86_400),
  status: z.enum(["completed", "missed", "busy", "failed"]),
  outcome: opt(40),
  language: opt(20),
  transcript: opt(200_000),
  summary: opt(2_000),
  sentiment: z.enum(["positive", "neutral", "negative"]).nullish(),
  nextAction: opt(500),
  roomName: z.string().min(1).max(200),
  startedAt: opt(40),
  endedAt: opt(40),
  handoff: z.record(z.unknown()).nullish(),
  failureReason: opt(500),
});

const mmss = (s: number) => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;

/** Store a finished call, link it to its lead (creating one for new inbound callers) and note it on the lead's task. */
export function recordAgentCall(input: unknown) {
  const c = agentCallSchema.parse(input);
  const db = cdb();
  const existing = db.prepare("SELECT id,leadId,endedAt FROM calls WHERE roomName=?").get(c.roomName) as
    | { id: string; leadId: string | null; endedAt: string | null }
    | undefined;
  if (existing?.endedAt) return { ok: true, duplicate: true, callId: existing.id };

  const phone = normalizePhone(c.customerNumber);
  let leadId =
    existing?.leadId ??
    ((c.leadId && (db.prepare("SELECT id FROM leads WHERE id=?").get(c.leadId) as { id: string } | undefined)?.id) || null);
  if (!leadId && phone) {
    leadId =
      (db.prepare("SELECT id FROM leads WHERE phone=? AND status!='Duplicate' ORDER BY number DESC LIMIT 1").get(phone) as
        | { id: string }
        | undefined)?.id ?? null;
  }
  // A new inbound caller who actually spoke with Riya is a new lead.
  if (!leadId && phone && c.direction === "inbound" && c.status === "completed") {
    leadId = addLeads(
      [{ externalId: `call:${c.roomName}`, name: phone, phone, message: c.summary ?? undefined, sourceDetail: "Inbound call (AI agent)" }],
      "AI call",
    ).leadIds[0] ?? null;
  }

  const time = now();
  const values = [leadId, c.direction, phone, c.status, c.outcome ?? null, c.duration, c.language ?? null, c.transcript ?? null, c.summary ?? null, c.sentiment ?? null, c.nextAction ?? null, c.failureReason ?? null, c.endedAt ?? time];
  let callId = existing?.id;
  if (existing) {
    db.prepare(
      "UPDATE calls SET leadId=?,direction=?,customerNumber=?,status=?,outcome=?,duration=?,language=?,transcript=?,summary=?,sentiment=?,nextAction=?,failureReason=?,endedAt=? WHERE id=?",
    ).run(...values, existing.id);
  } else {
    callId = randomUUID();
    db.prepare(
      "INSERT INTO calls(leadId,direction,customerNumber,status,outcome,duration,language,transcript,summary,sentiment,nextAction,failureReason,endedAt,id,roomName,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(...values, callId, c.roomName, c.startedAt ?? time);
  }

  if (leadId) {
    const lead = db.prepare("SELECT status,taskId FROM leads WHERE id=?").get(leadId) as { status: string; taskId: string | null };
    if (c.status === "completed" && lead.status === "New") {
      db.prepare("UPDATE leads SET status='Contacted', updatedAt=? WHERE id=?").run(time, leadId);
    }
    if (lead.taskId) {
      const head =
        c.status === "completed"
          ? `AI ${c.direction} call, ${mmss(c.duration)}${c.sentiment ? `, ${c.sentiment}` : ""}.`
          : `AI ${c.direction} call ${c.status === "busy" ? "— line busy" : c.status === "missed" ? "— not answered" : "failed"}${c.failureReason ? `: ${c.failureReason}` : "."}`;
      const text = [head, c.summary, c.nextAction && `Next step: ${c.nextAction}`].filter(Boolean).join("\n");
      db.prepare("INSERT INTO comments VALUES(?,?,?,?,?)").run(randomUUID(), lead.taskId, systemActor().id, text.slice(0, 4000), time);
      db.prepare("UPDATE tasks SET updatedAt=?, version=version+1 WHERE id=?").run(time, lead.taskId);
    }
  }
  if (c.duration > 0) meter("voice_minute", Math.ceil(c.duration / 60), "ai_call", { roomName: c.roomName, direction: c.direction });
  emit("call.completed", leadId, { callStatus: c.status, outcome: c.outcome, sentiment: c.sentiment, summary: c.summary, agent: "ai" });
  return { ok: true, callId, leadId };
}

type WhatsAppRequestResult = { accepted: boolean; status: "sent" | "blocked" | "failed"; error?: string };

/**
 * The agent asked to send a WhatsApp follow-up during a call. It is sent through the
 * WhatsApp Cloud API when possible: as a normal message inside the 24-hour customer-service
 * window, otherwise as the approved WHATSAPP_FOLLOWUP_TEMPLATE (its {{1}} receives the text).
 * When neither is possible — or the customer opted out — the lead's owner is asked to send it.
 * Idempotent on the agent's requestId, so a retried request never sends twice.
 */
export async function recordWhatsAppRequest(input: unknown): Promise<WhatsAppRequestResult> {
  const p = z
    .object({
      leadId: z.string().max(64).nullish(),
      phone: z.string().min(6).max(32),
      message: z.string().trim().min(1).max(1000),
      confirmed: z.literal(true),
      requestId: z.string().min(1).max(120).nullish(),
      name: z.string().trim().max(120).nullish(),
    })
    .parse(input);
  const db = cdb();
  if (p.requestId) {
    const prev = db.prepare("SELECT result FROM agent_requests WHERE id=?").get(`wa:${p.requestId}`) as { result: string } | undefined;
    if (prev) return JSON.parse(prev.result) as WhatsAppRequestResult;
  }
  const phone = normalizePhone(p.phone);
  if (!phone) return { accepted: false, status: "failed", error: "That phone number is not valid." };
  const lead =
    ((p.leadId && db.prepare("SELECT id, taskId, optOut FROM leads WHERE id=?").get(p.leadId)) ||
      db.prepare("SELECT id, taskId, optOut FROM leads WHERE phone=? AND status!='Duplicate' ORDER BY number DESC LIMIT 1").get(phone)) as
      | { id: string; taskId: string | null; optOut: number }
      | undefined;
  const note = (text: string) => {
    if (!lead?.taskId) return;
    db.prepare("INSERT INTO comments VALUES(?,?,?,?,?)").run(randomUUID(), lead.taskId, systemActor().id, text.slice(0, 4000), now());
    db.prepare("UPDATE tasks SET updatedAt=?, version=version+1 WHERE id=?").run(now(), lead.taskId);
  };

  let result: WhatsAppRequestResult | null = null;
  const wa = await import("./whatsapp");
  if (lead?.optOut) {
    result = { accepted: false, status: "blocked", error: "This customer has opted out of WhatsApp messages. Nothing was sent." };
  } else if (wa.waConfigured()) {
    const conv = wa.wdb().prepare("SELECT id, lastInboundAt FROM wa_conversations WHERE phone=?").get(phone) as
      | { id: string; lastInboundAt: string | null }
      | undefined;
    const template = process.env.WHATSAPP_FOLLOWUP_TEMPLATE?.trim();
    try {
      if (conv && wa.windowOpen(conv.lastInboundAt)) {
        await wa.sendText(null, conv.id, p.message, "AI call agent");
        result = { accepted: true, status: "sent" };
      } else if (template) {
        await wa.sendTemplate(null, { phone, name: p.name ?? undefined, leadId: lead?.id ?? null }, template, {
          params: [p.message.replace(/\s+/g, " ")],
          category: "utility",
        });
        result = { accepted: true, status: "sent" };
      }
    } catch (e) {
      result = { accepted: false, status: "failed", error: `WhatsApp did not accept the message: ${(e as Error).message}` };
    }
  }
  if (result?.accepted) {
    note(`AI call agent sent a WhatsApp message to ${phone}:\n"${p.message}"`);
  } else {
    note(`Caller asked for a WhatsApp message on ${phone}. Please send:\n"${p.message}"\nhttps://wa.me/${phone.replace(/\D/g, "")}`);
    result ??= {
      accepted: false,
      status: "blocked",
      error: "WhatsApp cannot message this number automatically right now. Nothing was sent. Tell the caller a team member will send it on WhatsApp shortly.",
    };
  }
  audit("AI call agent", "whatsapp.call_followup", "lead", lead?.id ?? null, { phone, status: result.status });
  if (p.requestId) db.prepare("INSERT OR IGNORE INTO agent_requests VALUES(?,?,?)").run(`wa:${p.requestId}`, JSON.stringify(result), now());
  return result;
}

export function listCalls(user: User, limit = 100, roomName?: string): CallRecord[] {
  const admin = user.role === "admin";
  const where = [roomName ? "c.roomName=?" : "", admin ? "" : "(l.ownerId=? OR c.requestedBy=?)"].filter(Boolean);
  const args = [...(roomName ? [roomName] : []), ...(admin ? [] : [user.id, user.id]), limit];
  return cdb()
    .prepare(
      `SELECT c.*, l.name AS leadName, u.name AS requestedByName FROM calls c LEFT JOIN leads l ON l.id=c.leadId LEFT JOIN users u ON u.id=c.requestedBy ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY c.createdAt DESC LIMIT ?`,
    )
    .all(...args) as unknown as CallRecord[];
}

// ─── Human calling ───────────────────────────────────────────────────────────

export const dispositions = ["Connected — interested", "Connected — follow up", "Connected — not interested", "No answer", "Busy", "Wrong number", "Call back later"] as const;

const leadOf = (user: User, leadId: string) => {
  const lead = cdb().prepare("SELECT id,name,phone,ownerId,status,taskId FROM leads WHERE id=?").get(leadId) as Record<string, any> | undefined;
  if (!lead || (user.role !== "admin" && lead.ownerId !== user.id)) throw new AppError(404, "Lead not found.");
  return lead;
};

/** Manual first: log a call made from any phone, with outcome, notes and next follow-up. */
export function logCall(user: User, input: unknown) {
  const p = z
    .object({
      leadId: z.string().uuid(),
      direction: z.enum(["outbound", "inbound"]).default("outbound"),
      disposition: z.enum(dispositions),
      minutes: z.number().min(0).max(600).default(0),
      notes: z.string().trim().max(2000).default(""),
      nextFollowUp: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    })
    .parse(input);
  const lead = leadOf(user, p.leadId);
  const connected = p.disposition.startsWith("Connected");
  const t = new Date().toISOString();
  cdb()
    .prepare("INSERT INTO calls(id,roomName,leadId,direction,customerNumber,status,outcome,duration,summary,agent,userId,disposition,notes,requestedBy,createdAt,endedAt) VALUES(?,?,?,?,?,?,?,?,?,'human',?,?,?,?,?,?)")
    .run(randomUUID(), `manual-${randomUUID()}`, lead.id, p.direction, lead.phone, connected ? "completed" : p.disposition === "Busy" ? "busy" : "missed", p.disposition, Math.round(p.minutes * 60), p.notes || null, user.id, p.disposition, p.notes || null, user.id, t, t);
  if (connected && lead.status === "New") cdb().prepare("UPDATE leads SET status='Contacted', updatedAt=? WHERE id=?").run(t, lead.id);
  if (p.nextFollowUp !== undefined) cdb().prepare("UPDATE leads SET nextFollowUp=? WHERE id=?").run(p.nextFollowUp, lead.id);
  if (lead.taskId) {
    cdb().prepare("INSERT INTO comments VALUES(?,?,?,?,?)").run(randomUUID(), lead.taskId, user.id, `Call (${p.direction}): ${p.disposition}${p.minutes ? `, ${p.minutes} min` : ""}.${p.notes ? `\n${p.notes}` : ""}${p.nextFollowUp ? `\nNext follow-up: ${p.nextFollowUp}` : ""}`, t);
    cdb().prepare("UPDATE tasks SET updatedAt=?, version=version+1 WHERE id=?").run(t, lead.taskId);
  }
  emit("call.completed", lead.id, { callStatus: connected ? "completed" : "missed", outcome: p.disposition, agent: "human" });
  return { ok: true };
}

export const exotelConfigured = () => !!(process.env.EXOTEL_SID && process.env.EXOTEL_API_KEY && process.env.EXOTEL_API_TOKEN && process.env.EXOTEL_CALLER_ID);
const callbackToken = (id: string) => {
  const key = process.env.EXOTEL_API_TOKEN;
  if (!key) throw new AppError(401, "Bad token."); // not configured: no callback can be genuine
  return createHmac("sha256", key).update(id).digest("hex").slice(0, 32);
};

/**
 * Click-to-call through Exotel: rings the salesperson's phone first, then connects the
 * customer from the company ExoPhone, with recording. Result arrives on the status callback.
 * https://developer.exotel.com/api/make-a-call-api
 */
export async function clickToCall(user: User, leadId: string, appUrl: string, agentPhone: string | null) {
  if (!exotelConfigured()) throw new AppError(400, "Cloud calling is not connected (EXOTEL_SID / EXOTEL_API_KEY / EXOTEL_API_TOKEN / EXOTEL_CALLER_ID).");
  const lead = leadOf(user, leadId);
  if (!lead.phone) throw new AppError(400, "This lead has no phone number.");
  const from = normalizePhone(agentPhone);
  if (!from) throw new AppError(400, "Add your mobile number under People → Employees so the call can ring you first.");
  const id = randomUUID();
  const host = process.env.EXOTEL_SUBDOMAIN || "api.in.exotel.com";
  const res = await fetch(`https://${host}/v1/Accounts/${process.env.EXOTEL_SID}/Calls/connect.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${process.env.EXOTEL_API_KEY}:${process.env.EXOTEL_API_TOKEN}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      From: from,
      To: lead.phone,
      CallerId: process.env.EXOTEL_CALLER_ID!,
      Record: "true",
      StatusCallback: `${appUrl}/api/calls/exotel?id=${id}&t=${callbackToken(id)}`,
      "StatusCallbackEvents[0]": "terminal",
      StatusCallbackContentType: "application/json",
      CustomField: id,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as { Call?: { Sid?: string }; RestException?: { Message?: string } };
  if (!res.ok || !j.Call?.Sid) throw new AppError(502, `Exotel: ${j.RestException?.Message ?? `HTTP ${res.status}`}`);
  const t = new Date().toISOString();
  cdb()
    .prepare("INSERT INTO calls(id,roomName,leadId,direction,customerNumber,status,agent,userId,requestedBy,createdAt) VALUES(?,?,?,'outbound',?,'queued','human',?,?,?)")
    .run(id, `exotel-${j.Call.Sid}`, lead.id, lead.phone, user.id, user.id, t);
  audit(user.name, "call.click_to_call", "lead", lead.id, { sid: j.Call.Sid });
  return { ok: true, message: `Your phone (${from}) will ring now; answer to connect ${lead.name}.` };
}

/** Exotel status callback (JSON or form). Authenticated by an HMAC token in the URL. */
export function exotelCallback(id: string, token: string, body: Record<string, any>) {
  const a = Buffer.from(callbackToken(id)),
    b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError(401, "Bad token.");
  const call = cdb().prepare("SELECT * FROM calls WHERE id=?").get(id) as Record<string, any> | undefined;
  if (!call || call.endedAt) return { ok: true };
  const status = String(body.Status ?? "").toLowerCase();
  const mapped = status === "completed" ? "completed" : status === "busy" ? "busy" : status === "no-answer" ? "missed" : "failed";
  const duration = Number(body.ConversationDuration ?? 0) || 0;
  const t = new Date().toISOString();
  cdb().prepare("UPDATE calls SET status=?, outcome=?, duration=?, recordingUrl=?, endedAt=? WHERE id=?").run(mapped, status || null, duration, body.RecordingUrl || null, t, id);
  if (duration > 0) meter("voice_minute", Math.ceil(duration / 60), "human_call", { provider: "exotel" });
  const lead = call.leadId ? (cdb().prepare("SELECT status, taskId FROM leads WHERE id=?").get(call.leadId) as { status: string; taskId: string | null }) : null;
  if (lead && mapped === "completed" && lead.status === "New") cdb().prepare("UPDATE leads SET status='Contacted', updatedAt=? WHERE id=?").run(t, call.leadId);
  if (lead?.taskId) {
    cdb().prepare("INSERT INTO comments VALUES(?,?,?,?,?)").run(randomUUID(), lead.taskId, call.userId ?? systemActor().id, `Cloud call ${mapped}${duration ? `, ${Math.round(duration / 60)} min` : ""}.${body.RecordingUrl ? ` Recording: ${body.RecordingUrl}` : ""} Add notes with “Log call”.`, t);
  }
  emit("call.completed", call.leadId, { callStatus: mapped, agent: "human" });
  return { ok: true };
}
