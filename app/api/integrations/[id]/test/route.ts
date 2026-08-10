import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/auth/guard';
import { prisma } from '@/lib/database/client';
import { getEmbeddingProvider } from '@/lib/embeddings';
import { getLlmProvider } from '@/lib/ai';
import { getStorage } from '@/lib/storage';
import { recordAudit } from '@/lib/security/audit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRequest(request, {
    permission: 'integration:manage',
    rateLimit: 'mutation',
  });
  if (!guard.ok) return guard.response;

  const { id } = await context.params;

  const integration = await prisma.integration.findUnique({
    where: { id },
    select: { id: true, type: true, name: true, status: true, configurationMetadata: true },
  });

  if (!integration) {
    return NextResponse.json({ error: 'Integration not found.' }, { status: 404 });
  }

  let testResult: {
    status: 'operational' | 'degraded' | 'unavailable' | 'misconfigured';
    detail: string;
    latencyMs: number;
  } | null = null;

  try {
    switch (integration.type) {
      case 'embedding': {
        const provider = getEmbeddingProvider();
        const start = Date.now();
        const health = await provider.healthCheck();
        testResult = {
          status:
            health.status === 'operational'
              ? 'operational'
              : health.status === 'degraded'
                ? 'degraded'
                : health.status === 'misconfigured'
                  ? 'misconfigured'
                  : 'unavailable',
          detail: health.detail,
          latencyMs: Date.now() - start,
        };
        break;
      }
      case 'llm': {
        const provider = getLlmProvider();
        const start = Date.now();
        const health = await provider.healthCheck();
        testResult = {
          status:
            health.status === 'operational'
              ? 'operational'
              : health.status === 'degraded'
                ? 'degraded'
                : health.status === 'misconfigured'
                  ? 'misconfigured'
                  : 'unavailable',
          detail: health.detail,
          latencyMs: Date.now() - start,
        };
        break;
      }
      case 'storage': {
        const storage = getStorage();
        const start = Date.now();
        const health = await storage.healthCheck();
        testResult = {
          status:
            health.status === 'operational'
              ? 'operational'
              : health.status === 'degraded'
                ? 'degraded'
                : health.status === 'misconfigured'
                  ? 'misconfigured'
                  : 'unavailable',
          detail: health.detail,
          latencyMs: Date.now() - start,
        };
        break;
      }
      default:
        return NextResponse.json(
          { error: 'Unsupported integration type for testing.' },
          { status: 400 },
        );
    }
  } catch (error) {
    testResult = {
      status: 'unavailable',
      detail: error instanceof Error ? error.message : 'Test failed',
      latencyMs: 0,
    };
  }

  // Update integration status in database
  const statusEnum: 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'NOT_CONFIGURED' =
    testResult?.status === 'operational' ? 'CONNECTED' : 'ERROR';

  await prisma.integration.update({
    where: { id },
    data: {
      status: statusEnum,
      lastCheckedAt: new Date(),
    },
  });

  await recordAudit({
    action: 'integration.test',
    entityType: 'Integration',
    entityId: integration.id,
    userId: guard.session.user?.id ?? null,
    newData: {
      status: testResult?.status,
      detail: testResult?.detail,
      latencyMs: testResult?.latencyMs,
    },
    ip: guard.ip,
  });

  return NextResponse.json({
    ok: true,
    integration: {
      id: integration.id,
      name: integration.name,
      type: integration.type,
      status: testResult?.status,
      detail: testResult?.detail,
      latencyMs: testResult?.latencyMs,
      checkedAt: new Date().toISOString(),
    },
  });
}
