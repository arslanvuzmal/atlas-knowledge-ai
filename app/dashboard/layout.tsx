import { redirect } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard/shell';
import { NAV_GROUPS } from '@/components/dashboard/nav';
import { getSession } from '@/lib/auth/session';
import { ROLE_LABELS, hasPermission } from '@/lib/auth/rbac';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session.isAuthenticated || !session.user) redirect('/login');

  // The sidebar only offers what this role can actually open. Each page repeats
  // the check independently.
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => hasPermission(session.role, item.permission)),
  })).filter((group) => group.items.length > 0);

  return (
    <DashboardShell
      groups={groups}
      demoMode={env().DEMO_MODE}
      user={{
        name: session.user.name,
        email: session.user.email,
        roleLabel: ROLE_LABELS[session.role],
      }}
    >
      {children}
    </DashboardShell>
  );
}
