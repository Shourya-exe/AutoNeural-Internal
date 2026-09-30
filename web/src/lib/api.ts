'use client';
import { useCallback, useEffect, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, message: string, public data: any) {
    super(message);
  }
}

/** Browser → /api/b/* proxy → NestJS. Redirects to sign-in when the session is gone. */
export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api/b${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401) {
    window.location.assign('/login');
    throw new ApiError(401, 'Please sign in again.', data);
  }
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message[0] : data?.message;
    throw new ApiError(res.status, msg || 'Something went wrong. Please try again.', data);
  }
  return data as T;
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

// ─── Types mirrored from backend/prisma/schema.prisma ─────────────────────────

export type LeadStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'UNQUALIFIED' | 'CUSTOMER';
export type LeadSource = 'MANUAL' | 'WEBSITE' | 'FACEBOOK' | 'WHATSAPP' | 'CALL' | 'REFERRAL' | 'IMPORT' | 'OTHER';
export type ActivityType = 'NOTE' | 'CALL' | 'WHATSAPP' | 'EMAIL' | 'MEETING' | 'FOLLOW_UP' | 'SYSTEM';
export type DealStatus = 'OPEN' | 'WON' | 'LOST';
export type Person = { id: string; name: string };
export type Stage = { id: string; name: string; position: number; probability: number };

export type Contact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: LeadSource;
  leadStatus: LeadStatus;
  lostReason: string | null;
  ownerId: string | null;
  owner: Person | null;
  account: { id: string; name: string } | null;
  createdAt: string;
  deals?: Deal[];
};

export type Deal = {
  id: string;
  title: string;
  value: string;
  status: DealStatus;
  stageId: string;
  stage: Stage;
  owner: Person | null;
  contact?: { id: string; name: string; phone: string | null };
  expectedCloseDate: string | null;
  closedAt: string | null;
  lostReason: string | null;
  updatedAt: string;
};

export type Activity = {
  id: string;
  type: ActivityType;
  subject: string;
  notes: string | null;
  outcome: string | null;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  owner: Person | null;
  createdBy?: Person;
  deal?: { id: string; title: string } | null;
  contact?: { id: string; name: string; phone: string | null };
};

export type Paginated<T> = {
  data: T[];
  meta: { total: number; page: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean };
};

// ─── Formatting ──────────────────────────────────────────────────────────────

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const money = (v: string | number) => inr.format(Number(v) || 0);

export function when(iso: string) {
  const d = new Date(iso);
  const day = new Date(d).setHours(0, 0, 0, 0);
  const today = new Date().setHours(0, 0, 0, 0);
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const diff = Math.round((day - today) / 86400_000);
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Tomorrow, ${time}`;
  if (diff === -1) return `Yesterday, ${time}`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: diff < -300 || diff > 300 ? 'numeric' : undefined }) + `, ${time}`;
}

/** Value for <input type="datetime-local"> n days from now at the given hour. */
export function localInput(daysAhead: number, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const toIso = (local: string) => new Date(local).toISOString();

export const STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  UNQUALIFIED: 'Unqualified',
  CUSTOMER: 'Customer',
};
export const SOURCE_LABEL: Record<LeadSource, string> = {
  MANUAL: 'Manual',
  WEBSITE: 'Website',
  FACEBOOK: 'Facebook',
  WHATSAPP: 'WhatsApp',
  CALL: 'Phone call',
  REFERRAL: 'Referral',
  IMPORT: 'Import',
  OTHER: 'Other',
};

/** wa.me link for manual WhatsApp (Indian 10-digit numbers get +91). */
export function whatsappLink(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}`;
}
