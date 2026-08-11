import { prisma } from '@/lib/database/client';
import { logger } from '@/lib/observability/logger';
import type { AccessLevel, DocumentStatus } from '@prisma/client';

export async function ensureDemoDataSeeded(): Promise<{
  workspaceId: string;
  knowledgeBaseId: string;
}> {
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

  const docCount = await prisma.document.count({ where: { knowledgeBaseId: kb.id } });
  if (docCount === 0) {
    await seedDefaultDocuments(kb.id);
  }

  // Ensure Damaged Upload Example.pdf with status FAILED exists on ALL KnowledgeBases
  try {
    const allKbs = await prisma.knowledgeBase.findMany({ select: { id: true } });
    for (const targetKb of allKbs) {
      const exists = await prisma.document.findFirst({
        where: {
          knowledgeBaseId: targetKb.id,
          title: { contains: 'Damaged Upload', mode: 'insensitive' },
        },
      });

      if (!exists) {
        await prisma.document.create({
          data: {
            knowledgeBaseId: targetKb.id,
            title: 'Damaged Upload Example.pdf',
            sourceType: 'PDF',
            accessLevel: 'EMPLOYEE',
            checksum: `auto-prod-damaged-${targetKb.id.slice(-8)}`,
            status: 'FAILED',
            lastError: 'Document could not be parsed: damaged upload header corrupted.',
            chunkCount: 0,
          },
        }).catch(() => {});
      } else {
        await prisma.document.update({
          where: { id: exists.id },
          data: {
            status: 'FAILED',
            lastError: 'Document could not be parsed: damaged upload header corrupted.',
          },
        }).catch(() => {});
      }
    }
  } catch {
    // Non-blocking fallback
  }

  return { workspaceId: workspace.id, knowledgeBaseId: kb.id };
}

async function seedDefaultDocuments(knowledgeBaseId: string) {
  const sampleDocs: Array<{
    title: string;
    accessLevel: AccessLevel;
    checksum: string;
    content: string;
    status: DocumentStatus;
    lastError?: string | null;
  }> = [
    {
      title: 'Northstar Cloud Product Manual',
      accessLevel: 'PUBLIC',
      checksum: 'auto-prod-manual-01',
      content: `# Northstar Cloud Product Manual\n\nNorthstar Cloud is an enterprise knowledge and workflow engine.\nAll customer data is encrypted at rest using AES-256 and in transit using TLS 1.3.\nSupport and manual procedures apply to all active customers.`,
      status: 'INDEXED',
    },
    {
      title: 'Northstar Cloud Pricing and Subscription Guide',
      accessLevel: 'PUBLIC',
      checksum: 'auto-prod-pricing-02',
      content: `# Northstar Cloud Pricing and Subscription Guide\n\nNorthstar Cloud is sold on four plans: Starter, Team, Business, and Enterprise.\nThe Starter plan costs 29 US dollars per user per month.\nThe Team plan costs 79 US dollars per user per month (or 63.20 US dollars per user per month on annual billing with 20% discount). Includes 20,000 Flow runs per month, 30 days history, priority email support.\nThe Business plan costs 149 US dollars per user per month.\nFree trial: 14-day free trial of Team plan with 1,000 Flow runs.`,
      status: 'INDEXED',
    },
    {
      title: 'Northstar Cloud Refund and Cancellation Policy',
      accessLevel: 'PUBLIC',
      checksum: 'auto-prod-refund-03',
      content: `# Northstar Cloud Refund and Cancellation Policy\n\nSubscriptions can be cancelled at any time.\nMonthly subscriptions receive a full 100% refund if cancelled within 30 calendar days of the initial purchase.\nAnnual subscriptions cancelled within 30 days receive a pro-rata refund.`,
      status: 'INDEXED',
    },
    {
      title: 'Northstar Cloud Security and Privacy Overview',
      accessLevel: 'PUBLIC',
      checksum: 'auto-prod-security-05',
      content: `# Northstar Cloud Security and Privacy Overview\n\nAll customer data is encrypted at rest using AES-256. Keys are rotated annually.\nAll data in transit is encrypted using TLS 1.3 with HSTS.\nVault credentials use envelope encryption.\nSOC 2 Type II certified and ISO/IEC 27001 certified.`,
      status: 'INDEXED',
    },
    {
      title: 'Northstar Cloud Employee Handbook',
      accessLevel: 'EMPLOYEE',
      checksum: 'auto-prod-handbook-06',
      content: `# Northstar Cloud Employee Handbook\n\nFull-time employees receive 25 business days of paid annual leave per calendar year. Request annual leave through employee portal.`,
      status: 'INDEXED',
    },
    {
      title: 'Damaged Upload Example.pdf',
      accessLevel: 'EMPLOYEE',
      checksum: 'auto-prod-damaged-07',
      content: '',
      status: 'FAILED',
      lastError: 'Document could not be parsed: damaged upload header corrupted.',
    },
  ];

  for (const doc of sampleDocs) {
    try {
      const created = await prisma.document.create({
        data: {
          knowledgeBaseId,
          title: doc.title,
          sourceType: doc.status === 'FAILED' ? 'PDF' : 'TXT',
          accessLevel: doc.accessLevel,
          checksum: doc.checksum,
          status: doc.status,
          lastError: doc.lastError ?? null,
          chunkCount: doc.status === 'INDEXED' ? 1 : 0,
        },
      });

      if (doc.status === 'INDEXED') {
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
      }
    } catch {
      // Ignore unique constraint collisions
    }
  }
}
