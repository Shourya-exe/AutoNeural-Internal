import { redirect } from 'next/navigation';
import { getUser } from '@/lib/session';
import { Shell } from '@/components/shell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');
  return <Shell user={user}>{children}</Shell>;
}
