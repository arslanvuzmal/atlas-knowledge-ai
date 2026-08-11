import { prisma } from '@/lib/database/client';
import type { LifecycleStage, LeadStatus, Prisma } from '@prisma/client';

export interface ResolveIdentityInput {
  workspaceId: string;
  visitorKey?: string;
  email?: string;
  name?: string;
  phone?: string;
  source?: string;
  sourceDetail?: string;
}

export interface ContactData {
  id: string;
  workspaceId: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  primaryEmail: string | null;
  normalizedEmail: string | null;
  phone: string | null;
  visitorKey: string | null;
  lifecycleStage: LifecycleStage;
  leadStatus: LeadStatus;
  leadScore: number;
  leadTier: string;
  companyId: string | null;
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListContactsOptions {
  query?: string;
  lifecycleStage?: LifecycleStage;
  leadStatus?: LeadStatus;
  companyId?: string;
  leadTier?: string;
  minScore?: number;
  maxScore?: number;
  primaryIntent?: string;
  source?: string;
  sort?:
    | 'activity_desc'
    | 'activity_asc'
    | 'score_desc'
    | 'score_asc'
    | 'created_desc'
    | 'created_asc'
    | 'name_asc'
    | 'name_desc';
  limit?: number;
  offset?: number;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Privacy-conscious identity resolution.
 * Links anonymous visitor to contact record when email or name is provided.
 */
export async function resolveIdentity(input: ResolveIdentityInput): Promise<ContactData> {
  const {
    workspaceId,
    visitorKey,
    email,
    name,
    phone,
    source = 'Website Chat',
    sourceDetail,
  } = input;

  const normalized = email ? normalizeEmail(email) : null;

  // 1. Match by normalized email if present
  if (normalized) {
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
          lastSeenAt: new Date(),
          lastActivityAt: new Date(),
        },
      });
      return updated;
    } else {
      const created = await prisma.contact.create({
        data: {
          workspaceId,
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

  // 2. Match by visitorKey if email not provided
  if (visitorKey) {
    const existingVisitor = await prisma.contact.findFirst({
      where: { workspaceId, visitorKey },
    });

    if (existingVisitor) {
      const updated = await prisma.contact.update({
        where: { id: existingVisitor.id },
        data: {
          displayName:
            name && existingVisitor.displayName === 'Anonymous Visitor'
              ? name
              : existingVisitor.displayName,
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
          firstName: parsedNames.firstName,
          lastName: parsedNames.lastName,
          displayName: name ?? 'Anonymous Visitor',
          visitorKey,
          lifecycleStage: 'VISITOR',
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
            type: 'VISITOR_CREATED',
            title: 'Visitor Started Session',
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
    leadTier,
    minScore,
    maxScore,
    primaryIntent,
    source,
    sort = 'activity_desc',
    limit = 50,
    offset = 0,
  } = options ?? {};

  const where: Prisma.ContactWhereInput = { workspaceId, archivedAt: null };

  if (lifecycleStage) where.lifecycleStage = lifecycleStage;
  if (leadStatus) where.leadStatus = leadStatus;
  if (companyId) where.companyId = companyId;
  if (leadTier) where.leadTier = leadTier;
  if (source) where.source = source;

  if (minScore !== undefined || maxScore !== undefined) {
    where.leadScore = {
      ...(minScore !== undefined ? { gte: minScore } : {}),
      ...(maxScore !== undefined ? { lte: maxScore } : {}),
    };
  }

  if (primaryIntent) {
    where.intelligence = {
      primaryIntent: { contains: primaryIntent, mode: 'insensitive' },
    };
  }

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
    const [items, total] = await Promise.all([
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

    return { items, total };
  } catch {
    try {
      const [items, total] = await Promise.all([
        prisma.contact.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy: { createdAt: 'desc' },
          include: {
            company: { select: { id: true, name: true, domain: true } },
          },
        }),
        prisma.contact.count({ where }),
      ]);

      return {
        items: items.map((item) => ({ ...item, intelligence: null })),
        total,
      };
    } catch {
      return { items: [], total: 0 };
    }
  }
}
