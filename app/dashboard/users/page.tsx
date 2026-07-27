import type { Metadata } from 'next';
import { AccessDenied } from '@/components/dashboard/access-denied';
import { UserControls } from '@/components/dashboard/controls';
import { Badge, Cell, DataTable, PageHeader, Panel, PanelHeader } from '@/components/ui/primitives';
import { getSession } from '@/lib/auth/session';
import {
  ACCESS_LEVEL_LABELS,
  ROLE_LABELS,
  ROLE_ORDER,
  allowedAccessLevels,
  assignableRoles,
  hasPermission,
  permissionsForRole,
} from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { formatRelative } from '@/lib/ui';

export const metadata: Metadata = { title: 'Users and roles' };
export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const session = await getSession();
  if (!hasPermission(session.role, 'user:read') || !session.user) {
    return <AccessDenied area="user administration" />;
  }

  const canManage = hasPermission(session.role, 'user:manage');
  const users = await prisma.user.findMany({
    orderBy: [{ role: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      isDemo: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });

  return (
    <>
      <PageHeader
        title="Users and roles"
        description="A role decides which access levels a person can retrieve and which actions they can take. Both are enforced server-side on every request."
      />

      <Panel className="mb-6">
        <PanelHeader
          title="Access ladder"
          description="Each role can read its own level and everything below it."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-edge">
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-[11px] uppercase tracking-wider text-ink-faint"
                >
                  Role
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-left text-[11px] uppercase tracking-wider text-ink-faint"
                >
                  Can read
                </th>
                <th
                  scope="col"
                  className="px-4 py-2 text-right text-[11px] uppercase tracking-wider text-ink-faint"
                >
                  Permissions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge-subtle">
              {ROLE_ORDER.map((role) => (
                <tr key={role}>
                  <td className="px-4 py-2.5 font-medium text-ink">{ROLE_LABELS[role]}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {allowedAccessLevels(role).map((level) => (
                        <Badge key={level} tone="neutral">
                          {ACCESS_LEVEL_LABELS[level]}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-ink-muted">
                    {permissionsForRole(role).length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="People" description={`${users.length} accounts`} />
        <DataTable
          caption="User accounts"
          headers={['Name', 'Role', 'Status', 'Last sign-in', { label: '', align: 'right' }]}
        >
          {users.map((user) => (
            <tr key={user.id}>
              <Cell>
                <span className="block font-medium text-ink">{user.name}</span>
                <span className="block font-mono text-xs text-ink-faint">{user.email}</span>
                {user.isDemo ? (
                  <Badge tone="iris" className="mt-1">
                    Demo account
                  </Badge>
                ) : null}
              </Cell>
              <Cell>
                <Badge
                  tone={
                    user.role === 'ADMIN'
                      ? 'critical'
                      : user.role === 'MANAGER'
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  {ROLE_LABELS[user.role]}
                </Badge>
              </Cell>
              <Cell>
                {user.status === 'ACTIVE' ? (
                  <Badge tone="good">Active</Badge>
                ) : user.status === 'SUSPENDED' ? (
                  <Badge tone="critical">Suspended</Badge>
                ) : (
                  <Badge tone="neutral">Invited</Badge>
                )}
              </Cell>
              <Cell>
                <span className="text-xs text-ink-faint">
                  {user.lastLoginAt ? formatRelative(user.lastLoginAt) : 'Never'}
                </span>
              </Cell>
              <Cell align="right">
                {canManage ? (
                  <UserControls
                    userId={user.id}
                    role={user.role}
                    status={user.status}
                    assignableRoles={assignableRoles(session.role)}
                    isSelf={user.id === session.user?.id}
                  />
                ) : (
                  <span className="text-xs text-ink-faint">View only</span>
                )}
              </Cell>
            </tr>
          ))}
        </DataTable>
        {canManage ? (
          <p className="border-t border-edge px-5 py-3 text-xs text-ink-faint">
            Changing a role or suspending an account revokes that person&rsquo;s active sessions
            immediately rather than waiting for them to expire. The last active administrator cannot
            be demoted or suspended.
          </p>
        ) : null}
      </Panel>
    </>
  );
}
