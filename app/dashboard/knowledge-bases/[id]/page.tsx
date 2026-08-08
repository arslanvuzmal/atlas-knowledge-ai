import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AccessDenied } from '@/components/dashboard/access-denied';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { KnowledgeBaseDetailTabs } from '@/components/dashboard/knowledge-base-detail-tabs';
import { getSession } from '@/lib/auth/session';
import { allowedAccessLevels, hasPermission } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { formatRelative } from '@/lib/ui';

interface Props {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = { title: 'Knowledge base' };
export const dynamic = 'force-dynamic';

export default async function KnowledgeBaseDetailPage({ params }: Props) {
  const session = await getSession();
  if (!hasPermission(session.role, 'knowledgebase:read')) {
    return <AccessDenied area="knowledge base" />;
  }

  const { id } = await params;
  const reachable = allowedAccessLevels(session.role);

  const base = await prisma.knowledgeBase.findUnique({
    where: { id },
    include: {
      owner: { select: { name: true, email: true } },
      documents: {
        where: { accessLevel: { in: reachable } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          sourceType: true,
          accessLevel: true,
          status: true,
          fileSize: true,
          pageCount: true,
          chunkCount: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!base) notFound();

  const documents = base.documents;
  const indexedDocs = documents.filter((d) => d.status === 'INDEXED');
  const totalPassages = documents.reduce((sum, d) => sum + d.chunkCount, 0);
  const levelsPresent = [...new Set(documents.map((d) => d.accessLevel))];

  // Citation usage for this KB
  const citationUsage = await prisma.citation.groupBy({
    by: ['documentId'],
    where: {
      document: { knowledgeBaseId: id },
      documentId: { in: documents.map((d) => d.id) },
    },
    _count: { _all: true },
  });
  const citationMap = new Map(citationUsage.map((c) => [c.documentId, c._count._all]));

  // Conversation activity
  const conversationCount = await prisma.conversation.count({
    where: { knowledgeBaseId: id },
  });
  const questionCount = await prisma.message.count({
    where: { role: 'USER', conversation: { knowledgeBaseId: id } },
  });

  // Health metrics
  const staleThresholdDays = 90;
  const staleDocs = indexedDocs.filter(
    (d) => d.updatedAt < new Date(Date.now() - staleThresholdDays * 24 * 60 * 60 * 1000),
  );
  const oldestIndexed =
    indexedDocs.length > 0
      ? indexedDocs.reduce((oldest, d) => (d.updatedAt < oldest.updatedAt ? d : oldest)).updatedAt
      : null;

  return (
    <>
      <PageHeader
        title={base.name}
        description={base.description ?? 'No description provided.'}
        action={
          hasPermission(session.role, 'knowledgebase:manage') ? (
            <a
              href={`/dashboard/knowledge-bases/${base.id}?edit=true`}
              className="rounded-md border border-edge px-4 py-2 text-sm font-medium text-ink transition hover:border-accent hover:text-accent"
            >
              Edit settings
            </a>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <Badge tone={base.visibility === 'PUBLIC' ? 'good' : 'neutral'}>
          {base.visibility.toLowerCase()}
        </Badge>
        <span className="text-xs text-ink-faint font-mono">{base.slug}</span>
        <span className="text-xs text-ink-faint">Owner: {base.owner?.name ?? 'Unknown'}</span>
        <span className="text-xs text-ink-faint">Created {formatRelative(base.createdAt)}</span>
      </div>

      <KnowledgeBaseDetailTabs
        base={{
          id: base.id,
          name: base.name,
          slug: base.slug,
          description: base.description,
          visibility: base.visibility,
          owner: base.owner,
          createdAt: base.createdAt,
          documents,
          citationMap,
          conversationCount,
          questionCount,
          totalPassages,
          levelsPresent,
          staleDocs,
          oldestIndexed,
          canManage: hasPermission(session.role, 'knowledgebase:manage'),
          canReprocess: hasPermission(session.role, 'document:reprocess'),
        }}
      />
    </>
  );
}
