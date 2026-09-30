/** Voice agent management service — start, stop, and health-check the LiveKit agent worker. */

import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";

let _agentProcess: ChildProcess | null = null;
let _agentStartedAt: number | null = null;
let _lastExitError: string | null = null;

function healthPort(): number {
  return Number(process.env.AGENT_HEALTH_PORT ?? "8082");
}

/**
 * Check whether the voice agent worker is running and healthy.
 * Reports both our managed child process and anything listening on the health port.
 */
export async function getAgentStatus(): Promise<{
  running: boolean;
  pid: number | null;
  uptime: number | null;
  healthPort: number;
  error: string | null;
}> {
  const port = healthPort();
  // AGENT_EXTERNAL=true: the voice agent runs on another machine (e.g. managed hosting that
  // can't run Python). There is no local process or port to probe, so report it as running
  // and let LiveKit queue the dispatch until that worker picks it up.
  if (["1", "true", "yes"].includes((process.env.AGENT_EXTERNAL ?? "").toLowerCase())) {
    return { running: false, pid: null, uptime: null, healthPort: port, error: "External worker configured; its health has not been verified from this server." };
  }
  const result = {
    running: false,
    pid: null as number | null,
    uptime: null as number | null,
    healthPort: port,
    error: _lastExitError,
  };

  // 1. Managed child process.
  if (_agentProcess !== null && _agentProcess.exitCode === null && _agentProcess.pid !== undefined) {
    result.running = true;
    result.pid = _agentProcess.pid;
    if (_agentStartedAt !== null) {
      result.uptime = Math.floor((Date.now() - _agentStartedAt) / 1000);
    }
  }

  // 2. Anything listening on the health port (externally started worker, e.g. pm2).
  result.running = result.running || (await isPortListening(port));
  if (result.running) result.error = null;

  return result;
}

/** Start the agent.py worker as a child process (best-effort; requires Python + deps). */
export async function startAgent(): Promise<{ ok: boolean; message?: string; pid?: number; error?: string }> {
  const port = healthPort();
  if (_agentProcess !== null && _agentProcess.exitCode === null) {
    return { ok: true, message: "Agent is already running", pid: _agentProcess.pid };
  }
  if (await isPortListening(port)) {
    return { ok: true, message: "Agent is already running (health port active)" };
  }

  const projectRoot = path.resolve(process.cwd());
  const agentScript = path.join(projectRoot, "agent.py");
  if (!fs.existsSync(agentScript)) {
    return { ok: false, error: `agent.py not found at ${agentScript}` };
  }

  try {
    const venvPython = path.join(projectRoot, ".venv-agent", "bin", "python");
    const pythonBin = fs.existsSync(venvPython) ? venvPython : "python3";

    // `start` = LiveKit production mode; without a subcommand the CLI just prints help and exits.
    const child = spawn(pythonBin, [agentScript, "start"], {
      cwd: projectRoot,
      stdio: "pipe",
      // Own process group so stopAgent() can take down the job subprocesses LiveKit spawns.
      detached: true,
      env: { ...process.env, AGENT_HEALTH_PORT: String(port) },
    });

    child.stdout?.on("data", (d) => console.log(`[agent] ${String(d).trim()}`));
    child.stderr?.on("data", (d) => console.error(`[agent] ${String(d).trim()}`));
    child.on("error", (e) => {
      console.error("[agent] spawn error:", e);
      _lastExitError = `Failed to start agent: ${e.message}`;
      if (_agentProcess === child) {
        _agentProcess = null;
        _agentStartedAt = null;
      }
    });
    child.on("exit", (code, signal) => {
      // stopAgent() clears _agentProcess first, so only unexpected exits land here.
      if (_agentProcess !== child) return;
      _agentProcess = null;
      _agentStartedAt = null;
      if (code !== 0) {
        _lastExitError = `Agent exited with ${code !== null ? `code ${code}` : `signal ${signal}`} — check server logs`;
      }
    });

    _agentProcess = child;
    _agentStartedAt = Date.now();
    _lastExitError = null;
    return { ok: true, message: "Agent worker started", pid: child.pid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Stop a managed agent process (SIGTERM, then SIGKILL after a short grace). */
export function stopAgent(): { ok: boolean; message?: string; error?: string } {
  const child = _agentProcess;
  if (child === null || child.exitCode !== null || child.pid === undefined) {
    return { ok: true, message: "Agent is not running (or was started outside the CRM)" };
  }

  const pid = child.pid;
  const killGroup = (sig: NodeJS.Signals) => {
    try {
      process.kill(-pid, sig); // negative pid = whole process group
    } catch {
      /* already gone */
    }
  };

  try {
    killGroup("SIGTERM");
    const timer = setTimeout(() => killGroup("SIGKILL"), 4000);
    child.once("exit", () => clearTimeout(timer));
    _agentProcess = null;
    _agentStartedAt = null;
    return { ok: true, message: "Agent stopped" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Must match AGENT_NAME in agent.py (both read the AGENT_NAME env var). Unique on the LiveKit
 *  project, so no other worker registered there can pick up the CRM's calls. */
const AGENT_NAME = process.env.AGENT_NAME || "autoneural-crm-assistant";

/**
 * Ask LiveKit to dispatch the voice agent into a fresh room; the agent reads `phone_number`
 * from the job metadata and dials it over the SIP trunk. The finished call is posted back to
 * /api/agent/calls against `leadId`.
 */
export async function dispatchOutboundCall(params: {
  organizationId: string;
  leadId: string;
  phone: string;
  /** Optional briefing for this call, appended to the agent's instructions. */
  context?: string;
}): Promise<{ ok: true; roomName: string; dispatchId: string } | { ok: false; error: string }> {
  const url = process.env.LIVEKIT_URL ?? "";
  const apiKey = process.env.LIVEKIT_API_KEY ?? "";
  const apiSecret = process.env.LIVEKIT_API_SECRET ?? "";
  if (!url || !apiKey || !apiSecret) {
    return { ok: false, error: "LiveKit is not configured (LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET)." };
  }
  if (!(await getAgentStatus()).running) {
    return { ok: false, error: "The voice agent is not running. Start it on the AI Voice Agent page first." };
  }

  const { AgentDispatchClient } = await import("livekit-server-sdk");
  const client = new AgentDispatchClient(url.replace(/^ws/, "http"), apiKey, apiSecret);
  const roomName = `call-${params.phone.replace(/\D/g, "")}-${Date.now().toString(36)}`;
  try {
    const dispatch = await client.createDispatch(roomName, AGENT_NAME, {
      metadata: JSON.stringify({
        phone_number: params.phone,
        tenant_id: params.organizationId,
        lead_id: params.leadId,
        ...(params.context?.trim() ? { user_prompt: params.context.trim() } : {}),
      }),
    });
    return { ok: true, roomName, dispatchId: dispatch.id };
  } catch (e) {
    return { ok: false, error: `LiveKit dispatch failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export type CallPhase = "connecting" | "dialing" | "ringing" | "active" | "ended";

/**
 * Live phase of a dispatched call, read from the LiveKit room: the SIP participant's
 * `sip.callStatus` attribute (dialing → ringing → active → hangup). Returns null when the
 * room does not exist (not created yet, or already closed — the caller checks the DB).
 */
export async function getLiveCallPhase(roomName: string): Promise<CallPhase | null> {
  const url = process.env.LIVEKIT_URL ?? "";
  const apiKey = process.env.LIVEKIT_API_KEY ?? "";
  const apiSecret = process.env.LIVEKIT_API_SECRET ?? "";
  if (!url || !apiKey || !apiSecret) return null;

  const { RoomServiceClient } = await import("livekit-server-sdk");
  const rooms = new RoomServiceClient(url.replace(/^ws/, "http"), apiKey, apiSecret);
  try {
    const participants = await rooms.listParticipants(roomName);
    const sip = participants.find((p) => p.attributes?.["sip.callStatus"] !== undefined);
    if (!sip) return "connecting"; // agent joined, SIP leg not created yet
    const status = sip.attributes["sip.callStatus"];
    if (status === "hangup") return "ended";
    if (status === "active" || status === "automation") return "active";
    if (status === "ringing") return "ringing";
    return "dialing";
  } catch {
    return null; // room not found
  }
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: "127.0.0.1" });
    const done = (listening: boolean) => {
      sock.destroy();
      resolve(listening);
    };
    sock.setTimeout(250);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}
