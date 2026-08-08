import type { Metadata } from 'next';
import { AccessDenied } from '@/components/dashboard/access-denied';
import { EvaluationNewForm } from './EvaluationNewForm';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';

export const metadata: Metadata = { title: 'Create Evaluation' };
export const dynamic = 'force-dynamic';

export default async function EvaluationNewPage() {
  const session = await getSession();
  if (!hasPermission(session.role, 'evaluation:manage')) {
    return <AccessDenied area="evaluations" />;
  }

  const knowledgeBases = await prisma.knowledgeBase.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  return <EvaluationNewForm knowledgeBases={knowledgeBases} />;
}
