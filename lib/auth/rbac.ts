import type { AccessLevel, Role } from '@prisma/client';

/**
 * Role-based authorisation.
 *
 * Two separate concepts live here and they must not be conflated:
 *
 *  - **Access levels** classify *content*. They form a strict ladder, and a role
 *    can read every level at or below its own rung.
 *  - **Permissions** classify *actions*. They are an explicit per-role list,
 *    because "can read manager documents" and "can delete any document" are not
 *    the same authority.
 */

/** Ordered from least to most privileged. Index position is the comparison key. */
export const ACCESS_LEVEL_ORDER: AccessLevel[] = [
  'PUBLIC',
  'CUSTOMER',
  'EMPLOYEE',
  'MANAGER',
  'ADMIN',
];

export const ROLE_ORDER: Role[] = ['PUBLIC', 'CUSTOMER', 'EMPLOYEE', 'MANAGER', 'ADMIN'];

/** The content ceiling for each role. */
const ROLE_CEILING: Record<Role, AccessLevel> = {
  PUBLIC: 'PUBLIC',
  CUSTOMER: 'CUSTOMER',
  EMPLOYEE: 'EMPLOYEE',
  MANAGER: 'MANAGER',
  ADMIN: 'ADMIN',
};

export function accessLevelRank(level: AccessLevel): number {
  return ACCESS_LEVEL_ORDER.indexOf(level);
}

export function roleRank(role: Role): number {
  return ROLE_ORDER.indexOf(role);
}

/**
 * Every access level a role may read. This is the single source of truth for
 * the SQL `accessLevel IN (...)` filter applied during retrieval.
 */
export function allowedAccessLevels(role: Role): AccessLevel[] {
  const ceiling = accessLevelRank(ROLE_CEILING[role]);
  return ACCESS_LEVEL_ORDER.filter((_, index) => index <= ceiling);
}

export function canReadAccessLevel(role: Role, level: AccessLevel): boolean {
  return accessLevelRank(level) <= accessLevelRank(ROLE_CEILING[role]);
}

// ---------------------------------------------------------------------------
// Action permissions
// ---------------------------------------------------------------------------

export const PERMISSIONS = [
  'chat:public',
  'chat:authenticated',
  'conversation:read:own',
  'conversation:read:all',
  'conversation:delete:own',
  'feedback:create',
  'feedback:review',
  'escalation:create',
  'escalation:read',
  'escalation:manage',
  'document:read',
  'document:upload',
  'document:reprocess',
  'document:archive',
  'document:delete',
  'document:change-access-level',
  'document:download',
  'knowledgebase:read',
  'knowledgebase:manage',
  'analytics:view',
  'user:read',
  'user:manage',
  'settings:retrieval:read',
  'settings:retrieval:manage',
  'settings:models:read',
  'settings:models:manage',
  'integration:manage',
  'audit:read',
  'health:read',
  'demo:reset',
  'evaluation:read',
  'evaluation:manage',
  'settings:retention:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PUBLIC_PERMISSIONS: Permission[] = ['chat:public', 'feedback:create', 'escalation:create'];

const CUSTOMER_PERMISSIONS: Permission[] = [
  ...PUBLIC_PERMISSIONS,
  'chat:authenticated',
  'conversation:read:own',
  'conversation:delete:own',
];

const EMPLOYEE_PERMISSIONS: Permission[] = [
  ...CUSTOMER_PERMISSIONS,
  'document:read',
  'knowledgebase:read',
];

const MANAGER_PERMISSIONS: Permission[] = [
  ...EMPLOYEE_PERMISSIONS,
  'conversation:read:all',
  'feedback:review',
  'escalation:read',
  'escalation:manage',
  'document:upload',
  'document:reprocess',
  'document:archive',
  'document:change-access-level',
  'document:download',
  'analytics:view',
  'settings:retrieval:read',
  'settings:models:read',
  'user:read',
  'health:read',
  'evaluation:read',
  'evaluation:manage',
];

const ADMIN_PERMISSIONS: Permission[] = [...PERMISSIONS];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  PUBLIC: PUBLIC_PERMISSIONS,
  CUSTOMER: CUSTOMER_PERMISSIONS,
  EMPLOYEE: EMPLOYEE_PERMISSIONS,
  MANAGER: MANAGER_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
};

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? PUBLIC_PERMISSIONS;
}

export function hasPermission(role: Role | null | undefined, permission: Permission): boolean {
  // An unauthenticated caller is treated as the PUBLIC role, never as "no
  // checks apply".
  return permissionsForRole(role ?? 'PUBLIC').includes(permission);
}

/** Roles a given actor is allowed to assign. Nobody may grant above themselves. */
export function assignableRoles(actorRole: Role): Role[] {
  if (actorRole !== 'ADMIN') return [];
  return ROLE_ORDER.filter((role) => role !== 'PUBLIC');
}

export const ROLE_LABELS: Record<Role, string> = {
  PUBLIC: 'Public viewer',
  CUSTOMER: 'Customer',
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  ADMIN: 'Administrator',
};

export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  PUBLIC: 'Public',
  CUSTOMER: 'Customer',
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  ADMIN: 'Admin only',
};
