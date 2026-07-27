import type { Metadata } from 'next';
import Link from 'next/link';
import type { DocumentStatus, Prisma } from '@prisma/client';
import { AccessDenied } from '@/components/dashboard/access-denied';
import { AccessLevelBadge, DocumentStatusBadge } from '@/components/dashboard/status-badges';
import { Cell, DataTable, EmptyState, PageHeader, Panel } from '@/components/ui/primitives';
import { getSession } from '@/lib/auth/session';
import { allowedAccessLevels, hasPermission } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { formatBytes, formatNumber, formatRelative } from '@/lib/ui';

export const metadata: Metadata = { title: 'Documents' };
export const dynamic = 'force-dynamic';

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'INDEXED', label: 'Indexed' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'ARCHIVED', label: 'Archived' },
];

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const session = await getSession();
  if (!hasPermission(session.role, 'document:read')) {
    return <AccessDenied area="the document library" />;
  }

  const params = await searchParams;
  const statusFilter = (params.status ?? 'ALL').toUpperCase();
  const query = (params.q ?? '').trim();

  // The access filter is part of the query, so a document above this role's
  // level is never fetched — not fetched and then hidden.
  const where: Prisma.DocumentWhereInput = {
    accessLevel: { in: allowedAccessLevels(session.role) },
  };
  if (STATUS_FILTERS.some((filter) => filter.value === statusFilter && filter.value !== 'ALL')) {
    where.status = statusFilter as DocumentStatus;
  }
  if (query.length > 0) {
    where.title = { contains: query, mode: 'insensitive' };
  }

  const [documents, totals] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        title: true,
        sourceType: true,
        status: true,
        accessLevel: true,
        chunkCount: true,
        pageCount: true,
        fileSize: true,
        createdAt: true,
        lastError: true,
        knowledgeBase: { select: { name: true } },
      },
    }),
    prisma.document.groupBy({
      by: ['status'],
      where: { accessLevel: { in: allowedAccessLevels(session.role) } },
      _count: { _all: true },
    }),
  ]);

  const countFor = (status: string) =>
    totals.find((entry) => entry.status === status)?._count._all ?? 0;
  const allCount = totals.reduce((sum, entry) => sum + entry._count._all, 0);

  return (
    <>
      <PageHeader
        title="Documents"
        description="Every source in the knowledge base you are permitted to see, with its processing state."
        action={
          hasPermission(session.role, 'document:upload') ? (
            <Link
              href="/dashboard/upload"
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft"
            >
              Add sources
            </Link>
          ) : null
        }
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-3 border-b border-edge px-5 py-3">
          <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((filter) => {
              const count = filter.value === 'ALL' ? allCount : countFor(filter.value);
              const active = statusFilter === filter.value;
              return (
                <Link
                  key={filter.value}
                  href={`/dashboard/documents${filter.value === 'ALL' ? '' : `?status=${filter.value}`}`}
                  aria-current={active ? 'page' : undefined}
                  className={
                    active
                      ? 'rounded-md bg-accent-wash px-2.5 py-1 text-xs font-medium text-accent-soft'
                      : 'rounded-md px-2.5 py-1 text-xs text-ink-muted transition hover:bg-canvas-overlay hover:text-ink'
                  }
                >
                  {filter.label}
                  <span className="ml-1.5 tabular-nums text-ink-faint">{count}</span>
                </Link>
              );
            })}
          </nav>

          <form method="get" className="ml-auto flex items-center gap-2">
            {statusFilter !== 'ALL' ? (
              <input type="hidden" name="status" value={statusFilter} />
            ) : null}
            <label htmlFor="doc-search" className="sr-only">
              Search documents by title
            </label>
            <input
              id="doc-search"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Search titles…"
              className="field w-48 py-1.5 text-xs"
            />
            <button
              type="submit"
              className="rounded-md border border-edge px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:border-edge-strong hover:text-ink"
            >
              Search
            </button>
          </form>
        </div>

        {documents.length === 0 ? (
          <EmptyState
            title="No documents match"
            description={
              query
                ? `Nothing found for “${query}”. Try a different term or clear the filter.`
                : 'Nothing has been indexed at this access level yet.'
            }
          />
        ) : (
          <DataTable
            caption="Indexed documents"
            headers={[
              'Title',
              'Type',
              'Access',
              'Status',
              { label: 'Passages', align: 'right' },
              { label: 'Size', align: 'right' },
              { label: 'Added', align: 'right' },
            ]}
          >
            {documents.map((document) => (
              <tr key={document.id} className="transition hover:bg-canvas-overlay/50">
                <Cell className="text-ink">
                  <Link
                    href={`/dashboard/documents/${document.id}`}
                    className="font-medium text-ink hover:text-accent"
                  >
                    {document.title}
                  </Link>
                  <span className="mt-0.5 block text-xs text-ink-faint">
                    {document.knowledgeBase.name}
                  </span>
                  {document.status === 'FAILED' && document.lastError ? (
                    <span className="mt-1 block text-xs text-status-critical">
                      {document.lastError.slice(0, 120)}
                    </span>
                  ) : null}
                </Cell>
                <Cell>
                  <span className="font-mono text-xs uppercase text-ink-faint">
                    {document.sourceType}
                  </span>
                </Cell>
                <Cell>
                  <AccessLevelBadge level={document.accessLevel} />
                </Cell>
                <Cell>
                  <DocumentStatusBadge status={document.status} />
                </Cell>
                <Cell align="right" mono>
                  {formatNumber(document.chunkCount)}
                </Cell>
                <Cell align="right" mono>
                  {document.fileSize > 0 ? formatBytes(document.fileSize) : '—'}
                </Cell>
                <Cell align="right">
                  <span className="text-xs text-ink-faint">
                    {formatRelative(document.createdAt)}
                  </span>
                </Cell>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </>
  );
}
