'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Trophy, X } from 'lucide-react';
import { useUser } from '@/components/shell';
import { Empty, ErrorNote, Modal, useSubmit } from '@/components/ui';
import { api, money, useApi, when, type Deal, type DealStatus, type Paginated, type Stage } from '@/lib/api';

export default function PipelinePage() {
  const [view, setView] = useState<DealStatus>('OPEN');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pipeline</h1>
          <p className="muted">Drag a deal to move it. New deals are opened from a lead's page.</p>
        </div>
        <div className="chips" role="group" aria-label="Deal status">
          {(['OPEN', 'WON', 'LOST'] as DealStatus[]).map((s) => (
            <button key={s} className="chip" aria-pressed={view === s} onClick={() => setView(s)}>
              {s === 'OPEN' ? 'Open' : s === 'WON' ? 'Won' : 'Lost'}
            </button>
          ))}
        </div>
      </div>
      {view === 'OPEN' ? <Board /> : <ClosedList status={view} />}
    </>
  );
}

function Board() {
  const admin = useUser().role === 'ADMIN';
  const stages = useApi<Stage[]>('/crm/stages');
  // ponytail: one page of 100 open deals; paginate per column when a team outgrows it.
  const deals = useApi<Paginated<Deal>>('/crm/deals?status=OPEN&limit=100');
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [losing, setLosing] = useState<Deal | null>(null);
  const [error, setError] = useState('');

  const patch = async (deal: Deal, body: object) => {
    setError('');
    try {
      await api(`/crm/deals/${deal.id}`, 'PATCH', body);
    } catch (e) {
      setError((e as Error).message);
    }
    await deals.reload();
  };

  const move = (deal: Deal, stageId: string) => {
    if (stageId === deal.stageId) return;
    // Optimistic: move the card now, reconcile on reload.
    deals.setData((d) => d && { ...d, data: d.data.map((x) => (x.id === deal.id ? { ...x, stageId } : x)) });
    void patch(deal, { stageId });
  };

  if ((stages.loading && !stages.data) || (deals.loading && !deals.data)) return <p className="muted">Loading…</p>;
  const all = deals.data?.data ?? [];

  return (
    <>
      <ErrorNote message={error || stages.error || deals.error} />
      {all.length === 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <Empty title="No open deals" hint="Open a lead and add a deal when there's a real opportunity." action={<Link href="/leads">Go to leads</Link>} />
        </div>
      )}
      <div className="board">
        {stages.data?.map((stage) => {
          const cards = all.filter((d) => d.stageId === stage.id);
          const total = cards.reduce((sum, d) => sum + Number(d.value), 0);
          return (
            <section
              key={stage.id}
              className={`column ${over === stage.id ? 'drop' : ''}`}
              aria-label={stage.name}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(stage.id);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const deal = all.find((d) => d.id === dragging);
                if (deal) move(deal, stage.id);
              }}
            >
              <div className="column-head">
                <strong>
                  {stage.name} <span className="muted small">{cards.length}</span>
                </strong>
                <span className="muted small">{money(total)}</span>
              </div>
              {cards.map((d) => (
                <article
                  key={d.id}
                  className="deal-card"
                  draggable
                  onDragStart={() => setDragging(d.id)}
                  onDragEnd={() => setDragging(null)}
                >
                  <div className="row">
                    <strong className="grow">{d.title}</strong>
                    <span className="value">{money(d.value)}</span>
                  </div>
                  {d.contact && (
                    <Link href={`/contacts/${d.contact.id}`} className="small">
                      {d.contact.name}
                    </Link>
                  )}
                  <div className="muted small">
                    {admin && d.owner ? `${d.owner.name} · ` : ''}
                    {d.expectedCloseDate ? `Close ${when(d.expectedCloseDate).split(',')[0]}` : `Updated ${when(d.updatedAt).split(',')[0]}`}
                  </div>
                  <div className="row">
                    <select
                      aria-label={`Stage for ${d.title}`}
                      value={d.stageId}
                      onChange={(e) => move(d, e.target.value)}
                      style={{ minHeight: 30, padding: '2px 6px', flex: 1 }}
                    >
                      {stages.data!.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <button className="btn btn-sm btn-ok" onClick={() => patch(d, { status: 'WON' })} aria-label={`Mark ${d.title} won`}>
                      <Trophy size={14} /> Won
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => setLosing(d)} aria-label={`Mark ${d.title} lost`}>
                      <X size={14} /> Lost
                    </button>
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
      <LostDialog
        key={losing?.id ?? 'none'}
        deal={losing}
        onClose={() => setLosing(null)}
        onDone={() => {
          setLosing(null);
          void deals.reload();
        }}
      />
    </>
  );
}

const LOST_REASONS = ['Price too high', 'Chose a competitor', 'No budget', 'No response', 'Requirement changed'];

function LostDialog({ deal, onClose, onDone }: { deal: Deal | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { busy, error, run } = useSubmit();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api(`/crm/deals/${deal!.id}`, 'PATCH', { status: 'LOST', lostReason: reason.trim() });
      onDone();
    });
  };
  return (
    <Modal open={!!deal} title={`Mark lost · ${deal?.title ?? ''}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Why was it lost? <span className="hint">Lost reasons show where the pipeline leaks.</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} autoFocus />
        </label>
        <div className="chips">
          {LOST_REASONS.map((r) => (
            <button key={r} type="button" className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
        <ErrorNote message={error} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !reason.trim()}>
            {busy ? 'Saving…' : 'Mark lost'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ClosedList({ status }: { status: DealStatus }) {
  const { data, error, loading, reload } = useApi<Paginated<Deal>>(`/crm/deals?status=${status}&limit=50`);
  const [reopenError, setReopenError] = useState('');
  const total = data?.data.reduce((s, d) => s + Number(d.value), 0) ?? 0;

  const reopen = async (d: Deal) => {
    try {
      await api(`/crm/deals/${d.id}`, 'PATCH', { status: 'OPEN' });
      await reload();
    } catch (e) {
      setReopenError((e as Error).message);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>{status === 'WON' ? 'Won deals' : 'Lost deals'}</h2>
        {data && <span className="muted">{money(total)}</span>}
      </div>
      <ErrorNote message={error || reopenError} />
      {loading && !data ? (
        <p className="muted card-pad">Loading…</p>
      ) : data?.data.length ? (
        <ul className="list">
          {data.data.map((d) => (
            <li key={d.id}>
              <div className="grow">
                <strong>{d.title}</strong>
                <div className="muted small">
                  {d.contact && <Link href={`/contacts/${d.contact.id}`}>{d.contact.name}</Link>}
                  {d.closedAt ? ` · ${when(d.closedAt).split(',')[0]}` : ''}
                  {d.lostReason ? ` · ${d.lostReason}` : ''}
                </div>
              </div>
              <strong>{money(d.value)}</strong>
              <button className="btn btn-sm" onClick={() => reopen(d)}>
                Reopen
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title={status === 'WON' ? 'No won deals yet' : 'No lost deals'} />
      )}
    </section>
  );
}
