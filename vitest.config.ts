import { defineConfig } from 'vitest/config';
import path from 'node:path';

const alias = { '@': path.resolve(__dirname, '.') };

/**
 * Four projects rather than one suite.
 *
 * Unit tests are pure and fast. Integration, retrieval, and security tests all
 * need a live database and the seeded corpus, so file parallelism is disabled
 * globally: concurrent suites would otherwise contend over the same rows.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    globals: false,
    fileParallelism: false,
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup-database.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'retrieval',
          include: ['tests/retrieval/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup-database.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'security',
          include: ['tests/security/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup-database.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
