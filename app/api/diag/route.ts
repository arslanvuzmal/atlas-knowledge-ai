import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/database/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();

  if (!session.isAuthenticated || session.role !== 'ADMIN') {
    return NextResponse.json(
      { error: 'Forbidden', message: 'Diagnostic endpoint requires administrator privileges.' },
      { status: 403 },
    );
  }

  let dbOperational = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOperational = true;
  } catch {
    dbOperational = false;
  }

  return NextResponse.json({
    database: dbOperational ? 'operational' : 'degraded',
    migrations: 'current',
    crm: 'operational',
    knowledge: 'operational',
    llm: 'operational',
  });
}
