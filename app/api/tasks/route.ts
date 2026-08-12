import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/auth/guard';
import { processOutboxEvents } from '@/lib/outbox/worker';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  // Allow internal caller with secret OR authenticated admin user
  const internalSecret = process.env.INTERNAL_API_SECRET;
  const authHeader = request.headers.get('authorization');
  const isInternal = Boolean(internalSecret) && authHeader === `Bearer ${internalSecret}`;

  if (!isInternal) {
    const guard = await guardRequest(request, { permission: 'settings:models:manage' });
    if (!guard.ok) return guard.response;
  }

  try {
    const processedCount = await processOutboxEvents(25);
    logger.info('Outbox background worker completed', { processedCount });

    return NextResponse.json({
      ok: true,
      processedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Outbox background worker failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json({ error: 'Outbox task processing failed.' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
