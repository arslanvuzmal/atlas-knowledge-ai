import { prisma } from '@/lib/database/client';
import type { LifecycleStage } from '@prisma/client';

export interface CompanyData {
  id: string;
  workspaceId: string;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  employeeRange: string | null;
  country: string | null;
  lifecycle: LifecycleStage;
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function associateCompanyByEmail(
  workspaceId: string,
  contactId: string,
  email: string,
): Promise<CompanyData | null> {
  const parts = email.split('@');
  if (parts.length !== 2) return null;
  const domain = parts[1].toLowerCase().trim();

  // Exclude public webmail domains
  const consumerDomains = [
    'gmail.com',
    'yahoo.com',
    'hotmail.com',
    'outlook.com',
    'icloud.com',
    'aol.com',
    'protonmail.com',
    'proton.me',
  ];
  if (consumerDomains.includes(domain)) return null;

  // Infer company name from domain if missing
  const inferredName = domain
    .split('.')[0]
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  let company = await prisma.company.findUnique({
    where: {
      workspaceId_domain: {
        workspaceId,
        domain,
      },
    },
  });

  if (!company) {
    company = await prisma.company.create({
      data: {
        workspaceId,
        name: inferredName,
        domain,
        website: `https://${domain}`,
        source: 'Auto-linked from Email Domain',
      },
    });
  }

  // Link contact to company
  await prisma.contact.update({
    where: { id: contactId },
    data: { companyId: company.id },
  });

  return company;
}

export async function getCompanyById(workspaceId: string, id: string) {
  return prisma.company.findFirst({
    where: { workspaceId, id },
    include: {
      contacts: true,
      deals: true,
      tasks: true,
      tickets: true,
    },
  });
}

export async function listCompanies(
  workspaceId: string,
  options?: { query?: string; limit?: number; offset?: number },
) {
  const { query, limit = 50, offset = 0 } = options ?? {};
  const where: Record<string, unknown> = { workspaceId };
  if (query) {
    where.OR = [
      { name: { contains: query, mode: 'insensitive' } },
      { domain: { contains: query, mode: 'insensitive' } },
    ];
  }

  try {
    const [items, total] = await Promise.all([
      prisma.company.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: { select: { contacts: true, deals: true, tickets: true } },
        },
      }),
      prisma.company.count({ where }),
    ]);

    return { items, total };
  } catch {
    return { items: [], total: 0 };
  }
}
