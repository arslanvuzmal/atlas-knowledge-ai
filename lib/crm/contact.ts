import type {
  Prisma,
  Contact,
  CustomerIntelligence,
  LifecycleStage,
  LeadStatus,
} from '@prisma/client';
import { prisma } from '@/lib/database/client';

export interface ResolveIdentityInput {
  workspaceId: string;
  visitorKey?: string;
  email?: string;
  name?: string;
  phone?: string;
  companyName?: string;
  companyDomain?: string;
  source?: string;
  sourceDetail?: string;
}

export type ContactData = Contact & {
  intelligence?: CustomerIntelligence | null;
  company?: { id: string; name: string; domain: string | null } | null;
};

export interface ListContactsOptions {
  query?: string;
  lifecycleStage?: string;
  leadStatus?: string;
  companyId?: string;
  leadTier?: string;
  minScore?: number;
  maxScore?: number;
  primaryIntent?: string;
  source?: string;
  sort?:
    | 'score_desc'
    | 'score_asc'
    | 'created_desc'
    | 'created_asc'
    | 'name_asc'
    | 'name_desc'
    | 'activity_desc'
    | 'activity_asc';
  limit?: number;
  offset?: number;
}

export async function resolveIdentity(input: ResolveIdentityInput): Promise<ContactData> {
  const {
    workspaceId: inputWorkspaceId,
    visitorKey,
    email,
    name,
    phone,
    companyName,
    companyDomain,
    source = 'CHAT',
    sourceDetail,
  } = input;

  let workspaceId = inputWorkspaceId;
  const dbWs = await prisma.workspace.findFirst().catch(() => null);
  if (dbWs) {
    workspaceId = dbWs.id;
  }

  // 1. Match by Email if provided
  if (email && email.trim()) {
    const normalized = email.trim().toLowerCase();

    let companyId: string | undefined;
    if (companyName || companyDomain) {
      const existingCompany = await prisma.company.findFirst({
        where: {
          workspaceId,
          OR: [
            ...(companyDomain ? [{ domain: companyDomain.toLowerCase() }] : []),
            ...(companyName
              ? [{ name: { equals: companyName, mode: 'insensitive' as const } }]
              : []),
          ],
        },
      });

      if (existingCompany) {
        companyId = existingCompany.id;
      } else if (companyName) {
        const newCompany = await prisma.company
          .create({
            data: {
              workspaceId,
              name: companyName,
              domain: companyDomain?.toLowerCase() ?? null,
            },
          })
          .catch(() => null);
        if (newCompany) companyId = newCompany.id;
      }
    }

    const contact = await prisma.contact.findUnique({
      where: {
        workspaceId_normalizedEmail: {
          workspaceId,
          normalizedEmail: normalized,
        },
      },
    });

    const parsedNames = parseName(name);

    if (contact) {
      const updated = await prisma.contact.update({
        where: { id: contact.id },
        data: {
          firstName: contact.firstName ?? parsedNames.firstName,
          lastName: contact.lastName ?? parsedNames.lastName,
          displayName:
            contact.displayName !== 'Anonymous Visitor' && contact.displayName !== 'Visitor'
              ? contact.displayName
              : (name ?? contact.displayName),
          phone: contact.phone ?? phone,
          visitorKey: contact.visitorKey ?? visitorKey,
          companyId: contact.companyId ?? companyId,
          lastSeenAt: new Date(),
          lastActivityAt: new Date(),
        },
      });
      return updated;
    } else {
      const created = await prisma.contact.create({
        data: {
          workspaceId,
          companyId,
          firstName: parsedNames.firstName,
          lastName: parsedNames.lastName,
          displayName: name ?? (normalized.split('@')[0] || 'Identified Customer'),
          primaryEmail: email,
          normalizedEmail: normalized,
          phone,
          visitorKey,
          lifecycleStage: 'LEAD',
          leadStatus: 'NEW',
          source,
          sourceDetail,
        },
      });

      await prisma.crmActivity
        .create({
          data: {
            workspaceId,
            contactId: created.id,
            type: 'CONTACT_IDENTIFIED',
            title: 'Contact Identified',
            description: `Identified contact ${created.displayName} (${created.primaryEmail})`,
            metadata: { provenance: 'PROVIDED', source },
          },
        })
        .catch(() => null);

      return created;
    }
  }

  // 2. Match by Visitor Key
  if (visitorKey && visitorKey.trim()) {
    const existing = await prisma.contact.findFirst({
      where: {
        workspaceId,
        visitorKey: visitorKey.trim(),
      },
    });

    if (existing) {
      const parsedNames = parseName(name);
      const updated = await prisma.contact.update({
        where: { id: existing.id },
        data: {
          displayName: name ?? existing.displayName,
          firstName: existing.firstName ?? parsedNames.firstName,
          lastName: existing.lastName ?? parsedNames.lastName,
          lastSeenAt: new Date(),
          lastActivityAt: new Date(),
        },
      });
      return updated;
    } else {
      const parsedNames = parseName(name);
      const created = await prisma.contact.create({
        data: {
          workspaceId,
          visitorKey: visitorKey.trim(),
          displayName: name ?? 'Anonymous Visitor',
          firstName: parsedNames.firstName,
          lastName: parsedNames.lastName,
          lifecycleStage: 'VISITOR',
          leadStatus: 'NEW',
          source,
        },
      });

      await prisma.crmActivity
        .create({
          data: {
            workspaceId,
            contactId: created.id,
            type: 'VISITOR_CREATED',
            title: 'Visitor Created',
            description: `New visitor session started (${visitorKey})`,
          },
        })
        .catch(() => null);

      return created;
    }
  }

  // 3. Fallback default contact creation
  const fallback = await prisma.contact.create({
    data: {
      workspaceId,
      displayName: name ?? 'Anonymous Visitor',
      lifecycleStage: 'VISITOR',
      leadStatus: 'NEW',
      source,
    },
  });

  return fallback;
}

function parseName(fullName?: string): { firstName: string | null; lastName: string | null } {
  if (!fullName || !fullName.trim()) return { firstName: null, lastName: null };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

export async function getContactById(workspaceId: string, id: string): Promise<ContactData | null> {
  try {
    return await prisma.contact.findFirst({
      where: { workspaceId, id },
    });
  } catch {
    return null;
  }
}

export async function listContacts(workspaceId: string, options?: ListContactsOptions) {
  const {
    query,
    lifecycleStage,
    leadStatus,
    companyId,
    source,
    sort = 'activity_desc',
    limit = 50,
    offset = 0,
  } = options ?? {};

  const where: Prisma.ContactWhereInput = { workspaceId, archivedAt: null };

  if (lifecycleStage) where.lifecycleStage = lifecycleStage as LifecycleStage;
  if (leadStatus) where.leadStatus = leadStatus as LeadStatus;
  if (companyId) where.companyId = companyId;
  if (source) where.source = source;

  if (query && query.trim()) {
    const q = query.trim();
    where.OR = [
      { displayName: { contains: q, mode: 'insensitive' } },
      { primaryEmail: { contains: q, mode: 'insensitive' } },
      { company: { name: { contains: q, mode: 'insensitive' } } },
    ];
  }

  let orderBy: Prisma.ContactOrderByWithRelationInput = { lastActivityAt: 'desc' };
  if (sort === 'score_desc') orderBy = { leadScore: 'desc' };
  else if (sort === 'score_asc') orderBy = { leadScore: 'asc' };
  else if (sort === 'created_desc') orderBy = { createdAt: 'desc' };
  else if (sort === 'created_asc') orderBy = { createdAt: 'asc' };
  else if (sort === 'name_asc') orderBy = { displayName: 'asc' };
  else if (sort === 'name_desc') orderBy = { displayName: 'desc' };
  else if (sort === 'activity_asc') orderBy = { lastActivityAt: 'asc' };

  try {
    let [items, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy,
        include: {
          company: { select: { id: true, name: true, domain: true } },
          intelligence: true,
        },
      }),
      prisma.contact.count({ where }),
    ]);

    if (items.length === 0) {
      const globalWhere = { ...where };
      delete globalWhere.workspaceId;
      const [fallbackItems, fallbackTotal] = await Promise.all([
        prisma.contact.findMany({
          where: globalWhere,
          take: limit,
          skip: offset,
          orderBy,
          include: {
            company: { select: { id: true, name: true, domain: true } },
            intelligence: true,
          },
        }),
        prisma.contact.count({ where: globalWhere }),
      ]);
      if (fallbackItems.length > 0) {
        items = fallbackItems;
        total = fallbackTotal;
      }
    }

    return { items, total };
  } catch (err: unknown) {
    console.error('listContacts query failed:', err);
    try {
      const fallbackItems = await prisma.contact.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      });
      return { items: fallbackItems as ContactData[], total: fallbackItems.length };
    } catch {
      return { items: [], total: 0 };
    }
  }
}
