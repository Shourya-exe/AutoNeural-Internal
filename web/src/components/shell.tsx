'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext } from 'react';
import { CircleCheckBig, Columns3, LogOut, Users } from 'lucide-react';
import type { SessionUser } from '@/lib/session';

const UserContext = createContext<SessionUser | null>(null);
export const useUser = () => useContext(UserContext)!;

const NAV = [
  { href: '/', label: 'My work', icon: CircleCheckBig },
  { href: '/leads', label: 'Leads', icon: Users },
  { href: '/pipeline', label: 'Pipeline', icon: Columns3 },
];

export function Shell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const path = usePathname();
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href) || (href === '/leads' && path.startsWith('/contacts')));

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.assign('/login');
  }

  return (
    <UserContext.Provider value={user}>
      <div className="shell">
        <nav className="sidebar" aria-label="Main">
          <div className="brand">
            AutoNeural
            <small>Business OS</small>
          </div>
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="nav-link" aria-current={active(href) ? 'page' : undefined}>
              <Icon size={18} />
              {label}
            </Link>
          ))}
          <button className="nav-link signout-mobile" onClick={signOut}>
            <LogOut size={18} />
            Sign out
          </button>
          <div className="nav-foot">
            <div className="nav-user">
              <strong>{user.name}</strong>
              <div className="muted small">{user.role === 'ADMIN' ? 'Admin' : 'Team member'}</div>
            </div>
            <button className="nav-link" onClick={signOut}>
              <LogOut size={18} /> Sign out
            </button>
          </div>
        </nav>
        <main className="main">{children}</main>
      </div>
    </UserContext.Provider>
  );
}
