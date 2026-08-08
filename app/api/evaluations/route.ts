import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardRequest } from '@/lib/auth/guard';
import { prisma } from '@/lib/database/client';
import { recordAudit } from '@/lib/security/audit';

export const dynamic = 'force-dynamic';

const testCaseSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1).max(2000),
  role: z.enum(['PUBLIC', 'CUSTOMER', 'EMPLOYEE', 'MANAGER', 'ADMIN']),
  expectedBehavior: z.enum(['SHOULD_ANSWER', 'SHOULD_REFUSE']),
  expectedSourceDocuments: z.array(z.string()).optional(),
  expectedConcepts: z.array(z.string()).optional(),
  permittedRole: z.enum(['PUBLIC', 'CUSTOMER', 'EMPLOYEE', 'MANAGER', 'ADMIN']).optional(),
  expectedGrounding: z.enum(['SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED']).optional(),
  minimumConfidence: z.number().min(0).max(1).optional(),
  maximumLatencyMs: z.number().positive().optional(),
  history: z.array(z.object({
    role: z.enum(['USER', 'ASSISTANT']),
    content: z.string(),
  })).optional(),
});

const createSchema = z.object({
  knowledgeBaseId: z.string().cuid(),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  testCases: z.array(testCaseSchema).min(1).max(200),
});

export async function POST(request: Request) {
  const guard = await guardRequest(request, {
    permission: 'evaluation:manage',
    rateLimit: 'mutation',
  });
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 },
    );
  }

  const kb = await prisma.knowledgeBase.findUnique({
    where: { id: parsed.data.knowledgeBaseId },
    select: { id: true },
  });

  if (!kb) {
    return NextResponse.json({ error: 'Knowledge base not found.' }, { status: 404 });
  }

  const created = await prisma.evaluation.create({
    data: {
      knowledgeBaseId: parsed.data.knowledgeBaseId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      testCases: parsed.data.testCases,
    },
  });

  await recordAudit({
    action: 'evaluation.create',
    entityType: 'Evaluation',
    entityId: created.id,
    userId: guard.session.user?.id ?? null,
    newData: { name: created.name, knowledgeBaseId: created.knowledgeBaseId, testCaseCount: Array.isArray(created.testCases) ? created.testCases.length : 0 },
    ip: guard.ip,
  });

  return NextResponse.json({ ok: true, evaluation: created });
}

export async function GET(request: Request) {
  const guard = await guardRequest(request, {
    permission: 'evaluation:read',
    rateLimit: 'api',
  });
  if (!guard.ok) return guard.response;

  const knowledgeBases = await prisma.knowledgeBase.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  const evaluations = await prisma.evaluation.findMany({
    where: { knowledgeBaseId: { in: knowledgeBases.map((kb) => kb.id) } },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    include: {
      knowledgeBase: { select: { name: true } },
      runs: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  return NextResponse.json({ ok: true, evaluations });
}