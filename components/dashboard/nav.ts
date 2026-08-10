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
    label: 'OVERVIEW',
    items: [
      {
        href: '/dashboard',
        label: 'Overview',
        permission: 'chat:authenticated',
        description: 'Operational summary of customer intelligence and RAG health',
      },
    ],
  },
  {
    label: 'CUSTOMERS',
    items: [
      {
        href: '/dashboard/inbox',
        label: 'Inbox',
        permission: 'inbox:read',
        description: '3-column Customer 360 intelligence inbox & composer',
      },
      {
        href: '/dashboard/contacts',
        label: 'Contacts',
        permission: 'crm:contact:read',
        description: 'Identified visitors, leads, and customer profiles',
      },
      {
        href: '/dashboard/companies',
        label: 'Companies',
        permission: 'crm:company:read',
        description: 'Accounts, target organizations, and industry data',
      },
      {
        href: '/dashboard/deals',
        label: 'Deals',
        permission: 'crm:deal:read',
        description: 'Opportunity pipeline, Kanban board, and sales stages',
      },
      {
        href: '/dashboard/tasks',
        label: 'Tasks',
        permission: 'crm:task:read',
        description: 'Operational tasks, follow-ups, and due dates',
      },
      {
        href: '/dashboard/tickets',
        label: 'Tickets',
        permission: 'crm:ticket:read',
        description: 'Durable customer support tickets and cases',
      },
    ],
  },
  {
    label: 'KNOWLEDGE',
    items: [
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
      {
        href: '/dashboard/knowledge-health',
        label: 'Knowledge Health',
        permission: 'document:read',
        description: 'Unanswered question clusters and source health',
      },
      {
        href: '/dashboard/evaluations',
        label: 'Evaluations',
        permission: 'evaluation:read',
        description: 'Retrieval accuracy workbench & test history',
      },
    ],
  },
  {
    label: 'INSIGHTS',
    items: [
      {
        href: '/dashboard/analytics',
        label: 'Analytics',
        permission: 'analytics:view',
        description: 'Grounding rates, retrieval latency, and query metrics',
      },
      {
        href: '/dashboard/feedback',
        label: 'Feedback',
        permission: 'feedback:review',
        description: 'User feedback, helpful ratings, and answer quality',
      },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      {
        href: '/dashboard/automations',
        label: 'Automations',
        permission: 'automation:read',
        description: 'Workspace trigger rules and outbox workflows',
      },
      {
        href: '/dashboard/integrations',
        label: 'Integrations',
        permission: 'integration:manage',
        description: 'Connected AI models, vector stores, and external tools',
      },
      {
        href: '/dashboard/users',
        label: 'Users & Access',
        permission: 'user:read',
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
