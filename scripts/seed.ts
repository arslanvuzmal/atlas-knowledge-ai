import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { AccessLevel, Role } from '@prisma/client';
import { prisma } from '@/lib/database/client';
import { env } from '@/lib/env';
import { hashPassword } from '@/lib/auth/password';
import { ingestSource } from '@/lib/documents/ingest';
import { ask, submitFeedback } from '@/lib/chat/service';
import {
  defaultModelSettings,
  defaultRetrievalSettings,
  MODEL_SETTINGS_KEY,
  RETRIEVAL_SETTINGS_KEY,
} from '@/lib/retrieval/settings';
import { ensureRetrievalIndexes } from './ensure-indexes';

/**
 * Demo seed.
 *
 * Everything here is fictional. The seed deliberately runs documents through
 * the *real* ingestion pipeline and questions through the *real* chat pipeline
 * rather than inserting pre-baked rows. That means the analytics, retrieval
 * logs, citations, and escalations on the dashboard are genuine outputs of the
 * system, not fixtures shaped to look good in a screenshot.
 */

const DEMO_PASSWORD = 'AtlasDemo!2026';

interface DemoUserSpec {
  name: string;
  email: string;
  role: Role;
}

const DEMO_USERS: DemoUserSpec[] = [
  { name: 'Amara Osei', email: 'admin@atlasknowledge.demo', role: 'ADMIN' },
  { name: 'Rohan Patel', email: 'manager@atlasknowledge.demo', role: 'MANAGER' },
  { name: 'Lena Fischer', email: 'employee@atlasknowledge.demo', role: 'EMPLOYEE' },
  { name: 'Diego Marin', email: 'customer@atlasknowledge.demo', role: 'CUSTOMER' },
  { name: 'Sam Rivera', email: 'viewer@atlasknowledge.demo', role: 'PUBLIC' },
];

const DOCUMENT_ACCESS: Record<string, { accessLevel: AccessLevel; title: string }> = {
  '01-product-manual.md': { accessLevel: 'PUBLIC', title: 'Northstar Cloud Product Manual' },
  '02-pricing-guide.md': { accessLevel: 'PUBLIC', title: 'Pricing and Subscription Guide' },
  '03-refund-policy.md': { accessLevel: 'PUBLIC', title: 'Refund and Cancellation Policy' },
  '04-support-faq.md': { accessLevel: 'PUBLIC', title: 'Customer Support FAQ' },
  '05-security-overview.md': { accessLevel: 'PUBLIC', title: 'Security and Privacy Overview' },
  '06-employee-handbook.md': { accessLevel: 'EMPLOYEE', title: 'Employee Handbook' },
  '07-sales-enablement.md': { accessLevel: 'EMPLOYEE', title: 'Sales Enablement Guide' },
  '08-incident-response.md': {
    accessLevel: 'MANAGER',
    title: 'Internal Incident Response Procedure',
  },
};

/**
 * Refuses to run against anything that does not look like a local or explicitly
 * sanctioned database. Reseeding a production database would destroy customer
 * data, so this guard fails closed.
 */
function assertSafeToSeed(): void {
  const config = env();
  if (config.ALLOW_PRODUCTION_SEED) {
    console.warn('ALLOW_PRODUCTION_SEED is true: seeding a non-local database as instructed.');
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
      'Refusing to seed: DATABASE_URL does not point at a local database and ALLOW_PRODUCTION_SEED is not "true".',
    );
  }
  if (config.NODE_ENV === 'production' && !config.ALLOW_PRODUCTION_SEED) {
    throw new Error(
      'Refusing to seed: NODE_ENV is production and ALLOW_PRODUCTION_SEED is not "true".',
    );
  }
}

async function seedUsers(): Promise<Map<string, { id: string; role: Role }>> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const users = new Map<string, { id: string; role: Role }>();

  for (const spec of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { email: spec.email },
      create: {
        name: spec.name,
        email: spec.email,
        passwordHash,
        role: spec.role,
        status: 'ACTIVE',
        isDemo: true,
      },
      update: { name: spec.name, role: spec.role, passwordHash, isDemo: true, status: 'ACTIVE' },
      select: { id: true, role: true },
    });
    users.set(spec.email, user);
  }

  console.log(`  users: ${users.size} demo accounts ready`);
  return users;
}

async function seedSettings(adminId: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: RETRIEVAL_SETTINGS_KEY },
    create: { key: RETRIEVAL_SETTINGS_KEY, value: defaultRetrievalSettings(), updatedBy: adminId },
    update: {},
  });
  await prisma.systemSetting.upsert({
    where: { key: MODEL_SETTINGS_KEY },
    create: { key: MODEL_SETTINGS_KEY, value: defaultModelSettings(), updatedBy: adminId },
    update: {},
  });

  const integrations = [
    {
      type: 'embedding',
      name: 'Deterministic demo embeddings',
      status: 'CONNECTED' as const,
      configurationMetadata: { provider: 'demo', dimensions: env().EMBEDDING_DIMENSIONS },
    },
    {
      type: 'llm',
      name: 'Deterministic demo generator',
      status: 'CONNECTED' as const,
      configurationMetadata: { provider: 'demo' },
    },
    {
      type: 'storage',
      name: 'Local filesystem storage',
      status: 'CONNECTED' as const,
      configurationMetadata: { provider: 'local' },
    },
    {
      type: 'llm',
      name: 'OpenAI',
      status: 'NOT_CONFIGURED' as const,
      configurationMetadata: { requires: 'OPENAI_API_KEY' },
    },
    {
      type: 'llm',
      name: 'Anthropic',
      status: 'NOT_CONFIGURED' as const,
      configurationMetadata: { requires: 'ANTHROPIC_API_KEY' },
    },
    {
      type: 'storage',
      name: 'Supabase Storage',
      status: 'NOT_CONFIGURED' as const,
      configurationMetadata: { requires: 'SUPABASE_SERVICE_ROLE_KEY' },
    },
  ];

  for (const integration of integrations) {
    await prisma.integration.upsert({
      where: { type_name: { type: integration.type, name: integration.name } },
      create: integration,
      update: {
        status: integration.status,
        configurationMetadata: integration.configurationMetadata,
      },
    });
  }

  console.log(`  settings: retrieval, model, and ${integrations.length} integration records ready`);
}

async function seedDocuments(knowledgeBaseId: string, adminId: string): Promise<void> {
  const corpusDir = path.resolve(process.cwd(), 'sample-data', 'northstar');
  const files = (await readdir(corpusDir)).filter((file) => file.endsWith('.md')).sort();

  for (const file of files) {
    const spec = DOCUMENT_ACCESS[file];
    if (!spec) {
      console.warn(`  documents: no access mapping for ${file}, skipped`);
      continue;
    }

    const bytes = await readFile(path.join(corpusDir, file));
    const result = await ingestSource({
      knowledgeBaseId,
      title: spec.title,
      accessLevel: spec.accessLevel,
      sourceType: 'MARKDOWN',
      bytes,
      originalFilename: file,
      mimeType: 'text/markdown',
      uploadedBy: adminId,
    });

    if (result.ok) {
      console.log(
        `  documents: indexed "${spec.title}" [${spec.accessLevel}] -> ${result.chunkCount} chunks`,
      );
    } else if (result.duplicateOf) {
      console.log(`  documents: "${spec.title}" already present, skipped`);
    } else {
      console.warn(`  documents: FAILED "${spec.title}": ${result.error?.message}`);
    }
  }

  // A deliberately corrupt file, so the dashboard shows a real failure state and
  // the retry path has something to act on.
  const corrupt = Buffer.from('%PDF-1.7\nthis file is intentionally truncated and unparseable');
  const failed = await ingestSource({
    knowledgeBaseId,
    title: 'Partner Onboarding Pack (damaged upload)',
    accessLevel: 'PUBLIC',
    sourceType: 'PDF',
    bytes: corrupt,
    originalFilename: 'partner-onboarding-pack.pdf',
    mimeType: 'application/pdf',
    uploadedBy: adminId,
  });
  console.log(
    `  documents: simulated failure "${failed.ok ? 'unexpectedly succeeded' : failed.error?.stage}" recorded`,
  );
}

interface SeedTurn {
  email: string;
  question: string;
  /** Continue the previous conversation for this user rather than starting a new one. */
  followUp?: boolean;
  feedback?: 'HELPFUL' | 'PARTIALLY_HELPFUL' | 'NOT_HELPFUL';
  feedbackReason?: 'INCORRECT_ANSWER' | 'MISSING_INFORMATION' | 'TOO_VAGUE' | 'ACCESS_ISSUE';
  daysAgo: number;
}

const SEED_TURNS: SeedTurn[] = [
  {
    email: 'viewer@atlasknowledge.demo',
    question: 'What is the refund window for an annual subscription?',
    feedback: 'HELPFUL',
    daysAgo: 9,
  },
  {
    email: 'viewer@atlasknowledge.demo',
    question: 'Does that apply to monthly plans as well?',
    followUp: true,
    feedback: 'HELPFUL',
    daysAgo: 9,
  },
  {
    email: 'customer@atlasknowledge.demo',
    question: 'How much does the Team plan cost per user?',
    feedback: 'HELPFUL',
    daysAgo: 8,
  },
  {
    email: 'customer@atlasknowledge.demo',
    question: 'Is there a discount for paying annually?',
    followUp: true,
    daysAgo: 8,
  },
  {
    email: 'viewer@atlasknowledge.demo',
    question: 'How long is the free trial and do I need a credit card?',
    feedback: 'HELPFUL',
    daysAgo: 7,
  },
  {
    email: 'customer@atlasknowledge.demo',
    question: 'What encryption do you use for data at rest?',
    feedback: 'HELPFUL',
    daysAgo: 6,
  },
  {
    email: 'viewer@atlasknowledge.demo',
    question: 'Are you HIPAA compliant?',
    feedback: 'HELPFUL',
    daysAgo: 6,
  },
  {
    email: 'employee@atlasknowledge.demo',
    question: 'How many days of annual leave do employees receive?',
    feedback: 'HELPFUL',
    daysAgo: 5,
  },
  {
    email: 'employee@atlasknowledge.demo',
    question: 'How much of that can be carried over to next year?',
    followUp: true,
    daysAgo: 5,
  },
  {
    email: 'manager@atlasknowledge.demo',
    question: 'Who is allowed to act as Incident Commander for a SEV1?',
    feedback: 'HELPFUL',
    daysAgo: 4,
  },
  {
    email: 'manager@atlasknowledge.demo',
    question: 'When does the 72 hour notification clock start?',
    followUp: true,
    feedback: 'HELPFUL',
    daysAgo: 4,
  },
  {
    email: 'customer@atlasknowledge.demo',
    question: 'What happens to my data 90 days after I cancel?',
    feedback: 'HELPFUL',
    daysAgo: 3,
  },
  {
    email: 'viewer@atlasknowledge.demo',
    question: 'Why did my Flow stop running?',
    feedback: 'PARTIALLY_HELPFUL',
    feedbackReason: 'MISSING_INFORMATION',
    daysAgo: 3,
  },
  {
    email: 'customer@atlasknowledge.demo',
    question: 'What is the parental leave policy for employees?',
    feedback: 'NOT_HELPFUL',
    feedbackReason: 'ACCESS_ISSUE',
    daysAgo: 2,
  },
  {
    email: 'viewer@atlasknowledge.demo',
    question: 'Do you offer a native mobile application for iOS?',
    daysAgo: 2,
  },
  {
    email: 'admin@atlasknowledge.demo',
    question: 'What are the audit log retention periods per plan?',
    feedback: 'HELPFUL',
    daysAgo: 1,
  },
  {
    email: 'viewer@atlasknowledge.demo',
    question: 'What is the maximum number of steps in a single Flow run?',
    feedback: 'HELPFUL',
    daysAgo: 1,
  },
  {
    email: 'employee@atlasknowledge.demo',
    question: 'How should I handle a prospect asking about HIPAA?',
    feedback: 'HELPFUL',
    daysAgo: 1,
  },
];

async function seedConversations(
  users: Map<string, { id: string; role: Role }>,
  knowledgeBaseId: string,
): Promise<void> {
  const activeConversation = new Map<string, string>();
  let supported = 0;
  let unsupported = 0;
  let escalations = 0;

  for (const turn of SEED_TURNS) {
    const user = users.get(turn.email);
    if (!user) continue;

    const result = await ask({
      question: turn.question,
      role: user.role,
      userId: user.id,
      conversationId: turn.followUp ? (activeConversation.get(turn.email) ?? null) : null,
      knowledgeBaseId,
    });

    activeConversation.set(turn.email, result.conversationId);
    if (result.answer.grounding === 'UNSUPPORTED') unsupported += 1;
    else supported += 1;
    if (result.escalationId) escalations += 1;

    if (turn.feedback) {
      await submitFeedback({
        messageId: result.messageId,
        userId: user.id,
        rating: turn.feedback,
        reason: turn.feedbackReason ?? null,
      });
    }

    // Backdate the turn so the activity chart shows a realistic spread rather
    // than every question landing in the same minute.
    const timestamp = new Date(Date.now() - turn.daysAgo * 24 * 60 * 60 * 1000);
    await prisma.$executeRaw`
      UPDATE "Message" SET "createdAt" = ${timestamp} WHERE "conversationId" = ${result.conversationId}
    `;
    await prisma.$executeRaw`
      UPDATE "RetrievalLog" SET "createdAt" = ${timestamp} WHERE "conversationId" = ${result.conversationId}
    `;
    await prisma.$executeRaw`
      UPDATE "Conversation" SET "createdAt" = ${timestamp}, "updatedAt" = ${timestamp} WHERE "id" = ${result.conversationId}
    `;
  }

  console.log(
    `  conversations: ${SEED_TURNS.length} questions asked (${supported} answered, ${unsupported} unsupported), ${escalations} escalations raised`,
  );
}

async function seedEscalationStates(users: Map<string, { id: string; role: Role }>): Promise<void> {
  const manager = users.get('manager@atlasknowledge.demo');
  if (!manager) return;

  const open = await prisma.escalation.findMany({ orderBy: { createdAt: 'asc' }, take: 3 });
  if (open.length === 0) return;

  if (open[0]) {
    await prisma.escalation.update({
      where: { id: open[0].id },
      data: {
        status: 'RESOLVED',
        assignedTo: manager.id,
        resolutionNote:
          'Confirmed the handbook is employee-restricted. Replied to the customer with the public support policy instead.',
      },
    });
  }
  if (open[1]) {
    await prisma.escalation.update({
      where: { id: open[1].id },
      data: { status: 'IN_PROGRESS', assignedTo: manager.id },
    });
  }

  console.log('  escalations: assigned and progressed a sample for the queue view');
}

async function main() {
  console.log('Seeding Atlas Knowledge AI demo data...');
  assertSafeToSeed();

  const indexes = await ensureRetrievalIndexes();
  if (indexes.created.length > 0) {
    console.log(`  indexes: restored ${indexes.created.join(', ')}`);
  }

  const users = await seedUsers();
  const admin = users.get('admin@atlasknowledge.demo');
  if (!admin) throw new Error('Admin demo user was not created.');

  await seedSettings(admin.id);

  const knowledgeBase = await prisma.knowledgeBase.upsert({
    where: { slug: 'northstar-cloud' },
    create: {
      name: 'Northstar Cloud Knowledge Base',
      slug: 'northstar-cloud',
      description:
        'Approved product, pricing, policy, and internal documentation for the fictional Northstar Cloud platform.',
      visibility: 'INTERNAL',
      ownerId: admin.id,
    },
    update: { ownerId: admin.id },
  });
  console.log(`  knowledge base: "${knowledgeBase.name}" ready`);

  const existingDocuments = await prisma.document.count({
    where: { knowledgeBaseId: knowledgeBase.id },
  });

  if (existingDocuments > 0) {
    console.log(`  documents: ${existingDocuments} already present, skipping ingestion`);
  } else {
    await seedDocuments(knowledgeBase.id, admin.id);
  }

  const existingConversations = await prisma.conversation.count();
  if (existingConversations > 0) {
    console.log(`  conversations: ${existingConversations} already present, skipping`);
  } else {
    await seedConversations(users, knowledgeBase.id);
    await seedEscalationStates(users);
  }

  console.log('\nSeed complete.');
  console.log('Demo sign-in (only valid while DEMO_MODE=true):');
  for (const spec of DEMO_USERS) {
    console.log(`  ${spec.role.padEnd(9)} ${spec.email}  /  ${DEMO_PASSWORD}`);
  }
}

main()
  .catch((error) => {
    console.error('\nSeed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
