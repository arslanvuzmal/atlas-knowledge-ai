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
    label: 'Overview',
    items: [
      {
        href: '/dashboard',
        label: 'Overview',
        permission: 'chat:authenticated',
        description: 'Platform status, CRM customer intelligence, and headline metrics',
      },
    ],
  },
  {
    label: 'Customers',
    items: [
      {
        href: '/dashboard/inbox',
        label: 'Inbox',
        permission: 'conversation:read:own',
        description: '3-column Customer 360 intelligence inbox & composer',
      },
      {
        href: '/dashboard/contacts',
        label: 'Contacts',
        permission: 'chat:authenticated',
        description: 'Identified customers, leads, and intelligence records',
      },
      {
        href: '/dashboard/companies',
        label: 'Companies',
        permission: 'chat:authenticated',
        description: 'Target accounts, domains, and team relationships',
      },
      {
        href: '/dashboard/deals',
        label: 'Deals',
        permission: 'chat:authenticated',
        description: 'Opportunity pipeline, Kanban board, and sales stages',
      },
      {
        href: '/dashboard/tasks',
        label: 'Tasks',
        permission: 'chat:authenticated',
        description: 'Follow-ups, sales calls, meetings, and team actions',
      },
      {
        href: '/dashboard/tickets',
        label: 'Tickets',
        permission: 'chat:authenticated',
        description: 'Durable customer support cases and SLA tracking',
      },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      {
        href: '/dashboard/knowledge-bases',
        label: 'Knowledge Bases',
        permission: 'knowledgebase:read',
        description: 'Collections grouping approved documents',
      },
      {
        href: '/dashboard/documents',
        label: 'Documents',
        permission: 'document:read',
        description: 'Indexed sources, RBAC access levels, and chunk states',
      },
      {
        href: '/dashboard/knowledge-health',
        label: 'Knowledge Health',
        permission: 'document:read',
        description: 'Knowledge gaps, source conflicts, and business impact',
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
    label: 'Insights',
    items: [
      {
        href: '/dashboard/analytics',
        label: 'Analytics',
        permission: 'analytics:view',
        description: 'Real conversation funnel, retrieval metrics, and sales insights',
      },
      {
        href: '/dashboard/feedback',
        label: 'Feedback',
        permission: 'feedback:review',
        description: 'User ratings, unhelpful answers, and correction loops',
      },
    ],
  },
  {
    label: 'System',
    items: [
      {
        href: '/dashboard/automations',
        label: 'Automations',
        permission: 'settings:retrieval:read',
        description: 'Workspace rules engine & trigger workflows',
      },
      {
        href: '/dashboard/integrations',
        label: 'Integrations',
        permission: 'settings:models:read',
        description: 'Connected databases, storage, and AI providers',
      },
      {
        href: '/dashboard/audit',
        label: 'Audit Log',
        permission: 'audit:read',
        description: 'Append-only audit log of all system actions',
      },
      {
        href: '/dashboard/health',
        label: 'System Health',
        permission: 'health:read',
        description: 'Live component checks & latency diagnostics',
      },
      {
        href: '/dashboard/settings',
        label: 'Settings',
        permission: 'chat:authenticated',
        description: 'Account settings, session revocation, and workspace config',
      },
    ],
  },
];
