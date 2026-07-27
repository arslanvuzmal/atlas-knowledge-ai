import type { Metadata } from 'next';
import Link from 'next/link';
import { AccessDenied } from '@/components/dashboard/access-denied';
import {
  Badge,
  Cell,
  DataTable,
  EmptyState,
  InlineNote,
  PageHeader,
  Panel,
} from '@/components/ui/primitives';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { formatDateTime } from '@/lib/ui';

export const metadata: Metadata = { title: 'Audit log' };
export const dynamic = 'force-dynamic';

const CATEGORIES = [
  { value: 'ALL', label: 'All' },
  { value: 'auth', label: 'Authentication' },
  { value: 'document', label: 'Documents' },
  { value: 'chat', label: 'Chat' },
  { value: 'escalation', label: 'Escalations' },
  { value: 'user', label: 'Users' },
  { value: 'settings', label: 'Settings' },
  { value: 'security', label: 'Security' },
];

function toneFor(action: string): 'neutral' | 'good' | 'warning' | 'critical' | 'accent' {
  if (action.includes('failure') || action.includes('unauthorised') || action.includes('lockout')) {
    return 'critical';
  }
  if (action.includes('injection') || action.includes('rate-limit') || action.includes('delete')) {
    return 'warning';
  }
  if (action.includes('success') || action.includes('complete')) return 'good';
  return 'neutral';
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const session = await getSession();
  if (!hasPermission(session.role, 'audit:read')) {
    return <AccessDenied area="the audit log" />;
  }

  const params = await searchParams;
  const category = params.category ?? 'ALL';

  const entries = await prisma.auditLog.findMany({
    where: category === 'ALL' ? {} : { action: { startsWith: `${category}.` } },
    orderBy: { createdAt: 'desc' },
    take: 150,
    include: { user: { select: { name: true, email: true } } },
  });

  return (
    <>
      <PageHeader
        title="Audit log"
        description="An append-only record of every security-relevant action. Entries are never edited or deleted through the application."
      />

      <Panel>
        <div className="flex flex-wrap gap-1.5 border-b border-edge px-5 py-3">
          {CATEGORIES.map((option) => (
            <Link
              key={option.value}
              href={`/dashboard/audit?category=${option.value}`}
              aria-current={category === option.value ? 'page' : undefined}
              className={
                category === option.value
                  ? 'rounded-md bg-accent-wash px-2.5 py-1 text-xs font-medium text-accent-soft'
                  : 'rounded-md px-2.5 py-1 text-xs text-ink-muted transition hover:bg-canvas-overlay hover:text-ink'
              }
            >
              {option.label}
            </Link>
          ))}
        </div>

        {entries.length === 0 ? (
          <EmptyState title="No entries" description="Nothing matches this category yet." />
        ) : (
          <DataTable
            caption="Audit entries"
            headers={['Action', 'Actor', 'Entity', 'Detail', { label: 'When', align: 'right' }]}
          >
            {entries.map((entry) => (
              <tr key={entry.id}>
                <Cell>
                  <Badge tone={toneFor(entry.action)}>{entry.action}</Badge>
                </Cell>
                <Cell>
                  <span className="text-xs">{entry.user?.name ?? 'System / anonymous'}</span>
                </Cell>
                <Cell>
                  <span className="font-mono text-[11px] text-ink-faint">
                    {entry.entityType}
                    {entry.entityId ? `:${entry.entityId.slice(0, 8)}` : ''}
                  </span>
                </Cell>
                <Cell className="max-w-sm">
                  {entry.metadata ? (
                    <code className="line-clamp-2 block font-mono text-[11px] text-ink-muted">
                      {JSON.stringify(entry.metadata)}
                    </code>
                  ) : (
                    <span className="text-xs text-ink-faint">—</span>
                  )}
                </Cell>
                <Cell align="right">
                  <span className="whitespace-nowrap text-xs text-ink-faint">
                    {formatDateTime(entry.createdAt)}
                  </span>
                </Cell>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <div className="mt-6">
        <InlineNote>
          IP addresses are stored as keyed hashes rather than in plain text, so entries can be
          correlated without retaining a directly identifying value. Values that look like secrets
          are redacted before an entry is written.
        </InlineNote>
      </div>
    </>
  );
}
