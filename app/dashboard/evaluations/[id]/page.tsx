import type { Metadata } from 'next';
import { AccessDenied } from '@/components/dashboard/access-denied';
import { EvaluationDetail } from './EvaluationDetail';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';

export const metadata: Metadata = { title: 'Evaluation Details' };
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EvaluationDetailPage({ params }: Props) {
  const session = await getSession();
  if (!hasPermission(session.role, 'evaluation:read')) {
    return <AccessDenied area="evaluations" />;
  }

  const { id } = await params;

  const evaluation = await prisma.evaluation.findUnique({
    where: { id },
    include: {
      knowledgeBase: { select: { id: true, name: true } },
      runs: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          evaluation: { select: { name: true } },
        },
      },
    },
  });

  if (!evaluation) {
    return <div className="p-8 text-center text-ink-faint">Evaluation not found</div>;
  }

  return <EvaluationDetail evaluation={evaluation as any} />;
}