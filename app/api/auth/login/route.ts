import { NextResponse } from 'next/server';
import { z } from 'zod';
import { attemptLogin } from '@/lib/auth/login';
import { getClientIp } from '@/lib/auth/guard';
import { checkRateLimit } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().email('Enter a valid email address.').max(320),
  password: z.string().min(1, 'Enter your password.').max(200),
});

export async function POST(request: Request) {
  const ip = await getClientIp();

  // Rate limiting runs before parsing so a flood of malformed bodies is also
  // throttled.
  const limit = checkRateLimit('login', ip ?? 'unknown');
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Too many sign-in attempts. Please wait and try again.',
        retryAfterSeconds: limit.retryAfterSeconds,
      },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid sign-in details.' },
      { status: 400 },
    );
  }

  const result = await attemptLogin({
    email: parsed.data.email,
    password: parsed.data.password,
    ip,
    userAgent: request.headers.get('user-agent'),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, lockedOut: result.lockedOut ?? false },
      { status: result.lockedOut ? 429 : 401 },
    );
  }

  return NextResponse.json({ ok: true, role: result.role });
}
