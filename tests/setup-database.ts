import 'dotenv/config';
import { beforeAll } from 'vitest';
import { prisma } from '@/lib/database/client';

/**
 * Shared setup for the database-backed suites.
 *
 * These tests read the seeded Northstar corpus rather than building their own
 * fixtures, because the point is to exercise the real pipeline against real
 * indexed content. The setup asserts the corpus is present and fails with an
 * actionable message rather than producing confusing empty-result failures.
 */
beforeAll(async () => {
  // A container that is still starting refuses connections for a few seconds.
  // Retrying briefly avoids a spurious failure without masking a real outage.
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  if (lastError) {
    throw new Error(
      'Cannot reach the database after 20 seconds. Start it with `npm run db:up` and apply migrations with `npm run db:migrate:deploy`.',
    );
  }

  const indexed = await prisma.document.count({ where: { status: 'INDEXED' } });
  if (indexed === 0) {
    throw new Error(
      'No indexed documents found. Run `npm run db:seed` before the integration, retrieval, and security suites.',
    );
  }

  const embedded = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "DocumentChunk" WHERE "embedding" IS NOT NULL
  `;
  if (Number(embedded[0]?.count ?? 0) === 0) {
    throw new Error('Chunks exist but none carry an embedding. Re-run `npm run db:seed`.');
  }
}, 120_000);
