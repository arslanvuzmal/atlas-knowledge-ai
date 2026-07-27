import type { Metadata } from 'next';
import { AccessDenied } from '@/components/dashboard/access-denied';
import { DemoResetButton } from '@/components/dashboard/controls';
import { InlineNote, PageHeader, Panel, PanelHeader } from '@/components/ui/primitives';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { env } from '@/lib/env';
import { formatNumber } from '@/lib/ui';

export const metadata: Metadata = { title: 'Demo controls' };
export const dynamic = 'force-dynamic';

export default async function DemoPage() {
  const session = await getSession();
  if (!hasPermission(session.role, 'demo:reset')) {
    return <AccessDenied area="demo controls" />;
  }

  const demoMode = env().DEMO_MODE;

  const [conversations, messages, escalations, feedback, logs, documents] = await Promise.all([
    prisma.conversation.count(),
    prisma.message.count(),
    prisma.escalation.count(),
    prisma.feedback.count(),
    prisma.retrievalLog.count(),
    prisma.document.count(),
  ]);

  return (
    <>
      <PageHeader
        title="Demo controls"
        description="Reset the demonstration activity so the platform can be shown from a clean state."
      />

      {!demoMode ? (
        <InlineNote tone="warning">
          Demo mode is disabled for this deployment, so the reset action is refused by the server.
          Set <code className="font-mono text-accent-soft">DEMO_MODE=true</code> to enable it.
        </InlineNote>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Current activity" />
          <div className="grid grid-cols-2 gap-px bg-edge-subtle">
            {[
              { label: 'Conversations', value: conversations },
              { label: 'Messages', value: messages },
              { label: 'Escalations', value: escalations },
              { label: 'Feedback items', value: feedback },
              { label: 'Retrieval logs', value: logs },
              { label: 'Documents', value: documents },
            ].map((item) => (
              <div key={item.label} className="bg-canvas-raised px-4 py-3">
                <p className="text-lg font-semibold tabular-nums text-ink">
                  {formatNumber(item.value)}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">{item.label}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Reset"
            description="Clears conversations, messages, citations, feedback, escalations and retrieval logs."
          />
          <div className="px-5 py-5">
            <p className="mb-4 text-[13px] leading-relaxed text-ink-muted">
              Documents, users, knowledge bases and settings are deliberately left untouched. An
              HTTP endpoint that can erase an indexed corpus is a liability even behind an
              administrator check, so rebuilding the corpus is the seed script&rsquo;s job:{' '}
              <code className="rounded bg-canvas-sunken px-1.5 py-0.5 font-mono text-xs text-accent-soft">
                npm run db:seed
              </code>
              .
            </p>
            {demoMode ? (
              <DemoResetButton />
            ) : (
              <p className="text-sm text-ink-faint">Unavailable while demo mode is disabled.</p>
            )}
          </div>
        </Panel>
      </div>

      <Panel className="mt-6">
        <PanelHeader title="What demo mode changes" />
        <ul className="space-y-2 px-5 py-4 text-[13px] text-ink-muted">
          {[
            'Embeddings are deterministic hashed-lexical vectors rather than a trained model, so retrieval matches on term overlap rather than meaning.',
            'Answers are composed by extracting the most relevant sentences from the retrieved passages, never paraphrased or invented.',
            'The seeded accounts can sign in. With demo mode off they are rejected at authentication, so a deployed instance never ships with known credentials.',
            'No external AI service is contacted and no API credentials are required.',
          ].map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-iris" />
              {item}
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
