import { prisma } from '@/lib/database/client';
import type { TaskPriority, TaskStatus, TaskType } from '@prisma/client';

export interface CreateTaskInput {
  workspaceId: string;
  title: string;
  description?: string;
  type?: TaskType;
  priority?: TaskPriority;
  ownerId?: string;
  dueAt?: Date;
  contactId?: string;
  companyId?: string;
  dealId?: string;
  ticketId?: string;
  conversationId?: string;
  createdBy?: string;
}

export async function createTask(input: CreateTaskInput) {
  const task = await prisma.task.create({
    data: {
      workspaceId: input.workspaceId,
      title: input.title,
      description: input.description,
      type: input.type ?? 'FOLLOW_UP',
      status: 'PENDING',
      priority: input.priority ?? 'NORMAL',
      ownerId: input.ownerId,
      dueAt: input.dueAt,
      contactId: input.contactId,
      companyId: input.companyId,
      dealId: input.dealId,
      ticketId: input.ticketId,
      conversationId: input.conversationId,
      createdBy: input.createdBy,
    },
  });

  await prisma.crmActivity.create({
    data: {
      workspaceId: input.workspaceId,
      taskId: task.id,
      contactId: input.contactId,
      companyId: input.companyId,
      dealId: input.dealId,
      ticketId: input.ticketId,
      type: 'TASK_CREATED',
      title: 'Task Created',
      description: `Task "${task.title}" created`,
    },
  });

  return task;
}

export async function listTasks(
  workspaceId: string,
  options?: { status?: TaskStatus; ownerId?: string; limit?: number; offset?: number },
) {
  const { status, ownerId, limit = 50, offset = 0 } = options ?? {};
  const where: Record<string, unknown> = { workspaceId };
  if (status) where.status = status;
  if (ownerId) where.ownerId = ownerId;

  try {
    const [items, total] = await Promise.all([
      prisma.task.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
        include: {
          owner: { select: { id: true, name: true, email: true } },
          contact: { select: { id: true, displayName: true, primaryEmail: true } },
          company: { select: { id: true, name: true } },
          deal: { select: { id: true, name: true } },
        },
      }),
      prisma.task.count({ where }),
    ]);

    return { items, total };
  } catch {
    return { items: [], total: 0 };
  }
}

export async function completeTask(workspaceId: string, taskId: string) {
  const task = await prisma.task.findFirst({ where: { workspaceId, id: taskId } });
  if (!task) throw new Error('Task not found');

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
    },
  });

  await prisma.crmActivity.create({
    data: {
      workspaceId,
      taskId: task.id,
      contactId: task.contactId,
      companyId: task.companyId,
      type: 'TASK_COMPLETED',
      title: 'Task Completed',
      description: `Task "${task.title}" was marked as completed`,
    },
  });

  return updated;
}
