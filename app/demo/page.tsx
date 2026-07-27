import type { Metadata } from 'next';
import Link from 'next/link';
import { ChatPanel } from '@/components/chat/chat-panel';
import { DemoBadge, Wordmark } from '@/components/ui/wordmark';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Public demo',
  description:
    'Ask questions against the public documentation of the fictional Northstar Cloud platform.',
};
export const dynamic = 'force-dynamic';

const SUGGESTIONS = [
  'What is the refund window for an annual subscription?',
  'How much does the Team plan cost per user?',
  'What encryption is used for data at rest?',
  'Why did my Flow stop running?',
  'What is the employee parental leave policy?',
  'Do you offer a native mobile app?',
];

/**
 * Public demo.
 *
 * Anonymous visitors are bound to the PUBLIC role server-side, so this surface
 * can only ever reach documents classified PUBLIC. Two of the suggested
 * questions are deliberately unanswerable — one because it is restricted, one
 * because the corpus does not cover it — so a visitor sees the refusal
 * behaviour without having to think of a trick question.
 */
export default function DemoPage() {
  const demoMode = env().DEMO_MODE;

  return (
    <div className="flex h-screen flex-col">
      <header className="shrink-0 border-b border-edge">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="rounded-md">
            <Wordmark size={24} />
          </Link>
          <div className="flex items-center gap-2">
            {demoMode ? <DemoBadge className="hidden sm:inline-flex" /> : null}
            <Link
              href="/login"
              className="rounded-md border border-edge-strong px-3 py-1.5 text-sm font-medium text-ink transition hover:border-accent hover:text-accent"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <div className="shrink-0 border-b border-edge bg-canvas-sunken px-4 py-2.5 sm:px-6">
        <p className="mx-auto max-w-6xl text-xs text-ink-muted">
          You are browsing anonymously, so only <strong className="text-ink">public</strong> sources
          are reachable. Ask about the employee handbook to see access control refuse an answer. All
          content is fictional.
        </p>
      </div>

      <main id="main" className="min-h-0 flex-1">
        <ChatPanel
          mode="public"
          suggestions={SUGGESTIONS}
          roleLabel="Public visitor"
          reachLabel="Reaches public documentation only"
          demoMode={demoMode}
        />
      </main>
    </div>
  );
}
