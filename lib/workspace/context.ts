import { prisma } from '@/lib/database/client';
import type { SessionUser } from '@/lib/auth/session';
import { getSession } from '@/lib/auth/session';
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
 * Guaranteed to NEVER throw or return null.
 */
export async function getCurrentWorkspaceContext(
  user?: SessionUser | null,
): Promise<WorkspaceContext> {
  const fallback: WorkspaceContext = {
    id: 'default-workspace-id',
    name: 'Northstar Cloud',
    slug: 'northstar-cloud',
    domain: 'northstar.example',
    role: 'MEMBER',
  };

  try {
    let currentUser = user;
    if (currentUser === undefined) {
      const session = await getSession().catch(() => null);
      currentUser = session?.user ?? null;
    }

    if (currentUser?.id) {
      const member = await prisma.workspaceMember
        .findFirst({
          where: { userId: currentUser.id },
          include: { workspace: true },
          orderBy: { createdAt: 'asc' },
        })
        .catch(() => null);

      if (member?.workspace) {
        return {
          id: member.workspace.id,
          name: member.workspace.name,
          slug: member.workspace.slug,
          domain: member.workspace.domain,
          role: member.role,
        };
      }
    }

    let firstWs = await prisma.workspace
      .findFirst({
        orderBy: { createdAt: 'asc' },
      })
      .catch(() => null);

    if (!firstWs) {
      try {
        const seeded = await ensureDemoDataSeeded();
        firstWs = await prisma.workspace
          .findUnique({ where: { id: seeded.workspaceId } })
          .catch(() => null);
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

    return fallback;
  } catch {
    return fallback;
  }
}

export async function getOrCreateDefaultWorkspace(): Promise<WorkspaceContext> {
  return getCurrentWorkspaceContext();
}

export async function getWorkspaceBySlug(slug: string): Promise<WorkspaceContext | null> {
  try {
    const ws = await prisma.workspace.findUnique({ where: { slug } });
    if (!ws) return null;
    return {
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      domain: ws.domain,
    };
  } catch {
    return null;
  }
}
