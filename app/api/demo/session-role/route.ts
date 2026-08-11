import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { isDemoMode } from '@/lib/env';
import { prisma } from '@/lib/database/client';
import { createSession, destroySession, getSession } from '@/lib/auth/session';
import { hashPassword } from '@/lib/auth/password';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['PUBLIC', 'CUSTOMER', 'EMPLOYEE', 'MANAGER', 'ADMIN'] as const;
const DEMO_ROLE_COOKIE = 'atlas_demo_role';

const schema = z.object({
  role: z.enum(ALLOWED_ROLES),
});

const DEMO_EMAILS: Record<(typeof ALLOWED_ROLES)[number], string> = {
  ADMIN: 'admin@atlasknowledge.demo',
  MANAGER: 'manager@atlasknowledge.demo',
  EMPLOYEE: 'employee@atlasknowledge.demo',
  CUSTOMER: 'customer@atlasknowledge.demo',
  PUBLIC: 'viewer@atlasknowledge.demo',
};

export async function POST(request: Request) {
  if (!isDemoMode()) {
    return NextResponse.json({ error: 'Demo role simulation is disabled.' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid demo role requested.' }, { status: 400 });
  }

  const requestedRole = parsed.data.role;

  if (requestedRole === 'PUBLIC') {
    await destroySession();
    return NextResponse.json({
      ok: true,
      role: 'PUBLIC',
      message: 'Demo session cleared. You are now unauthenticated PUBLIC.',
    });
  }

  const email = DEMO_EMAILS[requestedRole];
  let user = await prisma.user.findFirst({
    where: { email },
  });

  if (!user) {
    const passwordHash = await hashPassword('AtlasDemo!2026');
    user = await prisma.user.create({
      data: {
        name: `Demo ${requestedRole}`,
        email,
        passwordHash,
        role: requestedRole as Role,
        status: 'ACTIVE',
        isDemo: true,
      },
    });
  } else if (user.role !== requestedRole) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { role: requestedRole as Role },
    });
  }

  // Create real authenticated session
  await createSession(user.id);

  const cookieStore = await cookies();
  cookieStore.set(DEMO_ROLE_COOKIE, requestedRole, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  return NextResponse.json({
    ok: true,
    role: requestedRole,
    message: `Demo session established for ${user.email} (${requestedRole})`,
  });
}

export async function GET() {
  if (!isDemoMode()) {
    return NextResponse.json({ error: 'Demo role simulation is disabled.' }, { status: 403 });
  }

  const session = await getSession();
  return NextResponse.json({
    ok: true,
    role: session.role,
    isAuthenticated: session.isAuthenticated,
    user: session.user,
  });
}
