'use client';
import { useState } from 'react';
import { ErrorNote } from '@/components/ui';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
    }).catch(() => null);
    if (res?.ok) return window.location.assign('/');
    const body = await res?.json().catch(() => null);
    setError(body?.message ?? 'Sign-in failed. Check your connection.');
    setBusy(false);
  }

  return (
    <main className="login">
      <form className="card form" onSubmit={submit}>
        <div>
          <h1>AutoNeural</h1>
          <p className="muted">Sign in to your workspace</p>
        </div>
        <label>
          Work email
          <input name="email" type="email" autoComplete="email" required autoFocus />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <ErrorNote message={error} />
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
