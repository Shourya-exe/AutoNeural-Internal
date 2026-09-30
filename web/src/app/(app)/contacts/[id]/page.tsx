'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  ArrowLeft,
  CalendarClock,
  Check,
  Handshake,
  Mail,
  MessageCircle,
  NotebookPen,
  Phone,
  Plus,
  Settings2,
  Users,
} from 'lucide-react';
import { useUser } from '@/components/shell';
import { OwnerSelect } from '@/components/owner-select';
import { CALL_OUTCOMES, CompleteDialog } from '@/components/followups';
import { DueInput, Empty, ErrorNote, StatusBadge, useSubmit } from '@/components/ui';
import {
  SOURCE_LABEL,
  STATUS_LABEL,
  api,
  localInput,
  money,
  toIso,
  useApi,
  when,
  whatsappLink,
  type Activity,
  type ActivityType,
  type Contact,
  type LeadStatus,
  type Stage,
} from '@/lib/api';

type Timeline = { contact: Contact; nextAction: Activity | null; activities: Activity[] };

const ICON: Record<ActivityType, typeof Phone> = {
  CALL: Phone,
  WHATSAPP: MessageCircle,
  EMAIL: Mail,
  MEETING: Users,
  NOTE: NotebookPen,
  FOLLOW_UP: CalendarClock,
  SYSTEM: Settings2,
};

export default function ContactPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<Timeline>(`/crm/contacts/${id}/timeline`);
  const [completing, setCompleting] = useState<Activity | null>(null);

  if (loading && !data) return <p className="muted">Loading…</p>;
  if (!data)
    return (
      <>
        <BackLink />
        <ErrorNote message={error || 'Contact not found.'} />
      </>
    );

  const { contact: c, nextAction, activities } = data;
  const overdue = nextAction && new Date(nextAction.dueAt!) < new Date();

  return (
    <>
      <BackLink />
      <div className="page-head">
        <div>
          <div className="row">
            <h1>{c.name}</h1>
            <StatusBadge status={c.leadStatus} />
          </div>
          <p className="muted">
            {c.account ? `${c.account.name} · ` : ''}
            {SOURCE_LABEL[c.source]} lead · added {when(c.createdAt).split(',')[0]}
          </p>
        </div>
        <div className="row">
          {c.phone && (
            <>
              <a className="btn" href={`tel:${c.phone}`}>
                <Phone size={16} /> Call
              </a>
              <a className="btn" href={whatsappLink(c.phone)} target="_blank" rel="noopener noreferrer">
                <MessageCircle size={16} /> WhatsApp
              </a>
            </>
          )}
          {c.email && (
            <a className="btn" href={`mailto:${c.email}`}>
              <Mail size={16} /> Email
            </a>
          )}
        </div>
      </div>

      <div className="c360">
        <div className="stack">
          {nextAction ? (
            <section className={`card card-pad next-action ${overdue ? 'overdue' : ''}`}>
              <div className="row">
                <div className="grow">
                  <h3>Next action</h3>
                  <p style={{ marginTop: 4 }}>
                    <strong>{nextAction.subject}</strong>{' '}
                    <span className={overdue ? 'badge badge-overdue' : 'muted'}>{when(nextAction.dueAt!)}</span>
                  </p>
                  {nextAction.owner && <p className="muted small">Owner: {nextAction.owner.name}</p>}
                </div>
                <button className="btn" onClick={() => setCompleting({ ...nextAction, contact: { id: c.id, name: c.name, phone: c.phone } })}>
                  <Check size={16} /> Done
                </button>
              </div>
            </section>
          ) : (
            ['NEW', 'CONTACTED', 'QUALIFIED'].includes(c.leadStatus) && (
              <section className="card card-pad next-action overdue">
                <h3>No next action</h3>
                <p className="muted" style={{ marginTop: 4 }}>
                  This open lead has nothing scheduled. Log what happened or schedule a follow-up below.
                </p>
              </section>
            )
          )}

          <Composer contactId={c.id} onSaved={reload} />

          <section className="card">
            <div className="card-head">
              <h2>Timeline</h2>
              <span className="muted small">{activities.length} entries</span>
            </div>
            {activities.length ? (
              <ol className="timeline">
                {activities.map((a) => {
                  const Icon = ICON[a.type];
                  const pending = !a.completedAt;
                  return (
                    <li key={a.id}>
                      <span className={`tl-icon ${pending ? 'pending' : ''}`}>
                        <Icon size={15} />
                      </span>
                      <div className={a.type === 'SYSTEM' ? 'tl-system' : ''}>
                        <div>
                          <strong style={{ fontWeight: a.type === 'SYSTEM' ? 400 : 600 }}>{a.subject}</strong>
                          {a.outcome && <span className="badge" style={{ marginLeft: 8 }}>{a.outcome}</span>}
                          {pending && a.dueAt && <span className="badge badge-new" style={{ marginLeft: 8 }}>Due {when(a.dueAt)}</span>}
                        </div>
                        {a.notes && <p className="tl-notes">{a.notes}</p>}
                        <p className="muted small">
                          {when(a.completedAt ?? a.createdAt)}
                          {a.createdBy ? ` · ${a.createdBy.name}` : ''}
                          {a.deal ? ` · ${a.deal.title}` : ''}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <Empty title="No activity yet" />
            )}
          </section>
        </div>

        <div className="stack">
          <Details contact={c} onSaved={reload} />
          <Deals contact={c} onSaved={reload} />
        </div>
      </div>

      <CompleteDialog
        key={completing?.id ?? 'none'}
        activity={completing}
        onClose={() => setCompleting(null)}
        onDone={() => {
          setCompleting(null);
          void reload();
        }}
      />
    </>
  );
}

function BackLink() {
  return (
    <Link href="/leads" className="muted small row" style={{ marginBottom: 10, display: 'inline-flex' }}>
      <ArrowLeft size={14} /> Leads
    </Link>
  );
}

const MODES: { type: ActivityType; label: string; subject: string }[] = [
  { type: 'CALL', label: 'Log call', subject: 'Call' },
  { type: 'WHATSAPP', label: 'WhatsApp', subject: 'WhatsApp conversation' },
  { type: 'MEETING', label: 'Meeting', subject: 'Meeting' },
  { type: 'NOTE', label: 'Note', subject: 'Note' },
  { type: 'FOLLOW_UP', label: 'Schedule follow-up', subject: 'Follow-up call' },
];

/** One place to record what happened (manual first) and line up what happens next. */
function Composer({ contactId, onSaved }: { contactId: string; onSaved: () => void }) {
  const [mode, setMode] = useState(MODES[0]);
  const [subject, setSubject] = useState(MODES[4].subject);
  const [outcome, setOutcome] = useState(CALL_OUTCOMES[0]);
  const [notes, setNotes] = useState('');
  const [scheduleNext, setScheduleNext] = useState(false);
  const [due, setDue] = useState(localInput(1));
  const { busy, error, run } = useSubmit();
  const scheduling = mode.type === 'FOLLOW_UP';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (scheduling) {
        await api('/crm/activities', 'POST', { contactId, type: 'FOLLOW_UP', subject: subject.trim(), notes: notes.trim() || undefined, dueAt: toIso(due) });
      } else {
        await api('/crm/activities', 'POST', {
          contactId,
          type: mode.type,
          subject: mode.subject,
          outcome: mode.type === 'CALL' ? outcome : undefined,
          notes: notes.trim() || undefined,
        });
        if (scheduleNext) {
          await api('/crm/activities', 'POST', { contactId, type: 'FOLLOW_UP', subject: 'Follow-up', dueAt: toIso(due) });
        }
      }
      setNotes('');
      setScheduleNext(false);
      onSaved();
    });
  };

  return (
    <section className="card">
      <div className="tabs" role="tablist">
        {MODES.map((m) => {
          const Icon = ICON[m.type];
          return (
            <button key={m.type} role="tab" type="button" className="tab" aria-selected={mode.type === m.type} onClick={() => setMode(m)}>
              <Icon size={15} /> {m.label}
            </button>
          );
        })}
      </div>
      <form className="form" style={{ padding: 16 }} onSubmit={submit}>
        {scheduling && (
          <label>
            What needs to happen
            <input value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={200} />
          </label>
        )}
        {mode.type === 'CALL' && (
          <label>
            Call outcome
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {CALL_OUTCOMES.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          {mode.type === 'NOTE' ? 'Note' : 'Notes'}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            required={mode.type === 'NOTE'}
            maxLength={5000}
            placeholder={scheduling ? 'Optional context for whoever makes the follow-up' : 'Requirements, objections, promises made…'}
          />
        </label>
        {!scheduling && (
          <label className="row" style={{ display: 'flex', fontWeight: 500 }}>
            <input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={scheduleNext} onChange={(e) => setScheduleNext(e.target.checked)} />
            Also schedule the next follow-up
          </label>
        )}
        {(scheduling || scheduleNext) && <DueInput value={due} onChange={setDue} required />}
        <ErrorNote message={error} />
        <div className="actions">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : scheduling ? 'Schedule' : 'Save'}
          </button>
        </div>
      </form>
    </section>
  );
}

function Details({ contact: c, onSaved }: { contact: Contact; onSaved: () => void }) {
  const admin = useUser().role === 'ADMIN';
  const [status, setStatus] = useState<LeadStatus>(c.leadStatus);
  const [reason, setReason] = useState(c.lostReason ?? '');
  const { busy, error, run } = useSubmit();
  const needsReason = status === 'UNQUALIFIED' && status !== c.leadStatus;

  const save = (body: object) =>
    run(async () => {
      await api(`/crm/contacts/${c.id}`, 'PATCH', body);
      onSaved();
    });

  return (
    <section className="card">
      <div className="card-head">
        <h2>Details</h2>
      </div>
      <dl className="kv card-pad" style={{ margin: 0 }}>
        <dt>Phone</dt>
        <dd>{c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : <span className="muted">—</span>}</dd>
        <dt>Email</dt>
        <dd style={{ overflowWrap: 'anywhere' }}>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : <span className="muted">—</span>}</dd>
        <dt>Status</dt>
        <dd>
          <select
            value={status}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value as LeadStatus;
              setStatus(next);
              if (next !== 'UNQUALIFIED' && next !== c.leadStatus) save({ leadStatus: next });
            }}
          >
            {(Object.keys(STATUS_LABEL) as LeadStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </dd>
        {needsReason && (
          <>
            <dt>Reason</dt>
            <dd className="row">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why unqualified?" maxLength={500} />
              <button className="btn btn-sm" disabled={busy || !reason.trim()} onClick={() => save({ leadStatus: status, lostReason: reason.trim() })}>
                Save
              </button>
            </dd>
          </>
        )}
        {c.lostReason && c.leadStatus === 'UNQUALIFIED' && (
          <>
            <dt>Reason</dt>
            <dd>{c.lostReason}</dd>
          </>
        )}
        <dt>Owner</dt>
        <dd>
          {admin ? (
            <OwnerSelect value={c.ownerId ?? ''} onChange={(ownerId) => save({ ownerId })} />
          ) : (
            (c.owner?.name ?? 'Unassigned')
          )}
        </dd>
      </dl>
      <div style={{ padding: '0 16px 16px' }}>
        <ErrorNote message={error} />
      </div>
    </section>
  );
}

function Deals({ contact: c, onSaved }: { contact: Contact; onSaved: () => void }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [stageId, setStageId] = useState('');
  const { data: stages } = useApi<Stage[]>(adding ? '/crm/stages' : null);
  const { busy, error, run } = useSubmit();
  const deals = c.deals ?? [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/crm/deals', 'POST', {
        contactId: c.id,
        title: title.trim(),
        value: value ? Number(value) : undefined,
        stageId: stageId || undefined,
      });
      setAdding(false);
      setTitle('');
      setValue('');
      onSaved();
    });
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Deals</h2>
        {!adding && (
          <button className="btn btn-sm" onClick={() => setAdding(true)}>
            <Plus size={15} /> New deal
          </button>
        )}
      </div>
      {adding && (
        <form className="form card-pad" onSubmit={submit} style={{ borderBottom: '1px solid var(--border)' }}>
          <label>
            Deal
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Website redesign" required minLength={2} maxLength={160} autoFocus />
          </label>
          <div className="grid2">
            <label>
              Value (₹)
              <input type="number" inputMode="numeric" min={0} step="1" value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
            <label>
              Stage
              <select value={stageId} onChange={(e) => setStageId(e.target.value)}>
                {stages?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ErrorNote message={error} />
          <div className="actions">
            <button type="button" className="btn" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Create deal'}
            </button>
          </div>
        </form>
      )}
      {deals.length ? (
        <ul className="list">
          {deals.map((d) => (
            <li key={d.id}>
              <Handshake size={16} className="muted" />
              <div className="grow">
                <strong>{d.title}</strong>
                <div className="muted small">
                  {d.status === 'OPEN' ? d.stage.name : d.status === 'WON' ? 'Won' : `Lost${d.lostReason ? ` · ${d.lostReason}` : ''}`}
                </div>
              </div>
              <span className={d.status === 'WON' ? 'badge badge-customer' : d.status === 'LOST' ? 'badge' : ''}>{money(d.value)}</span>
            </li>
          ))}
        </ul>
      ) : (
        !adding && <Empty title="No deals yet" hint="Open a deal when there's a real opportunity." />
      )}
      {deals.some((d) => d.status === 'OPEN') && (
        <div className="card-pad" style={{ paddingTop: 0 }}>
          <Link href="/pipeline" className="small">
            Move deals in the pipeline →
          </Link>
        </div>
      )}
    </section>
  );
}
