import { prisma } from '@/lib/database/client';
import { logger } from '@/lib/observability/logger';
import type { AccessLevel } from '@prisma/client';

export async function ensureDemoDataSeeded(): Promise<{
  workspaceId: string;
  knowledgeBaseId: string;
}> {
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
      ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
    `);
  } catch {
    // Ignore schema auto-patch error if DB lacks DDL permissions or columns already exist
  }

  let workspace = await prisma.workspace.findFirst({
    orderBy: { createdAt: 'asc' },
  });

  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        name: 'Northstar Cloud Demo',
        slug: 'northstar-demo',
      },
    });
    logger.info('Auto-created default demo workspace', { workspaceId: workspace.id });
  }

  let kb = await prisma.knowledgeBase.findFirst({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: 'asc' },
  });

  if (!kb) {
    kb = await prisma.knowledgeBase.create({
      data: {
        workspaceId: workspace.id,
        name: 'Northstar Cloud Docs',
        slug: 'northstar-cloud',
      },
    });
    logger.info('Auto-created default demo knowledge base', { knowledgeBaseId: kb.id });
  }

  // Seed standard Northstar Cloud sample documents if 0 documents exist in this KB
  const docCount = await prisma.document.count({ where: { knowledgeBaseId: kb.id } });
  if (docCount === 0) {
    await seedDefaultDocuments(kb.id);
  }

  return { workspaceId: workspace.id, knowledgeBaseId: kb.id };
}

async function seedDefaultDocuments(knowledgeBaseId: string) {
  const sampleDocs = [
    {
      title: 'Northstar Cloud Product Manual',
      accessLevel: 'PUBLIC' as AccessLevel,
      checksum: 'auto-prod-manual-01',
      content: `# Northstar Cloud Product Manual\n\nNorthstar Cloud is an enterprise knowledge and workflow engine.\nAll customer data is encrypted at rest using AES-256 and in transit using TLS 1.3.\nSupport and manual procedures apply to all active customers.`,
    },
    {
      title: 'Northstar Cloud Pricing and Subscription Guide',
      accessLevel: 'PUBLIC' as AccessLevel,
      checksum: 'auto-prod-pricing-02',
      content: `# Northstar Cloud Pricing and Subscription Guide\n\nNorthstar Cloud is sold on four plans: Starter, Team, Business, and Enterprise.\nThe Starter plan costs 29 US dollars per user per month.\nThe Team plan costs 79 US dollars per user per month (or 63.20 US dollars per user per month on annual billing with 20% discount). Includes 20,000 Flow runs per month, 30 days history, priority email support.\nThe Business plan costs 149 US dollars per user per month.\nFree trial: 14-day free trial of Team plan with 1,000 Flow runs.`,
    },
    {
      title: 'Northstar Cloud Refund and Cancellation Policy',
      accessLevel: 'PUBLIC' as AccessLevel,
      checksum: 'auto-prod-refund-03',
      content: `# Northstar Cloud Refund and Cancellation Policy\n\nSubscriptions can be cancelled at any time.\nMonthly subscriptions receive a full 100% refund if cancelled within 30 calendar days of the initial purchase.\nAnnual subscriptions cancelled within 30 days receive a pro-rata refund.`,
    },
    {
      title: 'Northstar Cloud Security and Privacy Overview',
      accessLevel: 'PUBLIC' as AccessLevel,
      checksum: 'auto-prod-security-05',
      content: `# Northstar Cloud Security and Privacy Overview\n\nAll customer data is encrypted at rest using AES-256. Keys are rotated annually.\nAll data in transit is encrypted using TLS 1.3 with HSTS.\nVault credentials use envelope encryption.\nSOC 2 Type II certified and ISO/IEC 27001 certified.`,
    },
    {
      title: 'Northstar Cloud Employee Handbook',
      accessLevel: 'EMPLOYEE' as AccessLevel,
      checksum: 'auto-prod-handbook-06',
      content: `# Northstar Cloud Employee Handbook\n\nFull-time employees receive 25 business days of paid annual leave per calendar year. Request annual leave through employee portal.`,
    },
  ];

  for (const doc of sampleDocs) {
    try {
      const created = await prisma.document.create({
        data: {
          knowledgeBaseId,
          title: doc.title,
          sourceType: 'TXT',
          accessLevel: doc.accessLevel,
          checksum: doc.checksum,
          status: 'INDEXED',
          chunkCount: 1,
        },
      });

      await prisma.documentChunk.create({
        data: {
          knowledgeBaseId,
          documentId: created.id,
          documentVersionId: 'v1',
          chunkIndex: 0,
          content: doc.content,
          accessLevel: doc.accessLevel,
          tokenCount: Math.ceil(doc.content.length / 4),
        },
      });
    } catch {
      // Ignore unique constraint collisions if seeded concurrently
    }
  }
}
