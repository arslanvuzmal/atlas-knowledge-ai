import type { Metadata } from 'next';
import { AccessDenied } from '@/components/dashboard/access-denied';
import { AddSourceForms } from '@/components/dashboard/upload-forms';
import { InlineNote, PageHeader, Panel } from '@/components/ui/primitives';
import { getSession } from '@/lib/auth/session';
import { allowedAccessLevels, hasPermission } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { env } from '@/lib/env';
import { SUPPORTED_EXTENSIONS } from '@/lib/security/files';

export const metadata: Metadata = { title: 'Add sources' };
export const dynamic = 'force-dynamic';

export default async function UploadPage() {
  const session = await getSession();
  if (!hasPermission(session.role, 'document:upload')) {
    return <AccessDenied area="source ingestion" />;
  }

  const knowledgeBases = await prisma.knowledgeBase.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });

  return (
    <>
      <PageHeader
        title="Add sources"
        description="Every source is validated, extracted, split into passages, embedded and indexed before it can answer anything."
      />

      {knowledgeBases.length === 0 ? (
        <InlineNote tone="warning">
          There are no knowledge bases yet. Create one before adding sources.
        </InlineNote>
      ) : (
        <>
          <div className="mb-6">
            <InlineNote tone="accent">
              Upload only material you are authorised to index. Do not upload private, confidential
              or personal information into this demonstration deployment.
            </InlineNote>
          </div>

          <Panel>
            <AddSourceForms
              knowledgeBases={knowledgeBases}
              assignableLevels={allowedAccessLevels(session.role)}
              maxSizeMb={env().MAX_UPLOAD_SIZE_MB}
              supportedExtensions={SUPPORTED_EXTENSIONS}
            />
          </Panel>
        </>
      )}
    </>
  );
}
