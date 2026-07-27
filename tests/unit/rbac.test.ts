import { describe, expect, it } from 'vitest';
import type { AccessLevel, Role } from '@prisma/client';
import {
  ACCESS_LEVEL_ORDER,
  ROLE_ORDER,
  allowedAccessLevels,
  assignableRoles,
  canReadAccessLevel,
  hasPermission,
  permissionsForRole,
} from '@/lib/auth/rbac';

/**
 * The access ladder is the single most security-critical piece of logic in the
 * platform: it decides what every SQL retrieval filter contains. These tests
 * assert the whole matrix rather than a few spot checks.
 */
describe('access ladder', () => {
  const expected: Record<Role, AccessLevel[]> = {
    PUBLIC: ['PUBLIC'],
    CUSTOMER: ['PUBLIC', 'CUSTOMER'],
    EMPLOYEE: ['PUBLIC', 'CUSTOMER', 'EMPLOYEE'],
    MANAGER: ['PUBLIC', 'CUSTOMER', 'EMPLOYEE', 'MANAGER'],
    ADMIN: ['PUBLIC', 'CUSTOMER', 'EMPLOYEE', 'MANAGER', 'ADMIN'],
  };

  it.each(ROLE_ORDER)('%s reaches exactly its own level and below', (role) => {
    expect(allowedAccessLevels(role)).toEqual(expected[role]);
  });

  it('covers every role and level pair correctly', () => {
    for (const role of ROLE_ORDER) {
      for (const level of ACCESS_LEVEL_ORDER) {
        const shouldRead = expected[role].includes(level);
        expect(canReadAccessLevel(role, level), `${role} -> ${level}`).toBe(shouldRead);
      }
    }
  });

  it('never lets a lower role reach a higher level', () => {
    expect(canReadAccessLevel('PUBLIC', 'EMPLOYEE')).toBe(false);
    expect(canReadAccessLevel('CUSTOMER', 'EMPLOYEE')).toBe(false);
    expect(canReadAccessLevel('EMPLOYEE', 'MANAGER')).toBe(false);
    expect(canReadAccessLevel('MANAGER', 'ADMIN')).toBe(false);
  });

  it('lets each role reach public content', () => {
    for (const role of ROLE_ORDER) {
      expect(canReadAccessLevel(role, 'PUBLIC')).toBe(true);
    }
  });
});

describe('action permissions', () => {
  it('treats an absent role as PUBLIC rather than unchecked', () => {
    expect(hasPermission(null, 'document:upload')).toBe(false);
    expect(hasPermission(undefined, 'audit:read')).toBe(false);
    expect(hasPermission(null, 'chat:public')).toBe(true);
  });

  it('withholds administrative actions below ADMIN', () => {
    const adminOnly = [
      'user:manage',
      'audit:read',
      'settings:retrieval:manage',
      'document:delete',
      'demo:reset',
    ] as const;
    for (const permission of adminOnly) {
      expect(hasPermission('MANAGER', permission), permission).toBe(false);
      expect(hasPermission('EMPLOYEE', permission), permission).toBe(false);
      expect(hasPermission('ADMIN', permission), permission).toBe(true);
    }
  });

  it('gives managers the operational permissions they need', () => {
    for (const permission of [
      'escalation:manage',
      'feedback:review',
      'analytics:view',
      'document:upload',
    ] as const) {
      expect(hasPermission('MANAGER', permission), permission).toBe(true);
    }
  });

  it('withholds document upload from employees and below', () => {
    expect(hasPermission('EMPLOYEE', 'document:upload')).toBe(false);
    expect(hasPermission('CUSTOMER', 'document:upload')).toBe(false);
    expect(hasPermission('PUBLIC', 'document:upload')).toBe(false);
  });

  it('grows permissions monotonically up the ladder', () => {
    let previous = 0;
    for (const role of ROLE_ORDER) {
      const count = permissionsForRole(role).length;
      expect(
        count,
        `${role} should not have fewer permissions than the role below`,
      ).toBeGreaterThanOrEqual(previous);
      previous = count;
    }
  });

  it('lets a public visitor chat and escalate but nothing else', () => {
    expect(hasPermission('PUBLIC', 'chat:public')).toBe(true);
    expect(hasPermission('PUBLIC', 'feedback:create')).toBe(true);
    expect(hasPermission('PUBLIC', 'escalation:create')).toBe(true);
    expect(hasPermission('PUBLIC', 'document:read')).toBe(false);
    expect(hasPermission('PUBLIC', 'conversation:read:all')).toBe(false);
  });
});

describe('role assignment', () => {
  it('only administrators may assign roles', () => {
    expect(assignableRoles('ADMIN').length).toBeGreaterThan(0);
    expect(assignableRoles('MANAGER')).toEqual([]);
    expect(assignableRoles('EMPLOYEE')).toEqual([]);
    expect(assignableRoles('PUBLIC')).toEqual([]);
  });

  it('never offers PUBLIC as an assignable account role', () => {
    expect(assignableRoles('ADMIN')).not.toContain('PUBLIC');
  });
});
