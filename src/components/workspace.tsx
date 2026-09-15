"use client";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useId,
  type ReactNode,
} from "react";
import {
  LayoutDashboard,
  CheckCheck,
  Users,
  Activity as ActivityIcon,
  Settings,
  Search,
  Plus,
  ArrowUpRight,
  ArrowRight,
  CalendarDays,
  Clock3,
  ChevronDown,
  MoreHorizontal,
  MessageSquare,
  Check,
  X,
  LogOut,
  SlidersHorizontal,
  LayoutGrid,
  List,
  Flag,
  LoaderCircle,
  Menu,
  LockKeyhole,
  RefreshCw,
  ClipboardList,
  TriangleAlert,
  Link as LinkIcon,
  FileText,
  ExternalLink,
  Trash2,
  Paperclip,
  Upload,
} from "lucide-react";
import {
  statuses,
  priorities,
  type User,
  type Task,
  type WorkspaceData,
  type Activity,
  type TaskAttachment,
  type Status,
} from "@/lib/types";
const initials = (name: string) =>
  name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("");
const color = (name: string) =>
  ["mint", "lavender", "peach", "blue"][
    [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 4
  ];
const date = (s: string) =>
  new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const overdue = (t: Task) => t.status !== "Completed" && t.dueDate < today();
const statusClass = (s: string) => s.toLowerCase().replaceAll(" ", "-");
async function request(path: string, body?: unknown, method = "POST") {
  const r = await fetch(
    path,
    body
      ? {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const j = await r.json();
  if (r.status === 401) {
    window.location.assign("/login");
    throw new Error("Please sign in.");
  }
  if (!r.ok) throw new Error(j.error || "Unable to save.");
  return j;
}
function Avatar({
  user,
  small = false,
}: {
  user: Pick<User, "name">;
  small?: boolean;
}) {
  return (
    <span className={`avatar ${color(user.name)} ${small ? "small" : ""}`}>
      {initials(user.name)}
    </span>
  );
}
function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status ${statusClass(status)}`}>
      <i />
      {status}
    </span>
  );
}
function Modal({
  children,
  title,
  onClose,
  wide = false,
}: {
  children: ReactNode;
  title: string;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${wide ? "modal-wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function PasswordForm({
  forced,
  onDone,
}: {
  forced: boolean;
  onDone: (u: User) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className={forced ? "password-setup" : "settings-card"}>
      <div className="setup-icon">
        <LockKeyhole size={24} />
      </div>
      <h2>{forced ? "Make this account yours." : "Change your password"}</h2>
      <p>
        {forced
          ? "Choose a new CRM password before entering your workspace."
          : "Use a unique password with at least 12 characters."}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          const f = new FormData(e.currentTarget);
          if (f.get("password") !== f.get("confirm")) {
            setError("The new passwords do not match.");
            return;
          }
          setBusy(true);
          try {
            const j = await request(
              "/api/auth",
              { current: f.get("current"), password: f.get("password") },
              "PATCH",
            );
            onDone(j.user);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {forced ? "Temporary password" : "Current password"}
          <input
            name="current"
            type="password"
            autoComplete="current-password"
            required
            maxLength={200}
          />
        </label>
        <label>
          New password
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={200}
            required
          />
        </label>
        <label>
          Confirm new password
          <input
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={200}
            required
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy
            ? "Saving…"
            : forced
              ? "Continue to workspace"
              : "Update password"}
          <ArrowRight size={16} />
        </button>
      </form>
    </div>
  );
}
export default function Workspace({ initialUser }: { initialUser: User }) {
  const [user, setUser] = useState(initialUser),
    [data, setData] = useState<WorkspaceData | null>(null),
    [page, setPage] = useState("Overview"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("All tasks"),
    [assignee, setAssignee] = useState("all"),
    [view, setView] = useState<"list" | "board">("list"),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [creating, setCreating] = useState(false),
    [showAddEmployee, setShowAddEmployee] = useState(false),
    [removalTarget, setRemovalTarget] = useState<User | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [mobile, setMobile] = useState(false),
    [refreshing, setRefreshing] = useState(false);
  const admin = user.role === "admin";
  const load = useCallback(async () => {
    try {
      setData(await request("/api/workspace"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (user.mustChange) return;
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => clearInterval(timer);
  }, [load, user.mustChange]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const notify = (s: string) => setToast(s);
  const signOut = async () => {
    try {
      await request("/api/auth", {}, "DELETE");
      window.location.assign("/login");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (user.mustChange)
    return (
      <div className="first-login">
        <div className="brand">
          <span className="brand-mark">an</span>autoneural.
        </div>
        <PasswordForm forced onDone={(u) => setUser(u)} />
        <button className="text-button" onClick={signOut}>
          Sign out
        </button>
      </div>
    );
  if (!data)
    return (
      <div className="first-login">
        <div className="brand">
          <span className="brand-mark">an</span>autoneural.
        </div>
        {error ? (
          <>
            <p className="error">{error}</p>
            <button className="button" onClick={() => void load()}>
              Try again
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" />
            <p>Opening your workspace…</p>
          </>
        )}
      </div>
    );
  const tasks = data.tasks,
    completed = tasks.filter((t) => t.status === "Completed").length,
    late = tasks.filter(overdue),
    active = tasks.filter((t) => t.status === "In progress").length;
  const employees = data.team.filter((u) => u.role === "employee");
  const person = (id: string) =>
    data.team.find((u) => u.id === id) || {
      id,
      name: "Team member",
      email: "",
      role: "employee" as const,
      mustChange: false,
    };
  const filtered = tasks
    .filter(
      (t) =>
        (page !== "Completed" || t.status === "Completed") &&
        (filter === "All tasks" ||
          (filter === "Overdue" && overdue(t)) ||
          t.status === filter) &&
        (assignee === "all" || t.assigneeId === assignee) &&
        `${t.title} ${t.project} ${person(t.assigneeId).name}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        (a.status === "Completed" ? 1 : 0) -
          (b.status === "Completed" ? 1 : 0) ||
        a.dueDate.localeCompare(b.dueDate),
    );
  const nav = (s: string) => {
    setPage(s);
    setFilter("All tasks");
    setQuery("");
    setMobile(false);
  };
  const title =
    page === "Overview"
      ? admin
        ? "A clear view of your team."
        : "Your work, at a glance."
      : page === "Tasks"
        ? admin
          ? "Every task. One place."
          : "Your tasks. Your progress."
        : page === "Completed"
          ? "A little progress, every day."
          : page === "Team"
            ? "Great work starts with a team."
            : page === "Activity"
              ? "The latest from your workspace."
              : "Your workspace, your account.";
  const subtitle =
    page === "Overview"
      ? admin
        ? "Keep work moving and everyone on the same page."
        : "Know what’s next, share updates, and make things happen."
      : page === "Tasks"
        ? "Plan, prioritize, and move work forward."
        : page === "Completed"
          ? "A record of the work you’ve moved across the finish line."
          : page === "Team"
            ? "See who’s working on what, and balance the workload."
            : page === "Activity"
              ? "Assignments, updates, and milestones — all in one place."
              : "Manage your sign-in and view your account details.";
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "sidebar-open" : ""}`}>
        <a className="brand" href="/">
          <span className="brand-mark">
            a<span>n</span>
          </span>
          <span>
            autoneural<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace-switch">
          <span className="workspace-symbol">A</span>
          <div>
            <strong>AutoNeural</strong>
            <small>Team workspace</small>
          </div>
          <span className="workspace-lock">
            <LockKeyhole size={14} />
          </span>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {[
            [LayoutDashboard, "Overview"],
            [ClipboardList, "Tasks"],
            [CheckCheck, "Completed"],
            ...(admin ? [[Users, "Team"]] : []),
            [ActivityIcon, "Activity"],
          ].map(([Icon, label]) => {
            const I = Icon as typeof LayoutDashboard;
            const s = label as string;
            return (
              <button
                key={s}
                className={`nav-item ${page === s ? "selected" : ""}`}
                onClick={() => nav(s)}
              >
                <I size={19} />
                <span>{s === "Tasks" && !admin ? "My tasks" : s}</span>
                {s === "Tasks" && (
                  <span className="nav-count">{tasks.length - completed}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="team-note">
            <span className="note-spark">✳</span>
            <strong>
              Small steps.
              <br />
              Shared success.
            </strong>
            <p>
              Good things happen when
              <br />
              everyone moves together.
            </p>
          </div>
          <button
            className={`nav-item ${page === "Settings" ? "selected" : ""}`}
            onClick={() => nav("Settings")}
          >
            <Settings size={19} />
            Settings
          </button>
          <div className="user-card">
            <Avatar user={user} />
            <div>
              <strong>{admin ? "Administrator" : user.name}</strong>
              <small>{admin ? "Workspace admin" : "Team member"}</small>
            </div>
            <button
              className="icon-button"
              onClick={signOut}
              aria-label="Sign out"
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      {mobile && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>{page === "Tasks" && !admin ? "My tasks" : page}</strong>
          </div>
          <div className="top-actions">
            <span className="live-dot" />{" "}
            <span className="workspace-private">Private workspace</span>
            <div className="top-divider" />
            <Avatar user={user} small />
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {page === "Overview"
                  ? `LET’S MAKE TODAY COUNT, ${admin ? "TEAM" : user.name.toUpperCase()}`
                  : `AUTONEURAL / ${page.toUpperCase()}`}
              </span>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
            {admin && ["Overview", "Tasks", "Completed"].includes(page) ? (
              <button
                className="button primary"
                onClick={() => setCreating(true)}
              >
                <Plus size={18} />
                Create task
              </button>
            ) : (
              <span className="today-label">
                <CalendarDays size={17} />
                {new Date().toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            )}
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {page === "Overview" && (
            <>
              <section className="stats-grid">
                <Stat
                  label="Total tasks"
                  value={tasks.length}
                  detail={admin ? "Across your workspace" : "Assigned to you"}
                  icon={<ClipboardList size={18} />}
                  onClick={() => nav("Tasks")}
                />
                <Stat
                  label="In progress"
                  value={active}
                  detail="Good things in motion"
                  icon={<Clock3 size={18} />}
                  onClick={() => {
                    nav("Tasks");
                    setFilter("In progress");
                  }}
                />
                <Stat
                  label="Completed"
                  value={completed}
                  detail={
                    tasks.length
                      ? `${Math.round((completed / tasks.length) * 100)}% of all tasks`
                      : "Your next milestone awaits"
                  }
                  icon={<CheckCheck size={18} />}
                  onClick={() => nav("Completed")}
                  green
                />
                <Stat
                  label="Overdue"
                  value={late.length}
                  detail={
                    late.length
                      ? "A little attention needed"
                      : "All caught up. Nice work."
                  }
                  icon={<Flag size={18} />}
                  onClick={() => {
                    nav("Tasks");
                    setFilter("Overdue");
                  }}
                  warning={late.length > 0}
                />
              </section>
              <div className="focus-strip">
                <span className="focus-icon">
                  <ArrowUpRight size={23} />
                </span>
                <div>
                  <strong>
                    {late.length
                      ? `${late.length} ${late.length === 1 ? "task needs" : "tasks need"} a little attention.`
                      : tasks.length
                        ? "Let’s keep the momentum going."
                        : "Your next chapter starts with a task."}
                  </strong>
                  <span>
                    {late.length
                      ? "Review overdue work and help your team move forward."
                      : admin
                        ? "Assign clear priorities. Give great work room to happen."
                        : "Pick a task, share your progress, and take the next step."}
                  </span>
                </div>
                <button
                  className="text-button"
                  onClick={() => {
                    nav("Tasks");
                    if (late.length) setFilter("Overdue");
                  }}
                >
                  {late.length ? "Review tasks" : "View tasks"}
                  <ArrowRight size={16} />
                </button>
              </div>
            </>
          )}
          {["Overview", "Tasks", "Completed"].includes(page) && (
            <div className={page === "Overview" ? "overview-grid" : ""}>
              <section className="panel task-panel">
                <div className="panel-heading">
                  <div>
                    <h2>
                      {page === "Overview"
                        ? "Task overview"
                        : page === "Completed"
                          ? "Completed work"
                          : admin
                            ? "All tasks"
                            : "My tasks"}{" "}
                      <span className="count-chip">{filtered.length}</span>
                    </h2>
                    {page === "Overview" && (
                      <p>A little structure for the work ahead.</p>
                    )}
                  </div>
                  <div className="view-switch">
                    <button
                      aria-label="List view"
                      aria-pressed={view === "list"}
                      className={view === "list" ? "active" : ""}
                      onClick={() => setView("list")}
                    >
                      <List size={17} />
                    </button>
                    <button
                      aria-label="Board view"
                      aria-pressed={view === "board"}
                      className={view === "board" ? "active" : ""}
                      onClick={() => setView("board")}
                    >
                      <LayoutGrid size={16} />
                    </button>
                  </div>
                </div>
                <div className="task-toolbar">
                  <div className="filter-tabs">
                    {(page === "Completed"
                      ? ["All tasks"]
                      : ["All tasks", "In progress", "In review", "Completed"]
                    ).map((s) => (
                      <button
                        key={s}
                        className={filter === s ? "active" : ""}
                        onClick={() => setFilter(s)}
                      >
                        {s === "All tasks" && page === "Completed"
                          ? "All completed"
                          : s}
                      </button>
                    ))}
                  </div>
                  <div className="filter-controls">
                    <label className="search-box">
                      <Search size={16} />
                      <input
                        aria-label="Search tasks"
                        placeholder="Search tasks…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    {admin && (
                      <select
                        aria-label="Filter by team member"
                        value={assignee}
                        onChange={(e) => setAssignee(e.target.value)}
                      >
                        <option value="all">Everyone</option>
                        <optgroup label="Employees">
                          {employees.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Administrators">
                          {data.team
                            .filter((u) => u.role === "admin")
                            .map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name} (Admin)
                              </option>
                            ))}
                        </optgroup>
                      </select>
                    )}
                    <button
                      className={`icon-button ${filter === "Overdue" ? "filter-active" : ""}`}
                      aria-label="Show overdue tasks"
                      title="Show overdue tasks"
                      onClick={() =>
                        setFilter(
                          filter === "Overdue" ? "All tasks" : "Overdue",
                        )
                      }
                    >
                      <SlidersHorizontal size={17} />
                    </button>
                  </div>
                </div>
                {filter === "Overdue" && (
                  <div className="filter-notice">
                    Showing overdue tasks{" "}
                    <button onClick={() => setFilter("All tasks")}>
                      Clear filter ×
                    </button>
                  </div>
                )}
                {filtered.length === 0 ? (
                  <Empty
                    title={
                      tasks.length
                        ? "No tasks match this view."
                        : "Make room for great work."
                    }
                    description={
                      tasks.length
                        ? "Try a different search or filter."
                        : admin
                          ? "Create your first task, assign a teammate, and start moving forward."
                          : "Your assigned tasks will appear here. Your administrator will get you started."
                    }
                    action={
                      admin && !tasks.length ? (
                        <button
                          className="button primary"
                          onClick={() => setCreating(true)}
                        >
                          <Plus size={17} />
                          Create your first task
                        </button>
                      ) : undefined
                    }
                  />
                ) : view === "list" ? (
                  <div className="table-scroll">
                    <table className="task-table">
                      <thead>
                        <tr>
                          <th>Task name</th>
                          {admin && <th>Assignee</th>}
                          <th>Status</th>
                          <th>Priority</th>
                          <th>Due date</th>
                          <th>
                            <span className="sr-only">Open</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered
                          .slice(0, page === "Overview" ? 7 : filtered.length)
                          .map((t) => (
                            <tr key={t.id}>
                              <td>
                                <button
                                  className="task-name"
                                  onClick={() => setSelected(t.id)}
                                >
                                  <span
                                    className={`task-check ${t.status === "Completed" ? "done" : ""}`}
                                  >
                                    {t.status === "Completed" && (
                                      <Check size={13} />
                                    )}
                                  </span>
                                  <span>
                                    <strong>{t.title}</strong>
                                    <small>
                                      AN-{String(t.number).padStart(3, "0")}
                                      {t.project && ` · ${t.project}`}
                                      {Boolean(t.attachmentCount) && (
                                        <span
                                          style={{
                                            marginLeft: "6px",
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: "2px",
                                            color: "#2563eb",
                                            fontWeight: 600,
                                          }}
                                          title={`${t.attachmentCount} attachments/deliverables`}
                                        >
                                          <Paperclip size={11} />
                                          {t.attachmentCount}
                                        </span>
                                      )}
                                    </small>
                                  </span>
                                </button>
                              </td>
                              {admin && (
                                <td>
                                  <span className="assignee">
                                    <Avatar user={person(t.assigneeId)} small />
                                    <span>
                                      {person(t.assigneeId).name.split(" ")[0]}
                                    </span>
                                  </span>
                                </td>
                              )}
                              <td>
                                <StatusBadge status={t.status} />
                              </td>
                              <td>
                                <span
                                  className={`priority ${t.priority.toLowerCase()}`}
                                >
                                  <i />
                                  {t.priority}
                                </span>
                              </td>
                              <td>
                                <span
                                  className={`due ${overdue(t) ? "late" : ""}`}
                                >
                                  {date(t.dueDate)}
                                  {overdue(t) && (
                                    <span className="overdue-dot" />
                                  )}
                                </span>
                              </td>
                              <td>
                                <button
                                  className="icon-button"
                                  aria-label={`Open ${t.title}`}
                                  onClick={() => setSelected(t.id)}
                                >
                                  <ArrowUpRight size={16} />
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="kanban">
                    {statuses.map((s) => (
                      <div className="kanban-column" key={s}>
                        <div className="kanban-heading">
                          <StatusBadge status={s} />
                          <span>
                            {filtered.filter((t) => t.status === s).length}
                          </span>
                        </div>
                        {filtered
                          .filter((t) => t.status === s)
                          .map((t) => (
                            <button
                              className="kanban-card"
                              key={t.id}
                              onClick={() => setSelected(t.id)}
                            >
                              <small>
                                AN-{String(t.number).padStart(3, "0")}
                              </small>
                              <strong>{t.title}</strong>
                              {t.project && (
                                <span className="project-tag">{t.project}</span>
                              )}
                              <span
                                className={`priority ${t.priority.toLowerCase()}`}
                              >
                                <i />
                                {t.priority}
                              </span>
                              <div>
                                <Avatar user={person(t.assigneeId)} small />
                                <span className={overdue(t) ? "late" : ""}>
                                  <CalendarDays size={13} />
                                  {date(t.dueDate)}
                                </span>
                                <span>
                                  <MessageSquare size={13} />
                                  {t.commentCount}
                                </span>
                                {Boolean(t.attachmentCount) && (
                                  <span title={`${t.attachmentCount} attachments/deliverables`}>
                                    <Paperclip size={13} />
                                    {t.attachmentCount}
                                  </span>
                                )}
                              </div>
                            </button>
                          ))}
                        {!filtered.some((t) => t.status === s) && (
                          <div className="kanban-empty">Nothing here yet</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="panel-footer">
                  <span>
                    {page === "Overview" && filtered.length > 7
                      ? `Showing 7 of ${filtered.length} tasks`
                      : `${filtered.length} ${filtered.length === 1 ? "task" : "tasks"} · Asia/Kolkata`}
                  </span>
                  {page === "Overview" ? (
                    <button
                      className="text-button"
                      onClick={() => nav("Tasks")}
                    >
                      View all tasks
                      <ArrowRight size={14} />
                    </button>
                  ) : (
                    <button
                      className="text-button"
                      disabled={refreshing}
                      onClick={async () => {
                        setRefreshing(true);
                        await load();
                        setRefreshing(false);
                      }}
                    >
                      <RefreshCw
                        size={13}
                        className={refreshing ? "spin" : ""}
                      />
                      Refresh
                    </button>
                  )}
                </div>
              </section>
              {page === "Overview" && (
                <aside className="overview-side">
                  {admin ? (
                    <section className="panel workload">
                      <div className="panel-heading">
                        <h2>Team workload</h2>
                        <Users size={17} />
                      </div>
                      {data.team.map((u) => {
                        const assigned = tasks.filter(
                          (t) => t.assigneeId === u.id,
                        );
                        const open = assigned.filter(
                          (t) => t.status !== "Completed",
                        ).length;
                        return (
                          <button
                            className="workload-person"
                            key={u.id}
                            onClick={() => {
                              nav("Tasks");
                              setAssignee(u.id);
                            }}
                          >
                            <Avatar user={u} />
                            <div>
                              <strong>
                                {u.name}
                                {u.role === "admin" && (
                                  <span
                                    style={{
                                      fontSize: "0.72rem",
                                      color: "#2563eb",
                                      marginLeft: "6px",
                                      fontWeight: 600,
                                    }}
                                  >
                                    · Admin
                                  </span>
                                )}
                              </strong>
                              <span>
                                {open} active {open === 1 ? "task" : "tasks"}
                              </span>
                              <div className="mini-progress">
                                <i
                                  style={{
                                    width: `${assigned.length ? ((assigned.length - open) / assigned.length) * 100 : 0}%`,
                                  }}
                                />
                              </div>
                            </div>
                            <span className="workload-number">{open}</span>
                          </button>
                        );
                      })}
                      <button
                        className="text-button team-link"
                        onClick={() => nav("Team")}
                      >
                        Meet your team
                        <ArrowRight size={14} />
                      </button>
                    </section>
                  ) : (
                    <section className="panel personal-progress">
                      <span className="eyebrow">YOUR MOMENTUM</span>
                      <div
                        className="progress-ring"
                        style={{
                          background: `conic-gradient(#406448 ${tasks.length ? (completed / tasks.length) * 360 : 0}deg,#eef0e9 0deg)`,
                        }}
                      >
                        <span>
                          {tasks.length
                            ? Math.round((completed / tasks.length) * 100)
                            : 0}
                          %
                        </span>
                      </div>
                      <h2>Every task counts.</h2>
                      <p>
                        {completed} of {tasks.length} tasks completed
                      </p>
                    </section>
                  )}
                  <section className="activity-preview">
                    <div className="panel-heading">
                      <h2>Recent activity</h2>
                      <span className="live-dot" />
                    </div>
                    {data.activity.length ? (
                      <ActivityList
                        items={data.activity.slice(0, 3)}
                        onTask={setSelected}
                      />
                    ) : (
                      <p className="muted small-copy">
                        A fresh start. Task updates will appear here as your
                        team gets going.
                      </p>
                    )}
                  </section>
                </aside>
              )}
            </div>
          )}
          {page === "Team" && admin && (
            <>
              <div className="section-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h2>
                    Your people{" "}
                    <span className="count-chip">{data.team.length}</span>
                  </h2>
                  <span className="muted">
                    {data.team.filter((u) => u.role === "admin").length} administrators · {employees.length} employees
                  </span>
                </div>
                <button
                  className="button primary"
                  onClick={() => setShowAddEmployee(true)}
                >
                  <Plus size={16} />
                  Add employee
                </button>
              </div>

              {data.removalRequests && data.removalRequests.length > 0 && (
                <div
                  className="panel"
                  style={{
                    background: "rgba(239, 68, 68, 0.05)",
                    border: "1px solid rgba(239, 68, 68, 0.25)",
                    borderRadius: "8px",
                    padding: "16px 20px",
                    margin: "18px 0",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontWeight: 600,
                      color: "#b91c1c",
                      marginBottom: "12px",
                    }}
                  >
                    <TriangleAlert size={18} />
                    <span>Pending Employee Removal Requests (Dual-Admin Approval Required)</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {data.removalRequests.map((req) => {
                      const target = data.team.find((u) => u.id === req.employeeId);
                      const isRequester = req.requestedById === user.id;
                      return (
                        <div
                          key={req.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            background: "#ffffff",
                            padding: "12px 16px",
                            borderRadius: "6px",
                            border: "1px solid #fee2e2",
                          }}
                        >
                          <div>
                            <strong>{target?.name || "Employee"}</strong> ({target?.email || ""})
                            <div style={{ color: "#64748b", fontSize: "0.85rem", marginTop: "2px" }}>
                              Requested by <strong>{req.requestedByName}</strong>
                              {req.reason ? ` — "${req.reason}"` : ""}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            {isRequester ? (
                              <span
                                style={{
                                  fontSize: "0.8rem",
                                  color: "#b91c1c",
                                  fontWeight: 500,
                                  background: "#fee2e2",
                                  padding: "5px 10px",
                                  borderRadius: "4px",
                                }}
                              >
                                Awaiting approval by 2nd admin
                              </span>
                            ) : (
                              <>
                                <button
                                  className="button primary"
                                  style={{
                                    background: "#dc2626",
                                    borderColor: "#b91c1c",
                                    fontSize: "0.85rem",
                                    padding: "6px 14px",
                                  }}
                                  onClick={async () => {
                                    try {
                                      await request("/api/workspace", {
                                        action: "approveRemoval",
                                        requestId: req.id,
                                      });
                                      notify("Employee removed and deactivated.");
                                      await load();
                                    } catch (e) {
                                      notify((e as Error).message);
                                    }
                                  }}
                                >
                                  Approve Removal
                                </button>
                                <button
                                  className="button"
                                  style={{ fontSize: "0.85rem", padding: "6px 14px" }}
                                  onClick={async () => {
                                    try {
                                      await request("/api/workspace", {
                                        action: "rejectRemoval",
                                        requestId: req.id,
                                      });
                                      notify("Removal request rejected.");
                                      await load();
                                    } catch (e) {
                                      notify((e as Error).message);
                                    }
                                  }}
                                >
                                  Reject
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="team-grid">
                {data.team.map((u) => {
                  const assigned = tasks.filter((t) => t.assigneeId === u.id),
                    done = assigned.filter(
                      (t) => t.status === "Completed",
                    ).length;
                  const isCurrentUser = u.id === user.id;
                  const pendingReq = data.removalRequests?.find(
                    (r) => r.employeeId === u.id,
                  );

                  return (
                    <section className="panel employee-card" key={u.id}>
                      <div className="employee-top">
                        <Avatar user={u} />
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                          {u.designation && (
                            <span
                              className="label-pill"
                              style={{ background: "#e0e7ff", color: "#3730a3" }}
                            >
                              {u.designation}
                            </span>
                          )}
                          <span className="label-pill">
                            {u.role === "admin"
                              ? "Administrator"
                              : u.mustChange
                                ? "Awaiting first login"
                                : "Employee"}
                          </span>
                        </div>
                      </div>
                      <h2>{u.name}</h2>
                      <p>{u.email}</p>
                      <div className="employee-metrics">
                        <span>
                          <strong>{assigned.length - done}</strong>Active tasks
                        </span>
                        <span>
                          <strong>{done}</strong>Completed
                        </span>
                        <span>
                          <strong>{assigned.filter(overdue).length}</strong>
                          Overdue
                        </span>
                      </div>
                      <div className="mini-progress">
                        <i
                          style={{
                            width: `${assigned.length ? (done / assigned.length) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <div className="employee-actions">
                        {u.role === "employee" ? (
                          <button
                            className="text-button"
                            onClick={() => {
                              nav("Tasks");
                              setAssignee(u.id);
                            }}
                          >
                            View tasks
                            <ArrowRight size={14} />
                          </button>
                        ) : (
                          <span className="muted" style={{ fontSize: "0.85rem" }}>
                            Admin access
                          </span>
                        )}
                        <ResetPassword user={u} notify={notify} />
                        {!isCurrentUser && (
                          pendingReq ? (
                            <span
                              style={{
                                fontSize: "0.75rem",
                                color: "#b91c1c",
                                fontWeight: 500,
                              }}
                            >
                              Removal pending
                            </span>
                          ) : (
                            <button
                              className="text-button"
                              style={{ color: "#dc2626" }}
                              onClick={() => setRemovalTarget(u)}
                            >
                              Request removal
                            </button>
                          )
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
              <div className="admin-note">
                <LockKeyhole size={19} />
                <div>
                  <strong>Dual-Admin Authorization Policy</strong>
                  <p>
                    Administrators have full system management access. Removing any employee
                    or team member requires permission and sign-off from both admin accounts.
                  </p>
                </div>
              </div>
            </>
          )}
          {page === "Activity" && (
            <section className="panel activity-page">
              <div className="panel-heading">
                <h2>Workspace timeline</h2>
                <span className="muted">Latest 30 updates</span>
              </div>
              {data.activity.length ? (
                <ActivityList items={data.activity} onTask={setSelected} />
              ) : (
                <Empty
                  title="Your story starts here."
                  description="Task assignments, comments, and status updates will appear in this timeline."
                />
              )}
            </section>
          )}
          {page === "Settings" && (
            <div className="settings-grid">
              <section className="panel account-panel">
                <span className="eyebrow">YOUR ACCOUNT</span>
                <Avatar user={user} />
                <h2>{user.name}</h2>
                <p>{user.email}</p>
                <div>
                  <span>Role</span>
                  <strong>{admin ? "Administrator" : "Employee"}</strong>
                </div>
                <div>
                  <span>Workspace</span>
                  <strong>AutoNeural</strong>
                </div>
                <div>
                  <span>Task timezone</span>
                  <strong>Asia/Kolkata</strong>
                </div>
                <p className="settings-hint">
                  CRM passwords are separate from email mailbox passwords.
                </p>
              </section>
              <PasswordForm
                forced={false}
                onDone={(u) => {
                  setUser(u);
                  notify(
                    "Password updated. Other sessions have been signed out.",
                  );
                }}
              />
            </div>
          )}
          <footer className="workspace-footer">
            <span>Made for the way we work.</span>
            <span>
              AutoNeural workspace <span className="footer-dot">•</span>{" "}
              {admin ? "Admin view" : "Employee view"}
            </span>
          </footer>
        </main>
      </div>
      {creating && (
        <TaskEditor
          user={user}
          team={data.team}
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await load();
            notify("Task created and assigned.");
          }}
        />
      )}
      {showAddEmployee && (
        <AddEmployeeModal
          onClose={() => setShowAddEmployee(false)}
          onSaved={load}
          notify={notify}
        />
      )}
      {removalTarget && (
        <RequestRemovalModal
          user={removalTarget}
          onClose={() => setRemovalTarget(null)}
          onSaved={load}
          notify={notify}
        />
      )}
      {selected && (
        <TaskDetail
          id={selected}
          user={user}
          team={data.team}
          onClose={() => setSelected(null)}
          onSaved={load}
          notify={notify}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  detail,
  icon,
  onClick,
  green = false,
  warning = false,
}: {
  label: string;
  value: number;
  detail: string;
  icon: ReactNode;
  onClick: () => void;
  green?: boolean;
  warning?: boolean;
}) {
  return (
    <button
      className={`stat-card ${green ? "stat-green" : ""} ${warning ? "stat-warning" : ""}`}
      onClick={onClick}
    >
      <div>
        <span>{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong>{String(value).padStart(2, "0")}</strong>
      <p>
        {green && <span className="stat-dot" />}
        {detail}
      </p>
    </button>
  );
}
function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <ClipboardList size={27} />
        <span>
          <Plus size={12} />
        </span>
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function ActivityList({
  items,
  onTask,
}: {
  items: Activity[];
  onTask: (id: string) => void;
}) {
  return (
    <div className="activity-list">
      {items.map((a) => (
        <button
          className="activity-item"
          key={a.id}
          onClick={() => onTask(a.taskId)}
        >
          <span className="timeline-dot" />
          <div>
            <strong>{a.actorName}</strong>
            <p>{a.text}</p>
            <small>
              {date(a.createdAt)} ·{" "}
              {new Date(a.createdAt).toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </small>
          </div>
        </button>
      ))}
    </div>
  );
}
function TaskEditor({
  user,
  team,
  task,
  onClose,
  onSaved,
}: {
  user?: User;
  team: User[];
  task?: Task;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [attachType, setAttachType] = useState<"file" | "link">("file");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <Modal title={task ? "Edit task" : "Create a task"} onClose={onClose}>
      <p className="modal-intro">Clear ownership. A shared finish line.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            let attachmentPayload: { name: string; type: string; url: string; fileSize?: number; purpose: string } | undefined = undefined;
            if (!task) {
              if (attachType === "file" && selectedFile) {
                const customName = (f.get("attachmentName") as string)?.trim();
                attachmentPayload = {
                  name: customName || selectedFile.name,
                  type: "DOCUMENT",
                  url: "#",
                  fileSize: selectedFile.size,
                  purpose: "REFERENCE",
                };
              } else if (attachType === "link") {
                const url = (f.get("linkUrl") as string)?.trim();
                if (url) {
                  const name = (f.get("linkName") as string)?.trim() || url;
                  attachmentPayload = {
                    name,
                    type: "LINK",
                    url,
                    purpose: "REFERENCE",
                  };
                }
              }
            }

            await request("/api/workspace", {
              action: task ? "update" : "create",
              task: {
                ...(task ? { id: task.id, version: task.version } : {}),
                title: f.get("title"),
                description: f.get("description"),
                assigneeId: f.get("assigneeId"),
                priority: f.get("priority"),
                dueDate: f.get("dueDate"),
                project: f.get("project"),
                status: f.get("status"),
                ...(attachmentPayload ? { attachment: attachmentPayload } : {}),
              },
            });
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Task name <span className="required">*</span>
          <input
            name="title"
            placeholder="What needs to get done?"
            required
            minLength={3}
            maxLength={180}
            defaultValue={task?.title}
            autoFocus
          />
        </label>
        <label>
          Description
          <textarea
            name="description"
            placeholder="Add context, requirements, and what done looks like…"
            rows={4}
            maxLength={6000}
            defaultValue={task?.description}
          />
        </label>
        <div className="form-grid">
          <label>
            Assign to <span className="required">*</span>
            <select
              name="assigneeId"
              required
              defaultValue={task?.assigneeId || ""}
            >
              <option value="" disabled>
                Select team member
              </option>
              <optgroup label="Employees">
                {team
                  .filter((u) => u.role === "employee")
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} {u.designation ? `· ${u.designation}` : ""}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Administrators">
                {team
                  .filter((u) => u.role === "admin")
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} {user && u.id === user.id ? "(You - Admin)" : "(Admin)"} {u.designation ? `· ${u.designation}` : ""}
                    </option>
                  ))}
              </optgroup>
            </select>
          </label>
          <label>
            Due date <span className="required">*</span>
            <input
              type="date"
              name="dueDate"
              required
              defaultValue={task?.dueDate || today()}
            />
          </label>
          <label>
            Priority
            <select name="priority" defaultValue={task?.priority || "Medium"}>
              {priorities.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select name="status" defaultValue={task?.status || "To do"}>
              {statuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Project / client <span className="optional">Optional</span>
          <input
            name="project"
            placeholder="e.g. Website launch"
            maxLength={80}
            defaultValue={task?.project}
          />
        </label>

        {!task && (
          <div
            style={{
              marginTop: "12px",
              padding: "14px",
              borderRadius: "8px",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <strong style={{ fontSize: "0.88rem", display: "flex", alignItems: "center", gap: "6px", color: "#1e293b" }}>
                <Paperclip size={15} color="#2563eb" /> Attach Document or Reference Link <span className="optional">Optional</span>
              </strong>
              <div style={{ display: "flex", gap: "6px", fontSize: "0.8rem" }}>
                <button
                  type="button"
                  className={`text-button ${attachType === "file" ? "active" : ""}`}
                  style={{ fontWeight: attachType === "file" ? 700 : 400, color: attachType === "file" ? "#2563eb" : "#64748b" }}
                  onClick={() => setAttachType("file")}
                >
                  Upload File
                </button>
                <span>·</span>
                <button
                  type="button"
                  className={`text-button ${attachType === "link" ? "active" : ""}`}
                  style={{ fontWeight: attachType === "link" ? 700 : 400, color: attachType === "link" ? "#2563eb" : "#64748b" }}
                  onClick={() => setAttachType("link")}
                >
                  Web Link
                </button>
              </div>
            </div>

            {attachType === "file" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div
                  style={{
                    border: "2px dashed #cbd5e1",
                    borderRadius: "6px",
                    padding: "14px",
                    textAlign: "center",
                    background: "#ffffff",
                    cursor: "pointer",
                  }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) setSelectedFile(file);
                    }}
                  />
                  {selectedFile ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                      <FileText size={18} color="#059669" />
                      <strong style={{ fontSize: "0.85rem", color: "#1e293b" }}>{selectedFile.name}</strong>
                      <span style={{ color: "#64748b", fontSize: "0.78rem" }}>
                        ({(selectedFile.size / 1024).toFixed(1)} KB)
                      </span>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setSelectedFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <div style={{ color: "#64748b", fontSize: "0.82rem" }}>
                      <Upload size={18} style={{ margin: "0 auto 4px", display: "block", color: "#3b82f6" }} />
                      <span style={{ fontWeight: 600, color: "#1e293b" }}>Click to select reference file or document</span>
                      <span style={{ display: "block", fontSize: "0.75rem", color: "#94a3b8" }}>
                        PDF, Word, Excel, Images, ZIP up to 50MB
                      </span>
                    </div>
                  )}
                </div>
                {selectedFile && (
                  <input
                    name="attachmentName"
                    placeholder="Document title / label (optional)"
                    defaultValue={selectedFile.name}
                    style={{ fontSize: "0.82rem", padding: "6px 8px" }}
                  />
                )}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: "8px" }}>
                <input
                  name="linkName"
                  placeholder="Link Title (e.g. Figma Spec)"
                  style={{ fontSize: "0.82rem", padding: "6px 8px" }}
                />
                <input
                  name="linkUrl"
                  type="url"
                  placeholder="https://..."
                  style={{ fontSize: "0.82rem", padding: "6px 8px" }}
                />
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Saving…" : task ? "Save changes" : "Create & assign task"}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function TaskDetail({
  id,
  user,
  team,
  onClose,
  onSaved,
  notify,
}: {
  id: string;
  user: User;
  team: User[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [detail, setDetail] = useState<{
      task: Task;
      comments: Activity[];
      activity: Activity[];
      attachments?: TaskAttachment[];
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState(false),
    [tab, setTab] = useState("Comments"),
    [attachMode, setAttachMode] = useState<"file" | "link">("file"),
    [attachBusy, setAttachBusy] = useState(false),
    [detailFile, setDetailFile] = useState<File | null>(null);
  const detailFileInputRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    try {
      setDetail(await request(`/api/workspace?task=${id}`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const change = async (status: Status) => {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      const t = detail.task;
      await request("/api/workspace", {
        action: "update",
        task:
          user.role === "admin"
            ? { ...t, status }
            : { id: t.id, version: t.version, status },
      });
      await load();
      await onSaved();
      notify(
        status === "Completed"
          ? "Task completed. Nice work!"
          : "Task status updated.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (edit && detail)
    return (
      <TaskEditor
        user={user}
        team={team}
        task={detail.task}
        onClose={() => setEdit(false)}
        onSaved={async () => {
          setEdit(false);
          await load();
          await onSaved();
          notify("Task updated.");
        }}
      />
    );
  const t = detail?.task,
    owner = team.find((u) => u.id === t?.assigneeId);
  return (
    <Modal
      title={
        t
          ? `AN-${String(t.number).padStart(3, "0")} · Task details`
          : "Task details"
      }
      onClose={onClose}
      wide
    >
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!t ? (
        <div className="detail-loading">
          {!error && <LoaderCircle className="spin" />}
          <button className="text-button" onClick={() => void load()}>
            Refresh task
          </button>
        </div>
      ) : (
        <>
          <div className="detail-title">
            <h1>{t.title}</h1>
            {user.role === "admin" && (
              <button className="button" onClick={() => setEdit(true)}>
                Edit task
              </button>
            )}
          </div>
          <div className="detail-meta">
            <div>
              <span>ASSIGNED TO</span>
              <strong>
                {owner && <Avatar user={owner} small />}
                {owner?.name || "Team member"}
              </strong>
            </div>
            <div>
              <span>DUE DATE</span>
              <strong className={overdue(t) ? "late" : ""}>
                <CalendarDays size={15} />
                {date(t.dueDate)} {t.dueDate.slice(0, 4)}
              </strong>
            </div>
            <div>
              <span>PRIORITY</span>
              <strong className={`priority ${t.priority.toLowerCase()}`}>
                <i />
                {t.priority}
              </strong>
            </div>
            <div>
              <span>PROJECT / CLIENT</span>
              <strong>{t.project || "General"}</strong>
            </div>
          </div>
          <div className="detail-status">
            <label>
              Status
              <select
                aria-label="Task status"
                value={t.status}
                disabled={busy}
                onChange={(e) => void change(e.target.value as Status)}
              >
                {statuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            {t.status !== "Completed" ? (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void change("Completed")}
              >
                <CheckCheck size={17} />
                {busy ? "Saving…" : "Mark complete"}
              </button>
            ) : (
              <span className="completed-note">
                <CheckCheck size={18} />
                Completed {t.completedAt && date(t.completedAt)}
              </span>
            )}
            <button
              className="button"
              type="button"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                borderColor: tab === "Attachments & Deliverables" ? "#2563eb" : undefined,
                background: tab === "Attachments & Deliverables" ? "#eff6ff" : undefined,
                color: tab === "Attachments & Deliverables" ? "#1d4ed8" : undefined,
                fontWeight: 600,
              }}
              onClick={() => setTab("Attachments & Deliverables")}
            >
              <Upload size={16} />
              {user.role === "admin"
                ? "Attach Document / Link"
                : "Upload Deliverable / Output"}
              {Boolean(detail?.attachments?.length) && (
                <span
                  style={{
                    background: "#e2e8f0",
                    color: "#1e293b",
                    borderRadius: "999px",
                    padding: "1px 7px",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                  }}
                >
                  {detail?.attachments?.length || 0}
                </span>
              )}
            </button>
          </div>
          {detail!.attachments?.some((a) => a.approvalStatus === "PENDING") && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                borderRadius: "8px",
                background: "#fffbeb",
                border: "1px solid #fde68a",
                margin: "12px 0",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <TriangleAlert size={20} color="#d97706" />
                <div>
                  <strong style={{ color: "#92400e", fontSize: "0.9rem" }}>
                    Deliverable Submitted For Admin Approval
                  </strong>
                  <p style={{ margin: 0, fontSize: "0.8rem", color: "#b45309" }}>
                    {detail!.attachments.find((a) => a.approvalStatus === "PENDING")?.name} is awaiting administrator review.
                  </p>
                </div>
              </div>
              <button
                className="button primary"
                style={{ fontSize: "0.82rem", padding: "6px 14px" }}
                onClick={() => setTab("Attachments & Deliverables")}
              >
                Review Deliverable
              </button>
            </div>
          )}
          <div className="description">
            <h3>Description</h3>
            <p>
              {t.description ||
                "No additional details. Add a comment if you need clarification."}
            </p>
          </div>
          <div className="detail-tabs">
            {["Comments", "Attachments & Deliverables", "Activity"].map((s) => (
              <button
                key={s}
                className={tab === s ? "active" : ""}
                onClick={() => setTab(s)}
              >
                {s}
                {s === "Comments" && ` (${detail!.comments.length})`}
                {s === "Attachments & Deliverables" && ` (${detail!.attachments?.length || 0})`}
              </button>
            ))}
          </div>
          {tab === "Attachments & Deliverables" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* 1. UPLOAD & ATTACH FORM AT THE TOP */}
              <div
                style={{
                  background: "#f8fafc",
                  padding: "18px 20px",
                  borderRadius: "10px",
                  border: "1.5px solid #e2e8f0",
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: "8px",
                  }}
                >
                  <strong style={{ fontSize: "0.98rem", display: "flex", alignItems: "center", gap: "8px", color: "#0f172a" }}>
                    <Upload size={18} color="#2563eb" />
                    {user.role === "admin"
                      ? "Attach Reference Document or Link"
                      : "Upload Deliverable Output / Submit for Approval"}
                  </strong>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      type="button"
                      className={`text-button ${attachMode === "file" ? "active" : ""}`}
                      style={{
                        fontWeight: attachMode === "file" ? 700 : 500,
                        color: attachMode === "file" ? "#2563eb" : "#64748b",
                        fontSize: "0.85rem",
                      }}
                      onClick={() => setAttachMode("file")}
                    >
                      Document / File
                    </button>
                    <span>·</span>
                    <button
                      type="button"
                      className={`text-button ${attachMode === "link" ? "active" : ""}`}
                      style={{
                        fontWeight: attachMode === "link" ? 700 : 500,
                        color: attachMode === "link" ? "#2563eb" : "#64748b",
                        fontSize: "0.85rem",
                      }}
                      onClick={() => setAttachMode("link")}
                    >
                      Web Link
                    </button>
                  </div>
                </div>

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setAttachBusy(true);
                    setError("");
                    const form = e.currentTarget;
                    const f = new FormData(form);
                    try {
                      if (attachMode === "link") {
                        await request("/api/workspace", {
                          action: "attachLink",
                          taskId: t.id,
                          name: f.get("name"),
                          url: f.get("url"),
                          purpose: f.get("purpose"),
                        });
                      } else {
                        const file = detailFile;
                        if (!file) throw new Error("Please select a file to upload.");
                        const name =
                          (f.get("name") as string)?.trim() || file.name;
                        await request("/api/workspace", {
                          action: "attachFile",
                          taskId: t.id,
                          name,
                          type: "DOCUMENT",
                          url: "#",
                          fileSize: file.size,
                          purpose: f.get("purpose"),
                        });
                      }
                      form.reset();
                      setDetailFile(null);
                      if (detailFileInputRef.current) detailFileInputRef.current.value = "";
                      await load();
                      notify("Attachment added successfully.");
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setAttachBusy(false);
                    }
                  }}
                  style={{ display: "flex", flexDirection: "column", gap: "12px" }}
                >
                  {attachMode === "file" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <div
                        style={{
                          border: "2px dashed #cbd5e1",
                          borderRadius: "8px",
                          padding: "16px",
                          textAlign: "center",
                          background: "#ffffff",
                          cursor: "pointer",
                          transition: "border-color 0.2s",
                        }}
                        onClick={() => detailFileInputRef.current?.click()}
                      >
                        <input
                          type="file"
                          ref={detailFileInputRef}
                          style={{ display: "none" }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) setDetailFile(file);
                          }}
                        />
                        {detailFile ? (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
                            <FileText size={22} color="#059669" />
                            <strong style={{ fontSize: "0.9rem", color: "#0f172a" }}>{detailFile.name}</strong>
                            <span style={{ color: "#64748b", fontSize: "0.82rem" }}>
                              ({(detailFile.size / 1024).toFixed(1)} KB)
                            </span>
                            <button
                              type="button"
                              className="icon-button"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setDetailFile(null);
                                if (detailFileInputRef.current) detailFileInputRef.current.value = "";
                              }}
                            >
                              <X size={15} />
                            </button>
                          </div>
                        ) : (
                          <div style={{ color: "#64748b", fontSize: "0.86rem" }}>
                            <Upload size={22} style={{ margin: "0 auto 6px", display: "block", color: "#3b82f6" }} />
                            <span style={{ fontWeight: 600, color: "#1e293b" }}>Click to browse or drop file here</span>
                            <span style={{ display: "block", fontSize: "0.78rem", color: "#94a3b8", marginTop: "2px" }}>
                              PDF, Word, Excel, Images, ZIP up to 50MB
                            </span>
                          </div>
                        )}
                      </div>
                      {detailFile && (
                        <input
                          name="name"
                          placeholder="Document display title (defaults to filename)"
                          defaultValue={detailFile.name}
                          style={{ fontSize: "0.85rem", padding: "7px 10px" }}
                        />
                      )}
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: "10px" }}>
                      <input
                        name="name"
                        placeholder="Link Title (e.g. Figma Spec, Pull Request)"
                        required
                        style={{ fontSize: "0.85rem", padding: "7px 10px" }}
                      />
                      <input
                        name="url"
                        type="url"
                        placeholder="https://..."
                        required
                        style={{ fontSize: "0.85rem", padding: "7px 10px" }}
                      />
                    </div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      flexWrap: "wrap",
                      paddingTop: "6px",
                    }}
                  >
                    <label
                      style={{
                        margin: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#475569" }}>
                        Purpose:
                      </span>
                      <select
                        name="purpose"
                        defaultValue={user.role === "admin" ? "REFERENCE" : "OUTPUT"}
                        style={{ padding: "5px 10px", fontSize: "0.85rem", borderRadius: "6px" }}
                      >
                        {user.role === "admin" ? (
                          <>
                            <option value="REFERENCE">📌 Reference Material (Specification / Brief)</option>
                            <option value="OUTPUT">📦 Work Output / Deliverable</option>
                          </>
                        ) : (
                          <>
                            <option value="OUTPUT">📦 Deliverable Output (Completed work)</option>
                            <option value="FOR_APPROVAL">⭐ Submit For Approval (Requires Admin Sign-off)</option>
                          </>
                        )}
                      </select>
                    </label>

                    <button
                      className="button primary"
                      disabled={attachBusy}
                      style={{ fontSize: "0.85rem", padding: "7px 16px", display: "inline-flex", alignItems: "center", gap: "6px" }}
                    >
                      <Upload size={14} />
                      {attachBusy
                        ? "Saving…"
                        : attachMode === "link"
                          ? "Attach Link"
                          : "Upload Document"}
                    </button>
                  </div>
                </form>
              </div>

              {/* 2. ATTACHMENTS LIST BELOW */}
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <h3 style={{ fontSize: "0.95rem", margin: 0, color: "#1e293b", fontWeight: 600 }}>
                  Attached Documents & Deliverables ({detail!.attachments?.length || 0})
                </h3>
                {detail!.attachments && detail!.attachments.length > 0 ? (
                  detail!.attachments.map((att) => {
                    const isForApproval = att.purpose === "FOR_APPROVAL";
                    const isPending = att.approvalStatus === "PENDING";
                    const isApproved = att.approvalStatus === "APPROVED";
                    const isRejected = att.approvalStatus === "REJECTED";

                    return (
                      <div
                        key={att.id}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                          padding: "14px 16px",
                          borderRadius: "8px",
                          background: "#f8fafc",
                          border: isPending
                            ? "1px solid #fed7aa"
                            : isApproved
                              ? "1px solid #bbf7d0"
                              : isRejected
                                ? "1px solid #fecaca"
                                : "1px solid #e2e8f0",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: "8px",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            {att.type === "LINK" ? (
                              <LinkIcon size={18} color="#2563eb" />
                            ) : (
                              <FileText size={18} color="#059669" />
                            )}
                            <a
                              href={att.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                fontWeight: 600,
                                color: "#1e293b",
                                textDecoration: "none",
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                            >
                              <span>{att.name}</span>
                              <ExternalLink size={13} color="#64748b" />
                            </a>
                            <span
                              style={{
                                fontSize: "0.75rem",
                                padding: "2px 8px",
                                borderRadius: "4px",
                                fontWeight: 500,
                                background:
                                  att.purpose === "REFERENCE"
                                    ? "#eff6ff"
                                    : att.purpose === "FOR_APPROVAL"
                                      ? "#fff7ed"
                                      : "#f0fdf4",
                                color:
                                  att.purpose === "REFERENCE"
                                    ? "#1d4ed8"
                                    : att.purpose === "FOR_APPROVAL"
                                      ? "#c2410c"
                                      : "#15803d",
                              }}
                            >
                              {att.purpose === "REFERENCE"
                                ? "Reference Material"
                                : att.purpose === "FOR_APPROVAL"
                                  ? "For Approval"
                                  : "Deliverable Output"}
                            </span>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            {isForApproval && (
                              <span
                                style={{
                                  fontSize: "0.75rem",
                                  padding: "2px 8px",
                                  borderRadius: "4px",
                                  fontWeight: 600,
                                  background: isPending
                                    ? "#fef3c7"
                                    : isApproved
                                      ? "#dcfce7"
                                      : "#fee2e2",
                                  color: isPending
                                    ? "#b45309"
                                    : isApproved
                                      ? "#166534"
                                      : "#b91c1c",
                                }}
                              >
                                {isPending
                                  ? "Pending Review"
                                  : isApproved
                                    ? "Approved"
                                    : "Changes Requested"}
                              </span>
                            )}
                            {(user.role === "admin" || att.uploaderId === user.id) && (
                              <button
                                className="icon-button"
                                title="Delete attachment"
                                onClick={async () => {
                                  try {
                                    await request("/api/workspace", {
                                      action: "deleteAttachment",
                                      attachmentId: att.id,
                                    });
                                    await load();
                                    notify("Attachment removed.");
                                  } catch (e) {
                                    setError((e as Error).message);
                                  }
                                }}
                              >
                                <Trash2 size={14} color="#94a3b8" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            fontSize: "0.8rem",
                            color: "#64748b",
                          }}
                        >
                          <span>
                            Uploaded by <strong>{att.uploaderName}</strong> · {date(att.createdAt)}
                          </span>
                          {att.fileSize ? (
                            <span>{(att.fileSize / 1024).toFixed(1)} KB</span>
                          ) : null}
                        </div>

                        {att.reviewNote && (
                          <div
                            style={{
                              fontSize: "0.85rem",
                              padding: "8px 12px",
                              borderRadius: "6px",
                              background: "#ffffff",
                              border: "1px solid #e2e8f0",
                            }}
                          >
                            <strong style={{ color: "#475569" }}>Admin Feedback:</strong>{" "}
                            {att.reviewNote}
                          </div>
                        )}

                        {user.role === "admin" && isForApproval && isPending && (
                          <div
                            style={{
                              display: "flex",
                              gap: "8px",
                              marginTop: "6px",
                              paddingTop: "8px",
                              borderTop: "1px dashed #fed7aa",
                            }}
                          >
                            <button
                              className="button primary"
                              style={{ fontSize: "0.8rem", padding: "4px 10px" }}
                              onClick={async () => {
                                const note =
                                  window.prompt("Optional approval feedback / comment:") ||
                                  undefined;
                                try {
                                  await request("/api/workspace", {
                                    action: "approveSubmission",
                                    attachmentId: att.id,
                                    note,
                                  });
                                  await load();
                                  notify("Deliverable approved!");
                                } catch (e) {
                                  setError((e as Error).message);
                                }
                              }}
                            >
                              <Check size={14} />
                              Approve Deliverable
                            </button>
                            <button
                              className="button"
                              style={{
                                fontSize: "0.8rem",
                                padding: "4px 10px",
                                color: "#dc2626",
                              }}
                              onClick={async () => {
                                const note = window.prompt(
                                  "Specify changes or reason for rejection:",
                                );
                                if (note === null) return;
                                try {
                                  await request("/api/workspace", {
                                    action: "rejectSubmission",
                                    attachmentId: att.id,
                                    note,
                                  });
                                  await load();
                                  notify("Changes requested on deliverable.");
                                } catch (e) {
                                  setError((e as Error).message);
                                }
                              }}
                            >
                              <X size={14} />
                              Request Changes
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="muted" style={{ textAlign: "center", padding: "16px 0" }}>
                    No documents, links, or deliverables attached yet. Use the upload box above to add
                    reference materials or submit deliverables.
                  </p>
                )}
              </div>
            </div>
          ) : tab === "Comments" ? (
            <>
              <div className="comments">
                {detail!.comments.length ? (
                  detail!.comments.map((c) => (
                    <div className="comment" key={c.id}>
                      <Avatar user={{ name: c.actorName }} small />
                      <div>
                        <strong>
                          {c.actorName}
                          <small>
                            {date(c.createdAt)} ·{" "}
                            {new Date(c.createdAt).toLocaleTimeString("en-IN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </small>
                        </strong>
                        <p>{c.text}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    Start the conversation. Share an update or ask a question.
                  </p>
                )}
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const f = new FormData(form);
                  setBusy(true);
                  setError("");
                  try {
                    await request("/api/workspace", {
                      action: "comment",
                      taskId: t.id,
                      text: f.get("text"),
                    });
                    form.reset();
                    await load();
                    await onSaved();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label className="sr-only" htmlFor="comment">
                  Add a comment
                </label>
                <textarea
                  id="comment"
                  name="text"
                  required
                  maxLength={3000}
                  placeholder="Write an update…"
                  rows={3}
                />
                <div className="comment-submit">
                  <span>Visible to you and your administrator.</span>
                  <button className="button primary" disabled={busy}>
                    Post comment
                    <ArrowUpRight size={15} />
                  </button>
                </div>
              </form>
            </>
          ) : (
            <ActivityList
              items={detail!.activity.slice().reverse()}
              onTask={() => {}}
            />
          )}
        </>
      )}
    </Modal>
  );
}
function ResetPassword({
  user,
  notify,
}: {
  user: User;
  notify: (s: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <button
        className="text-button muted"
        onClick={() => {
          setOpen(true);
          setPassword("");
          setError("");
        }}
      >
        Reset login
      </button>
      {open && (
        <Modal
          title={`Reset ${user.name}’s password`}
          onClose={() => setOpen(false)}
        >
          {password ? (
            <>
              <p>
                A new temporary password is ready. Share it privately with{" "}
                {user.name}. It must be changed at first login.
              </p>
              <div className="temporary-password">{password}</div>
              <button
                className="button primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(password);
                    notify("Temporary password copied.");
                  } catch {
                    setError("Copy the password shown above.");
                  }
                }}
              >
                Copy password
              </button>
            </>
          ) : (
            <>
              <p>
                Their current password will stop working and existing sessions
                will be signed out.
              </p>
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await request("/api/workspace", {
                      action: "resetPassword",
                      userId: user.id,
                    });
                    setPassword(r.password);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Resetting…" : "Generate temporary password"}
              </button>
            </>
          )}
          {error && <p className="error">{error}</p>}
        </Modal>
      )}
    </>
  );
}

function AddEmployeeModal({
  onClose,
  onSaved,
  notify,
}: {
  onClose: () => void;
  onSaved: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);

  return (
    <Modal title="Add team member" onClose={onClose}>
      {credentials ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <p className="modal-intro">
            Team member account created! Share these temporary login details:
          </p>
          <div style={{ background: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
            <p style={{ margin: "0 0 6px" }}><strong>Email:</strong> {credentials.email}</p>
            <p style={{ margin: "0" }}>
              <strong>Temporary Password:</strong>{" "}
              <code style={{ background: "#e2e8f0", padding: "2px 6px", borderRadius: "4px" }}>
                {credentials.password}
              </code>
            </p>
          </div>
          <button
            className="button primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`Email: ${credentials.email}\nPassword: ${credentials.password}`);
                notify("Credentials copied to clipboard.");
              } catch {
                notify("Copy credentials from above.");
              }
              onClose();
            }}
          >
            Copy credentials & close
          </button>
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              const res = await request("/api/workspace", {
                action: "createEmployee",
                employee: {
                  name: f.get("name"),
                  email: f.get("email"),
                  designation: f.get("designation"),
                  role: f.get("role"),
                },
              });
              setCredentials({ email: res.email, password: res.initialPassword });
              await onSaved();
              notify("Team member created.");
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="modal-intro">Manually provision a company domain email and add an employee to the CRM.</p>
          <label>
            Full Name <span className="required">*</span>
            <input name="name" placeholder="e.g. Aditi Roy" required minLength={2} maxLength={80} autoFocus />
          </label>
          <label>
            Company Domain Email <span className="required">*</span>
            <input
              name="email"
              type="email"
              placeholder="e.g. aditi@autoneural.in"
              required
            />
          </label>
          <div className="form-grid">
            <label>
              Designation / Job Title
              <input name="designation" placeholder="e.g. Technical Lead, Frontend Dev" maxLength={80} />
            </label>
            <label>
              Role
              <select name="role" defaultValue="employee">
                <option value="employee">Employee</option>
                <option value="admin">Administrator</option>
              </select>
            </label>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? "Creating…" : "Create team member"}
              <ArrowRight size={16} />
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function RequestRemovalModal({
  user,
  onClose,
  onSaved,
  notify,
}: {
  user: User;
  onClose: () => void;
  onSaved: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <Modal title={`Request removal of ${user.name}`} onClose={onClose}>
      <p className="modal-intro" style={{ color: "#b91c1c" }}>
        <strong>Dual-Admin Authorization Policy:</strong> Removal of an employee requires permission and approval from both admin accounts. Submitting this will alert the other administrator for sign-off.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            await request("/api/workspace", {
              action: "requestRemoval",
              employeeId: user.id,
              reason: f.get("reason"),
            });
            await onSaved();
            notify("Removal request submitted. Awaiting second admin approval.");
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Reason for removal <span className="optional">Optional</span>
          <textarea
            name="reason"
            placeholder="e.g. Contract completion, resignation, or role transition..."
            rows={3}
            maxLength={500}
            autoFocus
          />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            style={{ background: "#dc2626", borderColor: "#b91c1c" }}
            disabled={busy}
          >
            {busy ? "Submitting…" : "Submit Removal Request"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

