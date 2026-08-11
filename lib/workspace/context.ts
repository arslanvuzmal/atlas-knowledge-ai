import { prisma } from '@/lib/database/client';
import type { SessionUser } from '@/lib/auth/session';

import { ensureDemoDataSeeded } from '@/lib/database/auto-seed';

export interface WorkspaceContext {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  role?: string;
}

/**
 * Resolves workspace context safely without mutating database data on read.
 */
import { getSession } from '@/lib/auth/session';

export interface WorkspaceContext {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  role?: string;
}

/**
 * Resolves workspace context safely without mutating database data on read.
 */
export async function getCurrentWorkspaceContext(
  user?: SessionUser | null,
): Promise<WorkspaceContext> {
  let currentUser = user;
  if (currentUser === undefined) {
    const session = await getSession();
    currentUser = session.user;
  }

  if (currentUser?.id) {
    const member = await prisma.workspaceMember.findFirst({
      where: { userId: currentUser.id },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });

    if (member) {
      return {
        id: member.workspace.id,
        name: member.workspace.name,
        slug: member.workspace.slug,
        domain: member.workspace.domain,
        role: member.role,
      };
    }
  }

  let firstWs = await prisma.workspace.findFirst({
    orderBy: { createdAt: 'asc' },
  });

  if (!firstWs) {
    try {
      const seeded = await ensureDemoDataSeeded();
      firstWs = await prisma.workspace.findUnique({ where: { id: seeded.workspaceId } });
    } catch {
      // Ignore if seeding fails
    }
  }

  if (firstWs) {
    return {
      id: firstWs.id,
      name: firstWs.name,
      slug: firstWs.slug,
      domain: firstWs.domain,
      role: 'MEMBER',
    };
  }

  return {
    id: 'default-workspace-id',
    name: 'Northstar Cloud',
    slug: 'northstar-cloud',
    domain: 'northstar.example',
    role: 'MEMBER',
  };
}

export async function getOrCreateDefaultWorkspace(): Promise<WorkspaceContext> {
  const ctx = await getCurrentWorkspaceContext();
  if (ctx) return ctx;

  const ws = await prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' } });
  if (ws) {
    return { id: ws.id, name: ws.name, slug: ws.slug, domain: ws.domain };
  }

  return {
    id: 'default-workspace-id',
    name: 'Northstar Cloud',
    slug: 'northstar-cloud',
    domain: 'northstar.example',
  };
}

export async function getWorkspaceBySlug(slug: string): Promise<WorkspaceContext | null> {
  const ws = await prisma.workspace.findUnique({ where: { slug } });
  if (!ws) return null;
  return {
    id: ws.id,
    name: ws.name,
    slug: ws.slug,
    domain: ws.domain,
  };
}
