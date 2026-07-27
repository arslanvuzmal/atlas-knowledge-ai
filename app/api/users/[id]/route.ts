import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardRequest } from '@/lib/auth/guard';
import { assignableRoles } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { revokeAllSessionsForUser } from '@/lib/auth/session';
import { recordAudit } from '@/lib/security/audit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  role: z.enum(['PUBLIC', 'CUSTOMER', 'EMPLOYEE', 'MANAGER', 'ADMIN']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'INVITED']).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRequest(request, {
    permission: 'user:manage',
    rateLimit: 'mutation',
  });
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const actorId = guard.session.user?.id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  // An administrator must not be able to lock themselves out or quietly
  // demote themselves while holding the only admin seat.
  if (target.id === actorId) {
    if (parsed.data.role && parsed.data.role !== target.role) {
      return NextResponse.json({ error: 'You cannot change your own role.' }, { status: 400 });
    }
    if (parsed.data.status && parsed.data.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'You cannot suspend your own account.' }, { status: 400 });
    }
  }

  if (parsed.data.role && !assignableRoles(guard.role).includes(parsed.data.role)) {
    return NextResponse.json({ error: 'You cannot assign that role.' }, { status: 403 });
  }

  // Never leave the system without an active administrator.
  if (
    target.role === 'ADMIN' &&
    ((parsed.data.role && parsed.data.role !== 'ADMIN') ||
      (parsed.data.status && parsed.data.status !== 'ACTIVE'))
  ) {
    const otherActiveAdmins = await prisma.user.count({
      where: { role: 'ADMIN', status: 'ACTIVE', id: { not: id } },
    });
    if (otherActiveAdmins === 0) {
      return NextResponse.json(
        { error: 'This is the last active administrator and cannot be changed.' },
        { status: 400 },
      );
    }
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.role !== undefined) data.role = parsed.data.role;
  if (parsed.data.status !== undefined) data.status = parsed.data.status;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No changes were supplied.' }, { status: 400 });
  }

  const updated = await prisma.user.update({ where: { id }, data });

  // A privilege change must not wait for an existing session to expire.
  if (
    (parsed.data.role && parsed.data.role !== target.role) ||
    (parsed.data.status && parsed.data.status !== 'ACTIVE')
  ) {
    await revokeAllSessionsForUser(id);
  }

  await recordAudit({
    action: parsed.data.role ? 'user.role.change' : 'user.status.change',
    entityType: 'User',
    entityId: id,
    userId: actorId ?? null,
    previousData: { role: target.role, status: target.status },
    newData: data,
    ip: guard.ip,
  });

  return NextResponse.json({
    ok: true,
    user: { id: updated.id, role: updated.role, status: updated.status },
  });
}
