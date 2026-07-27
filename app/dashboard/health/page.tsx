import type { Metadata } from 'next';
import { AccessDenied } from '@/components/dashboard/access-denied';
import { HealthBadge } from '@/components/dashboard/status-badges';
import { InlineNote, PageHeader, Panel, PanelHeader } from '@/components/ui/primitives';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { getSystemHealth } from '@/lib/observability/health';
import { formatDateTime } from '@/lib/ui';

export const metadata: Metadata = { title: 'System health' };
export const dynamic = 'force-dynamic';

export default async function HealthPage() {
  const session = await getSession();
  if (!hasPermission(session.role, 'health:read')) {
    return <AccessDenied area="system health" />;
  }

  const health = await getSystemHealth();

  return (
    <>
      <PageHeader
        title="System health"
        description="Every state below reflects a check performed when this page loaded. Nothing defaults to operational."
      />

      <Panel className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Overall
            </p>
            <div className="mt-1.5">
              <HealthBadge state={health.overall} />
            </div>
          </div>
          <p className="text-xs text-ink-faint">Checked {formatDateTime(health.checkedAt)}</p>
        </div>
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2">
        {health.components.map((component) => (
          <Panel key={component.name}>
            <PanelHeader title={component.name} action={<HealthBadge state={component.state} />} />
            <div className="px-5 py-4">
              <p className="text-[13px] leading-relaxed text-ink-muted">{component.detail}</p>

              {component.metadata ? (
                <dl className="mt-3 space-y-1 font-mono text-[11px]">
                  {Object.entries(component.metadata).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-3">
                      <dt className="text-ink-faint">{key}</dt>
                      <dd className="truncate text-ink-muted">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              {component.latencyMs !== null ? (
                <p className="mt-3 font-mono text-[11px] text-ink-faint">
                  probe {component.latencyMs} ms
                </p>
              ) : null}
            </div>
          </Panel>
        ))}
      </div>

      <div className="mt-6">
        <InlineNote>
          <strong className="text-ink">What the states mean.</strong> Operational: the check
          succeeded. Demo: running on deterministic local providers by design. Degraded: reachable
          but not performing correctly. Misconfigured: reachable but rejecting the configuration.
          Unavailable: could not be reached at all.
        </InlineNote>
      </div>
    </>
  );
}
