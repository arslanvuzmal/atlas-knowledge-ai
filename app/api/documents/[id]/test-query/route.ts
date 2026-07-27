import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardRequest } from '@/lib/auth/guard';
import { canReadAccessLevel } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { retrieve } from '@/lib/retrieval/search';
import { getRetrievalSettings } from '@/lib/retrieval/settings';
import { validateQuestion } from '@/lib/retrieval/query';

export const dynamic = 'force-dynamic';

const schema = z.object({ query: z.string() });

/**
 * Runs retrieval against a single document.
 *
 * This is the "test retrieval" affordance on the document detail page. It uses
 * the same pipeline and the same access filter as live chat, so what an
 * administrator sees here is exactly what a user with that role would get.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRequest(request, {
    permission: 'document:read',
    rateLimit: 'chat',
  });
  if (!guard.ok) return guard.response;

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

  const validation = validateQuestion(parsed.data.query);
  if (!validation.ok) return NextResponse.json({ error: validation.reason }, { status: 400 });

  const document = await prisma.document.findUnique({
    where: { id },
    select: { id: true, accessLevel: true, title: true },
  });
  if (!document || !canReadAccessLevel(guard.role, document.accessLevel)) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }

  const settings = await getRetrievalSettings();
  const result = await retrieve({
    question: validation.question,
    role: guard.role,
    documentId: id,
    settings,
  });

  return NextResponse.json({
    documentTitle: document.title,
    confidence: result.confidence.confidence,
    grounding: result.grounding,
    breakdown: result.confidence,
    stats: result.stats,
    matches: result.chunks.map((chunk) => ({
      chunkId: chunk.id,
      chunkIndex: chunk.chunkIndex,
      sectionTitle: chunk.sectionTitle,
      pageNumber: chunk.pageNumber,
      rerankScore: Number(chunk.rerankScore.toFixed(4)),
      signals: {
        coverage: Number(chunk.signals.coverage.toFixed(3)),
        proximity: Number(chunk.signals.proximity.toFixed(3)),
        rarity: Number(chunk.signals.rarity.toFixed(3)),
        titleMatch: Number(chunk.signals.titleMatch.toFixed(3)),
      },
      preview: chunk.content.slice(0, 400),
    })),
  });
}
