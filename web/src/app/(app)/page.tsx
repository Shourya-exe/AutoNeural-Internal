'use client';
import Link from 'next/link';
import { useState } from 'react';
import { CalendarPlus, Check, Phone } from 'lucide-react';
import { useUser } from '@/components/shell';
import { CompleteDialog, ScheduleDialog } from '@/components/followups';
import { Empty, ErrorNote, StatusBadge } from '@/components/ui';
import { useApi, when, type Activity, type Contact } from '@/lib/api';

type Attention = { overdue: Activity[]; upcoming: Activity[]; noNextAction: Contact[] };

export default function MyWorkPage() {
  const user = useUser();
  const admin = user.role === 'ADMIN';
  const { data, error, loading, reload } = useApi<Attention>('/crm/attention');
  const [completing, setCompleting] = useState<Activity | null>(null);
  const [scheduling, setScheduling] = useState<Contact | null>(null);

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  })();
  const dueToday = data?.upcoming.filter((a) => new Date(a.dueAt!).toDateString() === new Date().toDateString()).length ?? 0;

  const FollowUpRow = ({ a, overdue }: { a: Activity; overdue?: boolean }) => (
    <li>
      <div className="grow">
        <Link href={`/contacts/${a.contact!.id}`} className="who">
          {a.contact!.name}
        </Link>
        <div className="muted small">
          {a.subject}
          {admin && a.owner ? ` · ${a.owner.name}` : ''}
        </div>
      </div>
      <span className={overdue ? 'badge badge-overdue' : 'muted small'}>{when(a.dueAt!)}</span>
      {a.contact!.phone && (
        <a className="icon-btn" href={`tel:${a.contact!.phone}`} aria-label={`Call ${a.contact!.name}`}>
          <Phone size={16} />
        </a>
      )}
      <button className="btn btn-sm" onClick={() => setCompleting(a)}>
        <Check size={15} /> Done
      </button>
    </li>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            {greeting}, {user.name.split(' ')[0]}
          </h1>
          <p className="muted">{admin ? "Your team's follow-ups and leads that need attention." : 'Your follow-ups and leads that need attention.'}</p>
        </div>
        <Link href="/leads?new=1" className="btn btn-primary">
          New lead
        </Link>
      </div>

      <ErrorNote message={error} />

      <div className="stats">
        <div className="card stat danger">
          <strong>{data?.overdue.length ?? '–'}</strong>
          <span className="muted">Overdue</span>
        </div>
        <div className="card stat warn">
          <strong>{data?.noNextAction.length ?? '–'}</strong>
          <span className="muted">No next action</span>
        </div>
        <div className="card stat">
          <strong>{data ? dueToday : '–'}</strong>
          <span className="muted">Due today</span>
        </div>
      </div>

      {loading && !data ? (
        <p className="muted">Loading…</p>
      ) : (
        data && (
          <div className="stack">
            <section className="card">
              <div className="card-head">
                <h2>Overdue follow-ups</h2>
              </div>
              {data.overdue.length ? (
                <ul className="list">
                  {data.overdue.map((a) => (
                    <FollowUpRow key={a.id} a={a} overdue />
                  ))}
                </ul>
              ) : (
                <Empty title="Nothing overdue" hint="Every follow-up is on time." />
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Leads with no next action</h2>
                <span className="muted small hide-mobile">Every open lead should have a scheduled follow-up</span>
              </div>
              {data.noNextAction.length ? (
                <ul className="list">
                  {data.noNextAction.map((c) => (
                    <li key={c.id}>
                      <div className="grow">
                        <Link href={`/contacts/${c.id}`} className="who">
                          {c.name}
                        </Link>
                        <div className="muted small">
                          {c.phone ?? c.email}
                          {admin && ` · ${c.owner?.name ?? 'Unassigned'}`}
                        </div>
                      </div>
                      <StatusBadge status={c.leadStatus} />
                      <button className="btn btn-sm" onClick={() => setScheduling(c)}>
                        <CalendarPlus size={15} /> Schedule
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty title="Every open lead has a next action" />
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Next 7 days</h2>
              </div>
              {data.upcoming.length ? (
                <ul className="list">
                  {data.upcoming.map((a) => (
                    <FollowUpRow key={a.id} a={a} />
                  ))}
                </ul>
              ) : (
                <Empty title="No follow-ups scheduled this week" />
              )}
            </section>
          </div>
        )
      )}

      <CompleteDialog
        key={completing?.id ?? 'none'}
        activity={completing}
        onClose={() => setCompleting(null)}
        onDone={() => {
          setCompleting(null);
          void reload();
        }}
      />
      <ScheduleDialog
        key={scheduling?.id ?? 'none-s'}
        contact={scheduling}
        onClose={() => setScheduling(null)}
        onDone={() => {
          setScheduling(null);
          void reload();
        }}
      />
    </>
  );
}
