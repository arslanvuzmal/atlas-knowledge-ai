import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardRequest } from '@/lib/auth/guard';
import { prisma } from '@/lib/database/client';
import { recordAudit } from '@/lib/security/audit';

export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  _action: z.literal('update'),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  testCases: z.array(z.object({
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
  })).min(1).max(200),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await guardRequest(request, {
    permission: 'evaluation:read',
    rateLimit: 'api',
  });
  if (!guard.ok) return guard.response;

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
    return NextResponse.json({ error: 'Evaluation not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, evaluation });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await guardRequest(request, {
    permission: 'evaluation:manage',
    rateLimit: 'mutation',
  });
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 },
    );
  }

  const existing = await prisma.evaluation.findUnique({
    where: { id },
    select: { name: true, description: true, testCases: true, knowledgeBaseId: true },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Evaluation not found.' }, { status: 404 });
  }

  const updated = await prisma.evaluation.update({
    where: { id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      testCases: parsed.data.testCases,
    },
    select: {
      id: true,
      name: true,
      description: true,
      testCases: true,
      knowledgeBaseId: true,
      updatedAt: true,
    },
  });

  await recordAudit({
    action: 'evaluation.update',
    entityType: 'Evaluation',
    entityId: updated.id,
    userId: guard.session.user?.id ?? null,
    previousData: { name: existing.name, description: existing.description, testCaseCount: Array.isArray(existing.testCases) ? existing.testCases.length : 0 },
    newData: { name: updated.name, description: updated.description, testCaseCount: Array.isArray(updated.testCases) ? updated.testCases.length : 0 },
    ip: guard.ip,
  });

  return NextResponse.json({ ok: true, evaluation: updated });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await guardRequest(request, {
    permission: 'evaluation:manage',
    rateLimit: 'mutation',
  });
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const existing = await prisma.evaluation.findUnique({
    where: { id },
    select: { id: true, name: true, knowledgeBaseId: true },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Evaluation not found.' }, { status: 404 });
  }

  await prisma.evaluation.delete({ where: { id } });

  await recordAudit({
    action: 'evaluation.delete',
    entityType: 'Evaluation',
    entityId: existing.id,
    userId: guard.session.user?.id ?? null,
    previousData: { name: existing.name, knowledgeBaseId: existing.knowledgeBaseId },
    ip: guard.ip,
  });

  return NextResponse.json({ ok: true });
}