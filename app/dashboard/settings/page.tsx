import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import {
  Badge,
  DefinitionList,
  InlineNote,
  PageHeader,
  Panel,
  PanelHeader,
} from '@/components/ui/primitives';
import { getSession } from '@/lib/auth/session';
import {
  ACCESS_LEVEL_LABELS,
  ROLE_LABELS,
  allowedAccessLevels,
  permissionsForRole,
} from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { env } from '@/lib/env';
import { formatDateTime, formatRelative } from '@/lib/ui';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await getSession();
  if (!session.user) redirect('/login');

  const [user, activeSessions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        isDemo: true,
      },
    }),
    prisma.session.count({
      where: { userId: session.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    }),
  ]);

  if (!user) redirect('/login');

  return (
    <>
      <PageHeader title="Settings" description="Your account and what it can reach." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Account" />
          <div className="px-5 py-4">
            <DefinitionList
              items={[
                { term: 'Name', value: user.name },
                { term: 'Email', value: <span className="font-mono text-xs">{user.email}</span> },
                { term: 'Role', value: ROLE_LABELS[user.role] },
                { term: 'Status', value: user.status },
                { term: 'Account created', value: formatDateTime(user.createdAt) },
                {
                  term: 'Last sign-in',
                  value: user.lastLoginAt ? formatRelative(user.lastLoginAt) : 'This is your first',
                },
                { term: 'Active sessions', value: String(activeSessions) },
              ]}
            />
            {user.isDemo ? (
              <div className="mt-4">
                <Badge tone="iris">Demo account — only valid while demo mode is enabled</Badge>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="What you can reach"
            description="Applied to every retrieval you perform."
          />
          <div className="space-y-4 px-5 py-4">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                Content access levels
              </p>
              <div className="flex flex-wrap gap-1.5">
                {allowedAccessLevels(user.role).map((level) => (
                  <Badge key={level} tone="good">
                    {ACCESS_LEVEL_LABELS[level]}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                Permissions ({permissionsForRole(user.role).length})
              </p>
              <div className="flex flex-wrap gap-1">
                {permissionsForRole(user.role).map((permission) => (
                  <code
                    key={permission}
                    className="rounded bg-canvas-sunken px-1.5 py-0.5 font-mono text-[10px] text-ink-muted"
                  >
                    {permission}
                  </code>
                ))}
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <Panel className="mt-6">
        <PanelHeader title="Session security" />
        <ul className="space-y-2 px-5 py-4 text-[13px] text-ink-muted">
          {[
            'Sessions live in an HTTP-only, SameSite=Lax cookie that page scripts cannot read.',
            'Only a SHA-256 of the session token is stored, so a database leak cannot be replayed as a valid session.',
            'Sessions expire after 8 hours and renew silently while you are active.',
            'A role change or suspension revokes every active session immediately.',
            'Passwords are hashed with scrypt at N=32768, r=8 — roughly 32 MB of memory per verification.',
            'Eight failed sign-in attempts within 15 minutes lock the identifier out, counted in the database so the lockout survives a restart.',
          ].map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
              {item}
            </li>
          ))}
        </ul>
      </Panel>

      {env().DEMO_MODE ? (
        <div className="mt-6">
          <InlineNote tone="iris">
            This deployment runs in demo mode. Password changes and account creation are disabled so
            the demonstration accounts stay predictable for anyone trying the platform.
          </InlineNote>
        </div>
      ) : null}
    </>
  );
}
