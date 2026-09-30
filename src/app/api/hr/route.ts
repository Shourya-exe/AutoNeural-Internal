import { body, failure, requireUser, sameOrigin } from "@/lib/http";
import { allUsers } from "@/lib/store";
import * as hr from "@/lib/hr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const q = new URL(req.url).searchParams;
    const admin = user.role === "admin";
    const team = allUsers()
      .filter((u) => u.status !== "INACTIVE")
      .map((u) => ({ id: u.id, name: u.name, role: u.role, designation: u.designation }));
    switch (q.get("view")) {
      case "receipt": {
        const data = hr.claimReceipt(user, String(q.get("id")));
        const match = data.match(/^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,(.*)$/);
        if (!match) return Response.json({ error: "This receipt could not be read." }, { status: 422 });
        const [, type, b64] = match;
        return new Response(Buffer.from(b64, "base64"), {
          headers: { "content-type": type, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-disposition": "inline" },
        });
      }
      case "attendance":
        return Response.json({ ...hr.attendanceDay(user, q.get("day") || undefined), policy: hr.policy() });
      case "leave":
        return Response.json({ leaves: hr.listLeaves(user), balance: hr.leaveBalance(user.id), team });
      case "claims":
        return Response.json({ claims: hr.listClaims(user) });
      case "payroll":
        return Response.json({ runs: hr.listPayroll(user), profiles: hr.profiles(user), team });
      case "performance":
        return Response.json({ goals: hr.listGoals(user), team });
      case "hiring":
        return Response.json(hr.hiring(user));
      case "learning":
        return Response.json({ ...hr.learning(user), team: admin ? team : [] });
      case "engagement":
        return Response.json({ ...hr.engagement(), team });
      case "employees":
        return Response.json({ profiles: hr.profiles(user), policy: hr.policy(), team, balances: admin ? team.map((t) => ({ userId: t.id, balance: hr.leaveBalance(t.id) })) : [] });
      default:
        return Response.json({ error: "Unknown view." }, { status: 400 });
    }
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const user = await requireUser();
    const b = (await body(req)) as { action?: string; [k: string]: unknown };
    const actions: Record<string, () => unknown> = {
      clockIn: () => hr.clockIn(user, b),
      clockOut: () => hr.clockOut(user, b),
      ping: () => hr.pingLocation(user, b),
      applyLeave: () => hr.applyLeave(user, b),
      reviewLeave: () => hr.reviewLeave(user, b),
      cancelLeave: () => (hr.cancelLeave(user, String(b.id)), { ok: true }),
      claim: () => hr.submitClaim(user, b),
      reviewClaim: () => hr.reviewClaim(user, b),
      runPayroll: () => hr.runPayroll(user, b),
      finalizePayroll: () => hr.finalizePayroll(user, String(b.runId)),
      goal: () => hr.addGoal(user, b),
      rate: () => hr.rateGoal(user, b),
      job: () => hr.saveJob(user, b),
      candidate: () => hr.saveCandidate(user, b),
      course: () => hr.saveCourse(user, b),
      lesson: () => hr.completeLesson(user, b),
      announce: () => hr.postAnnouncement(user, b),
      kudos: () => hr.giveKudos(user, b),
      profile: () => (hr.saveProfile(user, b), { ok: true }),
      policy: () => (hr.savePolicy(user, b.policy), { ok: true }),
    };
    const run = actions[String(b.action)];
    if (!run) return Response.json({ error: "Unknown action." }, { status: 400 });
    return Response.json(run() ?? { ok: true });
  } catch (e) {
    return failure(e);
  }
}
