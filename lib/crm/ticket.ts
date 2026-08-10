import { prisma } from '@/lib/database/client';
import type { TaskPriority, TicketStatus } from '@prisma/client';

export interface CreateTicketInput {
  workspaceId: string;
  subject: string;
  description?: string;
  priority?: TaskPriority;
  contactId?: string;
  companyId?: string;
  conversationId?: string;
  assigneeId?: string;
  category?: string;
  productArea?: string;
  urgency?: string;
  escalationId?: string;
}

export async function createTicket(input: CreateTicketInput) {
  const ticket = await prisma.ticket.create({
    data: {
      workspaceId: input.workspaceId,
      subject: input.subject,
      description: input.description,
      status: 'NEW',
      priority: input.priority ?? 'NORMAL',
      contactId: input.contactId,
      companyId: input.companyId,
      conversationId: input.conversationId,
      assigneeId: input.assigneeId,
      category: input.category,
      productArea: input.productArea,
      urgency: input.urgency,
      escalationId: input.escalationId,
    },
  });

  await prisma.crmActivity.create({
    data: {
      workspaceId: input.workspaceId,
      ticketId: ticket.id,
      contactId: input.contactId,
      companyId: input.companyId,
      conversationId: input.conversationId,
      type: 'TICKET_CREATED',
      title: 'Ticket Created',
      description: `Support ticket "${ticket.subject}" created (${ticket.priority} priority)`,
    },
  });

  return ticket;
}

export async function listTickets(
  workspaceId: string,
  options?: { status?: TicketStatus; assigneeId?: string; limit?: number; offset?: number },
) {
  const { status, assigneeId, limit = 50, offset = 0 } = options ?? {};
  const where: Record<string, unknown> = { workspaceId };
  if (status) where.status = status;
  if (assigneeId) where.assigneeId = assigneeId;

  const [items, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        contact: { select: { id: true, displayName: true, primaryEmail: true } },
        company: { select: { id: true, name: true } },
        escalation: { select: { id: true, reason: true, status: true } },
      },
    }),
    prisma.ticket.count({ where }),
  ]);

  return { items, total };
}

export async function resolveTicket(workspaceId: string, ticketId: string) {
  const ticket = await prisma.ticket.findFirst({ where: { workspaceId, id: ticketId } });
  if (!ticket) throw new Error('Ticket not found');

  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      status: 'RESOLVED',
      resolvedAt: new Date(),
    },
  });

  await prisma.crmActivity.create({
    data: {
      workspaceId,
      ticketId: ticket.id,
      contactId: ticket.contactId,
      companyId: ticket.companyId,
      type: 'TICKET_UPDATED',
      title: 'Ticket Resolved',
      description: `Ticket "${ticket.subject}" was resolved`,
    },
  });

  return updated;
}
