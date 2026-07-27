import type { Metadata } from 'next';
import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { AccessDenied } from '@/components/dashboard/access-denied';
import { Badge, Cell, DataTable, EmptyState, PageHeader, Panel } from '@/components/ui/primitives';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { formatNumber, formatRelative } from '@/lib/ui';

export const metadata: Metadata = { title: 'Conversations' };
export const dynamic = 'force-dynamic';

export default async function ConversationsPage() {
  const session = await getSession();
  if (!hasPermission(session.role, 'conversation:read:own') || !session.user) {
    return <AccessDenied area="conversation history" />;
  }

  const canReadAll = hasPermission(session.role, 'conversation:read:all');

  // Without the read-all permission, the query is scoped to the caller's own
  // rows. Other people's conversations are never fetched.
  const where: Prisma.ConversationWhereInput = canReadAll ? {} : { userId: session.user.id };

  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 80,
    select: {
      id: true,
      title: true,
      status: true,
      updatedAt: true,
      user: { select: { name: true } },
      _count: { select: { messages: true, escalations: true } },
    },
  });

  return (
    <>
      <PageHeader
        title="Conversations"
        description={
          canReadAll
            ? 'Every conversation recorded by the platform, with its outcome.'
            : 'Your question history.'
        }
      />

      <Panel>
        {conversations.length === 0 ? (
          <EmptyState
            title="No conversations yet"
            description="Ask a question in the chat to start one."
            action={
              <Link
                href="/chat"
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft"
              >
                Open chat
              </Link>
            }
          />
        ) : (
          <DataTable
            caption="Conversations"
            headers={[
              'Conversation',
              ...(canReadAll ? ['User'] : []),
              'Status',
              { label: 'Messages', align: 'right' as const },
              { label: 'Updated', align: 'right' as const },
            ]}
          >
            {conversations.map((conversation) => (
              <tr key={conversation.id} className="transition hover:bg-canvas-overlay/50">
                <Cell>
                  <Link
                    href={`/dashboard/conversations/${conversation.id}`}
                    className="font-medium text-ink hover:text-accent"
                  >
                    {conversation.title}
                  </Link>
                </Cell>
                {canReadAll ? (
                  <Cell>
                    <span className="text-xs">{conversation.user?.name ?? 'Anonymous'}</span>
                  </Cell>
                ) : null}
                <Cell>
                  {conversation.status === 'ESCALATED' ? (
                    <Badge tone="warning">Escalated</Badge>
                  ) : conversation.status === 'CLOSED' ? (
                    <Badge tone="neutral">Closed</Badge>
                  ) : (
                    <Badge tone="good">Active</Badge>
                  )}
                </Cell>
                <Cell align="right" mono>
                  {formatNumber(conversation._count.messages)}
                </Cell>
                <Cell align="right">
                  <span className="text-xs text-ink-faint">
                    {formatRelative(conversation.updatedAt)}
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
