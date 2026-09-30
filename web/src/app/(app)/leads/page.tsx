'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useUser } from '@/components/shell';
import { OwnerSelect } from '@/components/owner-select';
import { DueInput, Empty, ErrorNote, Modal, StatusBadge, useSubmit } from '@/components/ui';
import {
  ApiError,
  SOURCE_LABEL,
  STATUS_LABEL,
  api,
  localInput,
  toIso,
  useApi,
  when,
  type Contact,
  type LeadSource,
  type LeadStatus,
  type Paginated,
} from '@/lib/api';

const FILTERS: (LeadStatus | 'ALL')[] = ['ALL', 'NEW', 'CONTACTED', 'QUALIFIED', 'CUSTOMER', 'UNQUALIFIED'];

export default function LeadsPage() {
  return (
    <Suspense>
      <Leads />
    </Suspense>
  );
}

function Leads() {
  const params = useSearchParams();
  const router = useRouter();
  const admin = useUser().role === 'ADMIN';
  const [status, setStatus] = useState<LeadStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(params.get('new') === '1');

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const qs = new URLSearchParams({ page: String(page), limit: '25' });
  if (status !== 'ALL') qs.set('leadStatus', status);
  if (debounced) qs.set('search', debounced);
  const { data, error, loading } = useApi<Paginated<Contact>>(`/crm/contacts?${qs}`);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Leads & customers</h1>
          <p className="muted">{data ? `${data.meta.total} ${data.meta.total === 1 ? 'contact' : 'contacts'}` : ' '}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> New lead
        </button>
      </div>

      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div className="row grow" style={{ position: 'relative', maxWidth: 340 }}>
            <Search size={16} className="muted" style={{ position: 'absolute', left: 10 }} />
            <input
              type="search"
              placeholder="Search name, phone or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 32 }}
              aria-label="Search leads"
            />
          </div>
          <div className="chips" role="group" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <button
                key={f}
                className="chip"
                aria-pressed={status === f}
                onClick={() => {
                  setStatus(f);
                  setPage(1);
                }}
              >
                {f === 'ALL' ? 'All' : STATUS_LABEL[f]}
              </button>
            ))}
          </div>
        </div>

        <ErrorNote message={error} />
        {loading && !data ? (
          <p className="muted card-pad">Loading…</p>
        ) : data && data.data.length === 0 ? (
          <Empty
            title={debounced || status !== 'ALL' ? 'No matching contacts' : 'No leads yet'}
            hint={debounced || status !== 'ALL' ? 'Try another search or filter.' : 'Add your first lead to start tracking follow-ups.'}
          />
        ) : (
          data && (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="hide-mobile">Phone / email</th>
                    <th className="hide-mobile">Source</th>
                    <th>Status</th>
                    {admin && <th className="hide-mobile">Owner</th>}
                    <th className="hide-mobile">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((c) => (
                    <tr key={c.id} onClick={() => router.push(`/contacts/${c.id}`)} style={{ cursor: 'pointer' }}>
                      <td>
                        <Link href={`/contacts/${c.id}`} onClick={(e) => e.stopPropagation()}>
                          <strong>{c.name}</strong>
                        </Link>
                        {c.account && <div className="muted small">{c.account.name}</div>}
                        <div className="muted small only-mobile">{c.phone ?? c.email}</div>
                      </td>
                      <td className="hide-mobile">{c.phone ?? c.email}</td>
                      <td className="hide-mobile">{SOURCE_LABEL[c.source]}</td>
                      <td>
                        <StatusBadge status={c.leadStatus} />
                      </td>
                      {admin && <td className="hide-mobile">{c.owner?.name ?? <span className="muted">Unassigned</span>}</td>}
                      <td className="hide-mobile muted">{when(c.createdAt).split(',')[0]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.meta.totalPages > 1 && (
                <div className="pager">
                  <button className="btn btn-sm" disabled={!data.meta.hasPreviousPage} onClick={() => setPage(page - 1)}>
                    Previous
                  </button>
                  <span className="muted small">
                    Page {data.meta.page} of {data.meta.totalPages}
                  </span>
                  <button className="btn btn-sm" disabled={!data.meta.hasNextPage} onClick={() => setPage(page + 1)}>
                    Next
                  </button>
                </div>
              )}
            </>
          )
        )}
      </div>

      <NewLeadDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => router.push(`/contacts/${id}`)} />
    </>
  );
}

function NewLeadDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const user = useUser();
  const [form, setForm] = useState({ name: '', phone: '', email: '', source: 'MANUAL' as LeadSource, ownerId: user.id });
  const [followUp, setFollowUp] = useState(localInput(1));
  const [existingId, setExistingId] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setExistingId(null);
    run(async () => {
      try {
        const created = await api<Contact>('/crm/contacts', 'POST', {
          name: form.name.trim(),
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          source: form.source,
          ownerId: form.ownerId,
          followUpAt: toIso(followUp),
        });
        onCreated(created.id);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) setExistingId(err.data?.existingId ?? null);
        throw err;
      }
    });
  };

  return (
    <Modal open={open} title="New lead" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Name
          <input value={form.name} onChange={set('name')} required minLength={2} maxLength={120} autoFocus />
        </label>
        <div className="grid2">
          <label>
            Phone
            <input type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} placeholder="98765 43210" />
          </label>
          <label>
            Email
            <input type="email" value={form.email} onChange={set('email')} />
          </label>
        </div>
        <div className="grid2">
          <label>
            Source
            <select value={form.source} onChange={set('source')}>
              {(Object.keys(SOURCE_LABEL) as LeadSource[])
                .filter((s) => s !== 'IMPORT')
                .map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABEL[s]}
                  </option>
                ))}
            </select>
          </label>
          {user.role === 'ADMIN' && (
            <label>
              Owner
              <OwnerSelect value={form.ownerId} onChange={(ownerId) => setForm({ ...form, ownerId })} />
            </label>
          )}
        </div>
        <label>
          First follow-up <span className="hint">Every new lead gets a next action.</span>
          <DueInput value={followUp} onChange={setFollowUp} required />
        </label>
        <ErrorNote message={error} />
        {existingId && (
          <Link href={`/contacts/${existingId}`} className="btn btn-sm" onClick={onClose}>
            Open the existing contact
          </Link>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || (!form.phone.trim() && !form.email.trim())}>
            {busy ? 'Saving…' : 'Create lead'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
