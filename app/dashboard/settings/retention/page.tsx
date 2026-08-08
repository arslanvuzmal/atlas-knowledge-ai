import type { Metadata } from 'next';
import { AccessDenied } from '@/components/dashboard/access-denied';
import { InlineNote, PageHeader, Panel, PanelHeader } from '@/components/ui/primitives';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { DEFAULT_RETENTION, getRetentionPolicy } from '@/lib/data-lifecycle';

export const metadata: Metadata = { title: 'Retention policies' };
export const dynamic = 'force-dynamic';

export default async function RetentionSettingsPage() {
  const session = await getSession();
  if (!hasPermission(session.role, 'settings:retention:manage')) {
    return <AccessDenied area="retention policies" />;
  }

  const policy = getRetentionPolicy();

  return (
    <>
      <PageHeader
        title="Retention policies"
        description="Configure how long data is retained before automatic cleanup. Audit logs may be retained longer for compliance."
        action={
          <a
            href="#"
            onClick={async (e) => {
              e.preventDefault();
              if (!confirm('Run retention cleanup now? This will permanently delete old data.'))
                return;
              const result = await fetch('/api/settings/retention/run', { method: 'POST' });
              const data = await result.json();
              if (data.ok) {
                alert(
                  `Cleanup complete: ${Object.entries(data.deleted)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(', ')}`,
                );
                window.location.reload();
              } else {
                alert(`Cleanup failed: ${data.error}`);
              }
            }}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft"
          >
            Run cleanup now
          </a>
        }
      />

      <InlineNote>
        Retention periods apply to data older than the specified number of days. Audit logs are only
        deleted if <strong>Retain audit logs</strong> is disabled in the erasure flow. Changes apply
        immediately to the next scheduled cleanup run.
      </InlineNote>

      <Panel>
        <PanelHeader title="Retention periods" />
        <form className="space-y-5 px-5 py-5" action="/api/settings/retention" method="POST">
          <input type="hidden" name="_action" value="update" />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                key: 'conversationsDays',
                label: 'Conversations (days)',
                defaultValue: DEFAULT_RETENTION.conversationsDays,
              },
              {
                key: 'retrievalLogsDays',
                label: 'Retrieval logs (days)',
                defaultValue: DEFAULT_RETENTION.retrievalLogsDays,
              },
              {
                key: 'auditLogsDays',
                label: 'Audit logs (days)',
                defaultValue: DEFAULT_RETENTION.auditLogsDays,
              },
              {
                key: 'feedbackDays',
                label: 'Feedback (days)',
                defaultValue: DEFAULT_RETENTION.feedbackDays,
              },
              {
                key: 'escalationsDays',
                label: 'Escalations (days)',
                defaultValue: DEFAULT_RETENTION.escalationsDays,
              },
              {
                key: 'messagesDays',
                label: 'Messages (days)',
                defaultValue: DEFAULT_RETENTION.messagesDays,
              },
            ].map((field) => (
              <div key={field.key}>
                <label htmlFor={field.key} className="mb-1.5 block text-sm font-medium text-ink">
                  {field.label}
                </label>
                <input
                  id={field.key}
                  name={field.key}
                  type="number"
                  min={1}
                  max={3650}
                  step={1}
                  defaultValue={policy[field.key as keyof typeof policy]}
                  className="field"
                />
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
                  Data older than this will be deleted. Default: {field.defaultValue} days.
                </p>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink-inverse transition hover:bg-accent-soft"
            >
              Save retention policies
            </button>
            <button
              type="button"
              className="rounded-md border border-edge-strong px-4 py-2 text-sm font-medium text-ink transition hover:border-status-warning hover:text-status-warning"
              onClick={() => {
                if (confirm('Reset all retention policies to defaults?')) {
                  // TODO: implement reset
                }
              }}
            >
              Reset to defaults
            </button>
          </div>
        </form>
      </Panel>

      <Panel>
        <PanelHeader title="Manual cleanup" description="Run retention cleanup immediately." />
        <InlineNote>
          This will immediately delete data older than the configured retention periods. This action
          cannot be undone.
        </InlineNote>
        <div className="mt-4">
          <button
            onClick={async () => {
              if (!confirm('Run retention cleanup now? This will permanently delete old data.'))
                return;
              try {
                const response = await fetch('/api/settings/retention/run', { method: 'POST' });
                const data = await response.json();
                if (data.ok) {
                  alert(
                    `Cleanup complete: ${Object.entries(data.deleted)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(', ')}`,
                  );
                  window.location.reload();
                } else {
                  alert(`Cleanup failed: ${data.error}`);
                }
              } catch {
                alert('Cleanup request failed');
              }
            }}
            className="rounded-md border border-status-warning/50 px-4 py-2 text-sm font-medium text-status-warning transition hover:bg-status-warning/10"
          >
            Run cleanup now
          </button>
        </div>
      </Panel>
    </>
  );
}
