import type { Metadata } from 'next';
import { AccessDenied } from '@/components/dashboard/access-denied';
import { Badge, InlineNote, PageHeader, Panel, PanelHeader } from '@/components/ui/primitives';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { formatDateTime } from '@/lib/ui';
import { IntegrationTestButton } from '@/components/dashboard/integration-test-button';

export const metadata: Metadata = { title: 'Integrations' };
export const dynamic = 'force-dynamic';

const STATUS_TONE = {
  CONNECTED: 'good',
  DISCONNECTED: 'neutral',
  ERROR: 'critical',
  NOT_CONFIGURED: 'neutral',
} as const;

const STATUS_LABEL = {
  CONNECTED: 'Connected',
  DISCONNECTED: 'Disconnected',
  ERROR: 'Error',
  NOT_CONFIGURED: 'Not configured',
} as const;

export default async function IntegrationsPage() {
  const session = await getSession();
  if (!hasPermission(session.role, 'settings:models:read')) {
    return <AccessDenied area="integrations" />;
  }

  const integrations = await prisma.integration.findMany({
    orderBy: [{ status: 'asc' }, { type: 'asc' }, { name: 'asc' }],
  });

  const grouped = integrations.reduce<Record<string, typeof integrations>>((accumulator, entry) => {
    accumulator[entry.type] = accumulator[entry.type] ?? [];
    accumulator[entry.type].push(entry);
    return accumulator;
  }, {});

  const TYPE_LABELS: Record<string, string> = {
    llm: 'Language models',
    embedding: 'Embedding providers',
    storage: 'Document storage',
  };

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Services this deployment can use. Credentials live only in environment variables — nothing secret is stored in the database or shown here."
      />

      <div className="space-y-6">
        {Object.entries(grouped).map(([type, entries]) => (
          <Panel key={type}>
            <PanelHeader title={TYPE_LABELS[type] ?? type} />
            <ul className="divide-y divide-edge-subtle">
              {entries.map((integration) => (
                <li
                  key={integration.id}
                  className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{integration.name}</p>
                    {integration.configurationMetadata ? (
                      <code className="mt-1 block font-mono text-[11px] text-ink-faint">
                        {JSON.stringify(integration.configurationMetadata)}
                      </code>
                    ) : null}
                    {integration.lastCheckedAt ? (
                      <p className="mt-1 text-[11px] text-ink-faint">
                        Last checked {formatDateTime(integration.lastCheckedAt)}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[integration.status]}>
                      {STATUS_LABEL[integration.status]}
                    </Badge>
                    {hasPermission(session.role, 'integration:manage') && (
                      <IntegrationTestButton
                        integrationId={integration.id}
                        _integrationName={integration.name}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>

      <div className="mt-6">
        <InlineNote>
          A provider shows as <strong className="text-ink">Not configured</strong> when its
          credential is absent from the environment. Adding the credential and restarting makes it
          selectable on the AI providers page. Live status for the two providers currently in use is
          on the System health page, which probes them rather than reading a stored value.
        </InlineNote>
      </div>
    </>
  );
}
