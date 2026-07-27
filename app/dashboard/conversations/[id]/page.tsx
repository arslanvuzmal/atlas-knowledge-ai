import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AccessDenied } from '@/components/dashboard/access-denied';
import { GroundingBadge } from '@/components/dashboard/status-badges';
import { ConfidenceMeter } from '@/components/dashboard/charts';
import { Badge, PageHeader, Panel, PanelHeader } from '@/components/ui/primitives';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { formatDateTime, formatNumber } from '@/lib/ui';

export const metadata: Metadata = { title: 'Conversation' };
export const dynamic = 'force-dynamic';

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!hasPermission(session.role, 'conversation:read:own') || !session.user) {
    return <AccessDenied area="conversation history" />;
  }

  const { id } = await params;
  const canReadAll = hasPermission(session.role, 'conversation:read:all');

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: {
          citations: {
            orderBy: { ordinal: 'asc' },
            include: { document: { select: { title: true, accessLevel: true } } },
          },
          feedback: { select: { rating: true, reason: true, comment: true } },
        },
      },
      escalations: { orderBy: { createdAt: 'desc' } },
      retrievalLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });

  if (!conversation) notFound();

  // Someone else's conversation is reported as missing rather than forbidden.
  const isOwner = conversation.userId === session.user.id;
  if (!isOwner && !canReadAll) notFound();

  const logByQuery = new Map(conversation.retrievalLogs.map((log) => [log.query, log]));

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-ink-muted">
        <Link href="/dashboard/conversations" className="hover:text-accent">
          Conversations
        </Link>
        <span className="mx-2 text-ink-faint">/</span>
        <span className="text-ink">{conversation.title}</span>
      </nav>

      <PageHeader
        title={conversation.title}
        description={`Started ${formatDateTime(conversation.createdAt)}${
          conversation.user
            ? ` by ${conversation.user.name} (${conversation.user.role})`
            : ' by an anonymous visitor'
        }`}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {conversation.messages.map((message) => {
            const log = message.role === 'USER' ? logByQuery.get(message.content) : undefined;

            return message.role === 'USER' ? (
              <div
                key={message.id}
                className="rounded-panel border border-edge bg-canvas-sunken px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                    Question
                  </span>
                  {message.flagged ? (
                    <Badge tone="critical">Injection patterns detected</Badge>
                  ) : null}
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink">{message.content}</p>
                {log?.rewrittenQuery ? (
                  <p className="mt-2 text-[11px] text-ink-faint">
                    Rewritten for retrieval: <span className="font-mono">{log.rewrittenQuery}</span>
                  </p>
                ) : null}
              </div>
            ) : (
              <article key={message.id} className="panel">
                <div className="flex flex-wrap items-center gap-3 border-b border-edge-subtle px-4 py-2.5">
                  <GroundingBadge level={message.grounded} />
                  {message.confidence !== null ? (
                    <ConfidenceMeter value={message.confidence} threshold={0.65} compact />
                  ) : null}
                  <span className="ml-auto font-mono text-[11px] text-ink-faint">
                    {message.modelProvider}/{message.modelName} ·{' '}
                    {formatNumber(message.latencyMs ?? 0)} ms
                  </span>
                </div>

                <div className="px-4 py-4">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                    {message.content}
                  </p>

                  {message.citations.length > 0 ? (
                    <div className="mt-4">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                        Citations
                      </p>
                      <ul className="space-y-1.5">
                        {message.citations.map((citation) => (
                          <li key={citation.id} className="text-[13px] text-ink-muted">
                            <span className="mr-1.5 font-mono text-accent">
                              [{citation.ordinal}]
                            </span>
                            {citation.document.title}
                            {citation.sectionTitle ? (
                              <span className="text-ink-faint"> · {citation.sectionTitle}</span>
                            ) : null}
                            {citation.pageNumber !== null ? (
                              <span className="text-ink-faint"> · page {citation.pageNumber}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {message.feedback.length > 0 ? (
                    <div className="mt-4 rounded-md border border-edge bg-canvas-sunken px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                        Feedback
                      </p>
                      {message.feedback.map((entry, index) => (
                        <p key={index} className="mt-1 text-[13px] text-ink-muted">
                          {entry.rating.replace(/_/g, ' ').toLowerCase()}
                          {entry.reason
                            ? ` · ${entry.reason.replace(/_/g, ' ').toLowerCase()}`
                            : ''}
                          {entry.comment ? ` — “${entry.comment}”` : ''}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>

        <div className="space-y-6">
          {conversation.escalations.length > 0 ? (
            <Panel>
              <PanelHeader title="Escalations" />
              <ul className="divide-y divide-edge-subtle">
                {conversation.escalations.map((escalation) => (
                  <li key={escalation.id} className="px-5 py-3">
                    <p className="text-sm text-ink">{escalation.reason}</p>
                    <p className="mt-1 text-[11px] text-ink-faint">
                      {escalation.status} · {escalation.priority} ·{' '}
                      {formatDateTime(escalation.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader
              title="Retrieval trace"
              description="Chunk identifiers only. Passage text is never written to the log."
            />
            {conversation.retrievalLogs.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-muted">No retrieval activity recorded.</p>
            ) : (
              <ul className="divide-y divide-edge-subtle">
                {conversation.retrievalLogs.map((log) => (
                  <li key={log.id} className="px-5 py-3">
                    <p className="line-clamp-2 text-[13px] text-ink">{log.query}</p>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] text-ink-faint">
                      <div className="flex justify-between">
                        <dt>candidates</dt>
                        <dd className="text-ink-muted">{log.candidateCount}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>permitted</dt>
                        <dd className="text-ink-muted">{log.filteredCount}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>cited</dt>
                        <dd className="text-ink-muted">{log.rerankedChunkIds.length}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>latency</dt>
                        <dd className="text-ink-muted">{log.latencyMs} ms</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>confidence</dt>
                        <dd className="text-ink-muted">{(log.confidence * 100).toFixed(0)}%</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>ceiling</dt>
                        <dd className="text-ink-muted">{log.accessLevel}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
