'use client';
import { useApi, type Paginated, type Person } from '@/lib/api';

/** Admin-only picker of active team members (employees endpoint is admin-only). */
export function OwnerSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { data } = useApi<Paginated<Person>>('/employees?status=ACTIVE&limit=100');
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {!data && <option value={value}>Loading…</option>}
      {data?.data.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
