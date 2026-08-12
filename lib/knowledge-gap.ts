import { prisma } from '@/lib/database/client';
import type { Role } from '@prisma/client';

export interface TrackKnowledgeGapInput {
  question: string;
  role: Role;
  knowledgeBaseId?: string | null;
  retrieval: {
    confidence: number;
    grounding: string;
    chunks: Array<{ documentId: string; documentTitle: string; content: string }>;
  };
  answer: {
    grounding: string;
    text: string;
    escalationSuggested: boolean;
  };
}

export async function trackKnowledgeGap(input: TrackKnowledgeGapInput): Promise<void> {
  if (input.answer.grounding !== 'UNSUPPORTED' && !input.answer.escalationSuggested) {
    return;
  }

  let kbId = input.knowledgeBaseId;
  if (!kbId) {
    const defaultKb = await prisma.knowledgeBase.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    kbId = defaultKb?.id ?? null;
  }

  if (!kbId) return;

  const normalizedTitle = input.question.slice(0, 100).trim();

  try {
    const existing = await prisma.knowledgeGap.findFirst({
      where: {
        knowledgeBaseId: kbId,
        status: 'OPEN',
        title: { equals: normalizedTitle, mode: 'insensitive' },
      },
    });

    if (existing) {
      await prisma.knowledgeGap.update({
        where: { id: existing.id },
        data: {
          occurrenceCount: { increment: 1 },
          lastOccurredAt: new Date(),
        },
      });
    } else {
      await prisma.knowledgeGap.create({
        data: {
          knowledgeBaseId: kbId,
          title: normalizedTitle,
          description: `Users repeatedly ask about this topic but approved knowledge is insufficient. Grounding: ${input.answer.grounding}`,
          status: 'OPEN',
          occurrenceCount: 1,
        },
      });
    }
  } catch {
    // Non-blocking background log
  }
}
