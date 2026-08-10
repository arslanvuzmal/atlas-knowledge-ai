import type { Permission } from '@/lib/auth/rbac';

export interface NavItem {
  href: string;
  label: string;
  permission: Permission;
  description: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'WORKSPACE',
    items: [
      {
        href: '/chat',
        label: 'Ask Atlas',
        permission: 'chat:authenticated',
        description: 'Grounded enterprise knowledge assistant with source citations',
      },
      {
        href: '/dashboard/inbox',
        label: 'Customer Inbox',
        permission: 'conversation:read:own',
        description: '3-column Customer 360 intelligence inbox & composer',
      },
      {
        href: '/dashboard/knowledge-bases',
        label: 'Knowledge Bases',
        permission: 'knowledgebase:read',
        description: 'Collections grouping approved enterprise sources',
      },
      {
        href: '/dashboard/documents',
        label: 'Documents',
        permission: 'document:read',
        description: 'Indexed sources, RBAC access levels, and chunk states',
      },
    ],
  },
  {
    label: 'OPERATIONS',
    items: [
      {
        href: '/dashboard/escalations',
        label: 'Escalations',
        permission: 'escalation:read',
        description: 'Human review queue for low confidence or unsupported questions',
      },
      {
        href: '/dashboard/knowledge-health',
        label: 'Knowledge Gaps',
        permission: 'document:read',
        description: 'Unanswered question clusters and source health',
      },
      {
        href: '/dashboard/deals',
        label: 'Deals & Pipeline',
        permission: 'chat:authenticated',
        description: 'Opportunity pipeline, Kanban board, and sales stages',
      },
      {
        href: '/dashboard/contacts',
        label: 'Contacts & Accounts',
        permission: 'chat:authenticated',
        description: 'Identified customers, target accounts, and leads',
      },
      {
        href: '/dashboard/analytics',
        label: 'Analytics',
        permission: 'analytics:view',
        description: 'Grounding rates, retrieval latency, and query metrics',
      },
      {
        href: '/dashboard/evaluations',
        label: 'Evaluations',
        permission: 'analytics:view',
        description: 'Retrieval accuracy workbench & test history',
      },
    ],
  },
  {
    label: 'ADMINISTRATION',
    items: [
      {
        href: '/dashboard/automations',
        label: 'Automations',
        permission: 'settings:retrieval:read',
        description: 'Workspace trigger rules and outbox workflows',
      },
      {
        href: '/dashboard/users',
        label: 'Users & Access',
        permission: 'user:manage',
        description: 'Role-based access control and user directory',
      },
      {
        href: '/dashboard/audit',
        label: 'Audit Log',
        permission: 'audit:read',
        description: 'Append-only operational event log',
      },
      {
        href: '/dashboard/health',
        label: 'System Health',
        permission: 'health:read',
        description: 'Database, embeddings, storage, and queue diagnostics',
      },
      {
        href: '/dashboard/settings',
        label: 'Settings',
        permission: 'chat:authenticated',
        description: 'Workspace configuration and retention rules',
      },
    ],
  },
];
