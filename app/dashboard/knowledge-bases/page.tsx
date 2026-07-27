import type { Metadata } from 'next';
import Link from 'next/link';
import { AccessDenied } from '@/components/dashboard/access-denied';
import { AccessLevelBadge } from '@/components/dashboard/status-badges';
import { Badge, Cell, DataTable, EmptyState, PageHeader, Panel } from '@/components/ui/primitives';
import { getSession } from '@/lib/auth/session';
import { allowedAccessLevels, hasPermission } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { formatNumber, formatRelative } from '@/lib/ui';

export const metadata: Metadata = { title: 'Knowledge bases' };
export const dynamic = 'force-dynamic';

export default async function KnowledgeBasesPage() {
  const session = await getSession();
  if (!hasPermission(session.role, 'knowledgebase:read')) {
    return <AccessDenied area="knowledge bases" />;
  }

  const reachable = allowedAccessLevels(session.role);

  const bases = await prisma.knowledgeBase.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      owner: { select: { name: true } },
      // Document counts are scoped to what this role can read, so the totals
      // shown never hint at the existence of restricted material.
      documents: {
        where: { accessLevel: { in: reachable } },
        select: { accessLevel: true, chunkCount: true, status: true },
      },
    },
  });

  return (
    <>
      <PageHeader
        title="Knowledge bases"
        description="Collections that group documents. Access is decided per document, not per collection, so one base can hold both public and restricted material."
      />

      <Panel>
        {bases.length === 0 ? (
          <EmptyState
            title="No knowledge bases"
            description="Create one to start grouping documents."
          />
        ) : (
          <DataTable
            caption="Knowledge bases"
            headers={[
              'Name',
              'Visibility',
              'Access levels present',
              { label: 'Documents', align: 'right' },
              { label: 'Passages', align: 'right' },
              { label: 'Created', align: 'right' },
            ]}
          >
            {bases.map((base) => {
              const levels = [...new Set(base.documents.map((document) => document.accessLevel))];
              const indexed = base.documents.filter((d) => d.status === 'INDEXED').length;
              const passages = base.documents.reduce((sum, d) => sum + d.chunkCount, 0);

              return (
                <tr key={base.id}>
                  <Cell>
                    <Link
                      href="/dashboard/documents"
                      className="font-medium text-ink hover:text-accent"
                    >
                      {base.name}
                    </Link>
                    {base.description ? (
                      <span className="mt-0.5 block max-w-md text-xs text-ink-faint">
                        {base.description}
                      </span>
                    ) : null}
                    <span className="mt-0.5 block font-mono text-[11px] text-ink-faint">
                      {base.slug}
                    </span>
                  </Cell>
                  <Cell>
                    <Badge tone={base.visibility === 'PUBLIC' ? 'good' : 'neutral'}>
                      {base.visibility.toLowerCase()}
                    </Badge>
                  </Cell>
                  <Cell>
                    <div className="flex flex-wrap gap-1">
                      {levels.length === 0 ? (
                        <span className="text-xs text-ink-faint">—</span>
                      ) : (
                        levels.map((level) => <AccessLevelBadge key={level} level={level} />)
                      )}
                    </div>
                  </Cell>
                  <Cell align="right" mono>
                    {formatNumber(indexed)}
                  </Cell>
                  <Cell align="right" mono>
                    {formatNumber(passages)}
                  </Cell>
                  <Cell align="right">
                    <span className="text-xs text-ink-faint">{formatRelative(base.createdAt)}</span>
                  </Cell>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Panel>
    </>
  );
}
