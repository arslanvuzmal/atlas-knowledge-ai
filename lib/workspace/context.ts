import { prisma } from '@/lib/database/client';

export interface WorkspaceContext {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
}

export async function getOrCreateDefaultWorkspace(): Promise<WorkspaceContext> {
  let ws = await prisma.workspace.findUnique({
    where: { slug: 'northstar-cloud' },
  });

  if (!ws) {
    ws = await prisma.workspace.create({
      data: {
        name: 'Northstar Cloud',
        slug: 'northstar-cloud',
        domain: 'northstar.example',
      },
    });
  }

  return {
    id: ws.id,
    name: ws.name,
    slug: ws.slug,
    domain: ws.domain,
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
