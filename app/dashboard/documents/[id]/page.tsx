import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AccessDenied } from '@/components/dashboard/access-denied';
import { DocumentActions, DocumentQueryTester } from '@/components/dashboard/document-actions';
import { AccessLevelBadge, DocumentStatusBadge } from '@/components/dashboard/status-badges';
import {
  DefinitionList,
  InlineNote,
  PageHeader,
  Panel,
  PanelHeader,
} from '@/components/ui/primitives';
import { getSession } from '@/lib/auth/session';
import { allowedAccessLevels, canReadAccessLevel, hasPermission } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { formatBytes, formatDateTime, formatNumber } from '@/lib/ui';

export const metadata: Metadata = { title: 'Document' };
export const dynamic = 'force-dynamic';

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!hasPermission(session.role, 'document:read')) {
    return <AccessDenied area="the document library" />;
  }

  const { id } = await params;

  const document = await prisma.document.findUnique({
    where: { id },
    include: {
      knowledgeBase: { select: { name: true, slug: true } },
      uploader: { select: { name: true } },
      versions: { orderBy: { version: 'desc' } },
      jobs: { orderBy: { createdAt: 'desc' }, take: 5 },
      chunks: {
        orderBy: { chunkIndex: 'asc' },
        take: 40,
        select: {
          id: true,
          chunkIndex: true,
          sectionTitle: true,
          pageNumber: true,
          tokenCount: true,
          content: true,
          embeddingProvider: true,
          embeddingModel: true,
        },
      },
    },
  });

  // A document above this role's access level is reported as missing, so the
  // detail route cannot be used to confirm that a restricted document exists.
  if (!document || !canReadAccessLevel(session.role, document.accessLevel)) {
    notFound();
  }

  const latestJob = document.jobs[0];
  const currentVersion = document.versions[0];

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-ink-muted">
        <Link href="/dashboard/documents" className="hover:text-accent">
          Documents
        </Link>
        <span className="mx-2 text-ink-faint">/</span>
        <span className="text-ink">{document.title}</span>
      </nav>

      <PageHeader
        title={document.title}
        description={`${document.sourceType} source in ${document.knowledgeBase.name}`}
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <DocumentStatusBadge status={document.status} />
        <AccessLevelBadge level={document.accessLevel} />
        {document.archivedAt ? (
          <span className="text-xs text-ink-faint">
            Archived {formatDateTime(document.archivedAt)}
          </span>
        ) : null}
      </div>

      {document.status === 'FAILED' && document.lastError ? (
        <div className="mb-6">
          <InlineNote tone="critical">
            <strong className="text-ink">Processing failed.</strong> {document.lastError}
            {hasPermission(session.role, 'document:reprocess')
              ? ' Use Reprocess below to retry from the stored original.'
              : ''}
          </InlineNote>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel>
            <PanelHeader title="Metadata" />
            <div className="px-5 py-4">
              <DefinitionList
                items={[
                  { term: 'Original filename', value: document.originalFilename ?? '—' },
                  { term: 'Source type', value: document.sourceType },
                  { term: 'MIME type', value: document.mimeType ?? '—' },
                  {
                    term: 'Source URL',
                    value: document.sourceUrl ? (
                      <span className="break-all font-mono text-xs">{document.sourceUrl}</span>
                    ) : (
                      '—'
                    ),
                  },
                  {
                    term: 'File size',
                    value: document.fileSize > 0 ? formatBytes(document.fileSize) : '—',
                  },
                  {
                    term: 'Pages',
                    value: document.pageCount !== null ? formatNumber(document.pageCount) : '—',
                  },
                  { term: 'Passages indexed', value: formatNumber(document.chunkCount) },
                  { term: 'Language', value: document.language },
                  { term: 'Uploaded by', value: document.uploader?.name ?? 'System' },
                  { term: 'Added', value: formatDateTime(document.createdAt) },
                  {
                    term: 'Checksum',
                    value: (
                      <span className="font-mono text-xs">{document.checksum.slice(0, 24)}…</span>
                    ),
                  },
                  {
                    term: 'Embedding',
                    value: currentVersion?.embeddingProvider
                      ? `${currentVersion.embeddingProvider} · ${currentVersion.embeddingModel} · ${currentVersion.embeddingDimensions}d`
                      : '—',
                  },
                ]}
              />
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Test retrieval"
              description="Run a question against this document alone, using the same pipeline and access filter as live chat."
            />
            <div className="px-5 py-4">
              <DocumentQueryTester documentId={document.id} />
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Indexed passages"
              description={`Showing ${Math.min(40, document.chunks.length)} of ${formatNumber(document.chunkCount)} passages, in document order.`}
            />
            {document.chunks.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-ink-muted">
                This document has no indexed passages. It either failed processing or contained no
                extractable text.
              </p>
            ) : (
              <ol className="divide-y divide-edge-subtle">
                {document.chunks.map((chunk) => (
                  <li key={chunk.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-xs font-medium text-ink">
                        {chunk.sectionTitle ?? `Passage ${chunk.chunkIndex + 1}`}
                        {chunk.pageNumber !== null ? (
                          <span className="text-ink-faint"> · page {chunk.pageNumber}</span>
                        ) : null}
                      </p>
                      <span className="font-mono text-[11px] text-ink-faint">
                        #{chunk.chunkIndex} · ~{chunk.tokenCount} tokens
                      </span>
                    </div>
                    <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
                      {chunk.content}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Actions" />
            <div className="px-5 py-4">
              <DocumentActions
                documentId={document.id}
                accessLevel={document.accessLevel}
                archived={Boolean(document.archivedAt)}
                assignableLevels={allowedAccessLevels(session.role)}
                can={{
                  reprocess: hasPermission(session.role, 'document:reprocess'),
                  archive: hasPermission(session.role, 'document:archive'),
                  changeAccess: hasPermission(session.role, 'document:change-access-level'),
                  delete: hasPermission(session.role, 'document:delete'),
                }}
              />

              {document.storagePath && hasPermission(session.role, 'document:download') ? (
                <a
                  href={`/api/documents/file?key=${encodeURIComponent(document.storagePath)}`}
                  className="mt-4 inline-block text-xs text-accent hover:text-accent-soft"
                >
                  Download original →
                </a>
              ) : null}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Processing history" />
            {document.jobs.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-muted">No ingestion jobs recorded.</p>
            ) : (
              <ul className="divide-y divide-edge-subtle">
                {document.jobs.map((job) => (
                  <li key={job.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-ink">{job.stage}</span>
                      <span
                        className={
                          job.status === 'SUCCEEDED'
                            ? 'text-xs text-status-good'
                            : job.status === 'FAILED'
                              ? 'text-xs text-status-critical'
                              : 'text-xs text-ink-muted'
                        }
                      >
                        {job.status}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-ink-faint">
                      {formatDateTime(job.createdAt)} · attempt {job.attemptCount}
                    </p>
                    {job.lastError ? (
                      <p className="mt-1.5 text-[11px] leading-relaxed text-status-critical">
                        {job.lastError}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Versions" />
            <ul className="divide-y divide-edge-subtle">
              {document.versions.map((version) => (
                <li key={version.id} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm text-ink">Version {version.version}</span>
                  <span className="text-xs text-ink-faint">
                    {formatDateTime(version.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      {latestJob?.correlationId ? (
        <p className="mt-6 font-mono text-[11px] text-ink-faint">
          Correlation ID {latestJob.correlationId}
        </p>
      ) : null}
    </>
  );
}
