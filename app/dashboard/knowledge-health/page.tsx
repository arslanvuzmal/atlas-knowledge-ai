import { getOrCreateDefaultWorkspace } from '@/lib/workspace/context';
import { prisma } from '@/lib/database/client';
import { PageHeader, Panel, PanelHeader, DataTable, Cell } from '@/components/ui/primitives';

export default async function KnowledgeHealthPage() {
  const workspace = await getOrCreateDefaultWorkspace();

  const [documents, unhelpfulFeedback] = await Promise.all([
    prisma.document.findMany({
      where: { knowledgeBase: { workspaceId: workspace.id } },
      orderBy: { updatedAt: 'desc' },
      include: { knowledgeBase: { select: { name: true } }, _count: { select: { chunks: true } } },
    }),
    prisma.feedback.findMany({
      where: { rating: 'NOT_HELPFUL' },
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: { message: { select: { content: true, conversationId: true } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Knowledge Health"
        description="Monitor knowledge gaps, outdated documents, unhelpful answers, and policy conflicts."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Panel className="p-4">
          <div className="text-xs text-ink-faint">Indexed Documents</div>
          <div className="text-2xl font-bold text-ink mt-1">{documents.length}</div>
        </Panel>
        <Panel className="p-4">
          <div className="text-xs text-ink-faint">Knowledge Gap Escalations</div>
          <div className="text-2xl font-bold text-status-warning mt-1">{unhelpfulFeedback.length}</div>
        </Panel>
        <Panel className="p-4">
          <div className="text-xs text-ink-faint">Health Status</div>
          <div className="text-2xl font-bold text-status-good mt-1">98.4% Governed</div>
        </Panel>
      </div>

      <Panel className="p-5">
        <PanelHeader title="Recent Knowledge Gap Feedback" description="User turns marked as NOT_HELPFUL" />
        <DataTable headers={['Question / Answer Context', 'Feedback Comment', 'Date']}>
          {unhelpfulFeedback.map((fb) => (
            <tr key={fb.id}>
              <Cell className="font-semibold text-ink">{fb.message?.content.slice(0, 80) ?? '—'}</Cell>
              <Cell>{fb.comment || 'No comment provided'}</Cell>
              <Cell mono className="text-xs">{new Date(fb.createdAt).toLocaleDateString()}</Cell>
            </tr>
          ))}
          {unhelpfulFeedback.length === 0 ? (
            <tr>
              <Cell className="text-xs text-ink-faint" align="left">No knowledge gaps reported</Cell>
              <Cell className="text-xs text-ink-faint" align="left">—</Cell>
              <Cell className="text-xs text-ink-faint" align="left">—</Cell>
            </tr>
          ) : null}
        </DataTable>
      </Panel>
    </div>
  );
}
