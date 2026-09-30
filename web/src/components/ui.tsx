'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { STATUS_LABEL, localInput, type LeadStatus } from '@/lib/api';

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} onCancel={onClose}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {open && children}
    </dialog>
  );
}

export function StatusBadge({ status }: { status: LeadStatus }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{STATUS_LABEL[status]}</span>;
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {hint && <p className="muted">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return message ? (
    <p className="error" role="alert">
      {message}
    </p>
  ) : null;
}

/** datetime-local with one-tap presets, since most follow-ups are "tomorrow" or "next week". */
export function DueInput({ value, onChange, required }: { value: string; onChange: (v: string) => void; required?: boolean }) {
  const presets: [string, number][] = [
    ['Tomorrow', 1],
    ['In 3 days', 3],
    ['Next week', 7],
  ];
  return (
    <div className="due">
      <input type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} required={required} />
      <div className="chips">
        {presets.map(([label, days]) => (
          <button key={label} type="button" className="chip" onClick={() => onChange(localInput(days))}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Wraps an async submit with busy/error state. */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}
