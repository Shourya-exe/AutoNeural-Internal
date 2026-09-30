import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, allUsers, findTask, requireAdmin, transaction, recordTaskNotificationEmail } from "./store";
import { ldb, nextOwner, onLeaveToday, systemActor } from "./leads";
import { notifyTaskAssigned } from "./email";
import type { User } from "./types";

/**
 * People: employee profiles, GPS + selfie attendance, field tracking, leave with
 * approvals (and CRM lead re-routing), expense claims, payroll with payslips,
 * performance goals, hiring (jobs + candidates), learning (courses) and engagement
 * (announcements + kudos). Admins manage; employees see their own records.
 */

let ready = false;
export function hdb() {
  const c = ldb();
  if (!ready) {
    c.exec(`CREATE TABLE IF NOT EXISTS employee_profiles(userId TEXT PRIMARY KEY REFERENCES users(id),phone TEXT,department TEXT,joinedOn TEXT,dob TEXT,monthlySalary REAL,address TEXT);
      CREATE TABLE IF NOT EXISTS attendance(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),day TEXT NOT NULL,inAt TEXT NOT NULL,outAt TEXT,inLat REAL,inLng REAL,inAcc REAL,outLat REAL,outLng REAL,inPhoto TEXT,outPhoto TEXT,inOffice INTEGER,note TEXT,UNIQUE(userId,day));
      CREATE TABLE IF NOT EXISTS locations(id INTEGER PRIMARY KEY AUTOINCREMENT,userId TEXT NOT NULL REFERENCES users(id),at TEXT NOT NULL,lat REAL NOT NULL,lng REAL NOT NULL,accuracy REAL);
      CREATE TABLE IF NOT EXISTS leaves(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),type TEXT NOT NULL,fromDate TEXT NOT NULL,toDate TEXT NOT NULL,days REAL NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL,reviewerId TEXT,reviewNote TEXT,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS claims(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),spentOn TEXT NOT NULL,category TEXT NOT NULL,amount REAL NOT NULL,description TEXT NOT NULL,receipt TEXT,status TEXT NOT NULL,reviewerId TEXT,reviewNote TEXT,payslipId TEXT,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS payroll_runs(id TEXT PRIMARY KEY,month TEXT UNIQUE NOT NULL,status TEXT NOT NULL,createdAt TEXT NOT NULL,finalizedAt TEXT);
      CREATE TABLE IF NOT EXISTS payslips(id TEXT PRIMARY KEY,runId TEXT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,userId TEXT NOT NULL REFERENCES users(id),data TEXT NOT NULL,net REAL NOT NULL,UNIQUE(runId,userId));
      CREATE TABLE IF NOT EXISTS goals(id TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),cycle TEXT NOT NULL,title TEXT NOT NULL,weight INTEGER NOT NULL,selfRating INTEGER,selfNote TEXT,managerRating INTEGER,managerNote TEXT,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,title TEXT NOT NULL,department TEXT,location TEXT,description TEXT NOT NULL,status TEXT NOT NULL,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY,jobId TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,name TEXT NOT NULL,email TEXT,phone TEXT,link TEXT,stage TEXT NOT NULL,notes TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS courses(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT,lessons TEXT NOT NULL,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS course_progress(courseId TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,userId TEXT NOT NULL REFERENCES users(id),done TEXT NOT NULL,completedAt TEXT,PRIMARY KEY(courseId,userId));
      CREATE TABLE IF NOT EXISTS announcements(id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,authorId TEXT NOT NULL REFERENCES users(id),createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS kudos(id TEXT PRIMARY KEY,fromId TEXT NOT NULL REFERENCES users(id),toId TEXT NOT NULL REFERENCES users(id),message TEXT NOT NULL,createdAt TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS attendance_day ON attendance(day);
      CREATE INDEX IF NOT EXISTS locations_user ON locations(userId,at);
      CREATE INDEX IF NOT EXISTS leaves_user ON leaves(userId,fromDate);`);
    ready = true;
  }
  return c;
}

const now = () => new Date().toISOString();
const istDate = (d = new Date()) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const own = (user: User, userId: string) => {
  if (user.role !== "admin" && user.id !== userId) throw new AppError(404, "Not found.");
};

// ─── Policy ──────────────────────────────────────────────────────────────────

export const policySchema = z.object({
  leaveQuota: z.object({ Casual: z.number().min(0).max(60), Sick: z.number().min(0).max(60), Earned: z.number().min(0).max(60) }),
  workWeek: z.union([z.literal(5), z.literal(6)]),
  holidays: z.array(dateStr).max(60),
  pf: z.boolean(),
  esi: z.boolean(),
  professionalTax: z.number().min(0).max(2500),
  office: z.object({ lat: z.number(), lng: z.number(), radiusM: z.number().min(50).max(10_000) }).nullable(),
});
export type Policy = z.infer<typeof policySchema>;
export function policy(): Policy {
  const row = hdb().prepare("SELECT value FROM settings WHERE key='hr_policy'").get() as { value: string } | undefined;
  return row
    ? (JSON.parse(row.value) as Policy)
    : { leaveQuota: { Casual: 12, Sick: 12, Earned: 15 }, workWeek: 6, holidays: [], pf: true, esi: true, professionalTax: 200, office: null };
}
export function savePolicy(user: User, input: unknown) {
  requireAdmin(user);
  hdb().prepare("INSERT INTO settings(key,value) VALUES('hr_policy',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(policySchema.parse(input)));
}

function isWorkingDay(day: string, p = policy()) {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return dow !== 0 && !(p.workWeek === 5 && dow === 6) && !p.holidays.includes(day);
}
function daysBetween(from: string, to: string) {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

// ─── Employee profiles ───────────────────────────────────────────────────────

const profileSchema = z.object({
  userId: z.string().uuid(),
  phone: z.string().trim().max(30).optional().default(""),
  department: z.string().trim().max(60).optional().default(""),
  joinedOn: dateStr.nullable().optional(),
  dob: dateStr.nullable().optional(),
  monthlySalary: z.number().min(0).max(1e8).nullable().optional(),
  address: z.string().trim().max(400).optional().default(""),
});
export function saveProfile(user: User, input: unknown) {
  requireAdmin(user);
  const p = profileSchema.parse(input);
  hdb()
    .prepare(
      "INSERT INTO employee_profiles VALUES(?,?,?,?,?,?,?) ON CONFLICT(userId) DO UPDATE SET phone=excluded.phone,department=excluded.department,joinedOn=excluded.joinedOn,dob=excluded.dob,monthlySalary=excluded.monthlySalary,address=excluded.address",
    )
    .run(p.userId, p.phone, p.department, p.joinedOn ?? null, p.dob ?? null, p.monthlySalary ?? null, p.address);
}
export function profiles(user: User) {
  const rows = hdb().prepare("SELECT * FROM employee_profiles").all() as Record<string, any>[];
  return user.role === "admin" ? rows : rows.filter((r) => r.userId === user.id);
}

// ─── Attendance (GPS + selfie) and field tracking ────────────────────────────

const photo = z
  .string({ required_error: "Take a selfie to clock in." })
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, "Take a selfie to clock in.")
  .max(400_000, "The selfie is too large.");
const geo = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100_000).optional() });

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(h));
}

export function clockIn(user: User, input: unknown) {
  const p = geo.extend({ photo, note: z.string().trim().max(300).optional() }).parse(input);
  const day = istDate();
  if (hdb().prepare("SELECT 1 FROM attendance WHERE userId=? AND day=?").get(user.id, day)) throw new AppError(409, "You have already clocked in today.");
  const office = policy().office;
  const inOffice = office ? (distanceM(p, office) <= office.radiusM ? 1 : 0) : null;
  hdb()
    .prepare("INSERT INTO attendance(id,userId,day,inAt,inLat,inLng,inAcc,inPhoto,inOffice,note) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(randomUUID(), user.id, day, now(), p.lat, p.lng, p.accuracy ?? null, p.photo, inOffice, p.note ?? null);
  hdb().prepare("INSERT INTO locations(userId,at,lat,lng,accuracy) VALUES(?,?,?,?,?)").run(user.id, now(), p.lat, p.lng, p.accuracy ?? null);
  return { ok: true, inOffice };
}

export function clockOut(user: User, input: unknown) {
  const p = geo.extend({ photo: photo.optional() }).parse(input);
  const row = hdb().prepare("SELECT id,outAt FROM attendance WHERE userId=? AND day=?").get(user.id, istDate()) as { id: string; outAt: string | null } | undefined;
  if (!row) throw new AppError(400, "Clock in first.");
  if (row.outAt) throw new AppError(409, "You have already clocked out today.");
  hdb().prepare("UPDATE attendance SET outAt=?, outLat=?, outLng=?, outPhoto=? WHERE id=?").run(now(), p.lat, p.lng, p.photo ?? null, row.id);
  return { ok: true };
}

/** Location ping from the app while clocked in (field staff tracking); at most one a minute. */
export function pingLocation(user: User, input: unknown) {
  const p = geo.parse(input);
  const open = hdb().prepare("SELECT 1 FROM attendance WHERE userId=? AND day=? AND outAt IS NULL").get(user.id, istDate());
  if (!open) return { ok: false, reason: "not clocked in" };
  const last = hdb().prepare("SELECT at FROM locations WHERE userId=? ORDER BY id DESC LIMIT 1").get(user.id) as { at: string } | undefined;
  if (last && Date.now() - Date.parse(last.at) < 55_000) return { ok: true, throttled: true };
  hdb().prepare("INSERT INTO locations(userId,at,lat,lng,accuracy) VALUES(?,?,?,?,?)").run(user.id, now(), p.lat, p.lng, p.accuracy ?? null);
  return { ok: true };
}

export function attendanceDay(user: User, day = istDate()) {
  dateStr.parse(day);
  const rows = hdb()
    .prepare(`SELECT a.*, u.name FROM attendance a JOIN users u ON u.id=a.userId WHERE a.day=? ${user.role === "admin" ? "" : "AND a.userId=?"}`)
    .all(...(user.role === "admin" ? [day] : [day, user.id])) as Record<string, any>[];
  const trail = (userId: string) =>
    hdb()
      .prepare("SELECT at,lat,lng,accuracy FROM locations WHERE userId=? AND at>=? AND at<? ORDER BY at")
      .all(userId, new Date(`${day}T00:00:00+05:30`).toISOString(), new Date(Date.parse(`${day}T00:00:00+05:30`) + 86_400_000).toISOString());
  const leave = onLeaveToday();
  return {
    day,
    records: rows.map((r) => ({ ...r, trail: trail(r.userId) })),
    absent:
      user.role === "admin"
        ? allUsers()
            .filter((u) => u.status !== "INACTIVE" && !rows.some((r) => r.userId === u.id))
            .map((u) => ({ id: u.id, name: u.name, onLeave: day === istDate() && leave.has(u.id) }))
        : [],
    mine: rows.find((r) => r.userId === user.id) ?? null,
  };
}

export function attendanceMonth(user: User, month: string, userId = user.id) {
  own(user, userId);
  z.string().regex(/^\d{4}-\d{2}$/).parse(month);
  return hdb().prepare("SELECT day,inAt,outAt,inOffice FROM attendance WHERE userId=? AND day LIKE ? ORDER BY day").all(userId, `${month}-%`);
}

// ─── Leave ───────────────────────────────────────────────────────────────────

export const leaveTypes = ["Casual", "Sick", "Earned", "Unpaid"] as const;

export function leaveBalance(userId: string, year = istDate().slice(0, 4)) {
  const used = hdb()
    .prepare("SELECT type, SUM(days) AS d FROM leaves WHERE userId=? AND status IN ('Approved','Pending') AND fromDate LIKE ? GROUP BY type")
    .all(userId, `${year}-%`) as { type: string; d: number }[];
  const q = policy().leaveQuota;
  return (Object.keys(q) as (keyof typeof q)[]).map((t) => ({ type: t, quota: q[t], used: used.find((u) => u.type === t)?.d ?? 0 }));
}

export function applyLeave(user: User, input: unknown) {
  const p = z.object({ type: z.enum(leaveTypes), fromDate: dateStr, toDate: dateStr, reason: z.string().trim().min(3).max(500) }).parse(input);
  if (p.toDate < p.fromDate) throw new AppError(400, "The end date is before the start date.");
  const pol = policy();
  const days = daysBetween(p.fromDate, p.toDate).filter((d) => isWorkingDay(d, pol)).length;
  if (!days) throw new AppError(400, "Those dates are all holidays or weekly offs.");
  const clash = hdb()
    .prepare("SELECT 1 FROM leaves WHERE userId=? AND status IN ('Pending','Approved') AND fromDate<=? AND toDate>=?")
    .get(user.id, p.toDate, p.fromDate);
  if (clash) throw new AppError(409, "You already have leave on these dates.");
  if (p.type !== "Unpaid") {
    const b = leaveBalance(user.id, p.fromDate.slice(0, 4)).find((x) => x.type === p.type)!;
    if (b.used + days > b.quota) throw new AppError(400, `Only ${b.quota - b.used} ${p.type} day(s) left this year.`);
  }
  hdb().prepare("INSERT INTO leaves VALUES(?,?,?,?,?,?,?,'Pending',NULL,NULL,?)").run(randomUUID(), user.id, p.type, p.fromDate, p.toDate, days, p.reason, now());
  return { ok: true, days };
}

export function reviewLeave(user: User, input: unknown) {
  requireAdmin(user);
  const p = z.object({ id: z.string().uuid(), status: z.enum(["Approved", "Rejected", "Cancelled"]), note: z.string().trim().max(300).optional() }).parse(input);
  const l = hdb().prepare("SELECT * FROM leaves WHERE id=?").get(p.id) as Record<string, any> | undefined;
  if (!l) throw new AppError(404, "Leave request not found.");
  hdb().prepare("UPDATE leaves SET status=?, reviewerId=?, reviewNote=? WHERE id=?").run(p.status, user.id, p.note ?? null, p.id);
  const moved = p.status === "Approved" ? rerouteLeadsOnLeave() : 0;
  return { ok: true, rerouted: moved };
}

export function cancelLeave(user: User, id: string) {
  const l = hdb().prepare("SELECT userId,status FROM leaves WHERE id=?").get(id) as { userId: string; status: string } | undefined;
  if (!l || l.userId !== user.id) throw new AppError(404, "Leave request not found.");
  if (l.status !== "Pending") throw new AppError(400, "Only pending requests can be withdrawn.");
  hdb().prepare("UPDATE leaves SET status='Cancelled' WHERE id=?").run(id);
}

export function listLeaves(user: User) {
  return hdb()
    .prepare(`SELECT l.*, u.name FROM leaves l JOIN users u ON u.id=l.userId ${user.role === "admin" ? "" : "WHERE l.userId=?"} ORDER BY l.createdAt DESC LIMIT 300`)
    .all(...(user.role === "admin" ? [] : [user.id]));
}

/**
 * CRM + HR: open "New" leads owned by someone on leave today move to an available
 * salesperson, with their call task, so no enquiry waits for someone who is away.
 */
export function rerouteLeadsOnLeave() {
  hdb();
  const away = onLeaveToday();
  if (!away.size) return 0;
  const actor = systemActor();
  const stuck = ldb()
    .prepare(
      `SELECT l.id, l.name, l.ownerId, l.taskId FROM leads l LEFT JOIN tasks t ON t.id=l.taskId WHERE l.status='New' AND l.ownerId IN (${[...away].map(() => "?").join(",")}) AND (t.id IS NULL OR t.status!='Completed')`,
    )
    .all(...away) as { id: string; name: string; ownerId: string; taskId: string | null }[];
  let moved = 0;
  for (const l of stuck) {
    const to = nextOwner(actor, away);
    if (away.has(to.id) || to.id === l.ownerId) continue;
    const from = allUsers().find((u) => u.id === l.ownerId)?.name ?? "someone";
    transaction(() => {
      ldb().prepare("UPDATE leads SET ownerId=?, updatedAt=? WHERE id=?").run(to.id, now(), l.id);
      if (l.taskId) {
        ldb().prepare("UPDATE tasks SET assigneeId=?, updatedAt=?, version=version+1 WHERE id=?").run(to.id, now(), l.taskId);
        ldb().prepare("INSERT INTO events VALUES(?,?,?,?,?)").run(randomUUID(), l.taskId, actor.id, `Re-routed from ${from} (on leave) to ${to.name}.`, now());
        if (to.id !== actor.id) recordTaskNotificationEmail({ type: "REASSIGNED", task: findTask(actor, l.taskId), sender: actor, recipient: to });
      }
    });
    if (l.taskId && to.id !== actor.id) void notifyTaskAssigned(findTask(actor, l.taskId), to, actor);
    moved++;
  }
  return moved;
}

// ─── Expense claims ──────────────────────────────────────────────────────────

export const claimCategories = ["Travel", "Fuel", "Food", "Client meeting", "Office supplies", "Phone / Internet", "Other"] as const;

export function submitClaim(user: User, input: unknown) {
  const p = z
    .object({
      spentOn: dateStr,
      category: z.enum(claimCategories),
      amount: z.number().positive().max(1e7),
      description: z.string().trim().min(3).max(500),
      receipt: z.string().regex(/^data:(image\/(jpeg|png|webp)|application\/pdf);base64,/).max(2_000_000, "Receipt must be under 1.5 MB.").optional(),
    })
    .parse(input);
  hdb().prepare("INSERT INTO claims VALUES(?,?,?,?,?,?,?,'Pending',NULL,NULL,NULL,?)").run(randomUUID(), user.id, p.spentOn, p.category, p.amount, p.description, p.receipt ?? null, now());
  return { ok: true };
}

export function reviewClaim(user: User, input: unknown) {
  requireAdmin(user);
  const p = z.object({ id: z.string().uuid(), status: z.enum(["Approved", "Rejected", "Paid"]), note: z.string().trim().max(300).optional() }).parse(input);
  const claim = hdb().prepare("SELECT status FROM claims WHERE id=?").get(p.id) as { status: string } | undefined;
  if (!claim) throw new AppError(404, "Claim not found.");
  if (claim.status === "Paid") throw new AppError(409, "This claim has already been paid.");
  hdb().prepare("UPDATE claims SET status=?, reviewerId=?, reviewNote=? WHERE id=?").run(p.status, user.id, p.note ?? null, p.id);
  return { ok: true };
}

export function listClaims(user: User) {
  return hdb()
    .prepare(
      `SELECT c.id,c.userId,c.spentOn,c.category,c.amount,c.description,c.status,c.reviewNote,c.createdAt,(c.receipt IS NOT NULL) AS hasReceipt,u.name FROM claims c JOIN users u ON u.id=c.userId ${user.role === "admin" ? "" : "WHERE c.userId=?"} ORDER BY c.createdAt DESC LIMIT 300`,
    )
    .all(...(user.role === "admin" ? [] : [user.id]));
}

export function claimReceipt(user: User, id: string) {
  const c = hdb().prepare("SELECT userId, receipt FROM claims WHERE id=?").get(id) as { userId: string; receipt: string | null } | undefined;
  if (!c?.receipt) throw new AppError(404, "No receipt.");
  own(user, c.userId);
  return c.receipt;
}

// ─── Payroll ─────────────────────────────────────────────────────────────────

export type PayslipData = {
  month: string;
  name: string;
  department: string;
  monthlySalary: number;
  workingDays: number;
  presentDays: number;
  paidLeaveDays: number;
  lopDays: number;
  earnings: { basic: number; hra: number; special: number; gross: number };
  deductions: { pf: number; esi: number; professionalTax: number; tds: number; total: number };
  reimbursements: number;
  net: number;
};

/**
 * ponytail: simplified Indian payroll — basic 50% / HRA 20% / special rest of earned gross,
 * employee PF 12% of basic (capped at ₹15,000 basic), ESI 0.75% when gross ≤ ₹21,000,
 * flat professional tax, TDS entered by the admin. Review with your CA before paying.
 */
export function computePayslip(userId: string, month: string, tds = 0): PayslipData {
  const pol = policy();
  const u = allUsers().find((x) => x.id === userId)!;
  const prof = hdb().prepare("SELECT * FROM employee_profiles WHERE userId=?").get(userId) as Record<string, any> | undefined;
  const salary = Number(prof?.monthlySalary ?? 0);
  const [y, m] = month.split("-").map(Number);
  const days = daysBetween(`${month}-01`, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10));
  const working = days.filter((d) => isWorkingDay(d, pol));
  const present = new Set((hdb().prepare("SELECT day FROM attendance WHERE userId=? AND day LIKE ?").all(userId, `${month}-%`) as { day: string }[]).map((r) => r.day));
  const leaves = hdb().prepare("SELECT type,fromDate,toDate FROM leaves WHERE userId=? AND status='Approved' AND fromDate<=? AND toDate>=?").all(userId, days.at(-1)!, days[0]) as {
    type: string;
    fromDate: string;
    toDate: string;
  }[];
  const paidLeave = new Set<string>();
  for (const l of leaves) if (l.type !== "Unpaid") for (const d of daysBetween(l.fromDate, l.toDate)) if (working.includes(d) && !present.has(d)) paidLeave.add(d);
  const presentWorking = working.filter((d) => present.has(d)).length;
  const payable = Math.min(working.length, presentWorking + paidLeave.size);
  const gross = working.length ? round2((salary * payable) / working.length) : 0;
  const basic = round2(gross * 0.5),
    hra = round2(gross * 0.2),
    special = round2(gross - basic - hra);
  const pf = pol.pf ? round2(Math.min(basic, 15_000) * 0.12) : 0;
  const esi = pol.esi && salary <= 21_000 ? Math.ceil(gross * 0.0075) : 0;
  const pt = gross > 0 ? pol.professionalTax : 0;
  const reimbursements = round2(
    (hdb().prepare("SELECT COALESCE(SUM(amount),0) AS s FROM claims WHERE userId=? AND status='Approved' AND payslipId IS NULL").get(userId) as { s: number }).s,
  );
  const totalDed = round2(pf + esi + pt + tds);
  return {
    month,
    name: u.name,
    department: prof?.department ?? "",
    monthlySalary: salary,
    workingDays: working.length,
    presentDays: presentWorking,
    paidLeaveDays: paidLeave.size,
    lopDays: working.length - payable,
    earnings: { basic, hra, special, gross },
    deductions: { pf, esi, professionalTax: pt, tds, total: totalDed },
    reimbursements,
    net: round2(gross - totalDed + reimbursements),
  };
}

export function runPayroll(user: User, input: unknown) {
  requireAdmin(user);
  const p = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), tds: z.record(z.number().min(0)).optional().default({}) }).parse(input);
  const existing = hdb().prepare("SELECT id,status FROM payroll_runs WHERE month=?").get(p.month) as { id: string; status: string } | undefined;
  if (existing?.status === "Finalized") throw new AppError(409, "Payroll for this month is already finalized.");
  const staff = (hdb().prepare("SELECT userId FROM employee_profiles WHERE monthlySalary>0").all() as { userId: string }[]).filter((r) =>
    allUsers().some((u) => u.id === r.userId && u.status !== "INACTIVE"),
  );
  if (!staff.length) throw new AppError(400, "Add monthly salaries in People → Employees first.");
  return transaction(() => {
    const runId = existing?.id ?? randomUUID();
    if (!existing) hdb().prepare("INSERT INTO payroll_runs VALUES(?,?,'Draft',?,NULL)").run(runId, p.month, now());
    hdb().prepare("DELETE FROM payslips WHERE runId=?").run(runId);
    for (const s of staff) {
      const slip = computePayslip(s.userId, p.month, p.tds[s.userId] ?? 0);
      hdb().prepare("INSERT INTO payslips VALUES(?,?,?,?,?)").run(randomUUID(), runId, s.userId, JSON.stringify(slip), slip.net);
    }
    return { ok: true, runId, count: staff.length };
  });
}

export function finalizePayroll(user: User, runId: string) {
  requireAdmin(user);
  return transaction(() => {
    const run = hdb().prepare("SELECT status FROM payroll_runs WHERE id=?").get(runId) as { status: string } | undefined;
    if (!run) throw new AppError(404, "Payroll run not found.");
    if (run.status === "Finalized") return { ok: true };
    for (const s of hdb().prepare("SELECT id,userId FROM payslips WHERE runId=?").all(runId) as { id: string; userId: string }[]) {
      hdb().prepare("UPDATE claims SET status='Paid', payslipId=? WHERE userId=? AND status='Approved' AND payslipId IS NULL").run(s.id, s.userId);
    }
    hdb().prepare("UPDATE payroll_runs SET status='Finalized', finalizedAt=? WHERE id=?").run(now(), runId);
    return { ok: true };
  });
}

export function listPayroll(user: User) {
  const runs = hdb().prepare("SELECT * FROM payroll_runs ORDER BY month DESC LIMIT 24").all() as Record<string, any>[];
  const slips = hdb()
    .prepare(`SELECT id,runId,userId,data,net FROM payslips ${user.role === "admin" ? "" : "WHERE userId=?"}`)
    .all(...(user.role === "admin" ? [] : [user.id])) as Record<string, any>[];
  return runs
    .map((r) => ({
      ...r,
      payslips: slips.filter((s) => s.runId === r.id && (user.role === "admin" || r.status === "Finalized")).map((s) => ({ ...s, data: JSON.parse(s.data) as PayslipData })),
    }))
    .filter((r) => user.role === "admin" || r.payslips.length);
}

// ─── Performance ─────────────────────────────────────────────────────────────

export function addGoal(user: User, input: unknown) {
  const p = z.object({ userId: z.string().uuid(), cycle: z.string().trim().min(2).max(20), title: z.string().trim().min(3).max(200), weight: z.number().int().min(1).max(100) }).parse(input);
  own(user, p.userId);
  hdb().prepare("INSERT INTO goals(id,userId,cycle,title,weight,createdAt) VALUES(?,?,?,?,?,?)").run(randomUUID(), p.userId, p.cycle, p.title, p.weight, now());
  return { ok: true };
}

export function rateGoal(user: User, input: unknown) {
  const p = z.object({ id: z.string().uuid(), rating: z.number().int().min(1).max(5), note: z.string().trim().max(500).optional() }).parse(input);
  const g = hdb().prepare("SELECT userId FROM goals WHERE id=?").get(p.id) as { userId: string } | undefined;
  if (!g) throw new AppError(404, "Goal not found.");
  if (user.role === "admin" && g.userId !== user.id) hdb().prepare("UPDATE goals SET managerRating=?, managerNote=? WHERE id=?").run(p.rating, p.note ?? null, p.id);
  else if (g.userId === user.id) hdb().prepare("UPDATE goals SET selfRating=?, selfNote=? WHERE id=?").run(p.rating, p.note ?? null, p.id);
  else throw new AppError(404, "Goal not found.");
  return { ok: true };
}

export function listGoals(user: User) {
  return hdb()
    .prepare(`SELECT g.*, u.name FROM goals g JOIN users u ON u.id=g.userId ${user.role === "admin" ? "" : "WHERE g.userId=?"} ORDER BY g.cycle DESC, u.name, g.createdAt`)
    .all(...(user.role === "admin" ? [] : [user.id]));
}

// ─── Hiring ──────────────────────────────────────────────────────────────────

export const candidateStages = ["Applied", "Screening", "Interview", "Offer", "Hired", "Rejected"] as const;

export function saveJob(user: User, input: unknown) {
  requireAdmin(user);
  const p = z
    .object({ id: z.string().uuid().optional(), title: z.string().trim().min(2).max(120), department: z.string().trim().max(60).default(""), location: z.string().trim().max(80).default(""), description: z.string().trim().min(3).max(5000), status: z.enum(["Open", "On hold", "Closed"]).default("Open") })
    .parse(input);
  if (p.id) hdb().prepare("UPDATE jobs SET title=?,department=?,location=?,description=?,status=? WHERE id=?").run(p.title, p.department, p.location, p.description, p.status, p.id);
  else hdb().prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?,?)").run(randomUUID(), p.title, p.department, p.location, p.description, p.status, now());
  return { ok: true };
}

export function saveCandidate(user: User, input: unknown) {
  requireAdmin(user);
  const p = z
    .object({ id: z.string().uuid().optional(), jobId: z.string().uuid(), name: z.string().trim().min(1).max(120), email: z.string().trim().max(120).default(""), phone: z.string().trim().max(30).default(""), link: z.string().trim().max(500).default(""), stage: z.enum(candidateStages).default("Applied"), notes: z.string().trim().max(3000).default("") })
    .parse(input);
  if (p.id) hdb().prepare("UPDATE candidates SET name=?,email=?,phone=?,link=?,stage=?,notes=?,updatedAt=? WHERE id=?").run(p.name, p.email, p.phone, p.link, p.stage, p.notes, now(), p.id);
  else hdb().prepare("INSERT INTO candidates VALUES(?,?,?,?,?,?,?,?,?,?)").run(randomUUID(), p.jobId, p.name, p.email, p.phone, p.link, p.stage, p.notes, now(), now());
  return { ok: true };
}

export function hiring(user: User) {
  requireAdmin(user);
  return {
    jobs: hdb().prepare("SELECT * FROM jobs ORDER BY createdAt DESC").all(),
    candidates: hdb().prepare("SELECT * FROM candidates ORDER BY updatedAt DESC").all(),
  };
}

// ─── Learning ────────────────────────────────────────────────────────────────

const lessonSchema = z.object({ title: z.string().trim().min(1).max(150), url: z.string().trim().max(500).default(""), body: z.string().trim().max(10_000).default("") });

export function saveCourse(user: User, input: unknown) {
  requireAdmin(user);
  const p = z.object({ title: z.string().trim().min(2).max(150), description: z.string().trim().max(2000).default(""), lessons: z.array(lessonSchema).min(1).max(50) }).parse(input);
  hdb().prepare("INSERT INTO courses VALUES(?,?,?,?,?)").run(randomUUID(), p.title, p.description, JSON.stringify(p.lessons), now());
  return { ok: true };
}

export function completeLesson(user: User, input: unknown) {
  const p = z.object({ courseId: z.string().uuid(), lesson: z.number().int().min(0) }).parse(input);
  const course = hdb().prepare("SELECT lessons FROM courses WHERE id=?").get(p.courseId) as { lessons: string } | undefined;
  if (!course) throw new AppError(404, "Course not found.");
  const total = (JSON.parse(course.lessons) as unknown[]).length;
  const row = hdb().prepare("SELECT done FROM course_progress WHERE courseId=? AND userId=?").get(p.courseId, user.id) as { done: string } | undefined;
  const done = [...new Set([...(row ? (JSON.parse(row.done) as number[]) : []), p.lesson])].filter((i) => i < total);
  hdb()
    .prepare("INSERT INTO course_progress VALUES(?,?,?,?) ON CONFLICT(courseId,userId) DO UPDATE SET done=excluded.done, completedAt=coalesce(course_progress.completedAt, excluded.completedAt)")
    .run(p.courseId, user.id, JSON.stringify(done), done.length === total ? now() : null);
  return { ok: true, completed: done.length === total };
}

export function learning(user: User) {
  const courses = (hdb().prepare("SELECT * FROM courses ORDER BY createdAt DESC").all() as Record<string, any>[]).map((c) => ({ ...c, lessons: JSON.parse(c.lessons) }));
  const progress = hdb()
    .prepare(`SELECT p.*, u.name FROM course_progress p JOIN users u ON u.id=p.userId ${user.role === "admin" ? "" : "WHERE p.userId=?"}`)
    .all(...(user.role === "admin" ? [] : [user.id])) as Record<string, any>[];
  return { courses, progress: progress.map((p) => ({ ...p, done: JSON.parse(p.done) })) };
}

// ─── Engagement ──────────────────────────────────────────────────────────────

export function postAnnouncement(user: User, input: unknown) {
  requireAdmin(user);
  const p = z.object({ title: z.string().trim().min(2).max(150), body: z.string().trim().min(1).max(5000) }).parse(input);
  hdb().prepare("INSERT INTO announcements VALUES(?,?,?,?,?)").run(randomUUID(), p.title, p.body, user.id, now());
  return { ok: true };
}

export function giveKudos(user: User, input: unknown) {
  const p = z.object({ toId: z.string().uuid(), message: z.string().trim().min(3).max(300) }).parse(input);
  if (p.toId === user.id) throw new AppError(400, "Kudos are for teammates.");
  if (!allUsers().some((u) => u.id === p.toId)) throw new AppError(404, "Teammate not found.");
  hdb().prepare("INSERT INTO kudos VALUES(?,?,?,?,?)").run(randomUUID(), user.id, p.toId, p.message, now());
  return { ok: true };
}

export function engagement() {
  const upcoming = (hdb().prepare("SELECT p.userId, p.dob, p.joinedOn, u.name FROM employee_profiles p JOIN users u ON u.id=p.userId WHERE u.status!='INACTIVE'").all() as Record<string, any>[])
    .flatMap((p) => {
      const out: { name: string; what: string; on: string }[] = [];
      const md = istDate().slice(5);
      for (const [field, what] of [["dob", "Birthday"], ["joinedOn", "Work anniversary"]] as const) {
        const v = p[field] as string | null;
        if (v && v.slice(5) >= md && v.slice(5) <= "12-31") out.push({ name: p.name, what, on: v.slice(5) });
      }
      return out;
    })
    .sort((a, b) => a.on.localeCompare(b.on))
    .slice(0, 8);
  return {
    announcements: hdb().prepare("SELECT a.*, u.name AS author FROM announcements a JOIN users u ON u.id=a.authorId ORDER BY a.createdAt DESC LIMIT 30").all(),
    kudos: hdb().prepare("SELECT k.*, f.name AS fromName, t.name AS toName FROM kudos k JOIN users f ON f.id=k.fromId JOIN users t ON t.id=k.toId ORDER BY k.createdAt DESC LIMIT 30").all(),
    upcoming,
  };
}
