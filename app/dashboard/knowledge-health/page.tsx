import type { Metadata } from 'next';
import Link from 'next/link';
import { getOrCreateDefaultWorkspace } from '@/lib/workspace/context';
import { prisma } from '@/lib/database/client';
import { PageHeader, Panel, PanelHeader, DataTable, Cell, Badge } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Knowledge Gaps & Health' };
export const dynamic = 'force-dynamic';

export default async function KnowledgeHealthPage() {
  const workspace = await getOrCreateDefaultWorkspace();

  const [documents, unhelpfulFeedback, escalations] = await Promise.all([
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
    prisma.escalation.findMany({
      where: { reason: { contains: 'unsupported', mode: 'insensitive' } },
      take: 15,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="OPERATIONS // CONTENT GOVERNANCE"
        title="Knowledge Gaps & Health"
        description="Identify unanswered question clusters, missing policy documentation, unhelpful answer feedback, and content action items."
        action={
          <Link
            href="/dashboard/upload"
            className="rounded bg-accent px-3.5 py-1.5 font-mono text-xs font-bold text-ink-inverse hover:bg-accent-soft transition"
          >
            Add Knowledge Entry →
          </Link>
        }
      />

      {/* Concrete Operational Signals */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono text-xs">
        <Panel className="p-4 space-y-1">
          <span className="text-[10px] uppercase font-bold text-ink-faint">INDEXED SOURCES</span>
          <div className="text-2xl font-bold text-ink">{documents.length}</div>
          <p className="text-[10.5px] text-ink-muted">Active sources across workspace</p>
        </Panel>
        <Panel className="p-4 space-y-1">
          <span className="text-[10px] uppercase font-bold text-amber">UNHELPFUL FEEDBACK</span>
          <div className="text-2xl font-bold text-amber">{unhelpfulFeedback.length}</div>
          <p className="text-[10.5px] text-ink-muted">Turn ratings flagged as NOT_HELPFUL</p>
        </Panel>
        <Panel className="p-4 space-y-1">
          <span className="text-[10px] uppercase font-bold text-rust">UNSUPPORTED ESCALATIONS</span>
          <div className="text-2xl font-bold text-rust">{escalations.length}</div>
          <p className="text-[10.5px] text-ink-muted">
            Unanswered questions requiring content creation
          </p>
        </Panel>
      </div>

      {/* Actionable Knowledge Gaps */}
      <Panel>
        <PanelHeader
          title="Unanswered Question Clusters (Knowledge Gaps)"
          description="Repeated user questions where approved evidence was missing or insufficient"
        />
        <DataTable
          headers={[
            'Question Cluster',
            'Reason',
            'Status',
            { label: 'Date', align: 'right' },
            { label: 'Action', align: 'right' },
          ]}
        >
          {escalations.map((esc) => (
            <tr key={esc.id} className="hover:bg-canvas-overlay/40 transition">
              <Cell className="font-semibold text-ink max-w-xs truncate">
                {esc.summary || esc.reason}
              </Cell>
              <Cell>
                <Badge tone="warning">Unsupported Evidence</Badge>
              </Cell>
              <Cell>
                <span className="font-mono text-xs uppercase text-amber">{esc.status}</span>
              </Cell>
              <Cell align="right" mono>
                {new Date(esc.createdAt).toLocaleDateString()}
              </Cell>
              <Cell align="right">
                <Link
                  href="/dashboard/upload"
                  className="font-mono text-xs text-accent hover:underline"
                >
                  Create Entry &rarr;
                </Link>
              </Cell>
            </tr>
          ))}
          {escalations.length === 0 ? (
            <tr>
              <Cell className="text-xs text-ink-faint" align="left">
                No open knowledge gaps detected
              </Cell>
              <Cell className="text-xs text-ink-faint" align="left">
                —
              </Cell>
              <Cell className="text-xs text-ink-faint" align="left">
                —
              </Cell>
              <Cell className="text-xs text-ink-faint" align="right">
                —
              </Cell>
              <Cell className="text-xs text-ink-faint" align="right">
                —
              </Cell>
            </tr>
          ) : null}
        </DataTable>
      </Panel>

      {/* Unhelpful Feedback Loop */}
      <Panel>
        <PanelHeader
          title="Negative Feedback Log"
          description="User ratings and comments for correction loops"
        />
        <DataTable
          headers={['Answer Context', 'User Comment', { label: 'Submitted', align: 'right' }]}
        >
          {unhelpfulFeedback.map((fb) => (
            <tr key={fb.id}>
              <Cell className="font-sans text-xs text-ink max-w-sm truncate">
                {fb.message?.content.slice(0, 90) ?? '—'}
              </Cell>
              <Cell className="italic text-ink-muted">
                {fb.comment || 'No explicit comment provided'}
              </Cell>
              <Cell align="right" mono>
                {new Date(fb.createdAt).toLocaleDateString()}
              </Cell>
            </tr>
          ))}
          {unhelpfulFeedback.length === 0 ? (
            <tr>
              <Cell className="text-xs text-ink-faint" align="left">
                No unhelpful ratings logged
              </Cell>
              <Cell className="text-xs text-ink-faint" align="left">
                —
              </Cell>
              <Cell className="text-xs text-ink-faint" align="right">
                —
              </Cell>
            </tr>
          ) : null}
        </DataTable>
      </Panel>
    </div>
  );
}
