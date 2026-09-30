'use client';
import { useState } from 'react';
import { api, localInput, toIso, type Activity } from '@/lib/api';
import { DueInput, ErrorNote, Modal, useSubmit } from './ui';

export const CALL_OUTCOMES = [
  'Interested',
  'Needs more information',
  'Call back later',
  'Not interested',
  'No answer',
  'Wrong number',
];

/** Close a follow-up with its outcome, and (by default) line up the next one in the same step. */
export function CompleteDialog({
  activity,
  onClose,
  onDone,
}: {
  activity: Activity | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [outcome, setOutcome] = useState(CALL_OUTCOMES[0]);
  const [notes, setNotes] = useState('');
  const [scheduleNext, setScheduleNext] = useState(true);
  const [next, setNext] = useState(localInput(3));
  const { busy, error, run } = useSubmit();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api(`/crm/activities/${activity!.id}/complete`, 'POST', {
        outcome,
        notes: notes.trim() || undefined,
        nextFollowUpAt: scheduleNext ? toIso(next) : undefined,
      });
      onDone();
    });
  };

  return (
    <Modal open={!!activity} title="Complete follow-up" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {activity?.contact && (
          <p>
            <strong>{activity.contact.name}</strong> <span className="muted">· {activity.subject}</span>
          </p>
        )}
        <label>
          Outcome
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {CALL_OUTCOMES.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        <label>
          Notes <span className="hint">What did they say? What was promised?</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <label className="row" style={{ display: 'flex', fontWeight: 500 }}>
          <input
            type="checkbox"
            style={{ width: 'auto', minHeight: 0 }}
            checked={scheduleNext}
            onChange={(e) => setScheduleNext(e.target.checked)}
          />
          Schedule the next follow-up
        </label>
        {scheduleNext && <DueInput value={next} onChange={setNext} required />}
        <ErrorNote message={error} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Complete'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ScheduleDialog({
  contact,
  onClose,
  onDone,
}: {
  contact: { id: string; name: string } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [subject, setSubject] = useState('Follow-up call');
  const [due, setDue] = useState(localInput(1));
  const { busy, error, run } = useSubmit();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/crm/activities', 'POST', {
        contactId: contact!.id,
        type: 'FOLLOW_UP',
        subject: subject.trim(),
        dueAt: toIso(due),
      });
      onDone();
    });
  };

  return (
    <Modal open={!!contact} title={`Schedule follow-up${contact ? ` · ${contact.name}` : ''}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          What needs to happen
          <input value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={200} />
        </label>
        <label>
          When
          <DueInput value={due} onChange={setDue} required />
        </label>
        <ErrorNote message={error} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Schedule'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
