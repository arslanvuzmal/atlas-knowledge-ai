import type { Metadata } from 'next';
import { AccessDenied } from '@/components/dashboard/access-denied';
import { EvaluationEditForm } from './EvaluationEditForm';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';

export const metadata: Metadata = { title: 'Edit Evaluation' };
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EvaluationEditPage({ params }: Props) {
  const session = await getSession();
  if (!hasPermission(session.role, 'evaluation:manage')) {
    return <AccessDenied area="evaluations" />;
  }

  const { id } = await params;

  const evaluation = await prisma.evaluation.findUnique({
    where: { id },
    include: {
      knowledgeBase: { select: { id: true, name: true } },
    },
  });

  if (!evaluation) {
    return <div className="p-8 text-center text-ink-faint">Evaluation not found</div>;
  }

  const knowledgeBases = await prisma.knowledgeBase.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  return <EvaluationEditForm evaluation={evaluation as any} knowledgeBases={knowledgeBases} />;
}
