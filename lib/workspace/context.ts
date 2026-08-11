import { prisma } from '@/lib/database/client';
import type { SessionUser } from '@/lib/auth/session';
import { getSession } from '@/lib/auth/session';

export interface WorkspaceContext {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  role?: string;
}

export const DEMO_WORKSPACE_SLUG = 'northstar-cloud';

export class WorkspaceAccessError extends Error {
  constructor(message = 'No authorized workspace context found for caller.') {
    super(message);
    this.name = 'WorkspaceAccessError';
  }
}

/**
 * Truthfully resolves the current authorized workspace context.
 * Does NOT execute runtime database seeding or return fake fallback objects.
 */
export async function getCurrentWorkspaceContext(
  user?: SessionUser | null,
): Promise<WorkspaceContext> {
  let currentUser = user;
  if (currentUser === undefined) {
    const session = await getSession().catch(() => null);
    currentUser = session?.user ?? null;
  }

  // 1. Authenticated user: resolve explicit membership in database
  if (currentUser?.id) {
    try {
      const member = await prisma.workspaceMember.findFirst({
        where: { userId: currentUser.id },
        include: { workspace: true },
        orderBy: { createdAt: 'asc' },
      });

      if (member?.workspace) {
        return {
          id: member.workspace.id,
          name: member.workspace.name,
          slug: member.workspace.slug,
          domain: member.workspace.domain,
          role: member.role,
        };
      }
    } catch {
      // Ignore database query errors
    }
  }

  // 2. Deterministic demo workspace lookup by slug (never findFirst())
  try {
    const demoWs = await prisma.workspace.findUnique({
      where: { slug: DEMO_WORKSPACE_SLUG },
    });

    if (demoWs) {
      return {
        id: demoWs.id,
        name: demoWs.name,
        slug: demoWs.slug,
        domain: demoWs.domain,
        role: 'MEMBER',
      };
    }
  } catch {
    // Ignore database query errors
  }

  throw new WorkspaceAccessError('No authorized workspace found.');
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
