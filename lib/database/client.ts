import { PrismaClient } from '@prisma/client';

/**
 * Prisma singleton. Next.js dev-mode hot reload re-evaluates modules, so the
 * client is parked on globalThis to avoid exhausting the connection pool.
 */

const globalForPrisma = globalThis as unknown as {
  atlasPrisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.atlasPrisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [
            { level: 'warn', emit: 'stdout' },
            { level: 'error', emit: 'stdout' },
          ]
        : [{ level: 'error', emit: 'stdout' }],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.atlasPrisma = prisma;
}

export type { PrismaClient };
