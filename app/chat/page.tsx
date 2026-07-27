import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChatPanel } from '@/components/chat/chat-panel';
import type { ChatTurn } from '@/components/chat/types';
import { DemoBadge, Wordmark } from '@/components/ui/wordmark';
import { getSession } from '@/lib/auth/session';
import { ACCESS_LEVEL_LABELS, ROLE_LABELS, allowedAccessLevels } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { env } from '@/lib/env';
import { formatRelative } from '@/lib/ui';

export const metadata: Metadata = { title: 'Chat' };
export const dynamic = 'force-dynamic';

const SUGGESTIONS_BY_ROLE: Record<string, string[]> = {
  ADMIN: [
    'What are the audit log retention periods per plan?',
    'Who can act as Incident Commander for a SEV1?',
    'What encryption is used for data at rest?',
    'What is the refund window for annual subscriptions?',
  ],
  MANAGER: [
    'Who can act as Incident Commander for a SEV1?',
    'When does the 72 hour notification clock start?',
    'How many days of annual leave do employees receive?',
    'What is the escalation path for a credential compromise?',
  ],
  EMPLOYEE: [
    'How many days of annual leave do employees receive?',
    'What is the parental leave policy?',
    'How should I handle a prospect asking about HIPAA?',
    'What is the learning budget per employee?',
  ],
  CUSTOMER: [
    'How much does the Team plan cost per user?',
    'What happens to my data after I cancel?',
    'What is the refund window for annual subscriptions?',
    'What are your support response times?',
  ],
  PUBLIC: [
    'What is the free trial length?',
    'What is the refund policy?',
    'Are you HIPAA compliant?',
    'How do I contact support?',
  ],
};

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const session = await getSession();
  if (!session.isAuthenticated || !session.user) redirect('/login');

  const params = await searchParams;
  const requestedId = params.c ?? null;

  // Conversations are loaded scoped to the signed-in user. A conversation id in
  // the URL that belongs to someone else simply yields nothing.
  const conversations = await prisma.conversation.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: 'desc' },
    take: 25,
    select: { id: true, title: true, updatedAt: true, status: true },
  });

  let initialTurns: ChatTurn[] = [];
  let activeId: string | null = null;

  if (requestedId) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: requestedId, userId: session.user.id },
      select: {
        id: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            content: true,
            confidence: true,
            grounded: true,
            modelProvider: true,
            modelName: true,
            createdAt: true,
            citations: {
              orderBy: { ordinal: 'asc' },
              select: {
                ordinal: true,
                documentId: true,
                pageNumber: true,
                sectionTitle: true,
                excerpt: true,
                relevanceScore: true,
                document: { select: { title: true } },
              },
            },
          },
        },
      },
    });

    if (conversation) {
      activeId = conversation.id;
      initialTurns = conversation.messages
        .filter((message) => message.role !== 'SYSTEM')
        .map((message) => ({
          id: message.id,
          role: message.role === 'USER' ? ('user' as const) : ('assistant' as const),
          content: message.content,
          grounding: message.grounded ?? undefined,
          confidence: message.confidence ?? undefined,
          provider: message.modelProvider ?? undefined,
          model: message.modelName ?? undefined,
          isDemo: message.modelProvider === 'demo',
          createdAt: message.createdAt.toISOString(),
          citations: message.citations.map((citation) => ({
            ordinal: citation.ordinal,
            documentId: citation.documentId,
            documentTitle: citation.document.title,
            sectionTitle: citation.sectionTitle,
            pageNumber: citation.pageNumber,
            excerpt: citation.excerpt,
            relevanceScore: citation.relevanceScore,
          })),
          relatedSources: [],
        }));
    }
  }

  const reach = allowedAccessLevels(session.role)
    .map((level) => ACCESS_LEVEL_LABELS[level])
    .join(', ');

  return (
    <div className="flex h-screen flex-col">
      <header className="shrink-0 border-b border-edge">
        <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="rounded-md">
            <Wordmark size={24} />
          </Link>
          <div className="flex items-center gap-3">
            {env().DEMO_MODE ? <DemoBadge className="hidden sm:inline-flex" /> : null}
            <Link
              href="/dashboard"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:text-ink"
            >
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-edge bg-canvas-sunken lg:flex">
          <div className="border-b border-edge px-4 py-3">
            <Link
              href="/chat"
              className="block rounded-md bg-accent px-3 py-2 text-center text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft"
            >
              New conversation
            </Link>
          </div>
          <nav
            aria-label="Conversation history"
            className="min-h-0 flex-1 overflow-y-auto px-2 py-3"
          >
            {conversations.length === 0 ? (
              <p className="px-2 py-4 text-xs text-ink-faint">No conversations yet.</p>
            ) : (
              <ul className="space-y-0.5">
                {conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <Link
                      href={`/chat?c=${conversation.id}`}
                      aria-current={conversation.id === activeId ? 'page' : undefined}
                      className={
                        conversation.id === activeId
                          ? 'block rounded-md bg-canvas-overlay px-2.5 py-2 text-sm text-ink'
                          : 'block rounded-md px-2.5 py-2 text-sm text-ink-muted transition hover:bg-canvas-overlay hover:text-ink'
                      }
                    >
                      <span className="line-clamp-2 leading-snug">{conversation.title}</span>
                      <span className="mt-1 block text-[11px] text-ink-faint">
                        {formatRelative(conversation.updatedAt)}
                        {conversation.status === 'ESCALATED' ? ' · escalated' : ''}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </nav>
        </aside>

        <main id="main" className="min-h-0 min-w-0 flex-1">
          <ChatPanel
            mode="authenticated"
            initialConversationId={activeId}
            initialTurns={initialTurns}
            suggestions={SUGGESTIONS_BY_ROLE[session.role] ?? SUGGESTIONS_BY_ROLE.PUBLIC}
            roleLabel={ROLE_LABELS[session.role]}
            reachLabel={`Reaches: ${reach}`}
            demoMode={env().DEMO_MODE}
          />
        </main>
      </div>
    </div>
  );
}
