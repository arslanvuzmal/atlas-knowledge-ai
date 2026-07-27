import 'dotenv/config';
import { prisma } from '@/lib/database/client';
import { env } from '@/lib/env';

/**
 * Returns the demo deployment to a clean, reproducible state.
 *
 * Deliberately narrow and guarded: it clears activity and any document created
 * outside the curated Northstar corpus, then leaves the corpus, users, and
 * settings intact. Rebuilding the corpus is `npm run db:seed`, which is the
 * only place that decides what the demo knowledge base contains.
 */

const CURATED_TITLES = new Set([
  'Northstar Cloud Product Manual',
  'Pricing and Subscription Guide',
  'Refund and Cancellation Policy',
  'Customer Support FAQ',
  'Security and Privacy Overview',
  'Employee Handbook',
  'Sales Enablement Guide',
  'Internal Incident Response Procedure',
  'Partner Onboarding Pack (damaged upload)',
]);

function assertSafe(): void {
  const config = env();
  if (config.ALLOW_PRODUCTION_SEED) {
    console.warn('ALLOW_PRODUCTION_SEED is set: proceeding against a non-local database.');
    return;
  }
  const url = config.DATABASE_URL;
  const isLocal =
    url.includes('@localhost') ||
    url.includes('@127.0.0.1') ||
    url.includes('@postgres:') ||
    url.includes('@db:');
  if (!isLocal) {
    throw new Error(
      'Refusing to reset: DATABASE_URL is not local and ALLOW_PRODUCTION_SEED is not "true".',
    );
  }
}

async function main() {
  assertSafe();

  // `--full` additionally drops the corpus so the next seed rebuilds every
  // document from source. Needed after a change to chunking or embeddings,
  // where the stored passages would otherwise reflect the previous code.
  const full = process.argv.includes('--full');

  console.log(`Resetting demo ${full ? 'corpus and activity' : 'activity'}...`);

  const [conversations, logs] = await Promise.all([
    prisma.conversation.count(),
    prisma.retrievalLog.count(),
  ]);

  // Messages, citations, feedback, and escalations cascade from Conversation.
  await prisma.$transaction([
    prisma.retrievalLog.deleteMany({}),
    prisma.conversation.deleteMany({}),
  ]);
  console.log(`  cleared ${conversations} conversations and ${logs} retrieval logs`);

  if (full) {
    // Chunks, versions, and jobs cascade from Document.
    const removed = await prisma.document.deleteMany({});
    console.log(`  removed all ${removed.count} document(s) for a full rebuild`);
  } else {
    // Remove anything a test run or manual trial added, so the library shows
    // only the curated corpus.
    const strays = await prisma.document.findMany({
      where: { title: { notIn: [...CURATED_TITLES] } },
      select: { id: true, title: true },
    });
    if (strays.length > 0) {
      await prisma.document.deleteMany({ where: { id: { in: strays.map((d) => d.id) } } });
      console.log(`  removed ${strays.length} non-curated document(s)`);
    }
  }

  const attempts = await prisma.loginAttempt.deleteMany({});
  console.log(`  cleared ${attempts.count} login attempt record(s)`);

  const audits = await prisma.auditLog.deleteMany({
    where: { action: { in: ['chat.query', 'feedback.create', 'escalation.create'] } },
  });
  console.log(`  cleared ${audits.count} activity audit entr(ies)`);

  console.log('\nDemo activity reset. Run `npm run db:seed` to regenerate sample conversations.');
}

main()
  .catch((error) => {
    console.error('Demo reset failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
