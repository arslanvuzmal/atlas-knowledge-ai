import type { Permission } from '@/lib/auth/rbac';

/**
 * Dashboard navigation.
 *
 * Each entry declares the permission it needs. The sidebar hides what the role
 * cannot use, and every page independently re-checks the same permission
 * server-side — hiding a link is a courtesy, never the control.
 */

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
        description: 'Platform status and headline figures',
      },
      {
        href: '/dashboard/analytics',
        label: 'Analytics',
        permission: 'analytics:view',
        description: 'Answer quality, usage, and content gaps',
      },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      {
        href: '/dashboard/documents',
        label: 'Documents',
        permission: 'document:read',
        description: 'Every indexed source and its processing state',
      },
      {
        href: '/dashboard/upload',
        label: 'Add sources',
        permission: 'document:upload',
        description: 'Upload files, register URLs, or write entries',
      },
      {
        href: '/dashboard/knowledge-bases',
        label: 'Knowledge bases',
        permission: 'knowledgebase:read',
        description: 'Collections that group documents',
      },
    ],
  },
  {
    label: 'Conversations',
    items: [
      {
        href: '/dashboard/conversations',
        label: 'Conversations',
        permission: 'conversation:read:own',
        description: 'Question history and retrieval outcomes',
      },
      {
        href: '/dashboard/escalations',
        label: 'Escalations',
        permission: 'escalation:read',
        description: 'Questions waiting on a human',
      },
      {
        href: '/dashboard/feedback',
        label: 'Feedback',
        permission: 'feedback:review',
        description: 'What users marked helpful or wrong',
      },
    ],
  },
  {
    label: 'Configuration',
    items: [
      {
        href: '/dashboard/retrieval',
        label: 'Retrieval',
        permission: 'settings:retrieval:read',
        description: 'Chunking, retrieval depth, and thresholds',
      },
      {
        href: '/dashboard/models',
        label: 'AI providers',
        permission: 'settings:models:read',
        description: 'Embedding and language model selection',
      },
      {
        href: '/dashboard/integrations',
        label: 'Integrations',
        permission: 'settings:models:read',
        description: 'Connected and available services',
      },
      {
        href: '/dashboard/users',
        label: 'Users and roles',
        permission: 'user:read',
        description: 'Who can reach which access level',
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        href: '/dashboard/health',
        label: 'System health',
        permission: 'health:read',
        description: 'Live component checks',
      },
      {
        href: '/dashboard/audit',
        label: 'Audit log',
        permission: 'audit:read',
        description: 'Append-only record of every action',
      },
      {
        href: '/dashboard/demo',
        label: 'Demo controls',
        permission: 'demo:reset',
        description: 'Reset demonstration activity',
      },
      {
        href: '/dashboard/settings',
        label: 'Settings',
        permission: 'chat:authenticated',
        description: 'Your account and session',
      },
    ],
  },
];
