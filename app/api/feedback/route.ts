import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardRequest } from '@/lib/auth/guard';
import { submitFeedback } from '@/lib/chat/service';

export const dynamic = 'force-dynamic';

const schema = z.object({
  messageId: z.string().cuid(),
  rating: z.enum(['HELPFUL', 'PARTIALLY_HELPFUL', 'NOT_HELPFUL']),
  reason: z
    .enum([
      'INCORRECT_ANSWER',
      'MISSING_INFORMATION',
      'WRONG_SOURCE',
      'OUTDATED_INFORMATION',
      'TOO_VAGUE',
      'ACCESS_ISSUE',
      'OTHER',
    ])
    .nullish(),
  comment: z.string().max(2000).nullish(),
});

export async function POST(request: Request) {
  const guard = await guardRequest(request, {
    allowAnonymous: true,
    permission: 'feedback:create',
    rateLimit: 'feedback',
  });
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid feedback submission.' }, { status: 400 });
  }

  const result = await submitFeedback({
    messageId: parsed.data.messageId,
    userId: guard.session.user?.id ?? null,
    rating: parsed.data.rating,
    reason: parsed.data.reason ?? null,
    comment: parsed.data.comment ?? null,
    ip: guard.ip,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    feedbackId: result.feedbackId,
    escalationId: result.escalationId ?? null,
  });
}
