import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { isDemoMode } from '@/lib/env';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['PUBLIC', 'CUSTOMER', 'EMPLOYEE', 'MANAGER', 'ADMIN'] as const;
const DEMO_ROLE_COOKIE = 'atlas_demo_role';

const schema = z.object({
  role: z.enum(ALLOWED_ROLES),
});

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

  const cookieStore = await cookies();
  cookieStore.set(DEMO_ROLE_COOKIE, parsed.data.role, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  return NextResponse.json({
    ok: true,
    role: parsed.data.role,
    message: `Demo session role set to ${parsed.data.role}`,
  });
}

export async function GET() {
  if (!isDemoMode()) {
    return NextResponse.json({ error: 'Demo role simulation is disabled.' }, { status: 403 });
  }

  const cookieStore = await cookies();
  const currentRole = cookieStore.get(DEMO_ROLE_COOKIE)?.value ?? 'PUBLIC';
  const role = ALLOWED_ROLES.includes(currentRole as (typeof ALLOWED_ROLES)[number])
    ? currentRole
    : 'PUBLIC';

  return NextResponse.json({ ok: true, role });
}
