"use client";
import { useEffect, useRef, useState } from "react";
import { Award, Camera, CheckCircle2, GraduationCap, LogIn, LogOut, MapPin, Megaphone, Plus, Receipt, Star } from "lucide-react";
import type { User } from "@/lib/types";
import { Empty, Modal, Panel, Stats, day, fileToDataUrl, formObj, getPosition, inr, mapLink, post, time, todayIST, useAction, useData } from "./kit";

type Member = { id: string; name: string; role: string; designation?: string };
const H = (payload: Record<string, unknown>) => post("/api/hr", payload);

// ─── Attendance + field tracking ─────────────────────────────────────────────

type Att = {
  id: string;
  userId: string;
  name: string;
  day: string;
  inAt: string;
  outAt: string | null;
  inLat: number | null;
  inLng: number | null;
  outLat: number | null;
  outLng: number | null;
  inPhoto: string | null;
  inOffice: number | null;
  trail: { at: string; lat: number; lng: number }[];
};

export function AttendanceView({ user, notify }: { user: User; notify: (m: string) => void }) {
  const [date, setDate] = useState(todayIST());
  const { data, reload } = useData<{ records: Att[]; absent: { id: string; name: string; onLeave: boolean }[]; mine: Att | null }>(`/api/hr?view=attendance&day=${date}`, 30_000);
  const { busy, run } = useAction(notify, reload);
  const selfie = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"in" | "out">("in");
  const mine = date === todayIST() ? data?.mine : undefined;
  const clockedIn = !!mine && !mine.outAt;

  // Field tracking: while clocked in and this page is open, share location every 2 minutes.
  useEffect(() => {
    if (!clockedIn) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void getPosition().then((p) => H({ action: "ping", ...p })).catch(() => undefined);
    }, 120_000);
    return () => clearInterval(t);
  }, [clockedIn]);

  const start = (m: "in" | "out") => {
    setMode(m);
    selfie.current?.click();
  };
  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    await run(async () => {
      const [pos, photo] = await Promise.all([getPosition(), fileToDataUrl(file, 480)]);
      return H({ action: mode === "in" ? "clockIn" : "clockOut", ...pos, photo });
    }, (r) => (mode === "in" ? `Clocked in${r?.inOffice === 0 ? " — you are outside the office radius, your manager will see this" : ""}.` : "Clocked out. Have a good evening."));
    if (selfie.current) selfie.current.value = "";
  };
  const route = (a: Att) => (a.trail.length > 1 ? `https://www.google.com/maps/dir/${a.trail.slice(-10).map((p) => `${p.lat},${p.lng}`).join("/")}` : null);

  return (
    <div className="leads-page">
      <input ref={selfie} type="file" accept="image/*" capture="user" hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
      <section className="panel settings-card lead-source clock-card">
        <div>
          <h3><MapPin size={16} /> {mine ? (mine.outAt ? "Day complete" : "You’re clocked in") : "Start your day"}</h3>
          <p>
            {mine
              ? `In at ${time(mine.inAt)}${mine.outAt ? ` · out at ${time(mine.outAt)}` : ""}${mine.inOffice === 0 ? " · outside office radius" : ""}`
              : "Clock in with a selfie and your location. Field staff: keep this page open to share your route."}
          </p>
        </div>
        <div className="lead-actions">
          {!mine && <button className="button primary" disabled={busy} onClick={() => start("in")}><LogIn size={15} /> <Camera size={15} /> Clock in</button>}
          {clockedIn && <button className="button" disabled={busy} onClick={() => start("out")}><LogOut size={15} /> Clock out</button>}
        </div>
      </section>

      {user.role === "admin" && (
        <>
          <Stats
            items={[
              ["Present", data?.records.length ?? "—"],
              ["Still working", data?.records.filter((r) => !r.outAt).length ?? "—"],
              ["On leave", data?.absent.filter((a) => a.onLeave).length ?? "—"],
              ["Not in", data?.absent.filter((a) => !a.onLeave).length ?? "—"],
            ]}
          />
          <Panel title="Attendance register" sub="Selfie, location and route for each person." actions={<input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} aria-label="Date" />}>
            {!data?.records.length ? (
              <Empty>No one has clocked in on {day(date)}.</Empty>
            ) : (
              <div className="table-scroll">
                <table className="task-table">
                  <thead><tr><th>Employee</th><th>In</th><th>Out</th><th>Location</th><th>Route</th></tr></thead>
                  <tbody>
                    {data.records.map((a) => (
                      <tr key={a.id}>
                        <td className="att-person">{a.inPhoto && <img src={a.inPhoto} alt={`Selfie of ${a.name}`} />}<strong>{a.name}</strong></td>
                        <td>{time(a.inAt)}{a.inOffice === 0 && <small className="lead-sub due">outside office</small>}</td>
                        <td>{a.outAt ? time(a.outAt) : <span className="call-badge completed">Working</span>}</td>
                        <td>{a.inLat != null && <a className="text-button" href={mapLink(a.inLat, a.inLng!)} target="_blank" rel="noreferrer">Clock-in spot</a>}{a.outLat != null && <> · <a className="text-button" href={mapLink(a.outLat, a.outLng!)} target="_blank" rel="noreferrer">Clock-out</a></>}</td>
                        <td>{route(a) ? <a className="text-button" href={route(a)!} target="_blank" rel="noreferrer">{a.trail.length} points</a> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!!data?.absent.length && <p className="hint pad">Not clocked in: {data.absent.map((a) => `${a.name}${a.onLeave ? " (leave)" : ""}`).join(", ")}</p>}
          </Panel>
        </>
      )}
    </div>
  );
}

// ─── Leave ───────────────────────────────────────────────────────────────────

type Leave = { id: string; userId: string; name: string; type: string; fromDate: string; toDate: string; days: number; reason: string; status: string; reviewNote: string | null };

export function LeaveView({ user, notify }: { user: User; notify: (m: string) => void }) {
  const { data, reload } = useData<{ leaves: Leave[]; balance: { type: string; quota: number; used: number }[] }>("/api/hr?view=leave", 30_000);
  const { busy, run } = useAction(notify, reload);
  const [applying, setApplying] = useState(false);
  const admin = user.role === "admin";
  return (
    <div className="leads-page">
      <Stats items={(data?.balance ?? []).map((b) => [`${b.type} leave left`, `${b.quota - b.used} / ${b.quota}`] as [string, string])} />
      <Panel
        title={admin ? "Leave requests" : "My leave"}
        sub={admin ? "Approving leave also moves that person’s new leads to available salespeople." : "Apply, track and withdraw leave."}
        actions={<button className="button primary" onClick={() => setApplying(true)}><Plus size={15} /> Apply for leave</button>}
      >
        {!data?.leaves.length ? (
          <Empty>No leave requests.</Empty>
        ) : (
          <div className="table-scroll">
            <table className="task-table">
              <thead><tr>{admin && <th>Employee</th>}<th>Type</th><th>Dates</th><th>Days</th><th>Reason</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.leaves.map((l) => (
                  <tr key={l.id}>
                    {admin && <td><strong>{l.name}</strong></td>}
                    <td>{l.type}</td>
                    <td>{day(l.fromDate)}{l.toDate !== l.fromDate ? ` – ${day(l.toDate)}` : ""}</td>
                    <td>{l.days}</td>
                    <td className="wrap">{l.reason}</td>
                    <td><span className={`call-badge ${l.status === "Approved" ? "completed" : l.status === "Rejected" ? "failed" : ""}`}>{l.status}</span></td>
                    <td className="row-actions">
                      {admin && l.status === "Pending" && l.userId !== user.id && (
                        <>
                          <button className="text-button" disabled={busy} onClick={() => run(() => H({ action: "reviewLeave", id: l.id, status: "Approved" }), (r) => `Approved.${r.rerouted ? ` ${r.rerouted} lead(s) re-routed.` : ""}`)}>Approve</button>
                          <button className="text-button" disabled={busy} onClick={() => { const note = prompt("Reason for rejecting?") ?? undefined; void run(() => H({ action: "reviewLeave", id: l.id, status: "Rejected", note }), "Rejected."); }}>Reject</button>
                        </>
                      )}
                      {l.userId === user.id && l.status === "Pending" && <button className="text-button" disabled={busy} onClick={() => run(() => H({ action: "cancelLeave", id: l.id }), "Withdrawn.")}>Withdraw</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {applying && (
        <Modal title="Apply for leave" onClose={() => setApplying(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => H({ action: "applyLeave", ...formObj(e.currentTarget) }), (r) => `Requested ${r.days} day(s).`).then(() => setApplying(false));
            }}
          >
            <div className="form-grid">
              <label>Type<select name="type">{["Casual", "Sick", "Earned", "Unpaid"].map((t) => <option key={t}>{t}</option>)}</select></label>
              <span />
              <label>From<input name="fromDate" type="date" required defaultValue={todayIST()} /></label>
              <label>To<input name="toDate" type="date" required defaultValue={todayIST()} /></label>
            </div>
            <label>Reason<textarea name="reason" rows={3} required /></label>
            <div className="modal-actions"><button className="button primary" disabled={busy}>Submit</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ─── Claims ──────────────────────────────────────────────────────────────────

type Claim = { id: string; userId: string; name: string; spentOn: string; category: string; amount: number; description: string; status: string; hasReceipt: number; reviewNote: string | null };

export function ClaimsView({ user, notify }: { user: User; notify: (m: string) => void }) {
  const { data, reload } = useData<{ claims: Claim[] }>("/api/hr?view=claims", 30_000);
  const { busy, run } = useAction(notify, reload);
  const [adding, setAdding] = useState(false);
  const admin = user.role === "admin";
  const sum = (s: string) => inr((data?.claims ?? []).filter((c) => c.status === s).reduce((a, c) => a + c.amount, 0));
  return (
    <div className="leads-page">
      <Stats items={[["Pending", sum("Pending")], ["Approved (paid with salary)", sum("Approved")], ["Paid", sum("Paid")], ["Claims", data?.claims.length ?? "—"]]} />
      <Panel title={admin ? "Expense claims" : "My claims"} sub="Approved claims are reimbursed in the next payroll run." actions={<button className="button primary" onClick={() => setAdding(true)}><Receipt size={15} /> New claim</button>}>
        {!data?.claims.length ? (
          <Empty>No claims yet.</Empty>
        ) : (
          <div className="table-scroll">
            <table className="task-table">
              <thead><tr>{admin && <th>Employee</th>}<th>Date</th><th>Category</th><th>Amount</th><th>Details</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.claims.map((c) => (
                  <tr key={c.id}>
                    {admin && <td><strong>{c.name}</strong></td>}
                    <td>{day(c.spentOn)}</td>
                    <td>{c.category}</td>
                    <td>{inr(c.amount)}</td>
                    <td className="wrap">{c.description}{c.hasReceipt ? <> · <a className="text-button" href={`/api/hr?view=receipt&id=${c.id}`} target="_blank" rel="noreferrer">receipt</a></> : null}</td>
                    <td><span className={`call-badge ${["Approved", "Paid"].includes(c.status) ? "completed" : c.status === "Rejected" ? "failed" : ""}`}>{c.status}</span></td>
                    <td className="row-actions">
                      {admin && c.status === "Pending" && c.userId !== user.id && (
                        <>
                          <button className="text-button" disabled={busy} onClick={() => run(() => H({ action: "reviewClaim", id: c.id, status: "Approved" }), "Approved.")}>Approve</button>
                          <button className="text-button" disabled={busy} onClick={() => { const note = prompt("Reason?") ?? undefined; void run(() => H({ action: "reviewClaim", id: c.id, status: "Rejected", note }), "Rejected."); }}>Reject</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {adding && (
        <Modal title="New expense claim" onClose={() => setAdding(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = formObj(form);
              const file = (form.elements.namedItem("receipt") as HTMLInputElement).files?.[0];
              void run(async () => H({ action: "claim", spentOn: f.spentOn, category: f.category, amount: Number(f.amount), description: f.description, receipt: file ? await fileToDataUrl(file) : undefined }), "Claim submitted.").then(() => setAdding(false));
            }}
          >
            <div className="form-grid">
              <label>Date<input name="spentOn" type="date" required defaultValue={todayIST()} max={todayIST()} /></label>
              <label>Amount (₹)<input name="amount" type="number" min={1} step="0.01" required /></label>
              <label>Category<select name="category">{["Travel", "Fuel", "Food", "Client meeting", "Office supplies", "Phone / Internet", "Other"].map((c) => <option key={c}>{c}</option>)}</select></label>
              <label>Receipt <span className="optional">photo or PDF</span><input name="receipt" type="file" accept="image/*,application/pdf" capture="environment" /></label>
            </div>
            <label>What was it for?<textarea name="description" rows={3} required /></label>
            <div className="modal-actions"><button className="button primary" disabled={busy}>Submit claim</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ─── Payroll ─────────────────────────────────────────────────────────────────

type Slip = {
  id: string;
  userId: string;
  net: number;
  data: {
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
};
type Run = { id: string; month: string; status: string; payslips: Slip[] };

export function PayrollView({ user, notify }: { user: User; notify: (m: string) => void }) {
  const { data, reload } = useData<{ runs: Run[] }>("/api/hr?view=payroll");
  const { busy, run } = useAction(notify, reload);
  const [slip, setSlip] = useState<Slip | null>(null);
  const lastMonth = new Date(Date.now() + 330 * 60_000 - 20 * 86_400_000).toISOString().slice(0, 7);
  const admin = user.role === "admin";
  return (
    <div className="leads-page">
      {admin && (
        <form
          className="panel settings-card lead-source clock-card"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => H({ action: "runPayroll", month: formObj(e.currentTarget).month }), (r) => `Draft payroll prepared for ${r.count} employee(s). Review, then finalize.`);
          }}
        >
          <div>
            <h3>Run payroll</h3>
            <p>Salary is prorated from attendance and approved leave; PF, ESI and professional tax follow People → Employees → HR policy. Approved claims are reimbursed. Check the draft with your CA before paying.</p>
          </div>
          <div className="lead-actions">
            <input name="month" type="month" defaultValue={lastMonth} required aria-label="Month" />
            <button className="button primary" disabled={busy}>Prepare draft</button>
          </div>
        </form>
      )}
      {!data?.runs.length ? (
        <Panel title="Payslips"><Empty>{admin ? "No payroll runs yet. Add monthly salaries under Employees, then prepare a draft." : "No payslips yet."}</Empty></Panel>
      ) : (
        data.runs.map((r) => (
          <Panel
            key={r.id}
            title={new Date(`${r.month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
            sub={`${r.status} · ${r.payslips.length} payslip(s) · net ${inr(r.payslips.reduce((a, s) => a + s.net, 0))}`}
            actions={admin && r.status === "Draft" ? <button className="button primary" disabled={busy} onClick={() => confirm("Finalize? Payslips become visible to employees and approved claims are marked paid.") && run(() => H({ action: "finalizePayroll", runId: r.id }), "Payroll finalized.")}>Finalize</button> : undefined}
          >
            <div className="table-scroll">
              <table className="task-table">
                <thead><tr><th>Employee</th><th>Paid days</th><th>LOP</th><th>Gross</th><th>Deductions</th><th>Claims</th><th>Net pay</th><th /></tr></thead>
                <tbody>
                  {r.payslips.map((s) => (
                    <tr key={s.id}>
                      <td><strong>{s.data.name}</strong></td>
                      <td>{s.data.presentDays + s.data.paidLeaveDays} / {s.data.workingDays}</td>
                      <td>{s.data.lopDays}</td>
                      <td>{inr(s.data.earnings.gross)}</td>
                      <td>{inr(s.data.deductions.total)}</td>
                      <td>{inr(s.data.reimbursements)}</td>
                      <td><strong>{inr(s.net)}</strong></td>
                      <td><button className="text-button" onClick={() => setSlip(s)}>Payslip</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ))
      )}
      {slip && (
        <Modal title={`Payslip · ${slip.data.name}`} onClose={() => setSlip(null)} wide>
          <div className="payslip">
            <p className="modal-intro">{new Date(`${slip.data.month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}{slip.data.department ? ` · ${slip.data.department}` : ""} · {slip.data.presentDays} present, {slip.data.paidLeaveDays} paid leave, {slip.data.lopDays} LOP of {slip.data.workingDays} working days</p>
            <div className="form-grid">
              <dl className="doc-totals">
                <dt>Basic</dt><dd>{inr(slip.data.earnings.basic)}</dd>
                <dt>HRA</dt><dd>{inr(slip.data.earnings.hra)}</dd>
                <dt>Special allowance</dt><dd>{inr(slip.data.earnings.special)}</dd>
                <dt className="grand">Gross earned</dt><dd className="grand">{inr(slip.data.earnings.gross)}</dd>
              </dl>
              <dl className="doc-totals">
                <dt>PF (employee)</dt><dd>{inr(slip.data.deductions.pf)}</dd>
                <dt>ESI</dt><dd>{inr(slip.data.deductions.esi)}</dd>
                <dt>Professional tax</dt><dd>{inr(slip.data.deductions.professionalTax)}</dd>
                <dt>TDS</dt><dd>{inr(slip.data.deductions.tds)}</dd>
                <dt>Reimbursements</dt><dd>+{inr(slip.data.reimbursements)}</dd>
                <dt className="grand">Net pay</dt><dd className="grand">{inr(slip.data.net)}</dd>
              </dl>
            </div>
            <div className="modal-actions"><button className="button" onClick={() => window.print()}>Print / save PDF</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Performance ─────────────────────────────────────────────────────────────

type Goal = { id: string; userId: string; name: string; cycle: string; title: string; weight: number; selfRating: number | null; selfNote: string | null; managerRating: number | null; managerNote: string | null };

export function PerformanceView({ user, notify }: { user: User; notify: (m: string) => void }) {
  const { data, reload } = useData<{ goals: Goal[]; team: Member[] }>("/api/hr?view=performance");
  const { busy, run } = useAction(notify, reload);
  const [adding, setAdding] = useState(false);
  const admin = user.role === "admin";
  const cycle = `${new Date().getFullYear()}-${new Date().getMonth() < 6 ? "H1" : "H2"}`;
  const groups = new Map<string, Goal[]>();
  for (const g of data?.goals ?? []) groups.set(`${g.name} · ${g.cycle}`, [...(groups.get(`${g.name} · ${g.cycle}`) ?? []), g]);
  const score = (gs: Goal[]) => {
    const rated = gs.filter((g) => g.managerRating);
    const w = rated.reduce((a, g) => a + g.weight, 0);
    return w ? (rated.reduce((a, g) => a + g.weight * g.managerRating!, 0) / w).toFixed(1) : "—";
  };
  const rate = (g: Goal) => {
    const v = prompt(`Rate "${g.title}" from 1 (poor) to 5 (outstanding)`);
    if (!v) return;
    const note = prompt("Comment (optional)") ?? undefined;
    void run(() => H({ action: "rate", id: g.id, rating: Number(v), note }), "Rating saved.");
  };
  return (
    <div className="leads-page">
      <Panel title="Goals & appraisals" sub="Set weighted goals each cycle; employees rate themselves, managers give the final rating." actions={<button className="button primary" onClick={() => setAdding(true)}><Plus size={15} /> Add goal</button>}>
        {!groups.size ? <Empty>No goals yet.</Empty> : null}
        {[...groups].map(([k, gs]) => (
          <div key={k} className="goal-group">
            <header><strong>{k}</strong><span>Score {score(gs)} / 5</span></header>
            {gs.map((g) => (
              <div key={g.id} className="goal-row">
                <span className="wrap">{g.title} <small className="lead-sub">weight {g.weight}%</small></span>
                <span>Self: {g.selfRating ? "★".repeat(g.selfRating) : "—"}</span>
                <span>Manager: {g.managerRating ? "★".repeat(g.managerRating) : "—"}</span>
                {(g.userId === user.id || admin) && <button className="text-button" onClick={() => rate(g)}><Star size={12} /> Rate</button>}
              </div>
            ))}
          </div>
        ))}
      </Panel>
      {adding && (
        <Modal title="Add goal" onClose={() => setAdding(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = formObj(e.currentTarget);
              void run(() => H({ action: "goal", userId: f.userId, cycle: f.cycle, title: f.title, weight: Number(f.weight) }), "Goal added.").then(() => setAdding(false));
            }}
          >
            <div className="form-grid">
              <label>
                For
                <select name="userId" defaultValue={user.id} disabled={!admin}>
                  {(admin ? data?.team ?? [] : [{ id: user.id, name: user.name }]).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <label>Cycle<input name="cycle" defaultValue={cycle} required /></label>
            </div>
            {!admin && <input type="hidden" name="userId" value={user.id} />}
            <label>Goal<input name="title" required placeholder="Close ₹10L of new business" /></label>
            <label>Weight (%)<input name="weight" type="number" min={1} max={100} defaultValue={25} required /></label>
            <div className="modal-actions"><button className="button primary" disabled={busy}>Add</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ─── Hiring ──────────────────────────────────────────────────────────────────

const candStages = ["Applied", "Screening", "Interview", "Offer", "Hired", "Rejected"];
type Job = { id: string; title: string; department: string; location: string; description: string; status: string };
type Cand = { id: string; jobId: string; name: string; email: string; phone: string; link: string; stage: string; notes: string };

export function HiringView({ notify }: { notify: (m: string) => void }) {
  const { data, reload } = useData<{ jobs: Job[]; candidates: Cand[] }>("/api/hr?view=hiring");
  const { busy, run } = useAction(notify, reload);
  const [job, setJob] = useState<Partial<Job> | null>(null);
  const [cand, setCand] = useState<Partial<Cand> | null>(null);
  return (
    <div className="leads-page">
      <Panel title="Open roles" sub="Track applicants from application to hire." actions={<button className="button primary" onClick={() => setJob({})}><Plus size={15} /> New role</button>}>
        {!data?.jobs.length && <Empty>No roles yet.</Empty>}
        {data?.jobs.map((j) => {
          const cs = data.candidates.filter((c) => c.jobId === j.id);
          return (
            <div key={j.id} className="goal-group">
              <header>
                <button className="text-button" onClick={() => setJob(j)}><strong>{j.title}</strong></button>
                <span>{[j.department, j.location, j.status].filter(Boolean).join(" · ")} · {cs.length} candidate(s)</span>
                <button className="text-button" onClick={() => setCand({ jobId: j.id, stage: "Applied" })}><Plus size={12} /> Candidate</button>
              </header>
              <div className="kanban kanban-sm">
                {candStages.map((s) => (
                  <section key={s} className="kanban-col">
                    <header><strong>{s}</strong><span>{cs.filter((c) => c.stage === s).length}</span></header>
                    {cs.filter((c) => c.stage === s).map((c) => (
                      <article key={c.id} className="kanban-card">
                        <button className="text-button" onClick={() => setCand(c)}><strong>{c.name}</strong></button>
                        <small>{c.phone || c.email}</small>
                      </article>
                    ))}
                  </section>
                ))}
              </div>
            </div>
          );
        })}
      </Panel>
      {job && (
        <Modal title={job.id ? "Edit role" : "New role"} onClose={() => setJob(null)} wide>
          <form onSubmit={(e) => { e.preventDefault(); void run(() => H({ action: "job", id: job.id, ...formObj(e.currentTarget) }), "Role saved.").then(() => setJob(null)); }}>
            <div className="form-grid">
              <label>Title<input name="title" required defaultValue={job.title} /></label>
              <label>Department<input name="department" defaultValue={job.department} /></label>
              <label>Location<input name="location" defaultValue={job.location} /></label>
              <label>Status<select name="status" defaultValue={job.status ?? "Open"}>{["Open", "On hold", "Closed"].map((s) => <option key={s}>{s}</option>)}</select></label>
            </div>
            <label>Description<textarea name="description" rows={5} required defaultValue={job.description} /></label>
            <div className="modal-actions"><button className="button primary" disabled={busy}>Save</button></div>
          </form>
        </Modal>
      )}
      {cand && (
        <Modal title={cand.id ? cand.name! : "Add candidate"} onClose={() => setCand(null)} wide>
          <form onSubmit={(e) => { e.preventDefault(); void run(() => H({ action: "candidate", id: cand.id, jobId: cand.jobId, ...formObj(e.currentTarget) }), "Candidate saved.").then(() => setCand(null)); }}>
            <div className="form-grid">
              <label>Name<input name="name" required defaultValue={cand.name} /></label>
              <label>Stage<select name="stage" defaultValue={cand.stage}>{candStages.map((s) => <option key={s}>{s}</option>)}</select></label>
              <label>Phone<input name="phone" defaultValue={cand.phone} /></label>
              <label>Email<input name="email" type="email" defaultValue={cand.email} /></label>
            </div>
            <label>Resume / profile link<input name="link" type="url" defaultValue={cand.link} placeholder="https://drive.google.com/…" /></label>
            <label>Interview notes<textarea name="notes" rows={4} defaultValue={cand.notes} /></label>
            <div className="modal-actions"><button className="button primary" disabled={busy}>Save</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ─── Learning ────────────────────────────────────────────────────────────────

type Course = { id: string; title: string; description: string; lessons: { title: string; url: string; body: string }[] };

export function LearningView({ user, notify }: { user: User; notify: (m: string) => void }) {
  const { data, reload } = useData<{ courses: Course[]; progress: { courseId: string; userId: string; name: string; done: number[]; completedAt: string | null }[]; team: Member[] }>("/api/hr?view=learning");
  const { busy, run } = useAction(notify, reload);
  const [open, setOpen] = useState<Course | null>(null);
  const [adding, setAdding] = useState(false);
  const mine = (id: string) => data?.progress.find((p) => p.courseId === id && p.userId === user.id)?.done ?? [];
  return (
    <div className="leads-page">
      <Panel title="Learning" sub="Training courses for onboarding, product and sales skills." actions={user.role === "admin" ? <button className="button primary" onClick={() => setAdding(true)}><Plus size={15} /> New course</button> : undefined}>
        {!data?.courses.length && <Empty>No courses yet.</Empty>}
        <div className="course-grid">
          {data?.courses.map((c) => {
            const done = mine(c.id).length;
            const finished = data.progress.filter((p) => p.courseId === c.id && p.completedAt).map((p) => p.name);
            return (
              <button key={c.id} className="panel course-card" onClick={() => setOpen(c)}>
                <GraduationCap size={18} />
                <strong>{c.title}</strong>
                <small>{c.description}</small>
                <div className="progress"><span style={{ width: `${(done / c.lessons.length) * 100}%` }} /></div>
                <small>{done}/{c.lessons.length} lessons{user.role === "admin" && finished.length ? ` · completed by ${finished.join(", ")}` : ""}</small>
              </button>
            );
          })}
        </div>
      </Panel>
      {open && (
        <Modal title={open.title} onClose={() => setOpen(null)} wide>
          <ol className="lesson-list">
            {open.lessons.map((l, i) => {
              const done = mine(open.id).includes(i);
              return (
                <li key={i}>
                  <div>
                    <strong>{l.title}</strong>
                    {l.body && <p>{l.body}</p>}
                    {l.url && <a className="text-button" href={l.url} target="_blank" rel="noreferrer">Open material</a>}
                  </div>
                  <button className="button" disabled={busy || done} onClick={() => run(() => H({ action: "lesson", courseId: open.id, lesson: i }), (r) => (r.completed ? "Course completed. Well done!" : "Lesson done."))}>
                    <CheckCircle2 size={14} /> {done ? "Done" : "Mark done"}
                  </button>
                </li>
              );
            })}
          </ol>
        </Modal>
      )}
      {adding && (
        <Modal title="New course" onClose={() => setAdding(false)} wide>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = formObj(e.currentTarget);
              const lessons = f.lessons.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
                const [title, url = ""] = line.split("|").map((x) => x.trim());
                return { title, url, body: "" };
              });
              void run(() => H({ action: "course", title: f.title, description: f.description, lessons }), "Course published.").then(() => setAdding(false));
            }}
          >
            <label>Title<input name="title" required /></label>
            <label>Description<input name="description" /></label>
            <label>Lessons <span className="optional">one per line: Title | link</span><textarea name="lessons" rows={6} required placeholder={"Our services | https://autoneural.in\nHandling objections | https://youtu.be/…"} /></label>
            <div className="modal-actions"><button className="button primary" disabled={busy}>Publish</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ─── Engagement ──────────────────────────────────────────────────────────────

export function EngagementView({ user, notify }: { user: User; notify: (m: string) => void }) {
  const { data, reload } = useData<{
    announcements: { id: string; title: string; body: string; author: string; createdAt: string }[];
    kudos: { id: string; fromName: string; toName: string; message: string; createdAt: string }[];
    upcoming: { name: string; what: string; on: string }[];
    team: Member[];
  }>("/api/hr?view=engagement", 60_000);
  const { busy, run } = useAction(notify, reload);
  return (
    <div className="leads-page">
      <section className="call-top">
        <Panel title="Announcements" sub="Company news for everyone.">
          {user.role === "admin" && (
            <form className="stack-form pad" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; void run(() => H({ action: "announce", ...formObj(f) }), "Posted.").then(() => f.reset()); }}>
              <input name="title" placeholder="Title" required aria-label="Title" />
              <textarea name="body" rows={3} placeholder="What’s new?" required aria-label="Announcement" />
              <button className="button primary" disabled={busy}><Megaphone size={14} /> Post</button>
            </form>
          )}
          {!data?.announcements.length && <Empty>No announcements yet.</Empty>}
          {data?.announcements.map((a) => (
            <article key={a.id} className="feed-item">
              <strong>{a.title}</strong>
              <p>{a.body}</p>
              <small>{a.author} · {day(a.createdAt)}</small>
            </article>
          ))}
        </Panel>
        <div className="leads-page">
          <Panel title="Kudos" sub="Say thanks where the team can see it.">
            <form className="stack-form pad" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; void run(() => H({ action: "kudos", ...formObj(f) }), "Kudos sent!").then(() => f.reset()); }}>
              <select name="toId" required aria-label="Teammate">
                <option value="">Choose a teammate…</option>
                {data?.team.filter((m) => m.id !== user.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <input name="message" placeholder="Thanks for…" required aria-label="Message" />
              <button className="button" disabled={busy}><Award size={14} /> Give kudos</button>
            </form>
            {data?.kudos.map((k) => (
              <article key={k.id} className="feed-item">
                <strong>{k.fromName} → {k.toName}</strong>
                <p>{k.message}</p>
                <small>{day(k.createdAt)}</small>
              </article>
            ))}
          </Panel>
          <Panel title="Coming up">
            {!data?.upcoming.length ? <Empty>Add birthdays and joining dates under Employees.</Empty> : data.upcoming.map((u, i) => <p key={i} className="feed-item">{u.what}: <strong>{u.name}</strong> · {new Date(`2000-${u.on}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>)}
          </Panel>
        </div>
      </section>
    </div>
  );
}

// ─── Employees & HR policy (admin) ───────────────────────────────────────────

type Profile = { userId: string; phone: string; department: string; joinedOn: string | null; dob: string | null; monthlySalary: number | null; address: string };
type Policy = { leaveQuota: { Casual: number; Sick: number; Earned: number }; workWeek: 5 | 6; holidays: string[]; pf: boolean; esi: boolean; professionalTax: number; office: { lat: number; lng: number; radiusM: number } | null };

export function EmployeesView({ notify }: { notify: (m: string) => void }) {
  const { data, reload } = useData<{ profiles: Profile[]; policy: Policy; team: Member[] }>("/api/hr?view=employees");
  const { busy, run } = useAction(notify, reload);
  const [edit, setEdit] = useState<Member | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const prof = (id: string) => data?.profiles.find((p) => p.userId === id);
  return (
    <div className="leads-page">
      <Panel title="Employees" sub="Profiles, salary and dates used by payroll, attendance and engagement." actions={<button className="button" onClick={() => setPolicyOpen(true)}>HR policy</button>}>
        <div className="table-scroll">
          <table className="task-table">
            <thead><tr><th>Name</th><th>Department</th><th>Phone</th><th>Joined</th><th>Monthly salary</th><th /></tr></thead>
            <tbody>
              {data?.team.map((m) => (
                <tr key={m.id}>
                  <td><strong>{m.name}</strong><small className="lead-sub">{m.designation ?? m.role}</small></td>
                  <td>{prof(m.id)?.department || "—"}</td>
                  <td>{prof(m.id)?.phone || "—"}</td>
                  <td>{day(prof(m.id)?.joinedOn)}</td>
                  <td>{inr(prof(m.id)?.monthlySalary)}</td>
                  <td><button className="text-button" onClick={() => setEdit(m)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {edit && (
        <Modal title={edit.name} onClose={() => setEdit(null)} wide>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = formObj(e.currentTarget);
              void run(() => H({ action: "profile", userId: edit.id, ...f, monthlySalary: f.monthlySalary ? Number(f.monthlySalary) : null, joinedOn: f.joinedOn || null, dob: f.dob || null }), "Saved.").then(() => setEdit(null));
            }}
          >
            <div className="form-grid">
              <label>Department<input name="department" defaultValue={prof(edit.id)?.department} /></label>
              <label>Phone<input name="phone" defaultValue={prof(edit.id)?.phone} /></label>
              <label>Joined on<input name="joinedOn" type="date" defaultValue={prof(edit.id)?.joinedOn ?? ""} /></label>
              <label>Date of birth<input name="dob" type="date" defaultValue={prof(edit.id)?.dob ?? ""} /></label>
              <label>Monthly gross salary (₹)<input name="monthlySalary" type="number" min={0} defaultValue={prof(edit.id)?.monthlySalary ?? ""} /></label>
            </div>
            <label>Address<input name="address" defaultValue={prof(edit.id)?.address} /></label>
            <div className="modal-actions"><button className="button primary" disabled={busy}>Save</button></div>
          </form>
        </Modal>
      )}
      {policyOpen && data && (
        <Modal title="HR policy" onClose={() => setPolicyOpen(false)} wide>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = formObj(e.currentTarget);
              const office = f.officeLat && f.officeLng ? { lat: Number(f.officeLat), lng: Number(f.officeLng), radiusM: Number(f.radiusM || 300) } : null;
              void run(
                () =>
                  H({
                    action: "policy",
                    policy: {
                      leaveQuota: { Casual: Number(f.Casual), Sick: Number(f.Sick), Earned: Number(f.Earned) },
                      workWeek: Number(f.workWeek),
                      holidays: f.holidays.split(/[\s,]+/).filter(Boolean),
                      pf: f.pf === "on",
                      esi: f.esi === "on",
                      professionalTax: Number(f.professionalTax),
                      office,
                    },
                  }),
                "Policy saved.",
              ).then(() => setPolicyOpen(false));
            }}
          >
            <div className="form-grid">
              {(["Casual", "Sick", "Earned"] as const).map((k) => <label key={k}>{k} leave / year<input name={k} type="number" min={0} defaultValue={data.policy.leaveQuota[k]} /></label>)}
              <label>Work week<select name="workWeek" defaultValue={data.policy.workWeek}><option value={6}>Mon–Sat</option><option value={5}>Mon–Fri</option></select></label>
              <label>Professional tax / month (₹)<input name="professionalTax" type="number" min={0} defaultValue={data.policy.professionalTax} /></label>
              <label className="check"><input type="checkbox" name="pf" defaultChecked={data.policy.pf} /> Deduct PF (12% of basic)</label>
              <label className="check"><input type="checkbox" name="esi" defaultChecked={data.policy.esi} /> Deduct ESI (0.75%, gross ≤ ₹21,000)</label>
            </div>
            <label>Holidays <span className="optional">dates, comma separated</span><textarea name="holidays" rows={2} defaultValue={data.policy.holidays.join(", ")} placeholder="2026-10-20, 2026-11-08" /></label>
            <p className="hint">Office location (optional): clock-ins further than the radius are flagged.</p>
            <div className="form-grid">
              <label>Latitude<input name="officeLat" defaultValue={data.policy.office?.lat ?? ""} /></label>
              <label>Longitude<input name="officeLng" defaultValue={data.policy.office?.lng ?? ""} /></label>
              <label>Radius (m)<input name="radiusM" type="number" defaultValue={data.policy.office?.radiusM ?? 300} /></label>
              <span className="lead-actions"><button type="button" className="button" onClick={(ev) => { const form = (ev.currentTarget as HTMLButtonElement).form!; void getPosition().then((p) => { (form.elements.namedItem("officeLat") as HTMLInputElement).value = String(p.lat); (form.elements.namedItem("officeLng") as HTMLInputElement).value = String(p.lng); }, (err: Error) => notify(err.message)); }}>Use my location</button></span>
            </div>
            <div className="modal-actions"><button className="button primary" disabled={busy}>Save policy</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
