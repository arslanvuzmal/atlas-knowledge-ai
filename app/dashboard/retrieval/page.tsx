import type { Metadata } from 'next';
import { AccessDenied } from '@/components/dashboard/access-denied';
import { RetrievalSettingsForm } from '@/components/dashboard/controls';
import { InlineNote, PageHeader, Panel, PanelHeader } from '@/components/ui/primitives';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { getRetrievalSettings } from '@/lib/retrieval/settings';
import { RERANK_MODEL_NOTE } from '@/lib/reranking';

export const metadata: Metadata = { title: 'Retrieval settings' };
export const dynamic = 'force-dynamic';

export default async function RetrievalSettingsPage() {
  const session = await getSession();
  if (!hasPermission(session.role, 'settings:retrieval:read')) {
    return <AccessDenied area="retrieval configuration" />;
  }

  const settings = await getRetrievalSettings();
  const readOnly = !hasPermission(session.role, 'settings:retrieval:manage');

  return (
    <>
      <PageHeader
        title="Retrieval settings"
        description="How documents are split, how many passages are considered, and where the line falls between a confident answer and an escalation."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader title="Configuration" description="Validated on save and again on read." />
          <RetrievalSettingsForm initial={settings} readOnly={readOnly} />
        </Panel>

        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Pipeline order" />
            <ol className="space-y-3 px-5 py-4 text-sm text-ink-muted">
              {[
                'Validate the question and scan it for injection patterns.',
                'Expand follow-up questions using recent conversation context.',
                'Filter to the caller’s access levels — in SQL, before anything is read.',
                'Retrieve by vector similarity and, if hybrid is on, by full-text search.',
                'Fuse the two ranked lists by reciprocal rank.',
                'Rerank on coverage, proximity, rarity and heading match.',
                'Re-check access on the survivors as defence in depth.',
                'Compute confidence from the evidence, not from the answer.',
                'Generate inside an untrusted-source boundary.',
                'Validate every citation against what was actually retrieved.',
              ].map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="shrink-0 font-mono text-xs text-accent">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[13px] leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel>
            <PanelHeader title="Reranking" />
            <div className="px-5 py-4">
              <p className="text-[13px] leading-relaxed text-ink-muted">{RERANK_MODEL_NOTE}</p>
            </div>
          </Panel>
        </div>
      </div>

      <div className="mt-6">
        <InlineNote tone="warning">
          Chunk size and overlap only affect documents processed <em>after</em> the change. Existing
          documents keep their current passages until you reprocess them from the document library.
        </InlineNote>
      </div>
    </>
  );
}
