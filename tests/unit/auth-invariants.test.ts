import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/database/client';

// Mock next/headers cookies
vi.mock('next/headers', () => {
  let cookieMap = new Map<string, string>();
  return {
    cookies: async () => ({
      get: (name: string) => (cookieMap.has(name) ? { value: cookieMap.get(name)! } : undefined),
      set: (name: string, value: string) => cookieMap.set(name, value),
      delete: (name: string) => cookieMap.delete(name),
      _clear: () => cookieMap.clear(),
      _setMap: (m: Map<string, string>) => {
        cookieMap = m;
      },
    }),
    _getCookieStore: () => cookieMap,
  };
});

interface MockCookieStore {
  _clear?: () => void;
  _setMap?: (m: Map<string, string>) => void;
}

describe('Security Invariant — Auth & Session Resolution', () => {
  beforeEach(async () => {
    const { cookies } = await import('next/headers');
    const store = (await cookies()) as unknown as MockCookieStore;
    if (store._clear) store._clear();
  });

  it('DEMO_MODE=true + no session => PUBLIC role and isAuthenticated=false', async () => {
    const session = await getSession();
    expect(session.role).toBe('PUBLIC');
    expect(session.isAuthenticated).toBe(false);
    expect(session.user).toBeNull();
  });

  it('atlas_demo_role=ADMIN cookie without valid session => PUBLIC role', async () => {
    const { cookies } = await import('next/headers');
    const store = (await cookies()) as unknown as MockCookieStore;
    if (store._setMap) store._setMap(new Map([['atlas_demo_role', 'ADMIN']]));

    const session = await getSession();
    expect(session.role).toBe('PUBLIC');
    expect(session.isAuthenticated).toBe(false);
    expect(session.user).toBeNull();
  });

  it('invalid atlas_session token => PUBLIC role', async () => {
    const { cookies } = await import('next/headers');
    const store = (await cookies()) as unknown as MockCookieStore;
    if (store._setMap) store._setMap(new Map([['atlas_session', 'invalid-token-12345']]));

    const session = await getSession();
    expect(session.role).toBe('PUBLIC');
    expect(session.isAuthenticated).toBe(false);
    expect(session.user).toBeNull();
  });

  it('revoked session => PUBLIC role', async () => {
    const { cookies } = await import('next/headers');
    const store = (await cookies()) as unknown as MockCookieStore;
    if (store._setMap) store._setMap(new Map([['atlas_session', 'revoked-token-123']]));

    vi.spyOn(prisma.session, 'findUnique').mockResolvedValueOnce({
      id: 'sess-1',
      tokenHash: 'hash',
      userId: 'user-1',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
      revokedAt: new Date(),
      ipHash: null,
      userAgentHash: null,
      user: {
        id: 'user-1',
        name: 'Test User',
        email: 'test@example.com',
        role: 'ADMIN',
        status: 'ACTIVE',
        isDemo: true,
        passwordHash: 'hash',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as never);

    const session = await getSession();
    expect(session.role).toBe('PUBLIC');
    expect(session.isAuthenticated).toBe(false);
    expect(session.user).toBeNull();
  });

  it('expired session => PUBLIC role', async () => {
    const { cookies } = await import('next/headers');
    const store = (await cookies()) as unknown as MockCookieStore;
    if (store._setMap) store._setMap(new Map([['atlas_session', 'expired-token-123']]));

    vi.spyOn(prisma.session, 'findUnique').mockResolvedValueOnce({
      id: 'sess-1',
      tokenHash: 'hash',
      userId: 'user-1',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() - 3600000), // Expired 1 hour ago
      revokedAt: null,
      ipHash: null,
      userAgentHash: null,
      user: {
        id: 'user-1',
        name: 'Test User',
        email: 'test@example.com',
        role: 'ADMIN',
        status: 'ACTIVE',
        isDemo: true,
        passwordHash: 'hash',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as never);

    const session = await getSession();
    expect(session.role).toBe('PUBLIC');
    expect(session.isAuthenticated).toBe(false);
    expect(session.user).toBeNull();
  });

  it('disabled user => PUBLIC role', async () => {
    const { cookies } = await import('next/headers');
    const store = (await cookies()) as unknown as MockCookieStore;
    if (store._setMap) store._setMap(new Map([['atlas_session', 'disabled-user-token']]));

    vi.spyOn(prisma.session, 'findUnique').mockResolvedValueOnce({
      id: 'sess-1',
      tokenHash: 'hash',
      userId: 'user-1',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
      revokedAt: null,
      ipHash: null,
      userAgentHash: null,
      user: {
        id: 'user-1',
        name: 'Disabled User',
        email: 'disabled@example.com',
        role: 'ADMIN',
        status: 'SUSPENDED', // Disabled status
        isDemo: true,
        passwordHash: 'hash',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as never);

    const session = await getSession();
    expect(session.role).toBe('PUBLIC');
    expect(session.isAuthenticated).toBe(false);
    expect(session.user).toBeNull();
  });
});
